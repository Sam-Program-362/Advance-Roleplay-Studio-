import { db } from "@/db";
import { characterLorebooks, lorebookEntries, lorebooks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const k of ["name", "description", "scanDepth", "tokenBudget", "recursive"]) {
      if (k in body) patch[k] = body[k];
    }
    const rows = await db
      .update(lorebooks)
      .set(patch)
      .where(eq(lorebooks.id, Number(id)))
      .returning();
    return json(rows[0] ?? null);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const bid = Number(id);
    await db.delete(lorebookEntries).where(eq(lorebookEntries.lorebookId, bid));
    await db.delete(characterLorebooks).where(eq(characterLorebooks.lorebookId, bid));
    await db.delete(lorebooks).where(eq(lorebooks.id, bid));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
