import { db } from "@/db";
import { characterLorebooks, characters } from "@/db/schema";
import { desc } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.select().from(characters).orderBy(desc(characters.updatedAt));
    const links = await db.select().from(characterLorebooks);
    return json(
      rows.map((c) => ({
        ...c,
        lorebookIds: links.filter((l) => l.characterId === c.id).map((l) => l.lorebookId),
      })),
    );
  } catch (e) {
    return errorJson(e);
  }
}

const FIELDS = [
  "name",
  "avatar",
  "contextBlock",
  "personality",
  "scenario",
  "firstMessage",
  "alternateGreetings",
  "exampleDialogue",
  "creatorNotes",
  "systemPromptOverride",
  "postHistoryInstructions",
  "tags",
  "nsfw",
  "background",
  "backgroundBlur",
  "backgroundOpacity",
  "favorite",
] as const;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const k of FIELDS) if (k in body && body[k] !== null) values[k] = body[k];
    if (!values.name) values.name = "New Character";
    const rows = await db.insert(characters).values(values).returning();
    const created = rows[0];
    const bookIds = (body.lorebookIds as number[]) ?? [];
    if (bookIds.length) {
      await db
        .insert(characterLorebooks)
        .values(bookIds.map((lorebookId) => ({ characterId: created.id, lorebookId })));
    }
    return json({ ...created, lorebookIds: bookIds });
  } catch (e) {
    return errorJson(e);
  }
}
