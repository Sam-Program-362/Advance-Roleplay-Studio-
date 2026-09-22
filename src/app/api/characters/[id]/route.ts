import { db } from "@/db";
import { characterLorebooks, characters, chats, messages } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const FIELDS = [
  "name",
  "avatar",
  "contextBlock",
  "personality",
  "scenario",
  "firstMessage",
  "alternateGreetings",
  "exampleDialogue",
  "creatorNotes",
  "systemPromptOverride",
  "postHistoryInstructions",
  "tags",
  "nsfw",
  "background",
  "backgroundBlur",
  "backgroundOpacity",
  "favorite",
] as const;

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const rows = await db
      .select()
      .from(characters)
      .where(eq(characters.id, Number(id)))
      .limit(1);
    if (!rows.length) return json({ error: "Not found" }, 404);
    const links = await db
      .select()
      .from(characterLorebooks)
      .where(eq(characterLorebooks.characterId, Number(id)));
    return json({ ...rows[0], lorebookIds: links.map((l) => l.lorebookId) });
  } catch (e) {
    return errorJson(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const cid = Number(id);
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of FIELDS) if (k in body && body[k] !== null) patch[k] = body[k];
    const rows = await db
      .update(characters)
      .set(patch)
      .where(eq(characters.id, cid))
      .returning();
    if (Array.isArray(body.lorebookIds)) {
      await db.delete(characterLorebooks).where(eq(characterLorebooks.characterId, cid));
      const ids = body.lorebookIds as number[];
      if (ids.length) {
        await db
          .insert(characterLorebooks)
          .values(ids.map((lorebookId) => ({ characterId: cid, lorebookId })));
      }
    }
    return json(rows[0] ?? null);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const cid = Number(id);
    const sessions = await db.select().from(chats).where(eq(chats.characterId, cid));
    const chatIds = sessions.map((s) => s.id);
    if (chatIds.length) {
      await db.delete(messages).where(inArray(messages.chatId, chatIds));
      await db.delete(chats).where(inArray(chats.id, chatIds));
    }
    await db.delete(characterLorebooks).where(eq(characterLorebooks.characterId, cid));
    await db.delete(characters).where(eq(characters.id, cid));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
