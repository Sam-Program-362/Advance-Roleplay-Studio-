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
import { errorJson, json } from "@/lib/server";
import {
  detectKind,
  normalizeBook,
  normalizeCharacter,
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

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const hintRaw = new URL(req.url).searchParams.get("kind");
    const kind = hintRaw && hintRaw !== "auto" ? hintRaw : detectKind(payload);

    if (kind === "lorebook") {
      const root = (payload ?? {}) as Record<string, unknown>;
      const book = normalizeBook(root.lorebook ?? root);
      const created = await insertBook(book);
      return json({ ok: true, kind: "lorebook", lorebookId: created.id, name: created.name });
    }

    if (kind === "character") {
      const { character, lorebooks: books, chats: sessions } = normalizeCharacter(payload);
      const rows = await db
        .insert(characters)
        .values({
          name: character.name,
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
        const chatRows = await db
          .insert(chats)
          .values({
            characterId: created.id,
            title: s.title,
            mode: s.mode,
            summary: s.summary,
            summaryInstructions: s.summaryInstructions,
          })
          .returning();
        const chat = chatRows[0];
        if (s.messages.length) {
          const inserted = await db
            .insert(messages)
            .values(
              s.messages.map((m) => ({
                chatId: chat.id,
                role: m.role,
                content: m.content,
              })),
            )
            .returning();
          importedMessages += inserted.length;
          if (s.checkpoints.length) {
            const cps = s.checkpoints
              .filter((cp) => inserted[cp.messageIndex])
              .map((cp) => ({
                chatId: chat.id,
                messageId: inserted[cp.messageIndex].id,
                name: cp.name,
              }));
            if (cps.length) await db.insert(checkpoints).values(cps);
          }
        }
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
      new Error("Unrecognised JSON. Expected a Roleplay Studio character/lorebook bundle or a Tavern character card."),
      400,
    );
  } catch (e) {
    return errorJson(e, 400);
  }
}
