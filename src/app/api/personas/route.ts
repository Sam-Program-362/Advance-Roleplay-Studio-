import { db } from "@/db";
import { personas } from "@/db/schema";
import { asc } from "drizzle-orm";
import { ensureSchema, errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    const rows = await db.select().from(personas).orderBy(asc(personas.id));
    return json(rows);
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  try {
    await ensureSchema();
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      avatar?: string;
    };
    const name = (body.name ?? "").trim();
    if (!name) return errorJson(new Error("Persona name is required"), 400);
    const rows = await db
      .insert(personas)
      .values({
        name,
        description: (body.description ?? "").trim(),
        avatar: body.avatar ?? "",
      })
      .returning();
    return json(rows[0]);
  } catch (e) {
    return errorJson(e);
  }
}
