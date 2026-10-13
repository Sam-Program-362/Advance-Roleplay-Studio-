"use client";

import { useMemo, useState } from "react";
import type { Character, Group, Lorebook } from "@/lib/client";
import { api } from "@/lib/client";
import { DEPTH_LABELS, ROLE_PRESETS, clampDepth } from "@/lib/groups";
import { AutoTextarea, Avatar, Button, Field, ImageUpload, TextInput, Toggle, cx } from "./ui";

type DraftMember = {
  characterId: number;
  role: string;
  depth: number;
  startsPresent: boolean;
};

type DraftGroup = {
  id?: number;
  name: string;
  avatar: string;
  worldDescription: string;
  plot: string;
  concept: string;
  tagsText: string;
  openingScene: string;
  narratorStyle: string;
  members: DraftMember[];
  lorebookIds: number[];
};

function emptyGroup(): DraftGroup {
  return {
    name: "",
    avatar: "",
    worldDescription: "",
    plot: "",
    concept: "",
    tagsText: "",
    openingScene: "",
    narratorStyle: "",
    members: [],
    lorebookIds: [],
  };
}

function toDraft(g: Group): DraftGroup {
  return {
    id: g.id,
    name: g.name,
    avatar: g.avatar,
    worldDescription: g.worldDescription,
    plot: g.plot,
    concept: g.concept,
    tagsText: (g.tags ?? []).join(", "),
    openingScene: g.openingScene,
    narratorStyle: g.narratorStyle,
    members: (g.members ?? []).map((m) => ({
      characterId: m.characterId,
      role: m.role,
      depth: clampDepth(m.depth),
      startsPresent: m.startsPresent,
    })),
    lorebookIds: g.lorebookIds ?? [],
  };
}

export default function GroupPanel({
  groups,
  characters,
  lorebooks,
  reload,
  toast,
  onStartChat,
  initialGroup,
}: {
  groups: Group[];
  characters: Character[];
  lorebooks: Lorebook[];
  reload: () => Promise<void>;
  toast: (m: string, k?: "ok" | "err") => void;
  onStartChat: (g: Group) => void;
  /**
   * Group the editor opens with, set when the user hits "edit" in a group
   * chat. The parent re-mounts this panel (via `key`) when it changes.
   */
  initialGroup?: Group | null;
}) {
  const [draft, setDraft] = useState<DraftGroup | null>(() =>
    initialGroup ? toDraft(initialGroup) : null,
  );
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [search, setSearch] = useState("");

  const charById = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );

  function patch(p: Partial<DraftGroup>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function toggleMember(characterId: number) {
    setDraft((d) => {
      if (!d) return d;
      const exists = d.members.some((m) => m.characterId === characterId);
      return {
        ...d,
        members: exists
          ? d.members.filter((m) => m.characterId !== characterId)
          : [...d.members, { characterId, role: "", depth: 3, startsPresent: true }],
      };
    });
  }

  function moveMember(index: number, delta: number) {
    setDraft((d) => {
      if (!d) return d;
      const next = [...d.members];
      const target = index + delta;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...d, members: next };
    });
  }

  async function save(startAfter: boolean) {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast("Give the group a name first", "err");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: draft.name.trim(),
        avatar: draft.avatar,
        worldDescription: draft.worldDescription,
        plot: draft.plot,
        concept: draft.concept,
        tags: draft.tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        openingScene: draft.openingScene,
        narratorStyle: draft.narratorStyle,
        members: draft.members.map((m, i) => ({ ...m, sortOrder: i })),
        lorebookIds: draft.lorebookIds,
      };
      const saved = draft.id
        ? await api.saveGroup(draft.id, body)
        : await api.addGroup(body);
      await reload();
      toast(draft.id ? "Group saved" : "Group created");
      setDraft(null);
      if (startAfter) onStartChat(saved);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the group", "err");
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------ list ------------------------------ */

  if (!draft) {
    const filtered = groups.filter((g) => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (
        g.name.toLowerCase().includes(s) ||
        (g.tags ?? []).join(" ").toLowerCase().includes(s) ||
        g.members.some((m) => m.name.toLowerCase().includes(s))
      );
    });

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 space-y-2.5 border-b border-white/5 px-3 py-2.5">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">
              🔍
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search groups, tags, cast..."
              className="w-full rounded-full border border-white/10 bg-[#121626] py-2 pl-9 pr-4 text-xs text-slate-100 placeholder-slate-500 outline-none transition focus:border-violet-500 focus:ring-1 focus:ring-violet-500 shadow-inner"
            />
          </div>
          <button
            onClick={() => setDraft(emptyGroup())}
            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-600/30 transition active:scale-[0.98] hover:from-violet-500 hover:to-indigo-500"
          >
            <span className="text-sm font-bold">+</span>
            <span>Create Group</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="mx-auto w-full max-w-4xl space-y-3 pb-8">
            {filtered.length === 0 ? (
              <div className="grid place-items-center rounded-3xl border border-dashed border-white/10 bg-[#121626] p-10 text-center animate-fade-in">
                <div>
                  <p className="text-4xl">🎭</p>
                  <p className="mt-3 text-sm font-medium text-slate-300">
                    {groups.length === 0 ? "No groups yet" : "No groups match"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    A group casts several characters from your library into one scene, with a narrator
                    holding the world together.
                  </p>
                  {groups.length === 0 && (
                    <Button
                      size="sm"
                      variant="primary"
                      className="mt-4 rounded-full"
                      onClick={() => setDraft(emptyGroup())}
                    >
                      + Create Group
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {filtered.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    onStart={() => onStartChat(g)}
                    onEdit={() => setDraft(toDraft(g))}
                    onDelete={async () => {
                      if (
                        !confirm(
                          `Delete "${g.name}"? Its sessions and their messages go too. Your characters stay in the library.`,
                        )
                      )
                        return;
                      try {
                        await api.deleteGroup(g.id);
                        await reload();
                        toast("Group deleted");
                      } catch (e) {
                        toast(e instanceof Error ? e.message : "Delete failed", "err");
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------- editor ----------------------------- */

  const selectedIds = new Set(draft.members.map((m) => m.characterId));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/5 px-3 py-2.5">
        <p className="text-xs font-semibold text-white">
          {draft.id ? `Edit — ${draft.name || "group"}` : "New Group"}
        </p>
        <div className="flex items-center gap-2">
          <Button size="xs" variant="ghost" className="rounded-full" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button
            size="xs"
            variant="soft"
            className="rounded-full"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Save &amp; start
          </Button>
          <Button
            size="xs"
            variant="primary"
            className="rounded-full"
            disabled={busy}
            onClick={() => void save(false)}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mx-auto w-full max-w-3xl space-y-5 pb-10">
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <ImageUpload
              label="Group picture"
              value={draft.avatar}
              onChange={(avatar) => patch({ avatar })}
              maxSize={640}
              round
            />
            <div className="space-y-4">
              <Field label="Name" hint="Shown on the group card and in every group session.">
                <TextInput
                  value={draft.name}
                  onChange={(name) => patch({ name })}
                  placeholder="The Ashen Court"
                />
              </Field>
              <Field label="Tags" hint="Comma separated — used for searching only.">
                <TextInput
                  value={draft.tagsText}
                  onChange={(tagsText) => patch({ tagsText })}
                  placeholder="fantasy, intrigue, slow burn"
                />
              </Field>
            </div>
          </div>

          <Field label="Concept" hint="One line that captures the premise.">
            <TextInput
              value={draft.concept}
              onChange={(concept) => patch({ concept })}
              placeholder="A pact of rivals must survive one winter together."
            />
          </Field>

          <Field
            label="World description"
            hint="The setting: era, places, rules, factions, what is normal here."
          >
            <AutoTextarea
              value={draft.worldDescription}
              onChange={(worldDescription) => patch({ worldDescription })}
              minRows={4}
            />
          </Field>

          <Field label="Plot" hint="The ongoing situation, stakes and where the story is heading.">
            <AutoTextarea
              value={draft.plot}
              onChange={(plot) => patch({ plot })}
              minRows={4}
            />
          </Field>

          <Field
            label="Narrator style"
            hint="How the narrator writes: voice, tense, pacing, sensory focus."
          >
            <AutoTextarea
              value={draft.narratorStyle}
              onChange={(narratorStyle) => patch({ narratorStyle })}
              minRows={3}
              placeholder="Close third person, present tense, weather and light as a running motif."
            />
          </Field>

          <Field
            label="Opening scene"
            hint="Posted as the first narration when you start a session. Write it as the narrator, not as a character."
          >
            <AutoTextarea
              value={draft.openingScene}
              onChange={(openingScene) => patch({ openingScene })}
              minRows={5}
            />
          </Field>

          {/* ---------------- cast ---------------- */}
          <div className="space-y-3 rounded-2xl border border-white/10 bg-[#121626] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Cast ({draft.members.length})
                </p>
                <p className="text-[11px] text-slate-500">
                  Characters are reused from your library — nothing is copied.
                </p>
              </div>
              <Button
                size="xs"
                variant="soft"
                className="rounded-full"
                onClick={() => setPickOpen((v) => !v)}
              >
                {pickOpen ? "Done" : "+ Add members"}
              </Button>
            </div>

            {pickOpen && (
              <div className="space-y-2 rounded-xl border border-white/10 bg-slate-950/50 p-2.5">
                {characters.length === 0 && (
                  <p className="p-2 text-center text-[11px] text-slate-500">
                    Your character library is empty — create a character first.
                  </p>
                )}
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {characters.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => toggleMember(c.id)}
                      className={cx(
                        "flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition",
                        selectedIds.has(c.id)
                          ? "border-violet-400/50 bg-violet-500/15"
                          : "border-white/10 hover:bg-white/5",
                      )}
                    >
                      <Avatar src={c.avatar} name={c.name} size={30} />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
                        {c.name}
                      </span>
                      {c.nsfw && <span className="text-[10px] text-rose-300">🔞</span>}
                      <span className="text-[10px] text-violet-300">
                        {selectedIds.has(c.id) ? "✓ in cast" : "add"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {draft.members.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-[11px] text-slate-500">
                No cast yet. Add at least one character, otherwise the group can only narrate.
              </p>
            ) : (
              <div className="space-y-2.5">
                {draft.members.map((m, i) => {
                  const c = charById.get(m.characterId);
                  if (!c) return null;
                  return (
                    <div
                      key={m.characterId}
                      className="space-y-2.5 rounded-xl border border-white/10 bg-slate-950/40 p-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <Avatar src={c.avatar} name={c.name} size={32} />
                        <span className="min-w-0 flex-1 truncate text-xs font-bold text-white">
                          {c.name}
                        </span>
                        <button
                          onClick={() => moveMember(i, -1)}
                          disabled={i === 0}
                          title="Move up"
                          className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveMember(i, 1)}
                          disabled={i === draft.members.length - 1}
                          title="Move down"
                          className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => toggleMember(m.characterId)}
                          title="Remove from cast"
                          className="rounded px-1.5 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/15"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {ROLE_PRESETS.map((role) => (
                          <button
                            key={role}
                            onClick={() =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      members: d.members.map((x, xi) =>
                                        xi === i
                                          ? { ...x, role: x.role === role ? "" : role }
                                          : x,
                                      ),
                                    }
                                  : d,
                              )
                            }
                            className={cx(
                              "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition",
                              m.role === role
                                ? "border-violet-400/60 bg-violet-500/25 text-white"
                                : "border-white/15 text-slate-300 hover:border-violet-400/50",
                            )}
                          >
                            {role}
                          </button>
                        ))}
                        <input
                          value={(ROLE_PRESETS as readonly string[]).includes(m.role) ? "" : m.role}
                          onChange={(e) =>
                            setDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    members: d.members.map((x, xi) =>
                                      xi === i ? { ...x, role: e.target.value } : x,
                                    ),
                                  }
                                : d,
                            )
                          }
                          placeholder="custom role…"
                          className="w-28 rounded-full border border-white/10 bg-[#111528] px-2.5 py-0.5 text-[10px] text-slate-100 placeholder-slate-500 outline-none focus:border-violet-500"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-[190px] flex-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="font-semibold uppercase tracking-wider text-slate-400">
                              Depth
                            </span>
                            <span className="font-mono text-violet-300">
                              {m.depth} · {DEPTH_LABELS[m.depth]}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={1}
                            max={5}
                            step={1}
                            value={m.depth}
                            onChange={(e) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      members: d.members.map((x, xi) =>
                                        xi === i
                                          ? { ...x, depth: clampDepth(e.target.value) }
                                          : x,
                                      ),
                                    }
                                  : d,
                              )
                            }
                            className="w-full accent-violet-500"
                          />
                        </div>
                        <div className="min-w-[150px] flex-1">
                          <Toggle
                            label="Starts present"
                            hint="In the scene when the session opens."
                            checked={m.startsPresent}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      members: d.members.map((x, xi) =>
                                        xi === i ? { ...x, startsPresent: v } : x,
                                      ),
                                    }
                                  : d,
                              )
                            }
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ---------------- world lorebooks ---------------- */}
          <Field
            label="World lorebooks"
            hint="Always available to the group. Present members also bring their own lorebooks."
          >
            <div className="space-y-1.5">
              {lorebooks.length === 0 && (
                <p className="rounded-xl border border-dashed border-white/10 p-3 text-center text-[11px] text-slate-500">
                  No lorebooks yet — create them in the Lorebooks tab.
                </p>
              )}
              {lorebooks.map((b) => (
                <button
                  key={b.id}
                  onClick={() =>
                    patch({
                      lorebookIds: draft.lorebookIds.includes(b.id)
                        ? draft.lorebookIds.filter((x) => x !== b.id)
                        : [...draft.lorebookIds, b.id],
                    })
                  }
                  className={cx(
                    "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition",
                    draft.lorebookIds.includes(b.id)
                      ? "border-violet-400/50 bg-violet-500/15 text-white"
                      : "border-white/10 text-slate-300 hover:bg-white/5",
                  )}
                >
                  <span>📖</span>
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  <span className="text-[10px] text-slate-500">{b.entries?.length ?? 0} entries</span>
                  <span className="text-[10px] text-violet-300">
                    {draft.lorebookIds.includes(b.id) ? "✓" : ""}
                  </span>
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

function GroupCard({
  group,
  onStart,
  onEdit,
  onDelete,
}: {
  group: Group;
  onStart: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const roles = group.members.filter((m) => m.role.trim()).length;
  const blurb =
    group.concept?.trim() ||
    group.worldDescription?.trim().slice(0, 150) ||
    group.plot?.trim().slice(0, 150) ||
    "A group scene with a narrator.";

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#131728] shadow-xl transition-all duration-300 hover:-translate-y-1 hover:border-violet-500/40 hover:shadow-2xl hover:shadow-violet-950/30 sm:rounded-3xl">
      <div onClick={onStart} className="relative h-28 w-full cursor-pointer overflow-hidden bg-slate-900 sm:h-36">
        {group.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={group.avatar}
            alt={group.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-900 via-slate-900 to-violet-950">
            <span className="text-4xl opacity-30">🎭</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#131728] via-transparent to-black/30" />
        <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-violet-200">
          {group.members.length} cast
        </span>
      </div>

      {/* Cast avatars */}
      <div className="relative -mt-6 ml-4 flex items-end gap-1 pr-4">
        {group.members.slice(0, 5).map((m) => (
          <span key={m.id} className="pointer-events-none">
            <Avatar src={m.avatar} name={m.name} size={34} className="ring-2 ring-[#131728]" />
          </span>
        ))}
        {group.members.length > 5 && (
          <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-300 ring-2 ring-[#131728]">
            +{group.members.length - 5}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col px-4 pb-3 pt-2">
        <div onClick={onStart} className="cursor-pointer">
          <h3 className="truncate text-base font-bold text-white transition-colors group-hover:text-violet-300 sm:text-lg">
            {group.name}
          </h3>
          <p className="mt-0.5 truncate text-xs font-semibold text-violet-400">
            {roles > 0 ? `${roles} with roles` : "Narrated scene"}
          </p>
        </div>

        <p
          onClick={onStart}
          className="mt-1.5 line-clamp-2 flex-1 cursor-pointer text-xs leading-relaxed text-slate-300 sm:text-sm"
        >
          {blurb}
        </p>

        {(group.tags ?? []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {group.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-400"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2.5">
          <button
            onClick={onStart}
            className="rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-md shadow-violet-700/30 transition active:scale-95 hover:from-violet-500 hover:to-indigo-500"
          >
            ▶ Start session
          </button>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={onEdit}
              title="Edit group"
              className="p-1 text-slate-400 transition-colors hover:text-white"
            >
              ✏️
            </button>
            <button
              onClick={onDelete}
              title="Delete group"
              className="p-1 text-rose-400/90 transition-colors hover:text-rose-300"
            >
              🗑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
