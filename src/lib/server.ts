import { db } from "@/db";
import {
  characterLorebooks,
  characters,
  connections,
  groupLorebooks,
  groupMembers,
  groups,
  lorebookEntries,
  lorebooks,
  memoryCards,
  settings,
  type Character,
  type Connection,
  type Group,
  type GroupMember,
  type GroupState,
  type MemoryCard,
} from "@/db/schema";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  DEFAULT_ASSISTANT_PROMPT,
  DEFAULT_NSFW_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
  DEFAULT_SUMMARY_INSTRUCTIONS,
} from "./defaults";
import type { LlmConfig } from "./llm";
import type { ScanEntry } from "./prompt";

/**
 * Idempotent, once-per-process schema upgrade. Existing databases were created
 * before these columns/table existed, so ALTER/CREATE IF NOT EXISTS keeps them
 * in sync with schema.ts without requiring a manual migration run.
 */
let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const stmts = [
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS image_connection_id integer",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS image_model text NOT NULL DEFAULT ''",
        "ALTER TABLE settings ADD COLUMN IF NOT EXISTS image_aspect text NOT NULL DEFAULT '1:1'",
        "CREATE TABLE IF NOT EXISTS personas (id serial PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '', avatar text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now())",
        // --- Group Roleplay (PR 1) — additive only, never drops or rewrites ---
        "CREATE TABLE IF NOT EXISTS groups (id serial PRIMARY KEY, name text NOT NULL DEFAULT 'New Group', avatar text NOT NULL DEFAULT '', world_description text NOT NULL DEFAULT '', plot text NOT NULL DEFAULT '', concept text NOT NULL DEFAULT '', tags jsonb NOT NULL DEFAULT '[]'::jsonb, opening_scene text NOT NULL DEFAULT '', narrator_style text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())",
        "CREATE TABLE IF NOT EXISTS group_members (id serial PRIMARY KEY, group_id integer NOT NULL, character_id integer NOT NULL, role text NOT NULL DEFAULT '', depth integer NOT NULL DEFAULT 3, starts_present boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS group_lorebooks (id serial PRIMARY KEY, group_id integer NOT NULL, lorebook_id integer NOT NULL)",
        "CREATE TABLE IF NOT EXISTS memory_cards (id serial PRIMARY KEY, chat_id integer NOT NULL, subject text NOT NULL DEFAULT 'global', data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamp NOT NULL DEFAULT now())",
        "ALTER TABLE chats ADD COLUMN IF NOT EXISTS group_id integer",
        "ALTER TABLE chats ADD COLUMN IF NOT EXISTS group_state jsonb NOT NULL DEFAULT '{}'::jsonb",
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS speaker_id integer",
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT ''",
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS turn_id text",
      ];
      for (const s of stmts) await db.execute(sql.raw(s));
    })().catch((e) => {
      schemaReady = null; // retry on next call
      throw e;
    });
  }
  return schemaReady;
}

export async function getSettings() {
  await ensureSchema();
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (rows.length) return rows[0];
  const inserted = await db
    .insert(settings)
    .values({
      id: 1,
      mode: "roleplay",
      assistantSystemPrompt: DEFAULT_ASSISTANT_PROMPT,
      roleplaySystemPrompt: DEFAULT_ROLEPLAY_PROMPT,
      nsfwPrompt: DEFAULT_NSFW_PROMPT,
      summaryInstructions: DEFAULT_SUMMARY_INSTRUCTIONS,
      personaName: "User",
    })
    .returning();
  return inserted[0];
}

export async function getActiveConnection(preferId?: number | null) {
  const all = await db.select().from(connections);
  if (preferId) {
    const found = all.find((c) => c.id === preferId);
    if (found) return found;
  }
  const s = await getSettings();
  if (s.activeConnectionId) {
    const found = all.find((c) => c.id === s.activeConnectionId);
    if (found) return found;
  }
  return all[0] ?? null;
}

export function toLlmConfig(c: {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  contextSize: number;
  extraHeaders: Record<string, string> | null;
}): LlmConfig {
  return {
    provider: c.provider,
    baseUrl: c.baseUrl,
    apiKey: c.apiKey,
    model: c.model,
    temperature: c.temperature,
    maxTokens: c.maxTokens,
    topP: c.topP,
    frequencyPenalty: c.frequencyPenalty,
    presencePenalty: c.presencePenalty,
    contextSize: c.contextSize,
    extraHeaders: c.extraHeaders,
  };
}

export async function getCharacter(id: number) {
  const rows = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getCharacterLoreEntries(characterId: number | null): Promise<ScanEntry[]> {
  if (!characterId) return [];
  const links = await db
    .select()
    .from(characterLorebooks)
    .where(eq(characterLorebooks.characterId, characterId));
  const bookIds = links.map((l) => l.lorebookId);
  if (!bookIds.length) return [];
  const books = await db.select().from(lorebooks).where(inArray(lorebooks.id, bookIds));
  const entries = await db
    .select()
    .from(lorebookEntries)
    .where(inArray(lorebookEntries.lorebookId, bookIds));
  const bookMap = new Map(books.map((b) => [b.id, b]));
  return entries.map((e) => ({ ...e, book: bookMap.get(e.lorebookId) }));
}

/* ------------------------------------------------------------------ */
/* Group roleplay — shared loaders                                     */
/* ------------------------------------------------------------------ */

/** A group cast row joined with the library character it points at. */
export type GroupCastMember = { member: GroupMember; character: Character };

export async function getGroup(id: number): Promise<Group | null> {
  await ensureSchema();
  const rows = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Cast of a group, ordered, characters joined. Members whose character is gone
 * are skipped rather than crashing the scene. */
export async function getGroupCast(groupId: number): Promise<GroupCastMember[]> {
  const members = await db
    .select()
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.sortOrder), asc(groupMembers.id));
  if (!members.length) return [];
  const chars = await db
    .select()
    .from(characters)
    .where(inArray(characters.id, members.map((m) => m.characterId)));
  const byId = new Map(chars.map((c) => [c.id, c]));
  return members
    .map((member) => ({ member, character: byId.get(member.characterId) }))
    .filter((row): row is GroupCastMember => Boolean(row.character));
}

/**
 * Which characters of `cast` are in the scene right now. An unset `present`
 * list (a brand-new session) means "everyone who starts present". Ids that no
 * longer belong to the cast are ignored.
 */
export function presentCharacterIds(
  groupState: GroupState | null | undefined,
  cast: GroupCastMember[],
): number[] {
  const known = new Set(cast.map((c) => c.character.id));
  const stored = groupState?.present;
  if (Array.isArray(stored)) return stored.filter((id) => known.has(id));
  return cast.filter((c) => c.member.startsPresent).map((c) => c.character.id);
}

/** Lorebook entries for a set of lorebook ids (world lorebooks + member ones). */
export async function getLoreEntries(bookIds: number[]): Promise<ScanEntry[]> {
  const ids = [...new Set(bookIds)];
  if (!ids.length) return [];
  const books = await db.select().from(lorebooks).where(inArray(lorebooks.id, ids));
  const entries = await db
    .select()
    .from(lorebookEntries)
    .where(inArray(lorebookEntries.lorebookId, ids));
  const bookMap = new Map(books.map((b) => [b.id, b]));
  return entries.map((e) => ({ ...e, book: bookMap.get(e.lorebookId) }));
}

/**
 * The lore a group scene can see: the group's world lorebooks plus the
 * lorebooks of the members currently present. Absent members contribute
 * nothing, exactly like their profile and memory card.
 */
export async function getGroupLoreEntries(
  groupId: number,
  presentIds: number[],
): Promise<ScanEntry[]> {
  const worldLinks = await db
    .select()
    .from(groupLorebooks)
    .where(eq(groupLorebooks.groupId, groupId));
  const memberLinks = presentIds.length
    ? await db
        .select()
        .from(characterLorebooks)
        .where(inArray(characterLorebooks.characterId, presentIds))
    : [];
  return getLoreEntries([
    ...worldLinks.map((l) => l.lorebookId),
    ...memberLinks.map((l) => l.lorebookId),
  ]);
}

export async function getMemoryCards(chatId: number): Promise<MemoryCard[]> {
  await ensureSchema();
  return db.select().from(memoryCards).where(eq(memoryCards.chatId, chatId));
}

/* ------------------------------------------------------------------ */
/* Group roleplay — API payloads                                       */
/* ------------------------------------------------------------------ */

/** A cast row plus the library character's display fields (never a copy). */
export type GroupMemberView = GroupMember & {
  name: string;
  avatar: string;
  nsfw: boolean;
  tags: string[];
};

export type GroupView = Group & { members: GroupMemberView[]; lorebookIds: number[] };

async function toGroupViews(rows: Group[]): Promise<GroupView[]> {
  if (!rows.length) return [];
  const ids = rows.map((g) => g.id);
  const members = await db
    .select()
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, ids))
    .orderBy(asc(groupMembers.sortOrder), asc(groupMembers.id));
  const charIds = [...new Set(members.map((m) => m.characterId))];
  const chars = charIds.length
    ? await db.select().from(characters).where(inArray(characters.id, charIds))
    : [];
  const links = await db
    .select()
    .from(groupLorebooks)
    .where(inArray(groupLorebooks.groupId, ids));
  const byId = new Map(chars.map((c) => [c.id, c]));
  return rows.map((g) => ({
    ...g,
    members: members
      .filter((m) => m.groupId === g.id)
      .map((m) => {
        const c = byId.get(m.characterId);
        return {
          ...m,
          name: c?.name ?? "Missing character",
          avatar: c?.avatar ?? "",
          nsfw: c?.nsfw ?? false,
          tags: c?.tags ?? [],
        };
      }),
    lorebookIds: links.filter((l) => l.groupId === g.id).map((l) => l.lorebookId),
  }));
}

export async function listGroups(): Promise<GroupView[]> {
  await ensureSchema();
  const rows = await db.select().from(groups).orderBy(desc(groups.updatedAt));
  return toGroupViews(rows);
}

export async function loadGroupView(id: number): Promise<GroupView | null> {
  await ensureSchema();
  const rows = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  if (!rows.length) return null;
  return (await toGroupViews(rows))[0];
}

/** Index memory cards by subject ("global" or a character id as text). */
export function indexMemoryCards(cards: MemoryCard[]): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  for (const c of cards) map.set(String(c.subject), (c.data ?? {}) as Record<string, string>);
  return map;
}

/**
 * A connection with the secret `apiKey` stripped out. Callers that need to know
 * whether a key exists look at `hasKey` instead of ever receiving the value, so
 * no API response can leak a saved provider key to the browser.
 */
export type PublicConnection = Omit<Connection, "apiKey"> & { hasKey: boolean };

export function publicConnection(c: Connection): PublicConnection {
  const { apiKey, ...rest } = c;
  return { ...rest, hasKey: apiKey.trim().length > 0 };
}

export function json(data: unknown, status = 200) {
  return Response.json(data as Record<string, unknown>, { status });
}

/**
 * Shown when the database is reachable but has no tables yet — the normal state
 * for a brand-new (forked/self-hosted) Postgres or Neon database before the very
 * first `npm run db:push`. Postgres reports this as undefined_table (42P01).
 */
export const DB_EMPTY_MESSAGE =
  "Database is empty. Run npm run db:push once against your database.";

function isMissingSchema(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "42P01" || code === "3F000") return true;
  const message = e instanceof Error ? e.message : String(e);
  return /relation .+ does not exist/i.test(message);
}

export function errorJson(e: unknown, status = 500) {
  if (isMissingSchema(e)) {
    return Response.json({ error: DB_EMPTY_MESSAGE, code: "db_empty" }, { status: 503 });
  }
  const message = e instanceof Error ? e.message : String(e);
  return Response.json({ error: message }, { status });
}

export function sseStream(
  run: (send: (event: string, data: unknown) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        await run(send);
      } catch (e) {
        send("error", { message: e instanceof Error ? e.message : String(e) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
