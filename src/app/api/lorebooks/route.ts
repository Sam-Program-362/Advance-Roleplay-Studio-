import { db } from "@/db";
import { lorebookEntries, lorebooks } from "@/db/schema";
import { asc } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const books = await db.select().from(lorebooks).orderBy(asc(lorebooks.id));
    const entries = await db
      .select()
      .from(lorebookEntries)
      .orderBy(asc(lorebookEntries.insertionOrder), asc(lorebookEntries.id));
    return json(
      books.map((b) => ({ ...b, entries: entries.filter((e) => e.lorebookId === b.id) })),
    );
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rows = await db
      .insert(lorebooks)
      .values({
        name: (body.name as string) || "New Lorebook",
        description: (body.description as string) ?? "",
        scanDepth: (body.scanDepth as number) ?? 8,
        tokenBudget: (body.tokenBudget as number) ?? 1200,
      })
      .returning();
    const book = rows[0];
    const incoming = (body.entries as Array<Record<string, unknown>>) ?? [];
    let entries: (typeof lorebookEntries.$inferSelect)[] = [];
    if (incoming.length) {
      entries = await db
        .insert(lorebookEntries)
        .values(
          incoming.map((e, i) => ({
            lorebookId: book.id,
            title: (e.title as string) || `Entry ${i + 1}`,
            keys: (e.keys as string[]) ?? [],
            secondaryKeys: (e.secondaryKeys as string[]) ?? [],
            content: (e.content as string) ?? "",
            enabled: (e.enabled as boolean) ?? true,
            constant: (e.constant as boolean) ?? false,
            caseSensitive: (e.caseSensitive as boolean) ?? false,
            priority: (e.priority as number) ?? 100,
            insertionOrder: (e.insertionOrder as number) ?? i,
          })),
        )
        .returning();
    }
    return json({ ...book, entries });
  } catch (e) {
    return errorJson(e);
  }
}
