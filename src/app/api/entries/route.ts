import { db } from "@/db";
import { lorebookEntries } from "@/db/schema";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const rows = await db
      .insert(lorebookEntries)
      .values({
        lorebookId: Number(body.lorebookId),
        title: (body.title as string) || "New Entry",
        keys: (body.keys as string[]) ?? [],
        secondaryKeys: (body.secondaryKeys as string[]) ?? [],
        content: (body.content as string) ?? "",
        constant: (body.constant as boolean) ?? false,
        priority: (body.priority as number) ?? 100,
        insertionOrder: (body.insertionOrder as number) ?? 0,
      })
      .returning();
    return json(rows[0]);
  } catch (e) {
    return errorJson(e);
  }
}
