import { db } from "@/db";
import { memoryCards } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  CHARACTER_CARD_FIELDS,
  GLOBAL_CARD_FIELDS,
  GLOBAL_CARD_SUBJECT,
  pruneCardData,
} from "@/lib/groupCards";
import { ensureSchema, errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Memory Cards are the compressed, always-pinned state of a group chat: one
 * shared "global" card plus one card per character (subject = character id).
 * Fields are capped and trimmed here so a card can never bloat the prompt.
 */
function cleanSubject(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s === GLOBAL_CARD_SUBJECT) return GLOBAL_CARD_SUBJECT;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : null;
}

function cleanData(subject: string, raw: unknown) {
  const fields = subject === GLOBAL_CARD_SUBJECT ? GLOBAL_CARD_FIELDS : CHARACTER_CARD_FIELDS;
  return pruneCardData(
    raw && typeof raw === "object" ? (raw as Record<string, string>) : {},
    fields,
  );
}

export async function GET(req: Request) {
  try {
    await ensureSchema();
    const url = new URL(req.url);
    const chatId = Number(url.searchParams.get("chatId"));
    if (!Number.isFinite(chatId) || chatId <= 0) {
      return errorJson(new Error("chatId is required"), 400);
    }
    const rows = await db
      .select()
      .from(memoryCards)
      .where(eq(memoryCards.chatId, chatId))
      .orderBy(asc(memoryCards.id));
    return json(rows);
  } catch (e) {
    return errorJson(e);
  }
}

/** Upsert one card. Body: { chatId, subject, data }. */
export async function PUT(req: Request) {
  try {
    await ensureSchema();
    const body = (await req.json()) as {
      chatId?: number;
      subject?: string;
      data?: Record<string, string>;
    };
    const chatId = Number(body.chatId);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      return errorJson(new Error("chatId is required"), 400);
    }
    const subject = cleanSubject(body.subject);
    if (!subject) return errorJson(new Error("subject must be 'global' or a character id"), 400);
    const data = cleanData(subject, body.data);

    const existing = await db
      .select()
      .from(memoryCards)
      .where(and(eq(memoryCards.chatId, chatId), eq(memoryCards.subject, subject)))
      .limit(1);

    if (existing.length) {
      const rows = await db
        .update(memoryCards)
        .set({ data, updatedAt: new Date() })
        .where(eq(memoryCards.id, existing[0].id))
        .returning();
      return json(rows[0]);
    }

    const rows = await db
      .insert(memoryCards)
      .values({ chatId, subject, data })
      .returning();
    return json(rows[0]);
  } catch (e) {
    return errorJson(e);
  }
}
