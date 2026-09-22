export const CHAR_SPEC = "roleplay_studio_character";
export const BOOK_SPEC = "roleplay_studio_lorebook";
export const SPEC_VERSION = "1.0";

export type PortableEntry = {
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

export type PortableBook = {
  name: string;
  description: string;
  scanDepth: number;
  tokenBudget: number;
  recursive: boolean;
  entries: PortableEntry[];
};

export type PortableMessage = { role: string; content: string; createdAt?: string };

export type PortableChat = {
  title: string;
  mode: string;
  summary: string;
  summaryInstructions: string;
  messages: PortableMessage[];
  checkpoints: { name: string; messageIndex: number }[];
};

export type PortableCharacter = {
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
};

export type CharacterBundle = {
  spec: typeof CHAR_SPEC;
  spec_version: string;
  exportedAt: string;
  character: PortableCharacter;
  lorebooks: PortableBook[];
  chats: PortableChat[];
};

export type LorebookBundle = {
  spec: typeof BOOK_SPEC;
  spec_version: string;
  exportedAt: string;
  lorebook: PortableBook;
};

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" && !Number.isNaN(v) ? v : d);
const bool = (v: unknown, d = false) => (typeof v === "boolean" ? v : d);
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

export function normalizeEntry(raw: unknown, index: number): PortableEntry {
  const e = (raw ?? {}) as Record<string, unknown>;
  const keys = e.keys ?? e.key ?? e.keywords ?? [];
  const secondary = e.secondaryKeys ?? e.secondary_keys ?? e.keysecondary ?? [];
  return {
    title: str(e.title ?? e.comment ?? e.name, `Entry ${index + 1}`),
    keys: typeof keys === "string" ? keys.split(",").map((k) => k.trim()).filter(Boolean) : arr(keys),
    secondaryKeys:
      typeof secondary === "string"
        ? secondary.split(",").map((k) => k.trim()).filter(Boolean)
        : arr(secondary),
    content: str(e.content ?? e.entry ?? e.text),
    enabled: e.disable !== undefined ? !bool(e.disable) : bool(e.enabled, true),
    constant: bool(e.constant),
    caseSensitive: bool(e.caseSensitive ?? e.case_sensitive),
    priority: num(e.priority ?? e.order, 100),
    insertionOrder: num(e.insertionOrder ?? e.insertion_order ?? e.displayIndex, index),
  };
}

export function normalizeBook(raw: unknown): PortableBook {
  const b = (raw ?? {}) as Record<string, unknown>;
  let rawEntries: unknown[] = [];
  if (Array.isArray(b.entries)) rawEntries = b.entries;
  else if (b.entries && typeof b.entries === "object")
    rawEntries = Object.values(b.entries as Record<string, unknown>);
  return {
    name: str(b.name, "Imported Lorebook"),
    description: str(b.description),
    scanDepth: num(b.scanDepth ?? b.scan_depth, 8),
    tokenBudget: num(b.tokenBudget ?? b.token_budget, 1200),
    recursive: bool(b.recursive),
    entries: rawEntries.map((e, i) => normalizeEntry(e, i)),
  };
}

export function normalizeCharacter(raw: unknown): {
  character: PortableCharacter;
  lorebooks: PortableBook[];
  chats: PortableChat[];
} {
  const root = (raw ?? {}) as Record<string, unknown>;

  // Our own export format
  if (root.spec === CHAR_SPEC && root.character) {
    const c = root.character as Record<string, unknown>;
    return {
      character: hydrateCharacter(c),
      lorebooks: Array.isArray(root.lorebooks) ? root.lorebooks.map(normalizeBook) : [],
      chats: Array.isArray(root.chats) ? (root.chats as unknown[]).map(normalizeChat) : [],
    };
  }

  // SillyTavern / Chub V2 & V3 card
  const data = (root.data && typeof root.data === "object" ? root.data : root) as Record<
    string,
    unknown
  >;
  const books: PortableBook[] = [];
  const cb = data.character_book;
  if (cb && typeof cb === "object") books.push(normalizeBook(cb));

  const character: PortableCharacter = {
    name: str(data.name ?? data.char_name, "Imported Character"),
    avatar: str(data.avatar).startsWith("data:") ? str(data.avatar) : "",
    contextBlock: str(data.contextBlock ?? data.depth_prompt ?? ""),
    personality: [str(data.description ?? data.char_persona), str(data.personality)]
      .filter((x) => x && x.trim())
      .join("\n\n"),
    scenario: str(data.scenario ?? data.world_scenario),
    firstMessage: str(data.first_mes ?? data.firstMessage ?? data.char_greeting),
    alternateGreetings: arr(data.alternate_greetings ?? data.alternateGreetings),
    exampleDialogue: str(data.mes_example ?? data.exampleDialogue ?? data.example_dialogue),
    creatorNotes: str(data.creator_notes ?? data.creatorNotes),
    systemPromptOverride: str(data.system_prompt ?? data.systemPromptOverride),
    postHistoryInstructions: str(
      data.post_history_instructions ?? data.postHistoryInstructions,
    ),
    tags: arr(data.tags),
    nsfw: bool(data.nsfw),
    background: "",
    backgroundBlur: 6,
    backgroundOpacity: 35,
  };
  return { character, lorebooks: books, chats: [] };
}

function hydrateCharacter(c: Record<string, unknown>): PortableCharacter {
  return {
    name: str(c.name, "Imported Character"),
    avatar: str(c.avatar),
    contextBlock: str(c.contextBlock),
    personality: str(c.personality),
    scenario: str(c.scenario),
    firstMessage: str(c.firstMessage),
    alternateGreetings: arr(c.alternateGreetings),
    exampleDialogue: str(c.exampleDialogue),
    creatorNotes: str(c.creatorNotes),
    systemPromptOverride: str(c.systemPromptOverride),
    postHistoryInstructions: str(c.postHistoryInstructions),
    tags: arr(c.tags),
    nsfw: bool(c.nsfw),
    background: str(c.background),
    backgroundBlur: num(c.backgroundBlur, 6),
    backgroundOpacity: num(c.backgroundOpacity, 35),
  };
}

function normalizeChat(raw: unknown): PortableChat {
  const c = (raw ?? {}) as Record<string, unknown>;
  const msgs = Array.isArray(c.messages) ? c.messages : [];
  return {
    title: str(c.title, "Imported Session"),
    mode: str(c.mode, "roleplay"),
    summary: str(c.summary),
    summaryInstructions: str(c.summaryInstructions),
    messages: msgs.map((m) => {
      const mm = (m ?? {}) as Record<string, unknown>;
      return {
        role: str(mm.role, "user") === "assistant" ? "assistant" : "user",
        content: str(mm.content ?? mm.mes),
        createdAt: str(mm.createdAt) || undefined,
      };
    }),
    checkpoints: Array.isArray(c.checkpoints)
      ? (c.checkpoints as unknown[]).map((cp) => {
          const x = (cp ?? {}) as Record<string, unknown>;
          return { name: str(x.name, "Checkpoint"), messageIndex: num(x.messageIndex, 0) };
        })
      : [],
  };
}

export function detectKind(raw: unknown): "character" | "lorebook" | "unknown" {
  const root = (raw ?? {}) as Record<string, unknown>;
  if (root.spec === CHAR_SPEC) return "character";
  if (root.spec === BOOK_SPEC) return "lorebook";
  if (root.spec === "chara_card_v2" || root.spec === "chara_card_v3") return "character";
  if (root.character) return "character";
  if (root.lorebook) return "lorebook";
  if (root.entries && !root.name && !root.first_mes) return "lorebook";
  if (root.first_mes || root.char_greeting || (root.name && root.description)) return "character";
  if (root.entries) return "lorebook";
  return "unknown";
}
