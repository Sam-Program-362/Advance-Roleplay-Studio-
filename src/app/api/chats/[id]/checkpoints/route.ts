import { db } from "@/db";
import { checkpoints, messages } from "@/db/schema";
import { and, asc, eq, gt } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const rows = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.chatId, Number(id)))
      .orderBy(asc(checkpoints.id));
    return json(rows);
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const cid = Number(id);
    const body = (await req.json()) as {
      messageId: number;
      name?: string;
      action?: "create" | "restore";
    };
    if (body.action === "restore") {
      // Roll the conversation back: remove every message after the checkpoint
      await db
        .delete(messages)
        .where(and(eq(messages.chatId, cid), gt(messages.id, body.messageId)));
      const remaining = await db
        .select()
        .from(checkpoints)
        .where(eq(checkpoints.chatId, cid));
      for (const cp of remaining) {
        if (cp.messageId > body.messageId) {
          await db.delete(checkpoints).where(eq(checkpoints.id, cp.id));
        }
      }
      return json({ ok: true, restoredTo: body.messageId });
    }
    const rows = await db
      .insert(checkpoints)
      .values({
        chatId: cid,
        messageId: body.messageId,
        name: body.name || `Checkpoint ${new Date().toLocaleTimeString()}`,
      })
      .returning();
    return json(rows[0]);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await ctx.params;
    const url = new URL(req.url);
    const cpId = Number(url.searchParams.get("checkpointId"));
    await db.delete(checkpoints).where(eq(checkpoints.id, cpId));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
