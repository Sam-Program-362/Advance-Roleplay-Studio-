/**
 * Memory Card definitions — shared by the prompt builder (`buildGroupPrompt`)
 * and the Cards panel in the UI, so the field order and labels can never drift
 * apart.
 *
 * Everything is written as SHORT COMPRESSED PHRASES, not prose: the cards are
 * pinned into the prompt on every turn and are meant to outrank recent text.
 */

export type MemoryCardField = {
  /** Stable field key stored in `memory_cards.data`, e.g. "SCN". */
  key: string;
  /** Human label shown in the Cards panel. */
  label: string;
  /** What belongs in the field. */
  hint: string;
};

/** `memory_cards.subject` value for the shared world card. */
export const GLOBAL_CARD_SUBJECT = "global";

/** Soft cap per field — the cards stay useful only while they stay short. */
export const CARD_VALUE_LIMIT = 300;

export const GLOBAL_CARD_FIELDS: MemoryCardField[] = [
  {
    key: "SCN",
    label: "Scene",
    hint: "Where and when we are: place, hour, weather, mood.",
  },
  {
    key: "INVRM",
    label: "Environment",
    hint: "Immediate surroundings and anything in the room that matters.",
  },
  {
    key: "ARC",
    label: "Story arc",
    hint: "What this stretch of story is building toward, and the open threads.",
  },
];

export const CHARACTER_CARD_FIELDS: MemoryCardField[] = [
  {
    key: "STAT",
    label: "Status",
    hint: "Alive/injured/captive/etc — their current condition.",
  },
  { key: "TONE", label: "Tone", hint: "Mood and emotional temperature toward the group." },
  { key: "REL", label: "Relationships", hint: "How they feel about each present character." },
  { key: "TRAIT", label: "Traits shown", hint: "Character traits that have actually surfaced." },
  { key: "PHY", label: "Physical", hint: "Clothing, wounds, carried items, visible changes." },
  { key: "GOAL", label: "Goal", hint: "What they are actively trying to get right now." },
  { key: "LIMIT", label: "Limits", hint: "What they refuse to do, fear, or cannot do." },
  { key: "LAST", label: "Last seen", hint: "Where they were and what they were doing." },
  { key: "L_TOPIC", label: "Last topic", hint: "The subject of their most recent exchange." },
  { key: "L_END", label: "Last exit", hint: "How their last beat in the scene ended." },
  { key: "KEY", label: "Key facts", hint: "Secrets, promises, debts, discoveries worth recalling." },
];

/** A card is stored as a flat map of field key → compressed phrase. */
export type CardData = Record<string, string>;

export function labelFor(fields: MemoryCardField[], key: string): string {
  return fields.find((f) => f.key === key)?.label ?? key;
}

/** Keep only known fields with a non-empty value, trimmed and length-capped. */
export function pruneCardData(data: CardData | null | undefined, fields: MemoryCardField[]): CardData {
  const out: CardData = {};
  for (const f of fields) {
    const raw = (data?.[f.key] ?? "").toString().trim();
    if (raw) out[f.key] = raw.slice(0, CARD_VALUE_LIMIT);
  }
  return out;
}

/** `[KEY] value` lines for one card, in canonical field order. */
export function cardLines(data: CardData | null | undefined, fields: MemoryCardField[]): string[] {
  const clean = pruneCardData(data, fields);
  return Object.keys(clean).map((k) => `${k}: ${clean[k]}`);
}

export function cardIsEmpty(data: CardData | null | undefined): boolean {
  if (!data) return true;
  return Object.values(data).every((v) => !(v ?? "").toString().trim());
}
