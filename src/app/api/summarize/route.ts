import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import {
  errorJson,
  getActiveConnection,
  getCharacter,
  getSettings,
  json,
  toLlmConfig,
} from "@/lib/server";
import { completeOnce, estimateTokens } from "@/lib/llm";
import { SUMMARY_SYSTEM_PROMPT } from "@/lib/defaults";
import { applyMacros } from "@/lib/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      chatId: number;
      instructions?: string;
      fromScratch?: boolean;
    };
    const chatRows = await db
      .select()
      .from(chats)
      .where(eq(chats.id, body.chatId))
      .limit(1);
    const chat = chatRows[0];
    if (!chat) return errorJson(new Error("Chat not found"), 404);

    const s = await getSettings();
    const conn = await getActiveConnection(s.writerConnectionId ?? s.activeConnectionId);
    if (!conn || !conn.model) {
      return errorJson(new Error("No API connection with a model is configured."), 400);
    }
    const character = chat.characterId ? await getCharacter(chat.characterId) : null;
    const charName = character?.name || "Assistant";
    const userName = s.personaName || "User";

    const all = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chat.id))
      .orderBy(asc(messages.id));

    const fromScratch = body.fromScratch ?? false;
    const prior = fromScratch ? "" : chat.summary;
    const pending = fromScratch
      ? all
      : all.filter((m) => m.id > (chat.summarizedUpTo ?? 0));

    if (pending.length === 0) {
      return json({ summary: chat.summary, unchanged: true });
    }

    // Trim transcript to fit context
    const maxTranscript = Math.max(2000, conn.contextSize - 2000);
    const lines: string[] = [];
    let used = 0;
    for (let i = pending.length - 1; i >= 0; i--) {
      const m = pending[i];
      const speaker = m.role === "assistant" ? charName : userName;
      const line = `${speaker}: ${m.content}`;
      const cost = estimateTokens(line);
      if (used + cost > maxTranscript) break;
      lines.unshift(line);
      used += cost;
    }

    const userInstructions = (
      body.instructions ??
      chat.summaryInstructions ??
      s.summaryInstructions ??
      ""
    ).trim();

    const parts: string[] = [];
    if (prior) {
      parts.push(
        `EXISTING STORY MEMORY (absorb this and continue it seamlessly):\n${prior}`,
      );
    }
    parts.push(`NEW TRANSCRIPT TO FOLD IN:\n${lines.join("\n\n")}`);
    if (userInstructions) {
      parts.push(
        `ADDITIONAL AUTHOR INSTRUCTIONS FOR THIS MEMORY (obey these, but never break the plain-prose rule):\n${userInstructions}`,
      );
    }
    parts.push(
      `Now output the single updated STORY MEMORY as unformatted prose describing how the story built up and progressed. No lists, no headings, no character profile.`,
    );

    const text = await completeOnce(
      {
        ...toLlmConfig(conn),
        temperature: 0.6,
        maxTokens: Math.min(900, Math.max(400, conn.maxTokens)),
      },
      [
        { role: "system", content: applyMacros(SUMMARY_SYSTEM_PROMPT, { char: charName, user: userName }) },
        { role: "user", content: parts.join("\n\n---\n\n") },
      ],
    );

    const clean = text
      .replace(/^#{1,6}\s.*$/gm, "")
      .replace(/^\s*[-*•]\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/^(story memory|summary|memory)\s*:\s*/i, "")
      .trim();

    const lastId = pending[pending.length - 1].id;
    const rows = await db
      .update(chats)
      .set({ summary: clean, summarizedUpTo: lastId, updatedAt: new Date() })
      .where(eq(chats.id, chat.id))
      .returning();

    return json({ summary: clean, chat: rows[0] });
  } catch (e) {
    return errorJson(e);
  }
}
