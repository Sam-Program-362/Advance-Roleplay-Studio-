import { db } from "@/db";
import { connections } from "@/db/schema";
import { asc } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";
import { providerBaseUrl } from "@/lib/defaults";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.select().from(connections).orderBy(asc(connections.id));
    return json(rows);
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = (body.provider as string) || "openai";
    const rows = await db
      .insert(connections)
      .values({
        name: (body.name as string) || "New Connection",
        provider,
        baseUrl: (body.baseUrl as string) ?? providerBaseUrl(provider),
        apiKey: (body.apiKey as string) ?? "",
        model: (body.model as string) ?? "",
      })
      .returning();
    return json(rows[0]);
  } catch (e) {
    return errorJson(e);
  }
}
