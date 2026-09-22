"use client";

export type Connection = {
  id: number;
  name: string;
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
};

export type AppSettings = {
  id: number;
  mode: "assistant" | "roleplay";
  activeConnectionId: number | null;
  writerConnectionId: number | null;
  assistantSystemPrompt: string;
  roleplaySystemPrompt: string;
  nsfwEnabled: boolean;
  nsfwPrompt: string;
  personaName: string;
  personaDescription: string;
  summaryInstructions: string;
  autoSummarize: boolean;
  autoSummarizeEvery: number;
  streaming: boolean;
  theme: string;
};

export type Character = {
  id: number;
  name: string;
  avatar: string;
  contextBlock: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  alternateGreetings: string[];
  exampleDialogue: string;
  creatorNotes: string;
  systemPromptOverride: string;
  postHistoryInstructions: string;
  tags: string[];
  nsfw: boolean;
  background: string;
  backgroundBlur: number;
  backgroundOpacity: number;
  favorite: boolean;
  lorebookIds?: number[];
};

export type LoreEntry = {
  id: number;
  lorebookId: number;
  title: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  caseSensitive: boolean;
  priority: number;
  insertionOrder: number;
};

export type Lorebook = {
  id: number;
  name: string;
  description: string;
  scanDepth: number;
  tokenBudget: number;
  recursive: boolean;
  entries: LoreEntry[];
};

export type ChatSession = {
  id: number;
  characterId: number | null;
  title: string;
  mode: string;
  summary: string;
  summaryInstructions: string;
  summarizedUpTo: number;
  updatedAt: string;
};

export type ChatMessage = { id: number; chatId: number; role: string; content: string };
export type Checkpoint = { id: number; chatId: number; messageId: number; name: string };

export type FullChat = ChatSession & { messages: ChatMessage[]; checkpoints: Checkpoint[] };

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text.slice(0, 300) || res.statusText);
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  settings: () => req<AppSettings>("/api/settings"),
  saveSettings: (patch: Partial<AppSettings>) =>
    req<AppSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  connections: () => req<Connection[]>("/api/connections"),
  addConnection: (body: Partial<Connection>) =>
    req<Connection>("/api/connections", { method: "POST", body: JSON.stringify(body) }),
  saveConnection: (id: number, patch: Partial<Connection>) =>
    req<Connection>(`/api/connections/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteConnection: (id: number) =>
    req<{ ok: true }>(`/api/connections/${id}`, { method: "DELETE" }),
  probe: (body: {
    action: "models" | "test";
    provider: string;
    baseUrl: string;
    apiKey: string;
    model?: string;
  }) =>
    req<{ ok: boolean; models?: string[]; reply?: string }>("/api/connections/probe", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  characters: () => req<Character[]>("/api/characters"),
  addCharacter: (body: Partial<Character>) =>
    req<Character>("/api/characters", { method: "POST", body: JSON.stringify(body) }),
  saveCharacter: (id: number, patch: Partial<Character>) =>
    req<Character>(`/api/characters/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCharacter: (id: number) =>
    req<{ ok: true }>(`/api/characters/${id}`, { method: "DELETE" }),

  lorebooks: () => req<Lorebook[]>("/api/lorebooks"),
  addLorebook: (body: Partial<Lorebook>) =>
    req<Lorebook>("/api/lorebooks", { method: "POST", body: JSON.stringify(body) }),
  saveLorebook: (id: number, patch: Partial<Lorebook>) =>
    req<Lorebook>(`/api/lorebooks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteLorebook: (id: number) =>
    req<{ ok: true }>(`/api/lorebooks/${id}`, { method: "DELETE" }),

  addEntry: (body: Partial<LoreEntry> & { lorebookId: number }) =>
    req<LoreEntry>("/api/entries", { method: "POST", body: JSON.stringify(body) }),
  saveEntry: (id: number, patch: Partial<LoreEntry>) =>
    req<LoreEntry>(`/api/entries/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteEntry: (id: number) => req<{ ok: true }>(`/api/entries/${id}`, { method: "DELETE" }),

  chats: (characterId?: number | null) =>
    req<ChatSession[]>(
      characterId == null ? "/api/chats" : `/api/chats?characterId=${characterId}`,
    ),
  chat: (id: number) => req<FullChat>(`/api/chats/${id}`),
  addChat: (body: { characterId?: number | null; title?: string; mode?: string; greetingIndex?: number }) =>
    req<ChatSession>("/api/chats", { method: "POST", body: JSON.stringify(body) }),
  saveChat: (id: number, patch: Partial<ChatSession>) =>
    req<ChatSession>(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteChat: (id: number) => req<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" }),

  addMessage: (chatId: number, role: string, content: string) =>
    req<ChatMessage>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    }),
  saveMessage: (id: number, content: string) =>
    req<ChatMessage>(`/api/messages/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteMessage: (id: number, cascade = false) =>
    req<{ ok: true }>(`/api/messages/${id}${cascade ? "?cascade=1" : ""}`, { method: "DELETE" }),

  addCheckpoint: (chatId: number, messageId: number, name?: string) =>
    req<Checkpoint>(`/api/chats/${chatId}/checkpoints`, {
      method: "POST",
      body: JSON.stringify({ messageId, name, action: "create" }),
    }),
  restoreCheckpoint: (chatId: number, messageId: number) =>
    req<{ ok: true }>(`/api/chats/${chatId}/checkpoints`, {
      method: "POST",
      body: JSON.stringify({ messageId, action: "restore" }),
    }),
  deleteCheckpoint: (chatId: number, checkpointId: number) =>
    req<{ ok: true }>(`/api/chats/${chatId}/checkpoints?checkpointId=${checkpointId}`, {
      method: "DELETE",
    }),

  summarize: (chatId: number, instructions?: string, fromScratch?: boolean) =>
    req<{ summary: string }>("/api/summarize", {
      method: "POST",
      body: JSON.stringify({ chatId, instructions, fromScratch }),
    }),

  writer: (body: {
    block: string;
    currentText?: string;
    hint?: string;
    nsfw?: boolean;
    context?: Record<string, unknown>;
  }) => req<{ text: string }>("/api/writer", { method: "POST", body: JSON.stringify(body) }),

  importJson: (
    payload: unknown,
    kind: "auto" | "character" | "lorebook" | "chat" = "auto",
    characterId?: number | null,
  ) =>
    req<{
      ok: boolean;
      kind: string;
      characterId?: number;
      chatId?: number;
      lorebookId?: number;
      name?: string;
      messages?: number;
      lorebooks?: number;
      chats?: number;
    }>(
      `/api/import?kind=${kind}${characterId ? `&characterId=${characterId}` : ""}`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
};

/* ---------------- streaming generate ---------------- */

export type GenerateEvents = {
  onMeta?: (m: { stats: Record<string, unknown>; model: string }) => void;
  onDelta?: (t: string) => void;
  onDone?: (d: { message: ChatMessage; mode: string }) => void;
  onError?: (msg: string) => void;
};

export async function generate(
  body: { chatId: number; action?: string; userContent?: string },
  ev: GenerateEvents,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as {
        error?: string;
        message?: ChatMessage;
        mode?: string;
        text?: string;
      };
      if (!res.ok || j.error) {
        ev.onError?.(j.error ?? "Generation failed");
        return;
      }
      if (j.message) {
        ev.onDelta?.(j.message.content);
        ev.onDone?.({ message: j.message, mode: j.mode ?? "insert" });
      }
      return;
    } catch {
      ev.onError?.(text.slice(0, 300) || "Generation failed");
      return;
    }
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split("\n");
      const evName = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
      const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (!evName || !dataLine) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (evName === "meta") ev.onMeta?.(data as never);
      else if (evName === "delta") ev.onDelta?.(String(data.text ?? ""));
      else if (evName === "done") ev.onDone?.(data as never);
      else if (evName === "error") ev.onError?.(String(data.message ?? "error"));
    }
  }
}

/* ---------------- image upload helper ---------------- */

export function fileToDataUrl(file: File, maxSize = 640, quality = 0.86): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Not a valid image"));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Tolerant JSON reader: strips a UTF-8 BOM, ignores trailing/leading junk and
 * falls back to the outermost object or array, so files exported by other
 * Roleplay platforms (SillyTavern, Janitor, Chub, Agnai…) still load.
 */
export function parseJsonLoose(text: string): unknown {
  const t = text.replace(/^\uFEFF/, "").replace(/^\s+|\s+$/g, "");
  if (!t) throw new Error("the file is empty");
  try {
    return JSON.parse(t);
  } catch {
    /* try to recover below */
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
      /* next attempt */
    }
  }
  throw new Error("the file is not valid JSON");
}

export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read "${file.name}"`));
    reader.onload = () => {
      try {
        resolve(parseJsonLoose(String(reader.result ?? "")));
      } catch (e) {
        reject(
          new Error(`"${file.name}" — ${e instanceof Error ? e.message : "not valid JSON"}`),
        );
      }
    };
    reader.readAsText(file);
  });
}
