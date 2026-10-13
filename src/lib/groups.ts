/**
 * Pure helpers for turning client input into group rows. Kept out of the route
 * files because Next.js only allows route handlers/config to be exported there.
 */

export type MemberInput = {
  characterId?: number;
  role?: string;
  depth?: number;
  startsPresent?: boolean;
  sortOrder?: number;
};

export const GROUP_FIELDS = [
  "name",
  "avatar",
  "worldDescription",
  "plot",
  "concept",
  "tags",
  "openingScene",
  "narratorStyle",
] as const;

/** Role chips offered by the editor; `role` itself stays free text. */
export const ROLE_PRESETS = ["Protagonist", "Antagonist", "Ally", "Rival", "NPC"] as const;

export const DEPTH_LABELS: Record<number, string> = {
  1: "Background",
  2: "Supporting",
  3: "Regular",
  4: "Prominent",
  5: "Lead",
};

export function clampDepth(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, n));
}

/**
 * Cleans an incoming cast list: library characters only, one row per character,
 * depth clamped to 1–5. Characters are always referenced by id, so the library
 * copy stays the single source of truth.
 */
export function normalizeMembers(input: unknown) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: {
    characterId: number;
    role: string;
    depth: number;
    startsPresent: boolean;
    sortOrder: number;
  }[] = [];
  input.forEach((raw, i) => {
    const m = (raw ?? {}) as MemberInput;
    const characterId = Number(m.characterId);
    if (!Number.isFinite(characterId) || characterId <= 0 || seen.has(characterId)) return;
    seen.add(characterId);
    out.push({
      characterId,
      role: (m.role ?? "").toString().trim().slice(0, 60),
      depth: clampDepth(m.depth),
      startsPresent: m.startsPresent === undefined ? true : Boolean(m.startsPresent),
      sortOrder: Number.isFinite(Number(m.sortOrder)) ? Number(m.sortOrder) : i,
    });
  });
  return out;
}

export function normalizeBookIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
}
