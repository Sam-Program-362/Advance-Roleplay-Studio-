import type { Character, LorebookEntry, Lorebook } from "@/db/schema";
import { estimateTokens, type ChatMessage } from "./llm";
import { DEFAULT_NSFW_PROMPT, DEFAULT_ROLEPLAY_PROMPT } from "./defaults";

export type MacroCtx = { char: string; user: string };

export function applyMacros(text: string, ctx: MacroCtx): string {
  if (!text) return "";
  const now = new Date();
  return text
    .replace(/\{\{char\}\}|<BOT>/gi, ctx.char)
    .replace(/\{\{user\}\}|<USER>/gi, ctx.user)
    .replace(/\{\{name\}\}/gi, ctx.char)
    .replace(/\{\{date\}\}/gi, now.toLocaleDateString())
    .replace(/\{\{time\}\}/gi, now.toLocaleTimeString())
    .replace(/\{\{random:([^}]+)\}\}/gi, (_m, list: string) => {
      const opts = list.split(",").map((s) => s.trim()).filter(Boolean);
      return opts.length ? opts[Math.floor(Math.random() * opts.length)] : "";
    });
}

export type ScanEntry = LorebookEntry & { book?: Lorebook };

/** SillyTavern-style keyword scan over the recent chat window. */
export function scanLorebook(
  entries: ScanEntry[],
  recentText: string,
  budgetTokens: number,
): ScanEntry[] {
  const hay = recentText;
  const hayLower = hay.toLowerCase();
  const matched: ScanEntry[] = [];

  for (const e of entries) {
    if (!e.enabled) continue;
    if (e.constant) {
      matched.push(e);
      continue;
    }
    const keys = (e.keys ?? []).filter(Boolean);
    if (keys.length === 0) continue;
    const hit = keys.some((k) => {
      const key = k.trim();
      if (!key) return false;
      return e.caseSensitive ? hay.includes(key) : hayLower.includes(key.toLowerCase());
    });
    if (!hit) continue;
    const secondary = (e.secondaryKeys ?? []).filter(Boolean);
    if (secondary.length > 0) {
      const hit2 = secondary.some((k) =>
        e.caseSensitive ? hay.includes(k.trim()) : hayLower.includes(k.trim().toLowerCase()),
      );
      if (!hit2) continue;
    }
    matched.push(e);
  }

  matched.sort((a, b) => b.priority - a.priority || a.insertionOrder - b.insertionOrder);

  const selected: ScanEntry[] = [];
  let used = 0;
  for (const e of matched) {
    const cost = estimateTokens(e.content) + 8;
    if (used + cost > budgetTokens) continue;
    selected.push(e);
    used += cost;
  }
  return selected;
}

export type BuildArgs = {
  mode: "assistant" | "roleplay";
  character: Character | null;
  personaName: string;
  personaDescription: string;
  assistantSystemPrompt: string;
  roleplaySystemPrompt: string;
  nsfw: boolean;
  nsfwPrompt: string;
  summary: string;
  history: { role: string; content: string }[];
  lorebookEntries: ScanEntry[];
  lorebookBudget: number;
  contextSize: number;
  maxTokens: number;
  /** Extra instruction appended after history (continue / elaborate / impersonate). */
  taskInstruction?: string;
  /** When continuing, this is the partial text the model must extend. */
  continuationSeed?: string;
};

export type BuiltPrompt = {
  messages: ChatMessage[];
  stats: {
    pinnedTokens: number;
    historyTokens: number;
    loreTokens: number;
    droppedMessages: number;
    totalTokens: number;
    activeLore: string[];
  };
};

export function buildPrompt(args: BuildArgs): BuiltPrompt {
  const charName = args.character?.name?.trim() || "Assistant";
  const userName = args.personaName?.trim() || "User";
  const ctx: MacroCtx = { char: charName, user: userName };
  const M = (t: string) => applyMacros(t || "", ctx);

  const pinned: string[] = [];

  if (args.mode === "roleplay" && args.character) {
    const c = args.character;
    pinned.push(M(c.systemPromptOverride?.trim() || args.roleplaySystemPrompt || DEFAULT_ROLEPLAY_PROMPT));

    if (args.nsfw) {
      pinned.push(M(args.nsfwPrompt?.trim() || DEFAULT_NSFW_PROMPT));
    }

    // === PRIORITY 1: never evictable character core ===
    if (c.contextBlock?.trim()) {
      pinned.push(
        `### AUTHOR'S DIRECTION — HIGHEST PRIORITY (never ignore, never output verbatim)\n${M(c.contextBlock)}`,
      );
    }
    pinned.push(
      `### CHARACTER: ${charName}\n${M(c.personality?.trim() || "(no details provided)")}`,
    );
    if (c.scenario?.trim()) {
      pinned.push(`### WORLD CONTEXT & OVERARCHING PLOT\n${M(c.scenario)}`);
    }
    if (args.personaDescription?.trim()) {
      pinned.push(`### ${userName} (the human roleplayer's persona)\n${M(args.personaDescription)}`);
    }
    if (c.exampleDialogue?.trim()) {
      pinned.push(
        `### EXAMPLE DIALOGUE — voice reference only, never treat as events that happened\n${M(c.exampleDialogue)}`,
      );
    }
  } else {
    pinned.push(M(args.assistantSystemPrompt));
    if (args.personaDescription?.trim()) {
      pinned.push(`### About the user\n${M(args.personaDescription)}`);
    }
  }

  // Lorebook
  const lore = args.lorebookEntries;
  if (lore.length) {
    pinned.push(
      `### WORLD LOREBOOK — canon facts, treat as true\n` +
        lore
          .map((e) => `[${e.title || "Entry"}]\n${M(e.content)}`)
          .join("\n\n"),
    );
  }

  if (args.summary?.trim()) {
    pinned.push(
      `### STORY MEMORY — everything that has already happened, treat as canon\n${M(args.summary)}`,
    );
  }

  const systemText = pinned.filter(Boolean).join("\n\n");
  const pinnedTokens = estimateTokens(systemText);
  const loreTokens = lore.reduce((s, e) => s + estimateTokens(e.content), 0);

  // === History budget: pinned context can NEVER be evicted ===
  const reserve = args.maxTokens + 400;
  const historyBudget = Math.max(600, args.contextSize - pinnedTokens - reserve);

  const hist = args.history.map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
    content: M(m.content),
  }));

  const kept: ChatMessage[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const cost = estimateTokens(hist[i].content) + 6;
    if (used + cost > historyBudget && kept.length > 0) {
      dropped = i + 1;
      break;
    }
    kept.unshift(hist[i]);
    used += cost;
  }

  const messages: ChatMessage[] = [{ role: "system", content: systemText }, ...kept];

  if (args.character && args.mode === "roleplay" && args.character.postHistoryInstructions?.trim()) {
    messages.push({
      role: "system",
      content: M(args.character.postHistoryInstructions),
    });
  }

  if (args.taskInstruction) {
    messages.push({ role: "system", content: M(args.taskInstruction) });
  }
  if (args.continuationSeed) {
    messages.push({ role: "assistant", content: args.continuationSeed });
  }

  return {
    messages,
    stats: {
      pinnedTokens,
      historyTokens: used,
      loreTokens,
      droppedMessages: dropped,
      totalTokens: pinnedTokens + used,
      activeLore: lore.map((e) => e.title),
    },
  };
}

export const CONTINUE_INSTRUCTION = `[CONTINUATION TASK]
Your previous message was cut off. You must now continue it SEAMLESSLY from the exact character where it stopped.
- Do NOT restart, do NOT re-greet, do NOT summarise or repeat anything already written.
- Do NOT begin a new scene. Stay in the same moment, same location, same participants, same tense, same POV.
- Match the existing formatting exactly: *asterisks* for narration/action, "quotes" for speech.
- If the text stopped mid-sentence or mid-word, resume mid-sentence — your first characters must join on grammatically. If it stopped at a sentence end, begin the very next sentence.
- Write 1–3 additional paragraphs and then stop at a natural beat.
- Output ONLY the continuation text. No preamble, no recap, no quotation of prior text.`;

export const ELABORATE_INSTRUCTION = `[ELABORATION TASK]
Re-enter the scene you just wrote and expand it, deepening the same moment instead of advancing past it.
- Keep the same location, time, characters, mood, tense and POV as your previous message.
- Add: sensory texture (sight, sound, smell, touch, temperature), body language and micro-expressions, {{char}}'s interior thought and motivation, and one fresh concrete detail or small escalation.
- Do NOT repeat sentences you already wrote and do NOT contradict them. Do NOT act or speak for {{user}}.
- Match the existing prose formatting exactly.
- Write 2–4 new paragraphs that read as a natural extension of the previous message, then stop on a beat that invites {{user}} to respond.
- Output ONLY the new prose.`;

export const IMPERSONATE_INSTRUCTION = `[IMPERSONATION TASK]
Write the NEXT message from {{user}}'s point of view — you are temporarily writing {{user}}, not {{char}}.
- Stay consistent with {{user}}'s persona and everything established in the scene.
- Do NOT write {{char}}'s dialogue, actions or thoughts.
- Use the same prose format: *asterisks* for action, "quotes" for speech. 1–2 paragraphs.
- Output only the message text.`;
