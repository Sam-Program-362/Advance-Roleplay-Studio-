"use client";

import { useMemo, useState } from "react";
import type { Character, Lorebook } from "@/lib/client";
import { api, readJsonFile } from "@/lib/client";
import {
  AutoTextarea,
  Avatar,
  Button,
  Field,
  ImageUpload,
  Slider,
  Tabs,
  TextInput,
  Toggle,
  WriterButton,
  cx,
} from "./ui";

export type DraftCharacter = Omit<Character, "id"> & { id?: number };

export function emptyCharacter(): DraftCharacter {
  return {
    name: "",
    avatar: "",
    contextBlock: "",
    personality: "",
    scenario: "",
    firstMessage: "",
    alternateGreetings: [],
    exampleDialogue: "",
    creatorNotes: "",
    systemPromptOverride: "",
    postHistoryInstructions: "",
    tags: [],
    nsfw: false,
    background: "",
    backgroundBlur: 6,
    backgroundOpacity: 35,
    favorite: false,
    lorebookIds: [],
  };
}

export default function CharacterEditor({
  initial,
  lorebooks,
  nsfwGlobal,
  onSaved,
  onClose,
  toast,
  onOpenLorebooks,
}: {
  initial: DraftCharacter;
  lorebooks: Lorebook[];
  nsfwGlobal: boolean;
  onSaved: (c: Character) => void;
  onClose: () => void;
  toast: (m: string, k?: "ok" | "err") => void;
  onOpenLorebooks: () => void;
}) {
  const [d, setD] = useState<DraftCharacter>(initial);
  const [tab, setTab] = useState("identity");
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState("");
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);

  const set = <K extends keyof DraftCharacter>(k: K, v: DraftCharacter[K]) =>
    setD((p) => ({ ...p, [k]: v }));

  const writerContext = useMemo(
    () => ({
      name: d.name,
      contextBlock: d.contextBlock,
      personality: d.personality,
      scenario: d.scenario,
      firstMessage: d.firstMessage,
      exampleDialogue: d.exampleDialogue,
      creatorNotes: d.creatorNotes,
      tags: d.tags,
    }),
    [d],
  );

  async function runWriter(block: string, field: keyof DraftCharacter) {
    setBusy(block);
    try {
      const current = String(d[field] ?? "");
      const res = await api.writer({
        block,
        currentText: current,
        hint: hint.trim() || undefined,
        nsfw: d.nsfw || nsfwGlobal,
        context: writerContext,
      });
      if (block === "name") {
        const names = res.text
          .split("\n")
          .map((s) => s.replace(/^[\d.\-*\s"']+|["']+$/g, "").trim())
          .filter(Boolean)
          .slice(0, 5);
        setNameSuggestions(names);
        if (!d.name && names[0]) set("name", names[0]);
      } else {
        set(field, res.text as DraftCharacter[typeof field]);
      }
      toast(current ? "Expanded with your text as context" : "Generated");
    } catch (e) {
      toast(e instanceof Error ? e.message : "AI Writer failed", "err");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!d.name.trim()) {
      toast("Give your character a name first", "err");
      setTab("identity");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...d };
      delete (payload as { id?: number }).id;
      const saved = d.id
        ? await api.saveCharacter(d.id, { ...payload, lorebookIds: d.lorebookIds ?? [] })
        : await api.addCharacter({ ...payload, lorebookIds: d.lorebookIds ?? [] });
      toast(d.id ? "Character updated" : "Character created");
      onSaved({ ...saved, lorebookIds: d.lorebookIds ?? [] });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "err");
    } finally {
      setSaving(false);
    }
  }

  async function importCard(file: File) {
    try {
      const data = await readJsonFile(file);
      const res = await api.importJson(data, "character");
      toast(`Imported "${res.name}"`);
      const full = await fetch(`/api/characters/${res.characterId}`).then((r) => r.json());
      setD(full);
      onSaved(full);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Import failed", "err");
    }
  }

  const toggleBook = (id: number) => {
    const cur = d.lorebookIds ?? [];
    set("lorebookIds", cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 pb-3">
        <div className="flex items-center gap-3">
          <Avatar src={d.avatar} name={d.name || "New"} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {d.name || "Unnamed character"}
            </p>
            <p className="text-[11px] text-slate-500">
              {d.id ? `Editing character #${d.id}` : "New character"}
            </p>
          </div>
        </div>
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "identity", label: "Identity", icon: "🪪" },
            { id: "personality", label: "Personality", icon: "🧬" },
            { id: "scenario", label: "Scenario", icon: "🌍" },
            { id: "greeting", label: "Greeting", icon: "💬" },
            { id: "lore", label: "Lorebooks", icon: "📚" },
            { id: "advanced", label: "Advanced", icon: "⚙️" },
          ]}
        />
        <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
          <TextInput
            value={hint}
            onChange={setHint}
            placeholder="Optional AI Writer steer — e.g. 'make her a cynical void-ship engineer'"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-5">
        {tab === "identity" && (
          <>
            <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
              <ImageUpload
                label="Avatar"
                value={d.avatar}
                onChange={(v) => set("avatar", v)}
                round
              />
              <div className="space-y-4">
                <Field
                  label="Character name"
                  action={
                    <WriterButton
                      busy={busy === "name"}
                      hasText={!!d.name}
                      onClick={() => void runWriter("name", "name")}
                      label="Name ideas"
                    />
                  }
                >
                  <TextInput
                    value={d.name}
                    onChange={(v) => set("name", v)}
                    placeholder="e.g. Seraphine Vale"
                  />
                  {nameSuggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {nameSuggestions.map((n) => (
                        <button
                          key={n}
                          onClick={() => set("name", n)}
                          className="rounded-full border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-200 hover:bg-violet-500/25"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
                <Field label="Tags" hint="Comma separated. Used as context by the AI Writer.">
                  <TextInput
                    value={(d.tags ?? []).join(", ")}
                    onChange={(v) =>
                      set(
                        "tags",
                        v.split(",").map((s) => s.trim()).filter(Boolean),
                      )
                    }
                    placeholder="fantasy, rivals-to-lovers, slow burn"
                  />
                </Field>
              </div>
            </div>

            <Field
              label="Context block — author's direction for the AI Writer"
              hint="Highest-priority guidance. Tone, pacing, POV, prose style, hard limits. Never evicted from the context window."
              action={
                <WriterButton
                  busy={busy === "context"}
                  hasText={!!d.contextBlock}
                  onClick={() => void runWriter("context", "contextBlock")}
                />
              }
            >
              <AutoTextarea
                value={d.contextBlock}
                onChange={(v) => set("contextBlock", v)}
                minRows={5}
                placeholder={"- Write in close third person, present tense\n- Slow-burn pacing, heavy sensory detail\n- Never resolve the mystery in one scene"}
              />
            </Field>

            <Field label="Creator notes" hint="Out-of-character pitch. Never sent to the model during chat.">
              <AutoTextarea
                value={d.creatorNotes}
                onChange={(v) => set("creatorNotes", v)}
                minRows={3}
                placeholder="What is this character, who is it for?"
              />
            </Field>

            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <Toggle
                checked={d.nsfw}
                onChange={(v) => set("nsfw", v)}
                label="NSFW character"
                hint="Always injects the uncensored jailbreak system prompt for this character, even if the global NSFW switch is off."
              />
            </div>
          </>
        )}

        {tab === "personality" && (
          <Field
            label="Personality — character details, plot info & world concepts"
            hint="Appearance, voice, temperament, motives, skills, relationships, their role in the plot, and the RPG / slice-of-life systems attached to them. Always pinned to the top of the context."
            action={
              <WriterButton
                busy={busy === "personality"}
                hasText={!!d.personality}
                onClick={() => void runWriter("personality", "personality")}
              />
            }
          >
            <AutoTextarea
              value={d.personality}
              onChange={(v) => set("personality", v)}
              minRows={16}
              maxRows={30}
              placeholder={
                "Appearance: ...\nSpeech: ...\nTemperament: ...\nMotivation: ...\nRole in the plot: ...\nWorld concept (class, powers, routine): ..."
              }
            />
          </Field>
        )}

        {tab === "scenario" && (
          <Field
            label="Scenario — world context, world concepts & overarching plot"
            hint="Not the opening scene. The setting, its rules, factions, stakes and the long arc that frames every session."
            action={
              <WriterButton
                busy={busy === "scenario"}
                hasText={!!d.scenario}
                onClick={() => void runWriter("scenario", "scenario")}
              />
            }
          >
            <AutoTextarea
              value={d.scenario}
              onChange={(v) => set("scenario", v)}
              minRows={14}
              maxRows={28}
              placeholder="The world, how it works, who holds power, what is at stake, and where {{user}} and {{char}} sit inside it."
            />
          </Field>
        )}

        {tab === "greeting" && (
          <>
            <Field
              label="First message (greeting)"
              hint="The opening roleplay message. Supports {{char}} and {{user}} macros."
              action={
                <WriterButton
                  busy={busy === "greeting"}
                  hasText={!!d.firstMessage}
                  onClick={() => void runWriter("greeting", "firstMessage")}
                />
              }
            >
              <AutoTextarea
                value={d.firstMessage}
                onChange={(v) => set("firstMessage", v)}
                minRows={10}
                maxRows={24}
                placeholder={'*The tavern door groans open...* "You\'re late, {{user}}."'}
              />
            </Field>

            <Field
              label="Alternate greetings"
              hint="Each alternate becomes a selectable opening when you start a new session."
              action={
                <Button
                  size="xs"
                  variant="soft"
                  onClick={() => set("alternateGreetings", [...(d.alternateGreetings ?? []), ""])}
                >
                  + Add
                </Button>
              }
            >
              <div className="space-y-2">
                {(d.alternateGreetings ?? []).length === 0 && (
                  <p className="text-[11px] text-slate-600">No alternates yet.</p>
                )}
                {(d.alternateGreetings ?? []).map((g, i) => (
                  <div key={i} className="rounded-lg border border-white/10 bg-slate-950/40 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">Alternate #{i + 1}</span>
                      <button
                        onClick={() =>
                          set(
                            "alternateGreetings",
                            (d.alternateGreetings ?? []).filter((_, j) => j !== i),
                          )
                        }
                        className="text-[11px] text-rose-300 hover:text-rose-200"
                      >
                        Remove
                      </button>
                    </div>
                    <AutoTextarea
                      value={g}
                      minRows={3}
                      onChange={(v) =>
                        set(
                          "alternateGreetings",
                          (d.alternateGreetings ?? []).map((x, j) => (j === i ? v : x)),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </Field>

            <Field
              label="Example dialogue"
              hint="Voice reference only — never treated as events that happened."
              action={
                <WriterButton
                  busy={busy === "example"}
                  hasText={!!d.exampleDialogue}
                  onClick={() => void runWriter("example", "exampleDialogue")}
                />
              }
            >
              <AutoTextarea
                value={d.exampleDialogue}
                onChange={(v) => set("exampleDialogue", v)}
                minRows={8}
                placeholder={"<START>\n{{user}}: Hello.\n{{char}}: *She doesn't look up.* \"Took you long enough.\""}
              />
            </Field>
          </>
        )}

        {tab === "lore" && (
          <div className="space-y-4">
            <Field
              label="Attached lorebooks"
              hint="Entries from attached books are injected when their keywords appear in the recent chat window."
              action={
                <Button size="xs" variant="soft" onClick={onOpenLorebooks}>
                  Manage lorebooks
                </Button>
              }
            >
              <div className="space-y-1.5">
                {lorebooks.length === 0 && (
                  <p className="text-[11px] text-slate-600">
                    No lorebooks exist yet. Create one in the Lorebooks panel.
                  </p>
                )}
                {lorebooks.map((b) => {
                  const on = (d.lorebookIds ?? []).includes(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() => toggleBook(b.id)}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition",
                        on
                          ? "border-violet-400/50 bg-violet-500/15"
                          : "border-white/10 bg-slate-950/40 hover:border-white/25",
                      )}
                    >
                      <span
                        className={cx(
                          "grid h-5 w-5 shrink-0 place-items-center rounded border text-[10px]",
                          on ? "border-violet-300 bg-violet-500 text-white" : "border-white/20",
                        )}
                      >
                        {on ? "✓" : ""}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-100">{b.name}</span>
                        <span className="block text-[11px] text-slate-500">
                          {b.entries.length} entries
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        )}

        {tab === "advanced" && (
          <>
            <Field
              label="Chat background (unique to this character)"
              hint="Uploaded image is used behind this character's chat only."
            >
              <ImageUpload
                label=""
                value={d.background}
                onChange={(v) => set("background", v)}
                maxSize={1400}
                aspect="aspect-video"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Slider
                label="Background blur"
                value={d.backgroundBlur}
                min={0}
                max={24}
                onChange={(v) => set("backgroundBlur", v)}
                suffix="px"
              />
              <Slider
                label="Background visibility"
                value={d.backgroundOpacity}
                min={0}
                max={100}
                onChange={(v) => set("backgroundOpacity", v)}
                suffix="%"
              />
            </div>

            <Field
              label="System prompt override"
              hint="Replaces the global roleplay system prompt for this character only. Leave empty to use the global one."
              action={
                <WriterButton
                  busy={busy === "system"}
                  hasText={!!d.systemPromptOverride}
                  onClick={() => void runWriter("system", "systemPromptOverride")}
                />
              }
            >
              <AutoTextarea
                value={d.systemPromptOverride}
                onChange={(v) => set("systemPromptOverride", v)}
                minRows={5}
              />
            </Field>

            <Field
              label="Post-history instructions (jailbreak tail)"
              hint="Injected after the chat history — the strongest position for format enforcement."
            >
              <AutoTextarea
                value={d.postHistoryInstructions}
                onChange={(v) => set("postHistoryInstructions", v)}
                minRows={4}
                placeholder="[Stay in character as {{char}}. Never write for {{user}}. Never break the fourth wall.]"
              />
            </Field>

            {d.id && (
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Backup
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => {
                      window.location.href = `/api/export?type=character&id=${d.id}&chats=1`;
                    }}
                  >
                    ⬇ Export character + chats
                  </Button>
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => {
                      window.location.href = `/api/export?type=character&id=${d.id}&chats=0`;
                    }}
                  >
                    ⬇ Export character only
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="h-4" />
      </div>

      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10">
          ⬆ Import JSON
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importCard(f);
              e.target.value = "";
            }}
          />
        </label>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : d.id ? "Save changes" : "Create character"}
          </Button>
        </div>
      </div>
    </div>
  );
}
