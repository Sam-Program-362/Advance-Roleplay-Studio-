import { db } from "@/db";
import {
  chats,
  checkpoints,
  groupLorebooks,
  groupMembers,
  groups,
  memoryCards,
  messages,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { GROUP_FIELDS, normalizeBookIds, normalizeMembers } from "@/lib/groups";
import { ensureSchema, errorJson, json, loadGroupView } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const group = await loadGroupView(Number(id));
    if (!group) return json({ error: "Not found" }, 404);
    return json(group);
  } catch (e) {
    return errorJson(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    const gid = Number(id);
    const body = (await req.json()) as Record<string, unknown>;

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of GROUP_FIELDS) if (k in body) patch[k] = body[k];
    await db.update(groups).set(patch).where(eq(groups.id, gid));

    // The cast and the world lorebooks are only rewritten when the client
    // actually sends them, so a partial patch can never wipe the roster.
    if ("members" in body) {
      const members = normalizeMembers(body.members);
      await db.delete(groupMembers).where(eq(groupMembers.groupId, gid));
      if (members.length) {
        await db.insert(groupMembers).values(members.map((m) => ({ ...m, groupId: gid })));
      }
    }
    if ("lorebookIds" in body) {
      const bookIds = normalizeBookIds(body.lorebookIds);
      await db.delete(groupLorebooks).where(eq(groupLorebooks.groupId, gid));
      if (bookIds.length) {
        await db
          .insert(groupLorebooks)
          .values(bookIds.map((lorebookId) => ({ groupId: gid, lorebookId })));
      }
    }

    const group = await loadGroupView(gid);
    if (!group) return json({ error: "Not found" }, 404);
    return json(group);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    const gid = Number(id);

    // A deleted group takes its own sessions (and their cards) with it; the
    // characters themselves live in the library and are untouched.
    const owned = await db.select().from(chats).where(eq(chats.groupId, gid));
    const chatIds = owned.map((c) => c.id);
    if (chatIds.length) {
      await db.delete(messages).where(inArray(messages.chatId, chatIds));
      await db.delete(checkpoints).where(inArray(checkpoints.chatId, chatIds));
      await db.delete(memoryCards).where(inArray(memoryCards.chatId, chatIds));
      await db.delete(chats).where(inArray(chats.id, chatIds));
    }
    await db.delete(groupMembers).where(eq(groupMembers.groupId, gid));
    await db.delete(groupLorebooks).where(eq(groupLorebooks.groupId, gid));
    await db.delete(groups).where(eq(groups.id, gid));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
