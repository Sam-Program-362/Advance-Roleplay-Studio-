import { HORDE_TRUSTED_KEY, providerKind } from "./defaults";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  contextSize?: number;
  extraHeaders?: Record<string, string> | null;
};

/** Progress of an in-flight AI Horde job, reported on every poll. */
export type HordeStatus = {
  phase: "queued" | "processing" | "done";
  /** Our position in the queue (0 while a worker is generating). */
  queuePosition: number;
  /** Estimated seconds until a worker picks the job up. */
  waitTime: number;
  /** Jobs queued ahead of us (plus ours). */
  waiting: number;
  /** Jobs currently being generated. */
  processing: number;
  /** Seconds since the job was submitted. */
  elapsedSec: number;
};

export type RunOptions = {
  /** Called on every Horde poll — used to drive the queue UI and keep SSE alive. */
  onStatus?: (s: HordeStatus) => void;
  /** Aborted when the user hits Stop or the HTTP client disconnects. */
  signal?: AbortSignal;
  /** Horde stop sequence ("\n{PersonaName}:"). */
  stopSequence?: string;
  /** Give up once the job has been queued this long (route is about to expire). */
  timeoutMs?: number;
};

/* ------------------------------------------------------------------ */
/* AI Horde (free, community, request-based text generation)           */
/* ------------------------------------------------------------------ */

const HORDE_DEFAULT_KEY = "0000000000";
const HORDE_CLIENT_AGENT = "RoleplayStudio:1.0:Sam-Program-362";
const HORDE_POLL_MS = 2500;
const HORDE_DEFAULT_BASE = "https://aihorde.net/api/v2";

function hordeHeaders(cfg: { apiKey?: string; extraHeaders?: Record<string, string> | null }) {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: (cfg.apiKey ?? "").trim() || HORDE_DEFAULT_KEY,
    "Client-Agent": HORDE_CLIENT_AGENT,
  };
  for (const [k, v] of Object.entries(cfg.extraHeaders ?? {})) {
    if (k && v && !k.startsWith("__")) h[k] = v;
  }
  return h;
}

/** Flatten chat messages into the single plain completion prompt Horde expects. */
function hordeFlatten(messages: ChatMessage[]) {
  return messages
    .map((m) => (m.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** The model field accepts several names separated by commas. */
export function hordeModelNames(model: string) {
  return (model || "")
    .split(",")
    .map((s) => s.trim().replace(/\s*\(\d+\s+workers?\)$/i, ""))
    .filter(Boolean);
}

function isAbort(e: unknown) {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: string }).name === "AbortError"
  );
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      },
      { once: true },
    );
  });
}

/**
 * Submits one async text job to AI Horde, polls it every 2.5s (reporting each
 * poll through `onStatus`) and resolves with the generation text. Cancels the
 * job server-side when the request is aborted or the queue wait runs too long.
 */
async function hordeRun(cfg: LlmConfig, prompt: string, opts: RunOptions): Promise<string> {
  const base = trimUrl(cfg.baseUrl) || HORDE_DEFAULT_BASE;
  const models = hordeModelNames(cfg.model);
  const trusted = (cfg.extraHeaders ?? {})[HORDE_TRUSTED_KEY] === "1";
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 150_000;

  const body: Record<string, unknown> = {
    prompt,
    params: {
      n: 1,
      max_context_length: Math.min(cfg.contextSize || 8192, 8192),
      max_length: Math.min(cfg.maxTokens || 512, 512),
      temperature: cfg.temperature,
      top_p: cfg.topP,
      rep_pen: 1.1,
      ...(opts.stopSequence ? { stop_sequence: [opts.stopSequence] } : {}),
    },
    trusted_workers: trusted,
    slow_workers: true,
  };
  if (models.length) body.models = models;

  let jobId = "";
  try {
    const res = await fetch(`${base}/generate/text/async`, {
      method: "POST",
      headers: hordeHeaders(cfg),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 600)}`);
    const j = JSON.parse(text) as { id?: string; message?: string };
    if (!j.id) throw new Error(j.message || "AI Horde rejected the request.");
    jobId = j.id;
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new Error(`AI Horde: ${e instanceof Error ? e.message : String(e)}`);
  }

  const statusUrl = `${base}/generate/text/status/${jobId}`;
  let cancelled = false;
  const cancel = async () => {
    if (cancelled) return;
    cancelled = true;
    try {
      await fetch(statusUrl, { method: "DELETE", headers: hordeHeaders(cfg) });
    } catch {
      /* best effort — the job may already be gone */
    }
  };

  try {
    while (true) {
      if (opts.signal?.aborted) {
        await cancel();
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }
      if (Date.now() - start > timeoutMs) {
        await cancel();
        throw new Error("queue too long, try again or pick a faster model");
      }

      const res = await fetch(statusUrl, { headers: hordeHeaders(cfg), signal: opts.signal });
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 404) throw new Error("AI Horde lost this job (404). Try again.");
        throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
      }
      const j = JSON.parse(text) as {
        waiting?: number;
        processing?: number;
        done?: boolean;
        faulted?: boolean;
        wait_time?: number;
        queue_position?: number;
        is_possible?: boolean;
        message?: string;
        generations?: Array<{ text?: string; worker_name?: string; model?: string }>;
      };

      const processing = Number(j.processing ?? 0);
      const status: HordeStatus = {
        phase: processing > 0 ? "processing" : "queued",
        queuePosition: Number(j.queue_position ?? 0),
        waitTime: Number(j.wait_time ?? 0),
        waiting: Number(j.waiting ?? 0),
        processing,
        elapsedSec: Math.round((Date.now() - start) / 1000),
      };

      if (j.faulted) {
        throw new Error(
          `AI Horde could not fulfil this request${j.message ? ` — ${j.message}` : ""}. Try again or pick a different model.`,
        );
      }
      if (j.is_possible === false) {
        throw new Error(
          "AI Horde says this request is impossible (prompt too long, or no worker for the chosen models). Pick a different model or shorten the context.",
        );
      }
      if (j.done) {
        opts.onStatus?.({ ...status, phase: "done" });
        const out = (j.generations?.[0]?.text ?? "").trim();
        if (!out) throw new Error("AI Horde returned an empty generation. Try again.");
        return out;
      }

      opts.onStatus?.(status);
      await sleep(HORDE_POLL_MS, opts.signal);
    }
  } catch (e) {
    if (isAbort(e)) {
      await cancel();
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    throw e;
  }
}

function trimUrl(u: string) {
  return (u || "").trim().replace(/\/+$/, "");
}

function headersFor(cfg: LlmConfig): Record<string, string> {
  const kind = providerKind(cfg.provider);
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (kind === "anthropic") {
    h["x-api-key"] = cfg.apiKey;
    h["anthropic-version"] = "2023-06-01";
  } else if (kind === "google") {
    h["x-goog-api-key"] = cfg.apiKey;
  } else {
    if (cfg.apiKey) h["Authorization"] = `Bearer ${cfg.apiKey}`;
    if (cfg.provider === "openrouter") {
      h["HTTP-Referer"] = "https://roleplay.studio";
      h["X-Title"] = "Roleplay Studio";
    }
  }
  for (const [k, v] of Object.entries(cfg.extraHeaders ?? {})) {
    if (k && v && !k.startsWith("__")) h[k] = v;
  }
  return h;
}

function splitSystem(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  // Anthropic/Google require alternating user/assistant beginning with user
  const merged: ChatMessage[] = [];
  for (const m of rest) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ ...m });
  }
  if (merged.length === 0 || merged[0].role !== "user") {
    merged.unshift({ role: "user", content: "(begin)" });
  }
  return { system, messages: merged };
}

function buildRequest(cfg: LlmConfig, messages: ChatMessage[], stream: boolean) {
  const kind = providerKind(cfg.provider);
  const base = trimUrl(cfg.baseUrl);
  if (kind === "anthropic") {
    const { system, messages: msgs } = splitSystem(messages);
    return {
      url: `${base}/messages`,
      body: {
        model: cfg.model,
        system,
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: Math.max(64, cfg.maxTokens),
        temperature: Math.min(1, cfg.temperature),
        top_p: cfg.topP,
        stream,
      },
    };
  }
  if (kind === "google") {
    const { system, messages: msgs } = splitSystem(messages);
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return {
      url: `${base}/models/${encodeURIComponent(cfg.model)}:${action}`,
      body: {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: msgs.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: cfg.temperature,
          topP: cfg.topP,
          maxOutputTokens: cfg.maxTokens,
        },
        safetySettings: [
          "HARM_CATEGORY_HARASSMENT",
          "HARM_CATEGORY_HATE_SPEECH",
          "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          "HARM_CATEGORY_DANGEROUS_CONTENT",
        ].map((category) => ({ category, threshold: "BLOCK_NONE" })),
      },
    };
  }
  return {
    url: `${base}/chat/completions`,
    body: {
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      top_p: cfg.topP,
      frequency_penalty: cfg.frequencyPenalty ?? 0,
      presence_penalty: cfg.presencePenalty ?? 0,
      stream,
    },
  };
}

function extractDelta(kind: string, json: unknown): string {
  const obj = json as Record<string, unknown>;
  try {
    if (kind === "anthropic") {
      const delta = obj?.delta as { text?: string } | undefined;
      return delta?.text ?? "";
    }
    if (kind === "google") {
      const candidates = obj?.candidates as
        | Array<{ content?: { parts?: Array<{ text?: string }> } }>
        | undefined;
      return candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    }
    const choices = obj?.choices as
      | Array<{ delta?: { content?: string }; text?: string }>
      | undefined;
    return choices?.[0]?.delta?.content ?? choices?.[0]?.text ?? "";
  } catch {
    return "";
  }
}

function extractFull(kind: string, json: unknown): string {
  const obj = json as Record<string, unknown>;
  if (kind === "anthropic") {
    const content = obj?.content as Array<{ text?: string }> | undefined;
    return content?.map((c) => c.text ?? "").join("") ?? "";
  }
  if (kind === "google") {
    const candidates = obj?.candidates as
      | Array<{ content?: { parts?: Array<{ text?: string }> } }>
      | undefined;
    return candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }
  const choices = obj?.choices as
    | Array<{ message?: { content?: string }; text?: string }>
    | undefined;
  return choices?.[0]?.message?.content ?? choices?.[0]?.text ?? "";
}

export async function completeOnce(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts?: RunOptions,
): Promise<string> {
  const kind = providerKind(cfg.provider);
  if (kind === "horde") {
    return (await hordeRun(cfg, hordeFlatten(messages), opts ?? {})).trim();
  }
  const { url, body } = buildRequest(cfg, messages, false);
  const res = await fetch(url, {
    method: "POST",
    headers: headersFor(cfg),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 600)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from provider: " + text.slice(0, 300));
  }
  return extractFull(kind, json).trim();
}

/** Streams plain text chunks from the provider. */
export async function* streamCompletion(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts?: RunOptions,
): AsyncGenerator<string> {
  const kind = providerKind(cfg.provider);
  if (kind === "horde") {
    // AI Horde has no token stream — yield the finished text in one go.
    const out = await hordeRun(cfg, hordeFlatten(messages), opts ?? {});
    if (out) yield out;
    return;
  }
  const { url, body } = buildRequest(cfg, messages, true);
  const res = await fetch(url, {
    method: "POST",
    headers: headersFor(cfg),
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${errText.slice(0, 600)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = extractDelta(kind, JSON.parse(payload));
        if (chunk) yield chunk;
      } catch {
        /* ignore malformed keepalive frames */
      }
    }
  }
}

export async function listModels(cfg: {
  provider: string;
  baseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  const kind = providerKind(cfg.provider);
  const base = trimUrl(cfg.baseUrl);
  const cfgFull: LlmConfig = {
    ...cfg,
    model: "",
    temperature: 1,
    maxTokens: 10,
    topP: 1,
  };
  if (kind === "horde") {
    const res = await fetch(`${base || HORDE_DEFAULT_BASE}/status/models?type=text`, {
      headers: hordeHeaders(cfg),
    });
    if (!res.ok) throw new Error(await res.text());
    const j = (await res.json()) as Array<{ name?: string; count?: number }>;
    return (Array.isArray(j) ? j : [])
      .map((m) => ({ name: (m?.name ?? "").trim(), count: Number(m?.count ?? 0) }))
      .filter((m) => m.name)
      .sort((a, b) => b.count - a.count)
      .map((m) => `${m.name} (${m.count} workers)`);
  }
  if (kind === "google") {
    const res = await fetch(`${base}/models`, { headers: headersFor(cfgFull) });
    if (!res.ok) throw new Error(await res.text());
    const j = (await res.json()) as { models?: Array<{ name?: string }> };
    return (j.models ?? [])
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
  }
  if (kind === "anthropic") {
    const res = await fetch(`${base}/models`, { headers: headersFor(cfgFull) });
    if (!res.ok) throw new Error(await res.text());
    const j = (await res.json()) as { data?: Array<{ id?: string }> };
    return (j.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  }
  const res = await fetch(`${base}/models`, { headers: headersFor(cfgFull) });
  if (!res.ok) throw new Error(await res.text());
  const j = (await res.json()) as { data?: Array<{ id?: string }> };
  return (j.data ?? []).map((m) => m.id ?? "").filter(Boolean).sort();
}

/**
 * Connectivity check for the Settings → Connections "Test" button on an AI
 * Horde connection. Unlike every other provider this deliberately does NOT
 * submit a generation job (which would sit in the community queue for minutes
 * and spend kudos):
 *   1. read the network heartbeat,
 *   2. if a key is set, validate it with find_user and read username/kudos,
 *   3. if models are set, count the workers currently serving each name.
 * Returns one human-readable line; throws a friendly message on failure.
 */
export async function probeHorde(cfg: {
  baseUrl: string;
  apiKey: string;
  model?: string;
}): Promise<string> {
  const base = trimUrl(cfg.baseUrl) || HORDE_DEFAULT_BASE;
  const headers = hordeHeaders({ apiKey: cfg.apiKey });

  try {
    const res = await fetch(`${base}/status/heartbeat`, { headers });
    if (!res.ok) throw new Error(`${res.status}`);
  } catch {
    throw new Error("AI Horde is unreachable right now");
  }

  const parts = ["Connected"];

  if ((cfg.apiKey ?? "").trim()) {
    let user: { username?: string; kudos?: number } | null = null;
    try {
      const res = await fetch(`${base}/find_user`, { headers });
      if (res.ok) user = (await res.json()) as { username?: string; kudos?: number };
    } catch {
      user = null;
    }
    if (!user) throw new Error("That AI Horde key wasn't accepted");
    parts.push(
      `key ok \u00b7 ${user.username || "unknown user"} (${Math.round(Number(user.kudos) || 0).toLocaleString("en-US")} kudos)`,
    );
  }

  const names = hordeModelNames(cfg.model ?? "");
  if (names.length) {
    let models: Array<{ name?: string; count?: number }> = [];
    try {
      const res = await fetch(`${base}/status/models?type=text`, { headers });
      if (res.ok) models = (await res.json()) as Array<{ name?: string; count?: number }>;
    } catch {
      models = [];
    }
    const counts = new Map(
      (Array.isArray(models) ? models : []).map((m) => [m?.name ?? "", Number(m?.count ?? 0)]),
    );
    for (const name of names) {
      const count = counts.get(name) ?? 0;
      parts.push(
        count > 0
          ? `${count} worker${count === 1 ? "" : "s"} on ${name}`
          : `No workers are serving ${name} right now`,
      );
    }
  }

  return parts.join(" \u00b7 ");
}

/** Rough token estimate — 1 token ≈ 3.7 chars for English prose. */
export function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 3.7);
}
