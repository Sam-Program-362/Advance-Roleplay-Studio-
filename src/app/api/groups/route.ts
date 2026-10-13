import { db } from "@/db";
import { groupLorebooks, groupMembers, groups } from "@/db/schema";
import { GROUP_FIELDS, normalizeBookIds, normalizeMembers } from "@/lib/groups";
import { ensureSchema, errorJson, json, listGroups, loadGroupView } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json(await listGroups());
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  try {
    await ensureSchema();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const k of GROUP_FIELDS) if (k in body && body[k] !== null) values[k] = body[k];
    if (!String(values.name ?? "").trim()) values.name = "New Group";

    const rows = await db.insert(groups).values(values).returning();
    const group = rows[0];

    const members = normalizeMembers(body.members);
    if (members.length) {
      await db
        .insert(groupMembers)
        .values(members.map((m) => ({ ...m, groupId: group.id })));
    }
    const bookIds = normalizeBookIds(body.lorebookIds);
    if (bookIds.length) {
      await db
        .insert(groupLorebooks)
        .values(bookIds.map((lorebookId) => ({ groupId: group.id, lorebookId })));
    }

    return json(await loadGroupView(group.id));
  } catch (e) {
    return errorJson(e);
  }
}
