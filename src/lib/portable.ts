export const CHAR_SPEC = "roleplay_studio_character";
export const BOOK_SPEC = "roleplay_studio_lorebook";
export const CHAT_SPEC = "roleplay_studio_chat";
export const SPEC_VERSION = "1.0";

export type ImportKind = "character" | "lorebook" | "chat" | "unknown";

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

export type ChatBundle = {
  spec: typeof CHAT_SPEC;
  spec_version: string;
  exportedAt: string;
  characterName: string;
  characterId: number | null;
  chat: PortableChat;
};

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" && !Number.isNaN(v) ? v : d);
const bool = (v: unknown, d = false) => (typeof v === "boolean" ? v : d);
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Accepts an object, a one-card array, or a wrapper holding `data`/`card`. */
export function unwrap(raw: unknown): Record<string, unknown> {
  let root = raw;
  if (Array.isArray(root)) root = root[0];
  const r = asRecord(root);
  if (!r) return {};
  return r;
}

function pick(data: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).length) return v;
  }
  return undefined;
}

function splitKeys(v: unknown): string[] {
  if (typeof v === "string") {
    return v
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  return [];
}

export function normalizeEntry(raw: unknown, index: number): PortableEntry {
  const e = asRecord(raw) ?? {};
  return {
    title: str(
      pick(e, ["title", "comment", "name", "label"]) ?? `Entry ${index + 1}`,
      `Entry ${index + 1}`,
    ),
    keys: splitKeys(pick(e, ["keys", "key", "keywords", "triggers"])),
    secondaryKeys: splitKeys(pick(e, ["secondaryKeys", "secondary_keys", "keysecondary"])),
    content: str(pick(e, ["content", "entry", "text", "value"])),
    enabled: e.disable !== undefined ? !bool(e.disable) : bool(e.enabled, true),
    constant: bool(e.constant),
    caseSensitive: bool(e.caseSensitive ?? e.case_sensitive),
    priority: num(e.priority ?? e.order ?? e.insertion_order, 100),
    insertionOrder: num(e.insertionOrder ?? e.insertion_order ?? e.displayIndex, index),
  };
}

export function normalizeBook(raw: unknown): PortableBook {
  const b = unwrap(raw);
  let rawEntries: unknown[] = [];
  if (Array.isArray(b.entries)) rawEntries = b.entries;
  else {
    const ent = asRecord(b.entries);
    if (ent) rawEntries = Object.values(ent);
  }
  // SillyTavern sometimes nests world info under `world_info` / `lorebook`
  if (!rawEntries.length) {
    const nested = asRecord(b.world_info ?? b.lorebook ?? b.worldinfo);
    if (nested) {
      const inner = Array.isArray(nested.entries)
        ? nested.entries
        : Object.values(asRecord(nested.entries) ?? {});
      rawEntries = inner;
      if (!b.name) b.name = nested.name ?? b.name;
    }
  }
  return {
    name: str(pick(b, ["name", "title", "book_name"]), "Imported Lorebook"),
    description: str(b.description),
    scanDepth: num(b.scanDepth ?? b.scan_depth, 8),
    tokenBudget: num(b.tokenBudget ?? b.token_budget, 1200),
    recursive: bool(b.recursive),
    entries: rawEntries.map((e, i) => normalizeEntry(e, i)),
  };
}

function hydrateCharacter(c: Record<string, unknown>): PortableCharacter {
  return {
    name: str(pick(c, ["name", "char_name"]), "Imported Character"),
    avatar: str(c.avatar).startsWith("data:") ? str(c.avatar) : "",
    contextBlock: str(
      pick(c, ["contextBlock", "context_block"]) ??
        (asRecord(c.depth_prompt)?.content as string | undefined) ??
        (typeof c.depth_prompt === "string" ? c.depth_prompt : ""),
    ),
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
    background: str(c.background).startsWith("data:") ? str(c.background) : "",
    backgroundBlur: num(c.backgroundBlur, 6),
    backgroundOpacity: num(c.backgroundOpacity, 35),
  };
}

export function normalizeCharacter(raw: unknown): {
  character: PortableCharacter;
  lorebooks: PortableBook[];
  chats: PortableChat[];
} {
  const root = unwrap(raw);

  // ── Our own export format (must round-trip exactly) ────────────────
  if (root.spec === CHAR_SPEC && root.character) {
    const c = asRecord(root.character) ?? {};
    const books: PortableBook[] = Array.isArray(root.lorebooks)
      ? root.lorebooks.map(normalizeBook)
      : [];
    const cb = asRecord(c.character_book);
    if (cb) books.push(normalizeBook(cb));
    return {
      character: hydrateCharacter(c),
      lorebooks: books,
      chats: Array.isArray(root.chats) ? (root.chats as unknown[]).map(normalizeChat) : [],
    };
  }

  // ── Resolve the card payload across every common layout ────────────
  let data: Record<string, unknown> = root;
  if (root.spec === "chara_card_v2" || root.spec === "chara_card_v3" || root.spec_version) {
    data = asRecord(root.data) ?? root;
  } else if (root.character && typeof root.character === "object" && !Array.isArray(root.character)) {
    data = asRecord(root.character) ?? root;
  } else if (root.card && typeof root.card === "object") {
    data = asRecord(root.card) ?? root;
  } else if (root.data && typeof root.data === "object") {
    data = asRecord(root.data) ?? root;
  } else if (root.character && typeof root.character === "string") {
    // { character: "<json string>" }
    try {
      data = asRecord(JSON.parse(root.character as string)) ?? root;
    } catch {
      data = root;
    }
  }
  if (Array.isArray(data.data)) data = asRecord(data.data[0]) ?? data;

  const books: PortableBook[] = [];
  const cb = pick(data, ["character_book", "characterBook", "lorebook", "world_info", "worldinfo"]);
  const cbRec = asRecord(cb);
  if (cbRec && (cbRec.entries || cbRec.name)) books.push(normalizeBook(cbRec));
  const rootBook = asRecord(root.lorebook ?? root.world_info);
  if (rootBook) books.push(normalizeBook(rootBook));

  const personality = [
    str(pick(data, ["personality", "char_persona", "persona"])),
    str(pick(data, ["description", "char_description", "char_desc"])),
  ]
    .filter((x) => x && x.trim())
    .join("\n\n");

  const tags = [
    ...arr(data.tags),
    ...arr(data.tag),
    ...arr(asRecord(data.extensions)?.tags),
  ].filter(Boolean);

  const character: PortableCharacter = {
    name: str(
      pick(data, ["name", "char_name", "nameActual", "displayName", "character_name"]),
      "Imported Character",
    ),
    avatar: str(data.avatar).startsWith("data:") ? str(data.avatar) : "",
    contextBlock: str(
      pick(data, ["contextBlock", "context_block", "depth_prompt"]) ??
        (asRecord(data.depth_prompt)?.content as string | undefined) ??
        (typeof data.depth_prompt === "string" ? data.depth_prompt : ""),
    ),
    personality,
    scenario: str(
      pick(data, ["scenario", "world_scenario", "scenario_text", "setting", "background"]),
    ),
    firstMessage: str(
      pick(data, ["first_mes", "firstMessage", "char_greeting", "greeting", "start"]),
    ),
    alternateGreetings: [
      ...arr(data.alternate_greetings),
      ...arr(data.alternateGreetings),
      ...arr(data.alt_greetings),
    ],
    exampleDialogue: str(
      pick(data, ["mes_example", "exampleDialogue", "example_dialogue", "example", "sample"]),
    ),
    creatorNotes: str(pick(data, ["creator_notes", "creatorNotes", "notes", "creator"])) as string,
    systemPromptOverride: str(pick(data, ["system_prompt", "systemPromptOverride"])),
    postHistoryInstructions: str(
      pick(data, ["post_history_instructions", "postHistoryInstructions"]),
    ),
    tags: [...new Set(tags)],
    nsfw: bool(data.nsfw) || num(data.nsfwLevel, 0) > 0,
    background: str(data.background).startsWith("data:") ? str(data.background) : "",
    backgroundBlur: num(data.backgroundBlur, 6),
    backgroundOpacity: num(data.backgroundOpacity, 35),
  };

  return { character, lorebooks: books, chats: [] };
}

export function normalizeChat(raw: unknown): PortableChat {
  const c = unwrap(raw);
  const msgs = Array.isArray(c.messages)
    ? c.messages
    : Array.isArray(c.msgs)
      ? c.msgs
      : Array.isArray(c.history)
        ? c.history
        : [];
  return {
    title: str(pick(c, ["title", "name"]), "Imported Session"),
    mode: str(c.mode, "roleplay"),
    summary: str(c.summary),
    summaryInstructions: str(c.summaryInstructions),
    messages: msgs.map((m) => {
      const mm = asRecord(m) ?? {};
      const role = str(mm.role ?? mm.speaker ?? mm.author, "user").toLowerCase();
      return {
        role: role === "assistant" || role === "char" || role === "bot" || role === "ai"
          ? "assistant"
          : role === "system"
            ? "system"
            : "user",
        content: str(mm.content ?? mm.mes ?? mm.text ?? mm.message),
        createdAt: typeof mm.createdAt === "string" ? mm.createdAt : undefined,
      };
    }),
    checkpoints: Array.isArray(c.checkpoints)
      ? (c.checkpoints as unknown[]).map((cp) => {
          const x = asRecord(cp) ?? {};
          return { name: str(x.name, "Checkpoint"), messageIndex: num(x.messageIndex, 0) };
        })
      : [],
  };
}

export function detectKind(raw: unknown): ImportKind {
  const root = unwrap(raw);
  if (!Object.keys(root).length) return "unknown";

  if (root.spec === CHAR_SPEC) return "character";
  if (root.spec === BOOK_SPEC) return "lorebook";
  if (root.spec === CHAT_SPEC) return "chat";
  if (root.spec === "chara_card_v2" || root.spec === "chara_card_v3") return "character";

  // Explicit wrapper objects
  if (root.chat && typeof root.chat === "object" && !Array.isArray(root.chat)) return "chat";
  if (root.character && typeof root.character === "object" && !Array.isArray(root.character))
    return "character";
  if (root.lorebook && typeof root.lorebook === "object" && !Array.isArray(root.lorebook))
    return "lorebook";

  // Standalone chat export
  if (
    Array.isArray(root.messages) &&
    (root.title !== undefined || root.summary !== undefined || root.mode !== undefined)
  ) {
    return "chat";
  }

  // Lorebook / world info. This MUST be checked before the card heuristics,
  // because SillyTavern books carry `name`, `description` AND `entries` —
  // checking description first mis-routed them into a broken character card.
  if (root.entries !== undefined && root.character_book === undefined) return "lorebook";

  // Card-like fields
  const looksLikeCard =
    root.first_mes !== undefined ||
    root.char_greeting !== undefined ||
    root.char_persona !== undefined ||
    root.world_scenario !== undefined ||
    root.mes_example !== undefined ||
    root.description !== undefined ||
    root.personality !== undefined ||
    root.char_description !== undefined ||
    root.alternate_greetings !== undefined ||
    root.character_book !== undefined;
  if (looksLikeCard) return "character";

  if (root.name && (root.content || root.keys)) return "lorebook";
  if (root.name && root.description !== undefined) return "character";
  if (root.name) return "character";

  return "unknown";
}
