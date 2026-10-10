"use client";

import { useEffect, useState } from "react";
import type { AppSettings, Persona } from "@/lib/client";
import { api } from "@/lib/client";
import { AutoTextarea, Button, Field, TextInput, cx } from "./ui";

/**
 * Multiple roleplayer personas (SillyTavern / character.ai style).
 * The ACTIVE persona lives in settings.personaName / personaDescription — the
 * same fields every prompt already reads — so switching is instant everywhere.
 */
export default function PersonaManager({
  settings,
  onPatch,
  toast,
}: {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => void;
  toast: (m: string, k?: "ok" | "err") => void;
}) {
  const [list, setList] = useState<Persona[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setList(await api.personas());
      } catch {
        /* first run / schema still warming — list stays empty */
      }
    })();
  }, []);

  const reload = async () => {
    try {
      setList(await api.personas());
    } catch {
      /* keep whatever we have */
    }
  };

  function selectPersona(p: Persona) {
    onPatch({ personaName: p.name, personaDescription: p.description });
    toast(`Active persona: ${p.name}`);
  }

  function openNew(prefill?: { name: string; description: string }) {
    setEditingId(null);
    setDraft(prefill ?? { name: "", description: "" });
    setFormOpen(true);
  }

  function openEdit(p: Persona) {
    setEditingId(p.id);
    setDraft({ name: p.name, description: p.description });
    setFormOpen(true);
  }

  async function saveDraft() {
    const name = draft.name.trim();
    if (!name) {
      toast("Persona name is required", "err");
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await api.savePersona(editingId, { name, description: draft.description.trim() });
        toast("Persona updated");
      } else {
        await api.addPersona({ name, description: draft.description.trim() });
        toast("Persona created");
      }
      await reload();
      setFormOpen(false);
      setEditingId(null);
      setDraft({ name: "", description: "" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save persona", "err");
    } finally {
      setBusy(false);
    }
  }

  /** Persist the currently active fields as a reusable persona. */
  async function saveActiveAsPersona() {
    const name = settings.personaName.trim();
    if (!name) {
      toast("Give the active persona a name first", "err");
      return;
    }
    setBusy(true);
    try {
      const existing = list.find(
        (p) => p.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        await api.savePersona(existing.id, {
          name,
          description: settings.personaDescription.trim(),
        });
        toast("Persona updated");
      } else {
        await api.addPersona({
          name,
          description: settings.personaDescription.trim(),
        });
        toast("Persona saved");
      }
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save persona", "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Persona) {
    if (!confirm(`Delete persona "${p.name}"?`)) return;
    try {
      await api.deletePersona(p.id);
      await reload();
      toast("Persona deleted");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete persona", "err");
    }
  }

  return (
    <div className="space-y-4">
      {/* Active persona — the fields every prompt reads */}
      <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
            Active persona
          </p>
          <Button size="xs" variant="soft" disabled={busy} onClick={() => void saveActiveAsPersona()}>
            💾 Save as persona
          </Button>
        </div>
        <Field label="Persona name" hint="Replaces the {{user}} macro everywhere.">
          <TextInput
            value={settings.personaName}
            onChange={(v) => onPatch({ personaName: v })}
            placeholder="User"
          />
        </Field>
        <Field
          label="Persona description"
          hint="Who you are in the story. Pinned into every roleplay prompt."
        >
          <AutoTextarea
            value={settings.personaDescription}
            onChange={(v) => onPatch({ personaDescription: v })}
            minRows={4}
            placeholder="A weary courier with a forged travel writ and a debt to the wrong people."
          />
        </Field>
      </div>

      {/* Saved personas */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Saved personas ({list.length})
          </p>
          <Button size="xs" variant="primary" onClick={() => openNew()}>
            + New persona
          </Button>
        </div>

        {list.length === 0 && !formOpen && (
          <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[11px] text-slate-500">
            No saved personas yet. Create identities to swap between mid-story — each one carries
            its own name and description into every prompt.
          </p>
        )}

        <div className="space-y-1.5">
          {list.map((p) => {
            const active =
              p.name.trim().toLowerCase() === settings.personaName.trim().toLowerCase();
            return (
              <div
                key={p.id}
                className={cx(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 transition",
                  active
                    ? "border-emerald-400/50 bg-emerald-500/10"
                    : "border-white/10 bg-slate-950/40",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-100">
                    {active && <span className="mr-1 text-emerald-300">✓</span>}
                    {p.name}
                  </p>
                  {p.description?.trim() && (
                    <p className="truncate text-[11px] text-slate-500">{p.description}</p>
                  )}
                </div>
                <Button
                  size="xs"
                  variant={active ? "soft" : "primary"}
                  disabled={active}
                  onClick={() => selectPersona(p)}
                  title="Make this the active persona"
                >
                  {active ? "In use" : "Use"}
                </Button>
                <Button size="xs" variant="soft" onClick={() => openEdit(p)} title="Edit">
                  ✏️
                </Button>
                <Button size="xs" variant="danger" onClick={() => void remove(p)} title="Delete">
                  🗑
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create / edit form */}
      {formOpen && (
        <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {editingId ? "Edit persona" : "New persona"}
          </p>
          <Field label="Name">
            <TextInput
              value={draft.name}
              onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
              placeholder="e.g. Raven, The Captain, Me (modern)"
            />
          </Field>
          <Field label="Description" hint="Appearance, background, temperament — who {{user}} is.">
            <AutoTextarea
              value={draft.description}
              onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
              minRows={4}
              placeholder="Late twenties, charcoal coat, quick with a lie and slower with the truth."
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void saveDraft()}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Create persona"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
