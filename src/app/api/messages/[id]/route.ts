import { db } from "@/db";
import { checkpoints, messages } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { content?: string };
    const rows = await db
      .update(messages)
      .set({ content: body.content ?? "" })
      .where(eq(messages.id, Number(id)))
      .returning();
    return json(rows[0] ?? null);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const mid = Number(id);
    const url = new URL(req.url);
    const cascade = url.searchParams.get("cascade") === "1";
    const row = (await db.select().from(messages).where(eq(messages.id, mid)).limit(1))[0];
    if (!row) return json({ ok: true });
    if (cascade) {
      // Revert: delete this message and everything after it in the same chat
      await db
        .delete(messages)
        .where(and(eq(messages.chatId, row.chatId), gt(messages.id, mid)));
      await db.delete(checkpoints).where(eq(checkpoints.chatId, row.chatId));
    }
    await db.delete(messages).where(eq(messages.id, mid));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
