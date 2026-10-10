import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import {
  errorJson,
  getActiveConnection,
  getCharacter,
  getCharacterLoreEntries,
  getSettings,
  sseStream,
  toLlmConfig,
} from "@/lib/server";
import { completeOnce, streamCompletion, type RunOptions } from "@/lib/llm";
import {
  CONTINUE_INSTRUCTION,
  ELABORATE_INSTRUCTION,
  IMPERSONATE_INSTRUCTION,
  buildHordePrompt,
  buildPrompt,
  scanLorebook,
  type BuildArgs,
} from "@/lib/prompt";
import {
  DEFAULT_ASSISTANT_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
  providerKind,
} from "@/lib/defaults";

export const dynamic = "force-dynamic";
// AI Horde jobs can sit in a community queue for minutes, so allow the longest
// runtime the plan offers (800s is the Pro/Enterprise max; Hobby caps at 300).
export const maxDuration = 800;

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

/** Strip leaked role labels / OOC artefacts that break immersion. */
function cleanup(text: string, charName: string, userName: string): string {
  let t = text.replace(/^\s+/, "");
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
