import { db } from "@/db";
import { personas } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSchema, errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const FIELDS = ["name", "description", "avatar"] as const;

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const k of FIELDS) if (k in body && body[k] !== null) patch[k] = body[k];
    if ("name" in patch && !String(patch.name).trim()) {
      return errorJson(new Error("Persona name is required"), 400);
    }
    const rows = await db
      .update(personas)
      .set(patch)
      .where(eq(personas.id, Number(id)))
      .returning();
    if (!rows.length) return errorJson(new Error("Persona not found"), 404);
    return json(rows[0]);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await ensureSchema();
    const { id } = await ctx.params;
    await db.delete(personas).where(eq(personas.id, Number(id)));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
