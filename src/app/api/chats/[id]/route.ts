import { db } from "@/db";
import { checkpoints, chats, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const cid = Number(id);
    const rows = await db.select().from(chats).where(eq(chats.id, cid)).limit(1);
    if (!rows.length) return json({ error: "Not found" }, 404);
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, cid))
      .orderBy(asc(messages.id));
    const cps = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.chatId, cid))
      .orderBy(asc(checkpoints.id));
    return json({ ...rows[0], messages: msgs, checkpoints: cps });
  } catch (e) {
    return errorJson(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["title", "summary", "summaryInstructions", "summarizedUpTo", "mode"]) {
      if (k in body) patch[k] = body[k];
    }
    const rows = await db
      .update(chats)
      .set(patch)
      .where(eq(chats.id, Number(id)))
      .returning();
    return json(rows[0] ?? null);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const cid = Number(id);
    await db.delete(messages).where(eq(messages.chatId, cid));
    await db.delete(checkpoints).where(eq(checkpoints.chatId, cid));
    await db.delete(chats).where(eq(chats.id, cid));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
