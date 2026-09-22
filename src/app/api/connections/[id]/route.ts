import { db } from "@/db";
import { connections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;
    const allowed = [
      "name",
      "provider",
      "baseUrl",
      "apiKey",
      "model",
      "temperature",
      "maxTokens",
      "topP",
      "frequencyPenalty",
      "presencePenalty",
      "contextSize",
      "extraHeaders",
    ];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    const rows = await db
      .update(connections)
      .set(patch)
      .where(eq(connections.id, Number(id)))
      .returning();
    return json(rows[0] ?? null);
  } catch (e) {
    return errorJson(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await db.delete(connections).where(eq(connections.id, Number(id)));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
