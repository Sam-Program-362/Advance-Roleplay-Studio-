import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { errorJson, getActiveConnection, getCharacter, getSettings } from "@/lib/server";
import { providerKind } from "@/lib/defaults";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Generates an illustration of the current scenario and returns it as a data
 * URL / remote URL. Deliberately writes NOTHING to the database — the image is
 * temporary and only lives in the browser until the modal is closed.
 */

type Conn = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  name: string;
};

const ASPECT_SIZE: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1792x1024",
  "9:16": "1024x1792",
};

function trimUrl(u: string) {
  return (u || "").trim().replace(/\/+$/, "");
}

function clip(s: string, n: number) {
  const t = (s || "").trim();
  return t.length > n ? t.slice(0, n).trimEnd() + "…" : t;
}

function buildScenePrompt(opts: {
  characterName: string;
  character: {
    personality?: string;
    scenario?: string;
    contextBlock?: string;
  } | null;
  personaName: string;
  personaDescription: string;
  turns: { role: string; content: string }[];
  nsfw: boolean;
}) {
  const { characterName, character, personaName, personaDescription, turns, nsfw } = opts;
  const lines: string[] = [];

  lines.push(
    "Create a vivid, high-quality illustration of the current moment in this roleplay scene.",
  );

  if (character) {
    if (character.personality?.trim()) {
      lines.push(`Character (${characterName}): ${clip(character.personality, 800)}`);
    }
    if (character.scenario?.trim()) {
      lines.push(`World & scenario: ${clip(character.scenario, 600)}`);
    }
    if (character.contextBlock?.trim()) {
      lines.push(`Art direction: ${clip(character.contextBlock, 400)}`);
    }
  }
  if (personaDescription?.trim()) {
    lines.push(`Roleplayer persona (${personaName}): ${clip(personaDescription, 400)}`);
  }

  if (turns.length) {
    lines.push(
      "Recent dialogue (the scene to depict):",
      turns
        .map((m) => `${m.role === "assistant" ? characterName : personaName}: ${clip(m.content, 600)}`)
        .join("\n"),
    );
    lines.push(
      "Depict the most recent beat of this dialogue: the characters, their expressions and body language, and the surrounding setting, composed cinematically with consistent appearances as described above.",
    );
  }

  lines.push(
    "Do not render any text, letters, captions, speech bubbles, logos or watermarks in the image.",
  );
  if (!nsfw) {
    lines.push("Keep the depiction tasteful and non-explicit.");
  }

  return lines.join("\n\n");
}

/* ---------------- provider: Google (Gemini image models) ---------------- */

async function viaGoogle(conn: Conn, model: string, prompt: string, aspect: string) {
  const base = trimUrl(conn.baseUrl || "https://generativelanguage.googleapis.com/v1beta");
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
  const headers = { "Content-Type": "application/json", "x-goog-api-key": conn.apiKey };

  // Progressive fallbacks: some image models accept an aspect-ratio config,
  // some require responseModalities, newer ones accept neither.
  const configs: Record<string, unknown>[] = [
    {
      responseModalities: ["TEXT", "IMAGE"],
      ...(aspect !== "1:1" ? { imageConfig: { aspectRatio: aspect } } : {}),
    },
    { responseModalities: ["TEXT", "IMAGE"] },
    {},
  ];

  let lastErr = "";
  for (const generationConfig of configs) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
    });
    if (!res.ok) {
      lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      if (res.status === 404) break; // unknown model — retrying configs won't help
      continue;
    }
    const j = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
    };
    const parts = j.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (p.inlineData?.data) {
        return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
      }
    }
    lastErr = "The model replied without an image (it may have been filtered).";
    break;
  }
  throw new Error(
    `Google image generation failed — ${lastErr || "unknown error"}. Check the image model in Settings → Connections → Image generation.`,
  );
}

/* ---------------- provider: OpenAI-compatible ---------------- */

async function viaOpenAiImages(conn: Conn, model: string, prompt: string, aspect: string) {
  const base = trimUrl(conn.baseUrl || "https://api.openai.com/v1");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${conn.apiKey}` };
  const size = ASPECT_SIZE[aspect] ?? "1024x1024";

  const call = (body: Record<string, unknown>) =>
    fetch(`${base}/images/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

  let res = await call({ model, prompt, n: 1, size });

  // Some endpoints (OpenRouter, local servers…) only expose image models over
  // chat completions — fall back to that before giving up.
  if (res.status === 404 || res.status === 405) {
    return viaChatImages(conn, model, prompt);
  }

  if (!res.ok) {
    let errText = await res.text();
    if (res.status === 400 && /\bsize\b/i.test(errText)) {
      res = await call({ model, prompt, n: 1 }); // model rejects the size param
      errText = res.ok ? "" : await res.text();
    }
    if (!res.ok) {
      if (res.status === 404) return viaChatImages(conn, model, prompt);
      throw new Error(
        `Image API error ${res.status}: ${errText.slice(0, 300)} — make sure the model in Settings → Connections → Image generation is an image model (e.g. dall-e-3, gpt-image-1).`,
      );
    }
  }

  const j = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const d = j.data?.[0];
  if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
  if (d?.url) return d.url;
  throw new Error("The image API returned no image data.");
}

/** Chat-completions image responses (OpenRouter & friends). */
async function viaChatImages(conn: Conn, model: string, prompt: string) {
  const base = trimUrl(conn.baseUrl);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${conn.apiKey}` };
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    throw new Error(
      `Image generation failed — HTTP ${res.status}: ${(await res.text()).slice(0, 300)}. Check the image model in Settings → Connections → Image generation.`,
    );
  }
  const j = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<Record<string, unknown>>;
        images?: Array<{ image_url?: { url?: string }; url?: string }>;
      };
    }>;
  };
  const msg = j.choices?.[0]?.message;

  if (Array.isArray(msg?.content)) {
    for (const p of msg.content) {
      const iu = p.image_url as { url?: string } | string | undefined;
      const u = typeof iu === "string" ? iu : iu?.url;
      if (u) return u;
    }
  }
  for (const im of msg?.images ?? []) {
    const u = im.image_url?.url ?? im.url;
    if (u) return u;
  }
  if (typeof msg?.content === "string") {
    const dataUrl = msg.content.match(/data:image\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrl) return dataUrl[0];
    const md = msg.content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
    if (md) return md[1];
    const bare = msg.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)\S*/i);
    if (bare) return bare[0];
  }
  throw new Error(
    "The model replied without an image. Set an image-capable model (e.g. dall-e-3, gpt-image-1 or google/gemini-2.5-flash-image) in Settings → Connections → Image generation.",
  );
}

/* ---------------- route ---------------- */

export async function POST(req: Request) {
  let body: { chatId?: number };
  try {
    body = await req.json();
  } catch (e) {
    return errorJson(e, 400);
  }
  if (!body.chatId) return errorJson(new Error("chatId is required"), 400);

  try {
    const chatRows = await db.select().from(chats).where(eq(chats.id, body.chatId)).limit(1);
    const chat = chatRows[0];
    if (!chat) return errorJson(new Error("Chat not found"), 404);

    const s = await getSettings();
    const conn = await getActiveConnection(s.imageConnectionId ?? null);
    if (!conn) {
      return errorJson(
        new Error("No API connection configured. Open Settings → Connections and add one."),
        400,
      );
    }
    if (providerKind(conn.provider) === "horde") {
      return errorJson(
        new Error(
          "AI Horde text connections cannot generate images. In Settings → Connections → Image generation, pick an OpenAI or Google connection (e.g. dall-e-3, gpt-image-1 or a Gemini image model).",
        ),
        400,
      );
    }
    const model = s.imageModel?.trim() || conn.model;
    if (!model) {
      return errorJson(
        new Error(
          `Connection "${conn.name}" has no model. Set one in Settings → Connections → Image generation.`,
        ),
        400,
      );
    }

    const character = chat.characterId ? await getCharacter(chat.characterId) : null;

    // Inject the last ~3 turns (2-3 user/assistant exchanges) of the scene.
    const recent = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chat.id))
      .orderBy(asc(messages.id));
    const turns = recent.slice(-6).map((m) => ({ role: m.role, content: m.content }));

    const prompt = buildScenePrompt({
      characterName: character?.name?.trim() || "Assistant",
      character: character
        ? {
            personality: character.personality,
            scenario: character.scenario,
            contextBlock: character.contextBlock,
          }
        : null,
      personaName: s.personaName || "User",
      personaDescription: s.personaDescription || "",
      turns,
      nsfw: Boolean(s.nsfwEnabled || character?.nsfw),
    });

    const kind = providerKind(conn.provider);
    if (kind === "anthropic") {
      return errorJson(
        new Error(
          "Anthropic models cannot generate images. In Settings → Connections → Image generation, pick an OpenAI or Google connection (e.g. dall-e-3, gpt-image-1 or a Gemini image model).",
        ),
        400,
      );
    }
    const image =
      kind === "google"
        ? await viaGoogle(conn, model, prompt, s.imageAspect || "1:1")
        : await viaOpenAiImages(conn, model, prompt, s.imageAspect || "1:1");

    return Response.json({ ok: true, image, model });
  } catch (e) {
    return errorJson(e);
  }
}

export const runtime = "nodejs";
