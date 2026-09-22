import { db } from "@/db";
import {
  characterLorebooks,
  characters,
  connections,
  lorebookEntries,
  lorebooks,
  settings,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  DEFAULT_ASSISTANT_PROMPT,
  DEFAULT_NSFW_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
  DEFAULT_SUMMARY_INSTRUCTIONS,
} from "./defaults";
import type { LlmConfig } from "./llm";
import type { ScanEntry } from "./prompt";

export async function getSettings() {
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
