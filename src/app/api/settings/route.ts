import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { errorJson, getSettings, json } from "@/lib/server";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await getSettings();
    await ensureSeed();
    return json(s);
  } catch (e) {
    return errorJson(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await getSettings();
    const body = (await req.json()) as Record<string, unknown>;
    const allowed = [
      "mode",
      "activeConnectionId",
      "writerConnectionId",
      "assistantSystemPrompt",
      "roleplaySystemPrompt",
      "nsfwEnabled",
      "nsfwPrompt",
      "personaName",
      "personaDescription",
      "summaryInstructions",
      "autoSummarize",
      "autoSummarizeEvery",
      "streaming",
      "theme",
    ];
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of allowed) if (k in body) patch[k] = body[k];
    const rows = await db
      .update(settings)
      .set(patch)
      .where(eq(settings.id, 1))
      .returning();
    return json(rows[0]);
  } catch (e) {
    return errorJson(e);
  }
}
