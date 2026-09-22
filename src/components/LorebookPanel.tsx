"use client";

import { useEffect, useState } from "react";
import type { Character, LoreEntry, Lorebook } from "@/lib/client";
import { api, downloadJson, readJsonFile } from "@/lib/client";
import { AutoTextarea, Button, Field, TextInput, Toggle, WriterButton, cx } from "./ui";

export default function LorebookPanel({
  books,
  characters,
  reload,
  toast,
  nsfw,
}: {
  books: Lorebook[];
  characters: Character[];
  reload: () => Promise<void>;
  toast: (m: string, k?: "ok" | "err") => void;
  nsfw: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(books[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (selectedId == null && books.length) setSelectedId(books[0].id);
    if (selectedId != null && !books.some((b) => b.id === selectedId)) {
      setSelectedId(books[0]?.id ?? null);
    }
  }, [books, selectedId]);

  const book = books.find((b) => b.id === selectedId) ?? null;

  async function createBook() {
    const b = await api.addLorebook({ name: "New Lorebook" });
    await reload();
    setSelectedId(b.id);
    toast("Lorebook created");
  }

  async function patchBook(patch: Partial<Lorebook>) {
    if (!book) return;
    await api.saveLorebook(book.id, patch);
    await reload();
  }

  async function removeBook() {
    if (!book) return;
    if (!confirm(`Delete lorebook "${book.name}" and all its entries?`)) return;
    await api.deleteLorebook(book.id);
    setSelectedId(null);
    await reload();
    toast("Lorebook deleted");
  }

  async function addEntry() {
    if (!book) return;
    await api.addEntry({
      lorebookId: book.id,
      title: "New Entry",
      insertionOrder: book.entries.length,
    });
    await reload();
  }

  async function patchEntry(id: number, patch: Partial<LoreEntry>) {
    await api.saveEntry(id, patch);
    await reload();
  }

  async function removeEntry(id: number) {
    await api.deleteEntry(id);
    await reload();
  }

  async function writeEntry(entry: LoreEntry, target: "content" | "keys") {
    if (!book) return;
    setBusy(`${entry.id}-${target}`);
    try {
      const attachedChar = characters.find((c) => (c.lorebookIds ?? []).includes(book.id));
      const res = await api.writer({
        block: target === "content" ? "lorebook" : "lorebook_keys",
        currentText: target === "content" ? entry.content : entry.keys.join(", "),
        hint: hint.trim() || undefined,
        nsfw,
        context: {
          lorebookName: book.name,
          lorebookDescription: book.description,
          entryTitle: entry.title,
          entryKeys: entry.keys,
          siblingEntries: book.entries.filter((e) => e.id !== entry.id).map((e) => e.title),
          name: attachedChar?.name,
          scenario: attachedChar?.scenario,
        },
      });
      if (target === "content") {
        await patchEntry(entry.id, { content: res.text });
      } else {
        await patchEntry(entry.id, {
          keys: res.text
            .split(/[,\n]/)
            .map((s) => s.replace(/^[-*\s"']+|["']+$/g, "").trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 10),
        });
      }
      toast("Lore generated");
    } catch (e) {
      toast(e instanceof Error ? e.message : "AI Writer failed", "err");
    } finally {
      setBusy(null);
    }
  }

  async function importBook(file: File) {
    try {
      const data = await readJsonFile(file);
      const res = await api.importJson(data, "lorebook");
      await reload();
      if (res.lorebookId) setSelectedId(res.lorebookId);
      toast(`Imported "${res.name}"`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Import failed", "err");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none"
        >
          {books.length === 0 && <option value="">No lorebooks yet</option>}
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.entries.length})
            </option>
          ))}
        </select>
        <Button size="sm" variant="primary" onClick={() => void createBook()}>
          + New
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10">
          ⬆ Import
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBook(f);
              e.target.value = "";
            }}
          />
        </label>
        {book && (
          <>
            <Button
              size="sm"
              variant="soft"
              onClick={() => {
                window.location.href = `/api/export?type=lorebook&id=${book.id}`;
              }}
            >
              ⬇ Export
            </Button>
            <Button size="sm" variant="danger" onClick={() => void removeBook()}>
              Delete
            </Button>
          </>
        )}
      </div>

      {!book ? (
        <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-white/10 p-8 text-center">
          <div>
            <p className="text-3xl">📚</p>
            <p className="mt-2 text-sm text-slate-400">
              Create a lorebook to store world facts, factions, places and items.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lorebook name">
              <TextInput value={book.name} onChange={(v) => void patchBook({ name: v })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scan depth" hint="Messages scanned for keywords.">
                <TextInput
                  type="number"
                  value={String(book.scanDepth)}
                  onChange={(v) => void patchBook({ scanDepth: Number(v) || 8 })}
                />
              </Field>
              <Field label="Token budget">
                <TextInput
                  type="number"
                  value={String(book.tokenBudget)}
                  onChange={(v) => void patchBook({ tokenBudget: Number(v) || 1200 })}
                />
              </Field>
            </div>
          </div>

          <Field
            label="Lorebook context / purpose"
            hint="Tell the AI Writer what this lorebook is about — it uses this to generate professional, on-theme entries."
          >
            <AutoTextarea
              value={book.description}
              onChange={(v) => void patchBook({ description: v })}
              minRows={3}
              placeholder="A grimdark city-state lorebook: districts, criminal syndicates, blood-magic laws and the plague that reshaped them."
            />
          </Field>

          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
            <TextInput
              value={hint}
              onChange={setHint}
              placeholder="Optional AI Writer steer for lore generation…"
            />
          </div>

          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Entries ({book.entries.length})
            </h4>
            <Button size="sm" variant="primary" onClick={() => void addEntry()}>
              + Add entry
            </Button>
          </div>

          <div className="space-y-3">
            {book.entries.length === 0 && (
              <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[11px] text-slate-600">
                No entries. Add one, give it a title and keywords, then hit ✍️ to have the AI write
                a professional lore entry.
              </p>
            )}
            {book.entries.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                busyContent={busy === `${e.id}-content`}
                busyKeys={busy === `${e.id}-keys`}
                onPatch={(p) => void patchEntry(e.id, p)}
                onRemove={() => void removeEntry(e.id)}
                onWrite={(t) => void writeEntry(e, t)}
              />
            ))}
          </div>

          <div className="pt-2">
            <Button
              size="sm"
              variant="soft"
              onClick={() =>
                downloadJson(`${book.name.replace(/\s+/g, "-").toLowerCase()}.lorebook.json`, {
                  spec: "roleplay_studio_lorebook",
                  spec_version: "1.0",
                  exportedAt: new Date().toISOString(),
                  lorebook: {
                    name: book.name,
                    description: book.description,
                    scanDepth: book.scanDepth,
                    tokenBudget: book.tokenBudget,
                    recursive: book.recursive,
                    entries: book.entries.map((x) => ({
                      title: x.title,
                      keys: x.keys,
                      secondaryKeys: x.secondaryKeys,
                      content: x.content,
                      enabled: x.enabled,
                      constant: x.constant,
                      caseSensitive: x.caseSensitive,
                      priority: x.priority,
                      insertionOrder: x.insertionOrder,
                    })),
                  },
                })
              }
            >
              ⬇ Download JSON (round-trips with Import)
            </Button>
          </div>
          <div className="h-4" />
        </div>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  onPatch,
  onRemove,
  onWrite,
  busyContent,
  busyKeys,
}: {
  entry: LoreEntry;
  onPatch: (p: Partial<LoreEntry>) => void;
  onRemove: () => void;
  onWrite: (target: "content" | "keys") => void;
  busyContent: boolean;
  busyKeys: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [keys, setKeys] = useState(entry.keys.join(", "));
  const [content, setContent] = useState(entry.content);

  useEffect(() => setTitle(entry.title), [entry.title]);
  useEffect(() => setKeys(entry.keys.join(", ")), [entry.keys]);
  useEffect(() => setContent(entry.content), [entry.content]);

  return (
    <div
      className={cx(
        "rounded-xl border bg-slate-950/40 transition",
        entry.enabled ? "border-white/10" : "border-white/5 opacity-60",
      )}
    >
      <div className="flex items-center gap-2 p-2.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-white/10"
        >
          {open ? "▾" : "▸"}
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== entry.title && onPatch({ title })}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-100 outline-none"
          placeholder="Entry subject"
        />
        {entry.constant && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
            always
          </span>
        )}
        <span className="hidden sm:block max-w-[160px] truncate text-[11px] text-slate-500">
          {entry.keys.join(", ") || "no keywords"}
        </span>
        <button
          onClick={onRemove}
          className="rounded px-1.5 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/15"
        >
          ✕
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-white/10 p-3">
          <Field
            label="Trigger keywords"
            hint="Comma separated. The entry activates when any keyword appears in the recent chat."
            action={
              <WriterButton
                busy={busyKeys}
                hasText={!!keys.trim()}
                onClick={() => onWrite("keys")}
                label="Keywords"
              />
            }
          >
            <TextInput
              value={keys}
              onChange={setKeys}
              placeholder="ashfall district, the ashfall, lower ward"
            />
            {keys !== entry.keys.join(", ") && (
              <Button
                size="xs"
                variant="soft"
                onClick={() =>
                  onPatch({
                    keys: keys.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
              >
                Save keywords
              </Button>
            )}
          </Field>

          <Field
            label="Entry content"
            action={
              <WriterButton
                busy={busyContent}
                hasText={!!content.trim()}
                onClick={() => onWrite("content")}
              />
            }
          >
            <AutoTextarea
              value={content}
              onChange={setContent}
              minRows={5}
              onBlur={() => content !== entry.content && onPatch({ content })}
              placeholder="Encyclopedic facts about this one subject…"
            />
          </Field>

          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle
              checked={entry.enabled}
              onChange={(v) => onPatch({ enabled: v })}
              label="Enabled"
            />
            <Toggle
              checked={entry.constant}
              onChange={(v) => onPatch({ constant: v })}
              label="Always on"
              hint="Ignore keywords, always inject."
            />
            <Field label="Priority">
              <TextInput
                type="number"
                value={String(entry.priority)}
                onChange={(v) => onPatch({ priority: Number(v) || 0 })}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
