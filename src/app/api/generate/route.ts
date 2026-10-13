import { db } from "@/db";
import { chats, messages, type Connection, type GroupState, type Message } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  errorJson,
  getActiveConnection,
  getCharacter,
  getCharacterLoreEntries,
  getGroup,
  getGroupCast,
  getGroupLoreEntries,
  getMemoryCards,
  getSettings,
  indexMemoryCards,
  presentCharacterIds,
  sseStream,
  toLlmConfig,
} from "@/lib/server";
import { completeOnce, streamCompletion, type RunOptions } from "@/lib/llm";
import {
  CONTINUE_INSTRUCTION,
  ELABORATE_INSTRUCTION,
  IMPERSONATE_INSTRUCTION,
  buildGroupPrompt,
  buildHordeGroupPrompt,
  buildHordePrompt,
  buildPrompt,
  scanLorebook,
  type BuildArgs,
  type BuiltPrompt,
  type GroupBuildArgs,
  type GroupMemberArgs,
} from "@/lib/prompt";
import { EMPTY_GROUP_TURN, runGroupTurn, type CommitArgs } from "@/lib/groupTurn";
import { GLOBAL_CARD_SUBJECT } from "@/lib/groupCards";
import {
  NARRATOR_LABEL,
  createSegmentParser,
  parseSegments,
  stripReasoningBlocks,
  type GroupSegment,
  type SpeakerRef,
} from "@/lib/groupSegments";
import {
  DEFAULT_ASSISTANT_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
  providerKind,
} from "@/lib/defaults";

export const dynamic = "force-dynamic";
// AI Horde jobs can sit in a community queue for minutes, so allow the longest
// runtime the plan offers (800s is the Pro/Enterprise max; Hobby caps at 300).
export const maxDuration = 300;

type Action = "send" | "regenerate" | "continue" | "elaborate" | "impersonate";

/** Give up on a Horde job shortly before the route itself is killed. */
const HORDE_TIMEOUT_MS = (maxDuration - 20) * 1000;

export async function POST(req: Request) {
  let body: {
    chatId: number;
    action?: Action;
    userContent?: string;
    connectionId?: number | null;
  };
  try {
    body = await req.json();
  } catch (e) {
    return errorJson(e, 400);
  }

  const action: Action = body.action ?? "send";

  try {
    const chatRows = await db
      .select()
      .from(chats)
      .where(eq(chats.id, body.chatId))
      .limit(1);
    const chat = chatRows[0];
    if (!chat) return errorJson(new Error("Chat not found"), 404);

    const s = await getSettings();
    const conn = await getActiveConnection(body.connectionId ?? null);
    if (!conn) {
      return errorJson(
        new Error("No API connection configured. Open Settings → Connections and add one."),
        400,
      );
    }
    const isHorde = providerKind(conn.provider) === "horde";
    // Horde may run with an empty model list (let the network choose).
    if (!conn.model && !isHorde) {
      return errorJson(new Error(`Connection "${conn.name}" has no model selected.`), 400);
    }

    // Group Roleplay: a group turn is one generation that is parsed into a
    // segment per speaker, all stamped with the same turn id.
    if (chat.groupId) {
      return await generateGroupTurn({
        signal: req.signal,
        chatId: chat.id,
        groupId: chat.groupId,
        groupState: chat.groupState,
        summary: chat.summary,
        action,
        userContent: body.userContent,
        settings: s,
        conn,
        isHorde,
      });
    }

    const character = chat.characterId ? await getCharacter(chat.characterId) : null;
    const mode: "assistant" | "roleplay" =
      chat.mode === "assistant" || !character ? "assistant" : "roleplay";

    // Persist the user's message first so the transcript is durable.
    if (action === "send" && body.userContent && body.userContent.trim()) {
      await db.insert(messages).values({
        chatId: chat.id,
        role: "user",
        content: body.userContent.trim(),
      });
    }

    let history = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chat.id))
      .orderBy(asc(messages.id));

    // Regenerate: drop the trailing assistant message.
    let replaceMessageId: number | null = null;
    let appendToMessageId: number | null = null;
    let continuationSeed: string | undefined;

    const last = history[history.length - 1];
    if (action === "regenerate") {
      if (last && last.role === "assistant") {
        replaceMessageId = last.id;
        history = history.slice(0, -1);
      }
    } else if (action === "continue") {
      if (!last || last.role !== "assistant") {
        return errorJson(new Error("Nothing to continue — the last message is not from the AI."), 400);
      }
      appendToMessageId = last.id;
      continuationSeed = last.content;
      history = history.slice(0, -1);
    } else if (action === "elaborate") {
      if (!last || last.role !== "assistant") {
        return errorJson(new Error("Nothing to elaborate on yet."), 400);
      }
      // Elaborate writes a BRAND-NEW reply that deepens the previous one —
      // it never appends into (or rewrites) the message it is elaborating on.
    }

    // Lorebook scan over the recent window
    const allEntries = await getCharacterLoreEntries(chat.characterId);
    const scanDepth = Math.max(
      4,
      ...allEntries.map((e) => e.book?.scanDepth ?? 8),
    );
    const budget = Math.max(
      400,
      ...allEntries.map((e) => e.book?.tokenBudget ?? 1200),
    );
    const recentText = history
      .slice(-scanDepth)
      .map((m) => m.content)
      .join("\n");
    const activeLore = scanLorebook(allEntries, recentText, budget);

    const taskInstruction =
      action === "continue"
        ? CONTINUE_INSTRUCTION
        : action === "elaborate"
          ? ELABORATE_INSTRUCTION
          : action === "impersonate"
            ? IMPERSONATE_INSTRUCTION
            : undefined;

    // Continue ends on the assistant's own partial message (a prefill), but
    // elaborate/impersonate are fresh directives — they go in as a new user
    // turn so every provider reliably answers instead of "continuing".

    const promptArgs: BuildArgs = {
      mode,
      action,
      character,
      personaName: s.personaName,
      personaDescription: s.personaDescription,
      assistantSystemPrompt: s.assistantSystemPrompt || DEFAULT_ASSISTANT_PROMPT,
      roleplaySystemPrompt: s.roleplaySystemPrompt || DEFAULT_ROLEPLAY_PROMPT,
      nsfw: s.nsfwEnabled || Boolean(character?.nsfw),
      nsfwPrompt: s.nsfwPrompt,
      summary: chat.summary,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      lorebookEntries: activeLore,
      lorebookBudget: budget,
      contextSize: conn.contextSize,
      maxTokens: conn.maxTokens,
      taskInstruction,
      taskInstructionRole: action === "continue" ? "system" : "user",
      continuationSeed,
    };

    // AI Horde is a plain-completion model: it gets a hand-built prose prompt
    // (no roleplay/assistant system prompt, no NSFW directive) plus a stop
    // sequence. Every other provider keeps the normal chat prompt unchanged.
    const built = isHorde ? buildHordePrompt(promptArgs) : buildPrompt(promptArgs);

    const cfg = toLlmConfig(conn);
    const hordeOpts: RunOptions | undefined = isHorde
      ? { signal: req.signal, stopSequence: built.stopSequence, timeoutMs: HORDE_TIMEOUT_MS }
      : undefined;

    // Impersonate returns text without persisting anything.
    if (action === "impersonate") {
      const raw = (await completeOnce(cfg, built.messages, hordeOpts)).trim();
      const text = cleanup(raw, character?.name ?? "", s.personaName);
      if (!text) {
        return errorJson(
          new Error(
            "The model returned an empty response. Try again, or pick a different model in Settings → Connections.",
          ),
          502,
        );
      }
      return Response.json({ ok: true, text });
    }

    // Horde always uses the SSE path so the queue status can stream to the UI.
    if (!s.streaming && !isHorde) {
      const text = cleanup(
        (await completeOnce(cfg, built.messages)).trim(),
        character?.name ?? "",
        s.personaName,
      );
      if (!text) {
        return errorJson(
          new Error(
            "The model returned an empty response. Try again, or pick a different model in Settings → Connections.",
          ),
          502,
        );
      }
      const finalText = await persist({
        chatId: chat.id,
        text,
        replaceMessageId,
        appendToMessageId,
        action,
      });
      return Response.json({ ok: true, ...finalText, stats: built.stats });
    }

    return sseStream(async (send) => {
      send("meta", { stats: built.stats, model: conn.model, connection: conn.name });
      // "horde" events carry the queue status on every poll and keep the SSE
      // connection alive while the job waits.
      const opts: RunOptions | undefined = hordeOpts
        ? { ...hordeOpts, onStatus: (status) => send("horde", status) }
        : undefined;
      let acc = "";
      for await (const chunk of streamCompletion(cfg, built.messages, opts)) {
        acc += chunk;
        send("delta", { text: chunk });
      }
      acc = cleanup(acc, character?.name ?? "", s.personaName);
      if (!acc.trim()) {
        throw new Error(
          "The model returned an empty response. Try again, or pick a different model in Settings → Connections.",
        );
      }
      const saved = await persist({
        chatId: chat.id,
        text: acc,
        replaceMessageId,
        appendToMessageId,
        action,
      });
      send("done", saved);
    });
  } catch (e) {
    return errorJson(e);
  }
}

/* ------------------------------------------------------------------ */
/* Group Roleplay turns                                                */
/* ------------------------------------------------------------------ */

type SettingsRow = Awaited<ReturnType<typeof getSettings>>;

/**
 * Runs one group turn: builds the group prompt from the PRESENT cast only,
 * streams it through the segment parser and stores every segment as its own
 * message.
 *
 * Regenerate replaces the whole previous turn (all of its segments), but only
 * once the replacement exists — see `runGroupTurn`. The planning, generation
 * and commit order is shared by the streaming and non-streaming paths, so a
 * failure or a Stop can never leave the transcript without its previous turn.
 */
async function generateGroupTurn(opts: {
  signal: AbortSignal;
  chatId: number;
  groupId: number;
  groupState: GroupState | null;
  summary: string;
  action: Action;
  userContent?: string;
  settings: SettingsRow;
  conn: Connection;
  isHorde: boolean;
}): Promise<Response> {
  const { chatId, groupId, action, conn, isHorde, settings: s } = opts;

  // Continue-style actions rewrite a single existing message, which makes no
  // sense for a multi-segment turn. Sending and regenerating is the whole
  // loop for now.
  if (action === "continue" || action === "elaborate" || action === "impersonate") {
    return errorJson(
      new Error("Group sessions support Send and Regenerate — Continue, Elaborate and Impersonate arrive in the next update."),
      400,
    );
  }

  const group = await getGroup(groupId);
  if (!group) return errorJson(new Error("Group not found"), 404);

  const cast = await getGroupCast(groupId);
  const presentIds = presentCharacterIds(opts.groupState, cast);
  const presentCast = cast.filter((c) => presentIds.includes(c.character.id));

  // The user's line is stored before generation so an aborted turn still
  // leaves a coherent transcript.
  if (action === "send" && opts.userContent?.trim()) {
    await db.insert(messages).values({
      chatId,
      role: "user",
      content: opts.userContent.trim(),
    });
  }

  // The transcript as it stands, INCLUDING the turn a regenerate would
  // replace. Nothing is deleted here: `runGroupTurn` only removes the old turn
  // inside the commit step, once the replacement actually exists.
  const stored = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.id));

  const cards = indexMemoryCards(await getMemoryCards(chatId));
  const globalCard = cards.get(GLOBAL_CARD_SUBJECT) ?? {};
  const nameById = new Map(cast.map((c) => [c.character.id, c.character.name]));

  const members: GroupMemberArgs[] = presentCast.map(({ member, character }) => ({
    characterId: character.id,
    name: character.name,
    role: member.role,
    depth: member.depth,
    personality: character.personality,
    scenario: character.scenario,
    contextBlock: character.contextBlock,
    exampleDialogue: character.exampleDialogue,
    card: cards.get(String(character.id)) ?? {},
  }));

  // Lore = the group's world lorebooks + the lorebooks of present members.
  const allLore = await getGroupLoreEntries(groupId, presentIds);
  const scanDepth = Math.max(4, ...allLore.map((e) => e.book?.scanDepth ?? 8));
  const budget = Math.max(400, ...allLore.map((e) => e.book?.tokenBudget ?? 1200));

  const speakers: SpeakerRef[] = presentCast.map((c) => ({
    id: c.character.id,
    name: c.character.name,
  }));
  const cfg = toLlmConfig(conn);
  const turnId = `g${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Builds the prompt from `history`, which for a regenerate already excludes
   * the turn being replaced, so the model never sees the text it is replacing.
   */
  let lastStats: BuiltPrompt["stats"] | null = null;
  const prepare = (history: Message[]) => {
    const recentText = history
      .slice(-scanDepth)
      .map((m) => m.content)
      .join("\n");
    const activeLore = scanLorebook(allLore, recentText, budget);

    const promptArgs: GroupBuildArgs = {
      group: {
        name: group.name,
        worldDescription: group.worldDescription,
        plot: group.plot,
        concept: group.concept,
        tags: group.tags ?? [],
        narratorStyle: group.narratorStyle,
      },
      members,
      personaName: s.personaName,
      personaDescription: s.personaDescription,
      nsfw: s.nsfwEnabled || presentCast.some((c) => c.character.nsfw),
      nsfwPrompt: s.nsfwPrompt,
      summary: opts.summary,
      globalCard,
      history: history.map((m) => ({
        role: m.role,
        content: m.content,
        speaker:
          m.role === "user"
            ? null
            : m.kind === "narration"
              ? NARRATOR_LABEL
              : m.speakerId
                ? (nameById.get(m.speakerId) ?? null)
                : null,
      })),
      lorebookEntries: activeLore,
      lorebookBudget: budget,
      contextSize: conn.contextSize,
      maxTokens: conn.maxTokens,
    };

    const built = isHorde ? buildHordeGroupPrompt(promptArgs) : buildGroupPrompt(promptArgs);
    lastStats = built.stats;
    return built;
  };

  /**
   * The ONLY place the previous turn is removed — inside the same transaction
   * that inserts the new segments. If generation threw, was aborted or came
   * back empty, this never runs and the old turn stays exactly as it was.
   */
  const commit = (args: CommitArgs<GroupSegment>): Promise<Message[]> =>
    db.transaction(async (tx) => {
      if (args.replaceTurnId) {
        await tx
          .delete(messages)
          .where(and(eq(messages.chatId, chatId), eq(messages.turnId, args.replaceTurnId)));
      } else if (args.replaceMessageId) {
        await tx.delete(messages).where(eq(messages.id, args.replaceMessageId));
      }

      const rows = await tx
        .insert(messages)
        .values(
          args.segments.map((seg) => ({
            chatId,
            role: "assistant",
            content: seg.text,
            speakerId: seg.kind === "character" ? seg.speakerId : null,
            kind: seg.kind,
            turnId: args.turnId,
          })),
        )
        .returning();

      await tx.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
      return rows;
    });

  const turnOptions = { action, messages: stored, turnId, prepare, commit };

  // Non-streaming providers get the whole reply at once and are parsed after.
  if (!s.streaming && !isHorde) {
    try {
      const outcome = await runGroupTurn({
        ...turnOptions,
        produce: async (built) =>
          parseSegments((await completeOnce(cfg, built.messages)).trim(), speakers),
      });
      return Response.json({
        ok: true,
        turnId: outcome.turnId,
        messages: outcome.committed,
        segments: outcome.segments,
        stats: lastStats,
      });
    } catch (e) {
      if (e instanceof Error && e.message === EMPTY_GROUP_TURN) return errorJson(e, 502);
      throw e;
    }
  }

  return sseStream(async (send) => {
    const outcome = await runGroupTurn({
      ...turnOptions,
      produce: async (built) => {
        send("meta", { stats: built.stats, model: conn.model, connection: conn.name });
        const runOpts: RunOptions | undefined = isHorde
          ? {
              signal: opts.signal,
              stopSequence: built.stopSequence,
              timeoutMs: HORDE_TIMEOUT_MS,
              onStatus: (status) => send("horde", status),
            }
          : undefined;
        const parser = createSegmentParser(speakers);
        for await (const chunk of streamCompletion(cfg, built.messages, runOpts)) {
          // The full segment list is resent every chunk so the client can simply
          // replace its state — no delta bookkeeping, no duplicated bubbles.
          send("segments", { segments: parser.push(chunk) });
        }
        return parser.flush();
      },
    });

    send("segments", { segments: outcome.segments });
    send("done", { turnId: outcome.turnId, messages: outcome.committed, mode: "insert" });
  });
}

/** Strip leaked role labels / OOC artefacts that break immersion. */
function cleanup(text: string, charName: string, userName: string): string {
  // Private reasoning (<think>…</think> and friends) is never part of the reply:
  // it is removed first so nothing downstream can save or display it.
  let t = stripReasoningBlocks(text, (dropped) => {
    const body = dropped.replace(/\s+/g, " ").trim().slice(0, 300);
    if (body) console.warn(`[chat] dropped reasoning text: ${body}`);
  }).replace(/^\s+/, "");
  for (const n of [charName, userName]) {
    if (!n) continue;
    const re = new RegExp(`^${escapeRe(n)}\\s*:\\s*`, "i");
    t = t.replace(re, "");
  }
  if (userName) {
    const stop = new RegExp(`\\n+${escapeRe(userName)}\\s*:\\s*[\\s\\S]*$`, "i");
    t = t.replace(stop, "");
  }
  t = t.replace(/\n*\[?\s*(OOC|Out of character)\s*:[\s\S]*$/i, "");
  t = t.replace(/<\/?(START|END)>/g, "");
  return t.trimEnd();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function persist(opts: {
  chatId: number;
  text: string;
  replaceMessageId: number | null;
  appendToMessageId: number | null;
  action: Action;
}) {
  const { chatId, text, replaceMessageId, appendToMessageId, action } = opts;
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));

  if (appendToMessageId) {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.id, appendToMessageId))
      .limit(1);
    const prev = rows[0]?.content ?? "";
    const joiner =
      action === "continue"
        ? /[.!?"*)\]]\s*$/.test(prev)
          ? " "
          : ""
        : "\n\n";
    const merged = (prev + joiner + text).trim();
    const updated = await db
      .update(messages)
      .set({ content: merged })
      .where(eq(messages.id, appendToMessageId))
      .returning();
    return { message: updated[0], mode: "append" as const };
  }

  if (replaceMessageId) {
    const updated = await db
      .update(messages)
      .set({ content: text })
      .where(eq(messages.id, replaceMessageId))
      .returning();
    return { message: updated[0], mode: "replace" as const };
  }

  const inserted = await db
    .insert(messages)
    .values({ chatId, role: "assistant", content: text })
    .returning();
  return { message: inserted[0], mode: "insert" as const };
}

export const runtime = "nodejs";
