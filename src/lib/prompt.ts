import type { Character, LorebookEntry, Lorebook } from "@/db/schema";
import { estimateTokens, type ChatMessage } from "./llm";
import { DEFAULT_NSFW_PROMPT, DEFAULT_ROLEPLAY_PROMPT } from "./defaults";
import {
  CHARACTER_CARD_FIELDS,
  GLOBAL_CARD_FIELDS,
  cardLines,
  type CardData,
} from "./groupCards";
import { NARRATOR_LABEL } from "./groupSegments";

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

export type GenerateAction =
  | "send"
  | "regenerate"
  | "continue"
  | "elaborate"
  | "impersonate";

export type BuildArgs = {
  mode: "assistant" | "roleplay";
  /** Which generate action triggered this prompt (used by the Horde builder). */
  action?: GenerateAction;
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
  /**
   * Where the task instruction is injected. "user" (a fresh turn at the very
   * end) guarantees every provider actually responds — Anthropic/Google must
   * end on a user turn, and a trailing system message after the model's own
   * reply can be silently ignored or mistaken for a continuation prefill.
   */
  taskInstructionRole?: "system" | "user";
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
  /** Horde only — the stop sequence that ends the completion. */
  stopSequence?: string;
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
    messages.push({
      role: args.taskInstructionRole === "user" ? "user" : "system",
      content: M(args.taskInstruction),
    });
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
You are writing a BRAND-NEW message that re-enters the scene from your previous message and expands it, deepening the same moment instead of advancing past it.
- Keep the same location, time, characters, mood, tense and POV as your previous message.
- Add: sensory texture (sight, sound, smell, touch, temperature), body language and micro-expressions, {{char}}'s interior thought and motivation, and one fresh concrete detail or small escalation.
- Do NOT repeat sentences you already wrote and do NOT contradict them. Do NOT act or speak for {{user}}.
- Match the existing prose formatting exactly: *asterisks* for narration/action, "quotes" for speech.
- Write 2–4 new paragraphs that read as a natural companion piece to your previous message, then stop on a beat that invites {{user}} to respond.
- Output ONLY the new prose — no preamble, no recap, no heading, no quotation of prior text.`;

/* ------------------------------------------------------------------ */
/* AI Horde — plain-text completion prompt (Horde connections only)    */
/* ------------------------------------------------------------------ */

/** Horde has no chat roles, so a single bracketed note carries the task. */
export const HORDE_CONTINUE_NOTE =
  "[The character's last message above was cut off mid-reply. Continue it seamlessly from the exact point where it stopped — do not repeat, restart or summarise anything already written.]";

export const HORDE_ELABORATE_NOTE =
  "[Rewrite the character's last message above as a longer, richer version of the very same moment — add sensory detail, body language and interior thought, but do not advance the scene or contradict anything already written.]";

/**
 * AI Horde skips the roleplay/assistant system prompt entirely, so its prose
 * prompt is built from plain labelled sections plus raw chat history. It is not
 * a chat model: the response is a continuation of one flat string.
 */
export function buildHordePrompt(args: BuildArgs): BuiltPrompt {
  const charName = args.character?.name?.trim() || "Assistant";
  const userName = args.personaName?.trim() || "User";
  const ctx: MacroCtx = { char: charName, user: userName };
  const M = (t: string) => applyMacros(t || "", ctx);
  const c = args.character;

  // Labelled sections — pinned, never trimmed.
  const sections: string[] = [];
  if (c?.contextBlock?.trim()) {
    sections.push(`Author's direction:\n${M(c.contextBlock)}`);
  }
  if (c) {
    sections.push(
      `Character: ${charName}\n${M(c.personality?.trim() || "(no details provided)")}`,
    );
    if (c.scenario?.trim()) sections.push(`Scenario:\n${M(c.scenario)}`);
  }
  if (args.personaDescription?.trim()) {
    sections.push(`Persona (${userName}):\n${M(args.personaDescription)}`);
  }
  if (c?.exampleDialogue?.trim()) {
    sections.push(`Example dialogue:\n${M(c.exampleDialogue)}`);
  }
  if (args.lorebookEntries.length) {
    sections.push(
      `Lorebook:\n` +
        args.lorebookEntries
          .map((e) => `[${e.title || "Entry"}]\n${M(e.content)}`)
          .join("\n\n"),
    );
  }
  if (args.summary?.trim()) {
    sections.push(`Story memory:\n${M(args.summary)}`);
  }
  const header = sections.join("\n\n");
  const pinnedTokens = estimateTokens(header);
  const loreTokens = args.lorebookEntries.reduce((s, e) => s + estimateTokens(e.content), 0);

  // Horde caps the context at 8192 tokens; keep room for the reply.
  const effective = Math.min(args.contextSize || 8192, 8192);
  const reserve = Math.min(args.maxTokens || 512, 512) + 120;
  const historyBudget = Math.max(200, effective - pinnedTokens - reserve);

  const action: GenerateAction = args.action ?? "send";
  const hist = args.history.map((m) => {
    const speaker = m.role === "assistant" ? charName : userName;
    return `${speaker}: ${M(m.content)}`;
  });
  if (action === "continue" && args.continuationSeed?.trim()) {
    hist.push(`${charName}: ${M(args.continuationSeed)}`);
  }

  // Trim the OLDEST history only — sections above are never evicted.
  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const cost = estimateTokens(hist[i]) + 4;
    if (used + cost > historyBudget && kept.length > 0) {
      dropped = i + 1;
      break;
    }
    kept.unshift(hist[i]);
    used += cost;
  }

  const finalSpeaker = action === "impersonate" ? userName : charName;
  const note =
    action === "continue"
      ? HORDE_CONTINUE_NOTE
      : action === "elaborate"
        ? HORDE_ELABORATE_NOTE
        : null;

  const body = [kept.join("\n"), ...(note ? [note] : []), `${finalSpeaker}:`]
    .filter(Boolean)
    .join("\n");
  const prompt = header ? `${header}\n\n${body}` : body;

  return {
    messages: [{ role: "user", content: prompt }],
    stats: {
      pinnedTokens,
      historyTokens: used,
      loreTokens,
      droppedMessages: dropped,
      totalTokens: pinnedTokens + used,
      activeLore: args.lorebookEntries.map((e) => e.title),
    },
    stopSequence: `\n${userName}:`,
  };
}

/**
 * AI Horde prompt for the simple JSON helpers (summaries, AI Writer): the
 * existing instruction text flattened into one string that ends in "Response:"
 * so the completion model knows where to begin.
 */
export function buildHordeInstruction(system: string, user: string): string {
  return [system, user, "Response:"]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Group Roleplay — multi-character prompt                             */
/* ------------------------------------------------------------------ */

/** One cast member as the prompt builder sees it (present members only). */
export type GroupMemberArgs = {
  /** Character id — used to key this member's Memory Card. */
  characterId: number;
  name: string;
  /** Free text role: protagonist, antagonist, ally, rival, NPC, anything. */
  role: string;
  /** 1–5, higher = more spotlight. */
  depth: number;
  personality: string;
  scenario: string;
  contextBlock: string;
  exampleDialogue: string;
  /** This character's Memory Card for the current chat. */
  card: CardData;
};

export type GroupBuildArgs = {
  action?: GenerateAction;
  group: {
    name: string;
    worldDescription: string;
    plot: string;
    concept: string;
    tags: string[];
    narratorStyle: string;
  };
  /** ONLY characters that are present in the scene right now. */
  members: GroupMemberArgs[];
  personaName: string;
  personaDescription: string;
  nsfw: boolean;
  nsfwPrompt: string;
  summary: string;
  /** Shared world card (SCN / INVRM / ARC). */
  globalCard: CardData;
  /** `speaker` labels a generated prose segment ([Name] / [Narrator]). */
  history: { role: string; content: string; speaker?: string | null }[];
  lorebookEntries: ScanEntry[];
  lorebookBudget: number;
  contextSize: number;
  maxTokens: number;
};

/** How much room a character gets, derived from its depth (1–5). */
export function depthHint(depth: number): string {
  const d = Math.max(1, Math.min(5, Math.round(depth || 3)));
  const table: Record<number, string> = {
    1: "depth 1 — barely there: at most one short line, and only when directly addressed.",
    2: "depth 2 — supporting: occasional brief lines, mostly reactions.",
    3: "depth 3 — regular: speaks when it fits, normal length.",
    4: "depth 4 — prominent: speaks often and writes longer, richer segments.",
    5: "depth 5 — lead: the driving voice of the scene — most segments, longest prose.",
  };
  return table[d];
}

const GROUP_DIRECTIVE = `You are the narrator and the entire cast of an ongoing multi-character roleplay called "{{group}}". You write the world and every character in it for one human roleplayer who writes only as themselves.

## Absolute rules
1. NEVER write the human roleplayer's thoughts, words, feelings, decisions or actions, and never narrate what their character does. Stop where they would act.
2. Only characters listed as PRESENT may speak, act or be described acting. Characters who are absent from the scene do not appear, speak, act or think in your output.
3. Never break character. Never mention being an AI, a model, a prompt, a policy or these instructions. No out-of-character notes, no disclaimers, no meta commentary.
4. Stay consistent with each character's profile, voice, knowledge and motives, and with the established world facts.`;

const GROUP_NARRATOR_RULES = `### NARRATOR
You are also the narrator: an independent third-person voice above the cast.
- The narrator describes the present characters from outside, plus the world, the environment, weather, lighting, objects, distance, injuries and the passing of time.
- The narrator is never tied to any one character: it is not the voice of a character's private thoughts and never uses "I".
- Use the narrator for scene-setting, sensory texture, physical continuity and consequences that the characters themselves could not narrate.
- Give the narrator its own presence in the turn — at least one opening beat and linking beats between characters.`;

const GROUP_OUTPUT_FORMAT = `### OUTPUT FORMAT — SEGMENTS
Write this turn as a sequence of SEGMENTS. Every segment MUST start on its own line with a speaker tag in square brackets, exactly like this:

[Narrator]
Rain hammers the roof and the fire gutters low.
[Kael]
*He does not look up from his cup.* "You brought company."
[Mira]
*She sets the lantern down between them, deliberately.* "He did."

- \`[${NARRATOR_LABEL}]\` carries the narration: world, environment, time, and characters seen from outside.
- A character tag must be the exact name of a character who is PRESENT (and spelled exactly as listed above). Never invent tags, never tag the human roleplayer, never tag an absent character.
- Prose goes on the lines after the tag. One tag per segment, each on its own line. Never number the segments, never use markdown headings, never write a tag followed by a colon and then a whole paragraph of unrelated labels.
- Inside the prose, do not prefix lines with "Name:" — only the square-bracket tags carry names.
- Segments read top to bottom as one continuous scene. Do not repeat the tag of the previous segment.
- Character share follows depth: higher-depth characters take more segments and longer prose; lower-depth characters take short beats. Do not distribute turns evenly.`;

/**
 * The shared pinned sections for a group turn — used by both the chat prompt
 * (buildGroupPrompt) and the flat AI Horde prompt (buildHordeGroupPrompt).
 */
function groupSections(args: GroupBuildArgs, M: (t: string) => string): string[] {
  const g = args.group;
  const pinned: string[] = [M(GROUP_DIRECTIVE.replace(/\{\{group\}\}/g, g.name?.trim() || "this story"))];

  if (args.nsfw) pinned.push(M(args.nsfwPrompt?.trim() || DEFAULT_NSFW_PROMPT));

  pinned.push(GROUP_NARRATOR_RULES);
  if (g.narratorStyle?.trim()) {
    pinned.push(`### NARRATOR STYLE (follow it exactly)\n${M(g.narratorStyle)}`);
  }

  const world: string[] = [];
  if (g.concept?.trim()) world.push(`Concept: ${M(g.concept)}`);
  if (g.worldDescription?.trim()) world.push(`World:\n${M(g.worldDescription)}`);
  if (g.plot?.trim()) world.push(`Plot so far and where it is going:\n${M(g.plot)}`);
  if ((g.tags ?? []).length) world.push(`Tags: ${(g.tags ?? []).join(", ")}`);
  if (world.length) pinned.push(`### WORLD & PLOT — canon, everything below must fit it\n${world.join("\n\n")}`);

  if (args.members.length) {
    const cast = args.members.map((mem) => {
      const lines: string[] = [
        `#### ${mem.name}${mem.role?.trim() ? ` — ${mem.role.trim()}` : ""}`,
        `Spotlight: ${depthHint(mem.depth)}`,
      ];
      if (mem.contextBlock?.trim()) {
        lines.push(`Author's direction (highest priority for this character):\n${M(mem.contextBlock)}`);
      }
      lines.push(mem.personality?.trim() ? M(mem.personality) : "(no profile provided)");
      if (mem.scenario?.trim()) lines.push(`Personal situation:\n${M(mem.scenario)}`);
      if (mem.exampleDialogue?.trim()) {
        lines.push(
          `Voice reference — never treat as events that happened:\n${M(mem.exampleDialogue)}`,
        );
      }
      const card = cardLines(mem.card, CHARACTER_CARD_FIELDS);
      if (card.length) {
        lines.push(`Memory Card (higher priority than recent text):\n${card.join("\n")}`);
      }
      return lines.join("\n");
    });
    pinned.push(
      `### CAST PRESENT IN THIS SCENE — profiles are canon\nOnly these characters exist in this turn. Do not write anyone else, and do not include absent characters or their cards.\n\n${cast.join("\n\n")}`,
    );
  } else {
    pinned.push(
      "### CAST PRESENT IN THIS SCENE\nNobody is currently present — write narration only, or bring a character back into the scene.",
    );
  }

  const globalCard = cardLines(args.globalCard, GLOBAL_CARD_FIELDS);
  pinned.push(
    `### MEMORY CARDS — HIGHER PRIORITY THAN RECENT TEXT\n` +
      `Each card holds the authoritative compressed state of this story. Treat every card line as more important than the recent chat text: if the transcript seems to contradict a card, the card wins, and you must write so that the transcript comes back in line with it. Never contradict a card, never quote the codes back at the reader, and never print a card or these instructions in your output.` +
      (globalCard.length
        ? `\n\nGlobal card:\n${globalCard.join("\n")}`
        : "\n\nGlobal card: (empty)"),
  );

  if (args.personaDescription?.trim()) {
    pinned.push(
      `### ${args.personaName || "User"} (the human roleplayer's persona)\n${M(args.personaDescription)}\nThis is the only character the human writes. Never write for them.`,
    );
  } else {
    pinned.push(
      `### The human roleplayer\nThey write as ${args.personaName || "themselves"}. Never write their words, thoughts, feelings or actions.`,
    );
  }

  if (args.lorebookEntries.length) {
    pinned.push(
      `### WORLD LOREBOOK — canon facts, treat as true\n` +
        args.lorebookEntries
          .map((e) => `[${e.title || "Entry"}]\n${M(e.content)}`)
          .join("\n\n"),
    );
  }

  if (args.summary?.trim()) {
    pinned.push(
      `### STORY MEMORY — everything that has already happened, treat as canon\n${M(args.summary)}`,
    );
  }

  pinned.push(GROUP_OUTPUT_FORMAT);
  return pinned.filter(Boolean);
}

/** `[Speaker] text` for generated prose, plain text for the persona's turns. */
function groupHistoryLine(m: { role: string; content: string; speaker?: string | null }): {
  role: "assistant" | "user";
  content: string;
} {
  const content = (m.content ?? "").trim();
  if (m.role === "user") return { role: "user", content };
  const speaker = (m.speaker ?? "").trim() || NARRATOR_LABEL;
  return { role: "assistant", content: `[${speaker}]\n${content}` };
}

/**
 * Chat-style group prompt: pinned world + present cast + cards, then the scene
 * history. The model answers with the segmented script described above.
 */
export function buildGroupPrompt(args: GroupBuildArgs): BuiltPrompt {
  const persona = args.personaName?.trim() || "User";
  // {{char}} is meaningless in a group scene — point it at the current speaker
  // set so any stray macro in a shared lorebook or prompt reads sensibly.
  const ctx: MacroCtx = { char: args.members.map((m) => m.name).join(", ") || NARRATOR_LABEL, user: persona };
  const M = (t: string) => applyMacros(t || "", ctx);

  const pinned = groupSections(args, M);
  const systemText = pinned.join("\n\n");
  const pinnedTokens = estimateTokens(systemText);
  const loreTokens = args.lorebookEntries.reduce((s, e) => s + estimateTokens(e.content), 0);

  // Identical budgeting to the single-character prompt: pinned context and
  // Memory Cards can never be evicted, only old history is trimmed.
  const reserve = args.maxTokens + 400;
  const historyBudget = Math.max(600, args.contextSize - pinnedTokens - reserve);

  const hist = args.history
    .filter((m) => m.role !== "system")
    .map((m) => {
      const line = groupHistoryLine(m);
      return { role: line.role, content: M(line.content) };
    });

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

  return {
    messages: [{ role: "system", content: systemText }, ...kept],
    stats: {
      pinnedTokens,
      historyTokens: used,
      loreTokens,
      droppedMessages: dropped,
      totalTokens: pinnedTokens + used,
      activeLore: args.lorebookEntries.map((e) => e.title),
    },
  };
}

/**
 * AI Horde version: one flat completion prompt that carries the SAME sections
 * and the SAME segment format, so a Horde group turn parses identically.
 */
export function buildHordeGroupPrompt(args: GroupBuildArgs): BuiltPrompt {
  const persona = args.personaName?.trim() || "User";
  const ctx: MacroCtx = { char: args.members.map((m) => m.name).join(", ") || NARRATOR_LABEL, user: persona };
  const M = (t: string) => applyMacros(t || "", ctx);

  const header = groupSections(args, M).join("\n\n");
  const pinnedTokens = estimateTokens(header);
  const loreTokens = args.lorebookEntries.reduce((s, e) => s + estimateTokens(e.content), 0);

  // Horde caps the context at 8192 tokens; keep room for the reply.
  const effective = Math.min(args.contextSize || 8192, 8192);
  const reserve = Math.min(args.maxTokens || 512, 512) + 120;
  const historyBudget = Math.max(200, effective - pinnedTokens - reserve);

  const hist = args.history
    .filter((m) => m.role !== "system")
    .map((m) =>
      m.role === "user"
        ? `${persona}: ${M((m.content ?? "").trim())}`
        : `[${(m.speaker ?? "").trim() || NARRATOR_LABEL}]\n${M((m.content ?? "").trim())}`,
    );

  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const cost = estimateTokens(hist[i]) + 4;
    if (used + cost > historyBudget && kept.length > 0) {
      dropped = i + 1;
      break;
    }
    kept.unshift(hist[i]);
    used += cost;
  }

  const transcript = kept.join("\n\n");
  const nudge = `=== CONTINUE THE SCENE ===\nContinue from exactly where the transcript stops. Begin your reply on a new line with a tag — \`[${NARRATOR_LABEL}]\` or the exact name of a present character in square brackets — and start every following segment the same way. Never write as ${persona}.`;
  const prompt = [header, transcript ? `=== TRANSCRIPT ===\n${transcript}` : "", nudge]
    .filter(Boolean)
    .join("\n\n");

  return {
    messages: [{ role: "user", content: prompt }],
    stats: {
      pinnedTokens,
      historyTokens: used,
      loreTokens,
      droppedMessages: dropped,
      totalTokens: pinnedTokens + used,
      activeLore: args.lorebookEntries.map((e) => e.title),
    },
    stopSequence: `\n${persona}:`,
  };
}

export const IMPERSONATE_INSTRUCTION = `[IMPERSONATION TASK]
Write the NEXT message from {{user}}'s point of view — you are temporarily writing {{user}}, not {{char}}.
- Stay consistent with {{user}}'s persona and everything established in the scene.
- Do NOT write {{char}}'s dialogue, actions or thoughts. Do NOT narrate {{char}}'s reactions.
- Use the same prose format: *asterisks* for action, "quotes" for speech. 1–2 paragraphs.
- Never prefix the output with {{user}}'s name, a speaker label or a colon.
- Output only the message text.`;
