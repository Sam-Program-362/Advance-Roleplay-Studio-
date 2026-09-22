import { db } from "@/db";
import { lorebookEntries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const k of [
      "title",
      "keys",
      "secondaryKeys",
      "content",
      "enabled",
      "constant",
      "caseSensitive",
      "priority",
      "insertionOrder",
    ]) {
      if (k in body) patch[k] = body[k];
    }
    const rows = await db
      .update(lorebookEntries)
      .set(patch)
      .where(eq(lorebookEntries.id, Number(id)))
      .returning();
    return json(rows[0] ?? null);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await db.delete(lorebookEntries).where(eq(lorebookEntries.id, Number(id)));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
