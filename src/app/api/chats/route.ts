import { db } from "@/db";
import { characters, chats, messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { errorJson, getSettings, json } from "@/lib/server";
import { applyMacros } from "@/lib/prompt";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const characterId = url.searchParams.get("characterId");
    const rows = characterId
      ? await db
          .select()
          .from(chats)
          .where(eq(chats.characterId, Number(characterId)))
          .orderBy(desc(chats.updatedAt))
      : await db.select().from(chats).orderBy(desc(chats.updatedAt));
    return json(rows);
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      characterId?: number | null;
      title?: string;
      mode?: string;
      greetingIndex?: number;
    };
    const s = await getSettings();
    const mode = body.mode || (body.characterId ? "roleplay" : "assistant");
    const rows = await db
      .insert(chats)
      .values({
        characterId: body.characterId ?? null,
        title: body.title || "New Session",
        mode,
      })
      .returning();
    const chat = rows[0];

    if (body.characterId) {
      const cRows = await db
        .select()
        .from(characters)
        .where(eq(characters.id, body.characterId))
        .limit(1);
      const c = cRows[0];
      if (c) {
        const greetings = [c.firstMessage, ...(c.alternateGreetings ?? [])].filter(
          (g) => g && g.trim(),
        );
        const idx = body.greetingIndex ?? 0;
        const greeting = greetings[idx] ?? greetings[0];
        if (greeting) {
          await db.insert(messages).values({
            chatId: chat.id,
            role: "assistant",
            content: applyMacros(greeting, {
              char: c.name,
              user: s.personaName || "User",
            }),
          });
        }
      }
    }
    return json(chat);
  } catch (e) {
    return errorJson(e);
  }
}
