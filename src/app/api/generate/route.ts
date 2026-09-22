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
import { completeOnce, streamCompletion } from "@/lib/llm";
import {
  CONTINUE_INSTRUCTION,
  ELABORATE_INSTRUCTION,
  IMPERSONATE_INSTRUCTION,
  buildPrompt,
  scanLorebook,
} from "@/lib/prompt";
import { DEFAULT_ASSISTANT_PROMPT, DEFAULT_ROLEPLAY_PROMPT } from "@/lib/defaults";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Action = "send" | "regenerate" | "continue" | "elaborate" | "impersonate";

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
    if (!conn.model) {
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
      appendToMessageId = last.id;
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

    const built = buildPrompt({
      mode,
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
      continuationSeed,
    });

    const cfg = toLlmConfig(conn);

    // Impersonate returns text without persisting anything.
    if (action === "impersonate") {
      const text = await completeOnce(cfg, built.messages);
      return Response.json({ ok: true, text: text.trim() });
    }

    if (!s.streaming) {
      const text = (await completeOnce(cfg, built.messages)).trim();
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
      let acc = "";
      for await (const chunk of streamCompletion(cfg, built.messages)) {
        acc += chunk;
        send("delta", { text: chunk });
      }
      acc = cleanup(acc, character?.name ?? "", s.personaName);
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
  if (charName) {
    const re = new RegExp(`^${escapeRe(charName)}\\s*:\\s*`, "i");
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
