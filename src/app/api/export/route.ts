import { db } from "@/db";
import {
  characterLorebooks,
  characters,
  checkpoints,
  chats,
  lorebookEntries,
  lorebooks,
  messages,
} from "@/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { errorJson } from "@/lib/server";
import {
  BOOK_SPEC,
  CHAR_SPEC,
  CHAT_SPEC,
  SPEC_VERSION,
  type CharacterBundle,
  type ChatBundle,
  type LorebookBundle,
  type PortableBook,
  type PortableChat,
} from "@/lib/portable";

export const dynamic = "force-dynamic";

async function buildBook(bookId: number): Promise<PortableBook> {
  const b = (await db.select().from(lorebooks).where(eq(lorebooks.id, bookId)).limit(1))[0];
  const entries = await db
    .select()
    .from(lorebookEntries)
    .where(eq(lorebookEntries.lorebookId, bookId))
    .orderBy(asc(lorebookEntries.insertionOrder), asc(lorebookEntries.id));
  return {
    name: b?.name ?? "Lorebook",
    description: b?.description ?? "",
    scanDepth: b?.scanDepth ?? 8,
    tokenBudget: b?.tokenBudget ?? 1200,
    recursive: b?.recursive ?? false,
    entries: entries.map((e) => ({
      title: e.title,
      keys: e.keys ?? [],
      secondaryKeys: e.secondaryKeys ?? [],
      content: e.content,
      enabled: e.enabled,
      constant: e.constant,
      caseSensitive: e.caseSensitive,
      priority: e.priority,
      insertionOrder: e.insertionOrder,
    })),
  };
}

function download(name: string, payload: unknown) {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

function slug(s: string) {
  return (s || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? "character";
    const id = Number(url.searchParams.get("id"));
    const includeChats = url.searchParams.get("chats") !== "0";

    if (type === "lorebook") {
      const book = await buildBook(id);
      const bundle: LorebookBundle = {
        spec: BOOK_SPEC,
        spec_version: SPEC_VERSION,
        exportedAt: new Date().toISOString(),
        lorebook: book,
      };
      return download(`${slug(book.name)}.lorebook.json`, bundle);
    }

    /* ── Single chat session (also re-importable) ─────────────────── */
    if (type === "chat") {
      const c = (await db.select().from(chats).where(eq(chats.id, id)).limit(1))[0];
      if (!c) return errorJson(new Error("Session not found"), 404);
      const owner = c.characterId
        ? ((await db
            .select()
            .from(characters)
            .where(eq(characters.id, c.characterId))
            .limit(1))[0] ?? null)
        : null;
      const msgs = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, c.id))
        .orderBy(asc(messages.id));
      const cps = await db.select().from(checkpoints).where(eq(checkpoints.chatId, c.id));
      const indexById = new Map(msgs.map((m, i) => [m.id, i]));
      const bundle: ChatBundle = {
        spec: CHAT_SPEC,
        spec_version: SPEC_VERSION,
        exportedAt: new Date().toISOString(),
        characterName: owner?.name ?? "",
        characterId: c.characterId,
        chat: {
          title: c.title,
          mode: c.mode,
          summary: c.summary,
          summaryInstructions: c.summaryInstructions,
          messages: msgs.map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt?.toISOString(),
          })),
          checkpoints: cps
            .filter((cp) => indexById.has(cp.messageId))
            .map((cp) => ({ name: cp.name, messageIndex: indexById.get(cp.messageId) ?? 0 })),
        },
      };
      return download(
        `${slug(owner?.name ?? "assistant")}-${slug(c.title)}.session.json`,
        bundle,
      );
    }

    const c = (await db.select().from(characters).where(eq(characters.id, id)).limit(1))[0];
    if (!c) return errorJson(new Error("Character not found"), 404);

    const links = await db
      .select()
      .from(characterLorebooks)
      .where(eq(characterLorebooks.characterId, id));
    const books: PortableBook[] = [];
    for (const l of links) books.push(await buildBook(l.lorebookId));

    const outChats: PortableChat[] = [];
    if (includeChats) {
      const sessions = await db
        .select()
        .from(chats)
        .where(eq(chats.characterId, id))
        .orderBy(asc(chats.id));
      const ids = sessions.map((s) => s.id);
      const allMsgs = ids.length
        ? await db.select().from(messages).where(inArray(messages.chatId, ids)).orderBy(asc(messages.id))
        : [];
      const allCps = ids.length
        ? await db.select().from(checkpoints).where(inArray(checkpoints.chatId, ids))
        : [];
      for (const s of sessions) {
        const msgs = allMsgs.filter((m) => m.chatId === s.id);
        const indexById = new Map(msgs.map((m, i) => [m.id, i]));
        outChats.push({
          title: s.title,
          mode: s.mode,
          summary: s.summary,
          summaryInstructions: s.summaryInstructions,
          messages: msgs.map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt?.toISOString(),
          })),
          checkpoints: allCps
            .filter((cp) => cp.chatId === s.id && indexById.has(cp.messageId))
            .map((cp) => ({ name: cp.name, messageIndex: indexById.get(cp.messageId) ?? 0 })),
        });
      }
    }

    const bundle: CharacterBundle = {
      spec: CHAR_SPEC,
      spec_version: SPEC_VERSION,
      exportedAt: new Date().toISOString(),
      character: {
        name: c.name,
        avatar: c.avatar,
        contextBlock: c.contextBlock,
        personality: c.personality,
        scenario: c.scenario,
        firstMessage: c.firstMessage,
        alternateGreetings: c.alternateGreetings ?? [],
        exampleDialogue: c.exampleDialogue,
        creatorNotes: c.creatorNotes,
        systemPromptOverride: c.systemPromptOverride,
        postHistoryInstructions: c.postHistoryInstructions,
        tags: c.tags ?? [],
        nsfw: c.nsfw,
        background: c.background,
        backgroundBlur: c.backgroundBlur,
        backgroundOpacity: c.backgroundOpacity,
      },
      lorebooks: books,
      chats: outChats,
    };
    return download(`${slug(c.name)}.character.json`, bundle);
  } catch (e) {
    return errorJson(e);
  }
}
