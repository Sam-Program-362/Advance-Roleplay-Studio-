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
import { eq } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";
import {
  detectKind,
  normalizeBook,
  normalizeChat,
  normalizeCharacter,
  unwrap,
  type ImportKind,
  type PortableBook,
} from "@/lib/portable";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function insertBook(book: PortableBook) {
  const rows = await db
    .insert(lorebooks)
    .values({
      name: book.name,
      description: book.description,
      scanDepth: book.scanDepth,
      tokenBudget: book.tokenBudget,
      recursive: book.recursive,
    })
    .returning();
  const created = rows[0];
  if (book.entries.length) {
    await db.insert(lorebookEntries).values(
      book.entries.map((e, i) => ({
        lorebookId: created.id,
        title: e.title,
        keys: e.keys,
        secondaryKeys: e.secondaryKeys,
        content: e.content,
        enabled: e.enabled,
        constant: e.constant,
        caseSensitive: e.caseSensitive,
        priority: e.priority,
        insertionOrder: e.insertionOrder ?? i,
      })),
    );
  }
  return created;
}

async function insertChat(
  characterId: number | null,
  raw: unknown,
  titleFallback: string,
) {
  const s = normalizeChat(raw);
  const chatRows = await db
    .insert(chats)
    .values({
      characterId,
      title: s.title || titleFallback,
      mode: s.mode || (characterId ? "roleplay" : "assistant"),
      summary: s.summary,
      summaryInstructions: s.summaryInstructions,
    })
    .returning();
  const chat = chatRows[0];
  let count = 0;
  if (s.messages.length) {
    const inserted = await db
      .insert(messages)
      .values(s.messages.map((m) => ({ chatId: chat.id, role: m.role, content: m.content })))
      .returning();
    count = inserted.length;
    const cps = s.checkpoints
      .filter((cp) => inserted[cp.messageIndex])
      .map((cp) => ({ chatId: chat.id, messageId: inserted[cp.messageIndex].id, name: cp.name }));
    if (cps.length) await db.insert(checkpoints).values(cps);
  }
  return { chat, count };
}

/** Tolerates a UTF-8 BOM and stray text around the JSON object/array. */
function parseLooseBody(text: string): unknown {
  const t = text.replace(/^\uFEFF/, "").replace(/^\s+|\s+$/g, "");
  if (!t) throw new Error("the file is empty");
  try {
    return JSON.parse(t);
  } catch {
    /* recover below */
  }
  const attempts: string[] = [];
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) attempts.push(t.slice(a, b + 1));
  const c = t.indexOf("[");
  const d = t.lastIndexOf("]");
  if (c >= 0 && d > c) attempts.push(t.slice(c, d + 1));
  for (const s of attempts) {
    try {
      return JSON.parse(s);
    } catch {
      /* next */
    }
  }
  throw new Error("not valid JSON");
}

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = parseLooseBody(await req.text());
  } catch (e) {
    return errorJson(
      new Error(
        `The file could not be read as JSON — ${e instanceof Error ? e.message : "unparseable"}.`,
      ),
      400,
    );
  }

  try {
    const url = new URL(req.url);
    const hintRaw = url.searchParams.get("kind");
    const kind: ImportKind =
      hintRaw && hintRaw !== "auto" ? (hintRaw as ImportKind) : detectKind(payload);

    if (!payload || typeof payload !== "object") {
      return errorJson(new Error("This file does not contain a JSON object."), 400);
    }

    /* ── Lorebook / world info ─────────────────────────────────────── */
    if (kind === "lorebook") {
      const root = unwrap(payload);
      const book = normalizeBook(root.lorebook ?? root);
      if (!book.entries.length && !book.name) {
        return errorJson(new Error("No lorebook entries found in this file."), 400);
      }
      const created = await insertBook(book);
      return json({
        ok: true,
        kind: "lorebook",
        lorebookId: created.id,
        name: created.name,
        entries: book.entries.length,
      });
    }

    /* ── Standalone session export ─────────────────────────────────── */
    if (kind === "chat") {
      const root = unwrap(payload);
      const chatRaw =
        root.chat && typeof root.chat === "object" && !Array.isArray(root.chat)
          ? root.chat
          : root;

      let characterId = Number(url.searchParams.get("characterId")) || null;

      if (!characterId && typeof root.characterName === "string" && root.characterName.trim()) {
        const all = await db.select().from(characters);
        const wanted = root.characterName.trim().toLowerCase();
        const match = all.find((c) => c.name.trim().toLowerCase() === wanted);
        if (match) characterId = match.id;
      }

      const { chat, count } = await insertChat(
        characterId,
        chatRaw,
        (root.characterName as string) || "Imported session",
      );
      return json({ ok: true, kind: "chat", chatId: chat.id, characterId, messages: count });
    }

    /* ── Character card / studio bundle ────────────────────────────── */
    if (kind === "character") {
      const { character, lorebooks: books, chats: sessions } = normalizeCharacter(payload);

      if (!character.name && !character.personality && !character.firstMessage) {
        return errorJson(
          new Error(
            "This JSON does not look like a character card (no name, description or first message found).",
          ),
          400,
        );
      }

      const rows = await db
        .insert(characters)
        .values({
          name: character.name || "Imported Character",
          avatar: character.avatar,
          contextBlock: character.contextBlock,
          personality: character.personality,
          scenario: character.scenario,
          firstMessage: character.firstMessage,
          alternateGreetings: character.alternateGreetings,
          exampleDialogue: character.exampleDialogue,
          creatorNotes: character.creatorNotes,
          systemPromptOverride: character.systemPromptOverride,
          postHistoryInstructions: character.postHistoryInstructions,
          tags: character.tags,
          nsfw: character.nsfw,
          background: character.background,
          backgroundBlur: character.backgroundBlur,
          backgroundOpacity: character.backgroundOpacity,
        })
        .returning();
      const created = rows[0];

      for (const b of books) {
        const book = await insertBook(b);
        await db
          .insert(characterLorebooks)
          .values({ characterId: created.id, lorebookId: book.id });
      }

      let importedMessages = 0;
      for (const s of sessions) {
        const res = await insertChat(created.id, s, s.title);
        importedMessages += res.count;
      }

      return json({
        ok: true,
        kind: "character",
        characterId: created.id,
        name: created.name,
        lorebooks: books.length,
        chats: sessions.length,
        messages: importedMessages,
      });
    }

    return errorJson(
      new Error(
        "Unrecognised JSON — expected a Roleplay Studio character/session/lorebook bundle, a Tavern character card (chara_card_v2/v3), a character JSON, or a SillyTavern world-info/lorebook file.",
      ),
      400,
    );
  } catch (e) {
    return errorJson(e, 400);
  }
}
