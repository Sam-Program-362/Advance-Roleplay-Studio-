import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* API Connections (SillyTavern-style multi-provider connection list)  */
/* ------------------------------------------------------------------ */
export const connections = pgTable("connections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull().default("openai"),
  baseUrl: text("base_url").notNull().default(""),
  apiKey: text("api_key").notNull().default(""),
  model: text("model").notNull().default(""),
  temperature: real("temperature").notNull().default(0.9),
  maxTokens: integer("max_tokens").notNull().default(900),
  topP: real("top_p").notNull().default(0.95),
  frequencyPenalty: real("frequency_penalty").notNull().default(0),
  presencePenalty: real("presence_penalty").notNull().default(0),
  contextSize: integer("context_size").notNull().default(16000),
  extraHeaders: jsonb("extra_headers").$type<Record<string, string>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Global app settings (single row, id = 1)                            */
/* ------------------------------------------------------------------ */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  mode: text("mode").notNull().default("roleplay"), // assistant | roleplay
  activeConnectionId: integer("active_connection_id"),
  writerConnectionId: integer("writer_connection_id"),
  assistantSystemPrompt: text("assistant_system_prompt").notNull().default(""),
  roleplaySystemPrompt: text("roleplay_system_prompt").notNull().default(""),
  nsfwEnabled: boolean("nsfw_enabled").notNull().default(false),
  nsfwPrompt: text("nsfw_prompt").notNull().default(""),
  personaName: text("persona_name").notNull().default("User"),
  personaDescription: text("persona_description").notNull().default(""),
  imageConnectionId: integer("image_connection_id"),
  imageModel: text("image_model").notNull().default(""),
  imageAspect: text("image_aspect").notNull().default("1:1"),
  summaryInstructions: text("summary_instructions").notNull().default(""),
  autoSummarize: boolean("auto_summarize").notNull().default(false),
  autoSummarizeEvery: integer("auto_summarize_every").notNull().default(24),
  streaming: boolean("streaming").notNull().default(true),
  theme: text("theme").notNull().default("midnight"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Personas — multiple roleplayer identities (SillyTavern-style)       */
/* ------------------------------------------------------------------ */
export const personas = pgTable("personas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  avatar: text("avatar").notNull().default(""), // data URL, optional
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */
export const characters = pgTable("characters", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("New Character"),
  avatar: text("avatar").notNull().default(""), // data URL
  // "Context Block" — always-prioritised writer/AI guidance
  contextBlock: text("context_block").notNull().default(""),
  // Personality = character details + plot info + world concepts
  personality: text("personality").notNull().default(""),
  // Scenario = world context / world concepts / overarching plot
  scenario: text("scenario").notNull().default(""),
  firstMessage: text("first_message").notNull().default(""),
  alternateGreetings: jsonb("alternate_greetings").$type<string[]>().notNull().default([]),
  exampleDialogue: text("example_dialogue").notNull().default(""),
  creatorNotes: text("creator_notes").notNull().default(""),
  systemPromptOverride: text("system_prompt_override").notNull().default(""),
  postHistoryInstructions: text("post_history_instructions").notNull().default(""),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  nsfw: boolean("nsfw").notNull().default(false),
  background: text("background").notNull().default(""), // data URL, per character
  backgroundBlur: integer("background_blur").notNull().default(6),
  backgroundOpacity: integer("background_opacity").notNull().default(35),
  favorite: boolean("favorite").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Lorebooks                                                           */
/* ------------------------------------------------------------------ */
export const lorebooks = pgTable("lorebooks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("New Lorebook"),
  description: text("description").notNull().default(""),
  scanDepth: integer("scan_depth").notNull().default(8),
  tokenBudget: integer("token_budget").notNull().default(1200),
  recursive: boolean("recursive").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const lorebookEntries = pgTable("lorebook_entries", {
  id: serial("id").primaryKey(),
  lorebookId: integer("lorebook_id").notNull(),
  title: text("title").notNull().default("New Entry"),
  keys: jsonb("keys").$type<string[]>().notNull().default([]),
  secondaryKeys: jsonb("secondary_keys").$type<string[]>().notNull().default([]),
  content: text("content").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  constant: boolean("constant").notNull().default(false),
  caseSensitive: boolean("case_sensitive").notNull().default(false),
  priority: integer("priority").notNull().default(100),
  insertionOrder: integer("insertion_order").notNull().default(0),
});

// many-to-many: lorebook attached to characters
export const characterLorebooks = pgTable("character_lorebooks", {
  id: serial("id").primaryKey(),
  characterId: integer("character_id").notNull(),
  lorebookId: integer("lorebook_id").notNull(),
});

/**
 * Per-chat group state. `present` is the set of character ids currently in the
 * scene; an absent member is never sent to the model. An empty object means
 * "not configured yet", in which case every member with `startsPresent` is in.
 * PR 2 will add the director state to this same JSON blob.
 */
export type GroupState = { present?: number[] };

/* ------------------------------------------------------------------ */
/* Groups — multi-character roleplay (Group Roleplay)                  */
/* ------------------------------------------------------------------ */
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("New Group"),
  avatar: text("avatar").notNull().default(""), // data URL
  worldDescription: text("world_description").notNull().default(""),
  plot: text("plot").notNull().default(""),
  concept: text("concept").notNull().default(""),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  openingScene: text("opening_scene").notNull().default(""),
  narratorStyle: text("narrator_style").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** One cast member of a group. Characters are always reused from the library. */
export const groupMembers = pgTable("group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  characterId: integer("character_id").notNull(),
  /** Free text: protagonist, antagonist, ally, rival, NPC, anything else. */
  role: text("role").notNull().default(""),
  /** 1–5. Higher depth = more spotlight, more frequent and longer replies. */
  depth: integer("depth").notNull().default(3),
  startsPresent: boolean("starts_present").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Many-to-many: world lorebook attached to a group. */
export const groupLorebooks = pgTable("group_lorebooks", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  lorebookId: integer("lorebook_id").notNull(),
});

/**
 * Compressed per-chat memory. `subject` is "global" for the shared world card
 * or a character id (as text) for that character's own card.
 */
export const memoryCards = pgTable("memory_cards", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  subject: text("subject").notNull().default("global"),
  data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Chat sessions + messages                                            */
/* ------------------------------------------------------------------ */
export const chats = pgTable("chats", {
  id: serial("id").primaryKey(),
  characterId: integer("character_id"), // null = assistant or group chat
  /** Set when this chat is a group session (group roleplay). */
  groupId: integer("group_id"),
  /** Group sessions only: { present: number[] } — who is in the scene right now. */
  groupState: jsonb("group_state").$type<GroupState>().notNull().default({}),
  title: text("title").notNull().default("New Session"),
  mode: text("mode").notNull().default("roleplay"),
  summary: text("summary").notNull().default(""),
  summaryInstructions: text("summary_instructions").notNull().default(""),
  summarizedUpTo: integer("summarized_up_to").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  role: text("role").notNull(), // user | assistant | system
  content: text("content").notNull().default(""),
  /** Group chats: the group_member character id that spoke (null = narrator). */
  speakerId: integer("speaker_id"),
  /** Group chats: "narration" | "character" | "" (unset = normal message). */
  kind: text("kind").notNull().default(""),
  /** Group chats: every message of one generation shares this id. */
  turnId: text("turn_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const checkpoints = pgTable("checkpoints", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  messageId: integer("message_id").notNull(),
  name: text("name").notNull().default("Checkpoint"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Connection = typeof connections.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Persona = typeof personas.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Lorebook = typeof lorebooks.$inferSelect;
export type LorebookEntry = typeof lorebookEntries.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type GroupLorebook = typeof groupLorebooks.$inferSelect;
export type MemoryCard = typeof memoryCards.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Checkpoint = typeof checkpoints.$inferSelect;
