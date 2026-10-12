import { db } from "@/db";
import {
  characterLorebooks,
  characters,
  connections,
  lorebookEntries,
  lorebooks,
  settings,
  type Connection,
} from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
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

export function errorJson(e: unknown, status = 500) {
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
