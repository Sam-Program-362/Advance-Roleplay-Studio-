import { db } from "@/db";
import { characters, chats, groups, messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSchema, errorJson, getSettings, json } from "@/lib/server";
import { applyMacros } from "@/lib/prompt";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const characterId = url.searchParams.get("characterId");
    const groupId = url.searchParams.get("groupId");
    const rows = groupId
      ? await db
          .select()
          .from(chats)
          .where(eq(chats.groupId, Number(groupId)))
          .orderBy(desc(chats.updatedAt))
      : characterId
        ? await db
            .select()
            .from(chats)
            .where(eq(chats.characterId, Number(characterId)))
            .orderBy(desc(chats.updatedAt))
        : await db.select().from(chats).orderBy(desc(chats.updatedAt));
    return json(rows);
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      characterId?: number | null;
      groupId?: number | null;
      title?: string;
      mode?: string;
      greetingIndex?: number;
    };
    const s = await getSettings();

    // Group session: the group IS the chat. The opening scene lands in the
    // transcript as the first narration segment so the scene always starts
    // from the same beat.
    if (body.groupId) {
      await ensureSchema();
      const groupRows = await db
        .select()
        .from(groups)
        .where(eq(groups.id, Number(body.groupId)))
        .limit(1);
      const group = groupRows[0];
      if (!group) return errorJson(new Error("Group not found"), 404);

      const rows = await db
        .insert(chats)
        .values({
          characterId: null,
          groupId: group.id,
          groupState: {},
          title: body.title?.trim() || group.name || "Group Session",
          mode: "group",
        })
        .returning();
      const chat = rows[0];

      if (group.openingScene?.trim()) {
        await db.insert(messages).values({
          chatId: chat.id,
          role: "assistant",
          content: applyMacros(group.openingScene, {
            char: group.name,
            user: s.personaName || "User",
          }),
          kind: "narration",
        });
      }
      return json(chat);
    }

    const mode = body.mode || (body.characterId ? "roleplay" : "assistant");
    const rows = await db
      .insert(chats)
      .values({
        characterId: body.characterId ?? null,
        title: body.title || "New Session",
        mode,
      })
      .returning();
    const chat = rows[0];

    if (body.characterId) {
      const cRows = await db
        .select()
        .from(characters)
        .where(eq(characters.id, body.characterId))
        .limit(1);
      const c = cRows[0];
      if (c) {
        const greetings = [c.firstMessage, ...(c.alternateGreetings ?? [])].filter(
          (g) => g && g.trim(),
        );
        const idx = body.greetingIndex ?? 0;
        const greeting = greetings[idx] ?? greetings[0];
        if (greeting) {
          await db.insert(messages).values({
            chatId: chat.id,
            role: "assistant",
            content: applyMacros(greeting, {
              char: c.name,
              user: s.personaName || "User",
            }),
          });
        }
      }
    }
    return json(chat);
  } catch (e) {
    return errorJson(e);
  }
}
