import { providerKind } from "./defaults";

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
  extraHeaders?: Record<string, string> | null;
};

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
    if (k && v) h[k] = v;
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

export async function completeOnce(cfg: LlmConfig, messages: ChatMessage[]): Promise<string> {
  const kind = providerKind(cfg.provider);
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
): AsyncGenerator<string> {
  const kind = providerKind(cfg.provider);
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

/** Rough token estimate — 1 token ≈ 3.7 chars for English prose. */
export function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 3.7);
}
