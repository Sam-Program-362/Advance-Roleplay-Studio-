"use client";

import { useState } from "react";
import type { AppSettings, Connection } from "@/lib/client";
import { api } from "@/lib/client";
import { PROVIDERS } from "@/lib/defaults";
import {
  AutoTextarea,
  Button,
  Field,
  Slider,
  Tabs,
  TextInput,
  Toggle,
  cx,
  inputCls,
} from "./ui";
import {
  DEFAULT_ASSISTANT_PROMPT,
  DEFAULT_NSFW_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
} from "@/lib/defaults";

export default function SettingsPanel({
  settings,
  connections,
  onSettings,
  reloadConnections,
  toast,
}: {
  settings: AppSettings;
  connections: Connection[];
  onSettings: (patch: Partial<AppSettings>) => void;
  reloadConnections: () => Promise<void>;
  toast: (m: string, k?: "ok" | "err") => void;
}) {
  const [tab, setTab] = useState("api");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "api", label: "Connections", icon: "🔌" },
            { id: "prompts", label: "System Prompts", icon: "📜" },
            { id: "persona", label: "Persona", icon: "🧑" },
            { id: "memory", label: "Memory", icon: "🧠" },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {tab === "api" && (
          <ConnectionsTab
            settings={settings}
            connections={connections}
            onSettings={onSettings}
            reload={reloadConnections}
            toast={toast}
          />
        )}

        {tab === "prompts" && (
          <>
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Active mode
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["assistant", "roleplay"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => onSettings({ mode: m })}
                    className={cx(
                      "rounded-lg border px-3 py-2.5 text-left transition",
                      settings.mode === m
                        ? "border-violet-400/60 bg-violet-500/15"
                        : "border-white/10 bg-slate-900/50 hover:border-white/25",
                    )}
                  >
                    <span className="block text-sm font-medium text-white">
                      {m === "assistant" ? "🤖 Assistant LLM" : "🎭 Character Roleplay"}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {m === "assistant"
                        ? "Plain, capable chat assistant"
                        : "Full character + lorebook immersion"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Field
              label="Assistant mode system prompt"
              hint="Used whenever you chat without a character."
              action={
                <Button
                  size="xs"
                  variant="soft"
                  onClick={() => onSettings({ assistantSystemPrompt: DEFAULT_ASSISTANT_PROMPT })}
                >
                  Reset default
                </Button>
              }
            >
              <AutoTextarea
                value={settings.assistantSystemPrompt}
                onChange={(v) => onSettings({ assistantSystemPrompt: v })}
                minRows={8}
              />
            </Field>

            <Field
              label="Roleplay mode system prompt"
              hint="Ships with a strict anti-break default. Supports {{char}} and {{user}}."
              action={
                <Button
                  size="xs"
                  variant="soft"
                  onClick={() => onSettings({ roleplaySystemPrompt: DEFAULT_ROLEPLAY_PROMPT })}
                >
                  Reset default
                </Button>
              }
            >
              <AutoTextarea
                value={settings.roleplaySystemPrompt}
                onChange={(v) => onSettings({ roleplaySystemPrompt: v })}
                minRows={12}
              />
            </Field>

            <div className="rounded-xl border border-rose-500/25 bg-rose-950/20 p-3 space-y-3">
              <Toggle
                checked={settings.nsfwEnabled}
                onChange={(v) => onSettings({ nsfwEnabled: v })}
                label="🔞 NSFW / uncensored mode"
                hint="Injects the jailbreak system prompt below so the model writes mature content without breaking character."
              />
              {settings.nsfwEnabled && (
                <Field
                  label="Jailbreak prompt"
                  action={
                    <Button
                      size="xs"
                      variant="soft"
                      onClick={() => onSettings({ nsfwPrompt: DEFAULT_NSFW_PROMPT })}
                    >
                      Reset default
                    </Button>
                  }
                >
                  <AutoTextarea
                    value={settings.nsfwPrompt}
                    onChange={(v) => onSettings({ nsfwPrompt: v })}
                    minRows={8}
                  />
                </Field>
              )}
            </div>
          </>
        )}

        {tab === "persona" && (
          <>
            <Field label="Your persona name" hint="Replaces the {{user}} macro everywhere.">
              <TextInput
                value={settings.personaName}
                onChange={(v) => onSettings({ personaName: v })}
                placeholder="User"
              />
            </Field>
            <Field
              label="Your persona description"
              hint="Who you are in the story. Pinned into every roleplay prompt."
            >
              <AutoTextarea
                value={settings.personaDescription}
                onChange={(v) => onSettings({ personaDescription: v })}
                minRows={6}
                placeholder="A weary courier with a forged travel writ and a debt to the wrong people."
              />
            </Field>
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <Toggle
                checked={settings.streaming}
                onChange={(v) => onSettings({ streaming: v })}
                label="Stream responses token by token"
              />
            </div>
          </>
        )}

        {tab === "memory" && (
          <>
            <Field
              label="Default summary instructions"
              hint="Optional. Applied to every chat summary unless the session overrides it."
            >
              <AutoTextarea
                value={settings.summaryInstructions}
                onChange={(v) => onSettings({ summaryInstructions: v })}
                minRows={5}
                placeholder="Keep track of the debt plot and Elenna's shifting loyalty. Mention any injuries."
              />
            </Field>
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 space-y-3">
              <Toggle
                checked={settings.autoSummarize}
                onChange={(v) => onSettings({ autoSummarize: v })}
                label="Auto-summarise long sessions"
                hint="Folds older turns into the Story Memory block automatically."
              />
              {settings.autoSummarize && (
                <Slider
                  label="Summarise every N messages"
                  min={8}
                  max={80}
                  step={2}
                  value={settings.autoSummarizeEvery}
                  onChange={(v) => onSettings({ autoSummarizeEvery: v })}
                />
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-[11px] leading-relaxed text-slate-400">
              <p className="mb-1 font-semibold text-slate-300">Context priority guarantee</p>
              The character Context Block, Personality and Scenario, plus active lorebook entries
              and the Story Memory, are pinned into the system block and are never evicted. Only
              the oldest chat turns are trimmed when the window fills.
            </div>
          </>
        )}
        <div className="h-4" />
      </div>
    </div>
  );
}

function ConnectionsTab({
  settings,
  connections,
  onSettings,
  reload,
  toast,
}: {
  settings: AppSettings;
  connections: Connection[];
  onSettings: (patch: Partial<AppSettings>) => void;
  reload: () => Promise<void>;
  toast: (m: string, k?: "ok" | "err") => void;
}) {
  const [editing, setEditing] = useState<number | null>(connections[0]?.id ?? null);
  const conn = connections.find((c) => c.id === editing) ?? null;
  const [models, setModels] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [draft, setDraft] = useState<Connection | null>(conn);

  if (conn && (!draft || draft.id !== conn.id)) setDraft(conn);

  async function add() {
    const c = await api.addConnection({
      name: "New Connection",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    await reload();
    setEditing(c.id);
    setDraft(c);
    if (!settings.activeConnectionId) onSettings({ activeConnectionId: c.id });
  }

  async function saveDraft(patch: Partial<Connection>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    await api.saveConnection(draft.id, patch);
    await reload();
  }

  async function probe(action: "models" | "test") {
    if (!draft) return;
    setProbing(true);
    try {
      const res = await api.probe({
        action,
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        model: draft.model,
      });
      if (action === "models") {
        setModels(res.models ?? []);
        toast(`${res.models?.length ?? 0} models found`);
      } else {
        toast(`Connected — model replied: ${(res.reply ?? "").slice(0, 40)}`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message.slice(0, 180) : "Probe failed", "err");
    } finally {
      setProbing(false);
    }
  }

  const presetModels = PROVIDERS.find((p) => p.id === draft?.provider)?.models ?? [];
  const modelOptions = Array.from(new Set([...models, ...presetModels]));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Connections
          </p>
          <Button size="xs" variant="primary" onClick={() => void add()}>
            + Add
          </Button>
        </div>
        {connections.length === 0 && (
          <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[11px] text-slate-500">
            No connections yet. Add one to plug in OpenAI, OpenRouter, Claude, Gemini, DeepSeek,
            Mistral, Groq, KoboldCpp, Ollama or any OpenAI-compatible endpoint.
          </p>
        )}
        <div className="space-y-1.5">
          {connections.map((c) => (
            <div
              key={c.id}
              className={cx(
                "flex items-center gap-2 rounded-lg border px-3 py-2 transition",
                editing === c.id
                  ? "border-violet-400/50 bg-violet-500/10"
                  : "border-white/10 bg-slate-950/40",
              )}
            >
              <button
                onClick={() => onSettings({ activeConnectionId: c.id })}
                title="Use for chat"
                className={cx(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px]",
                  settings.activeConnectionId === c.id
                    ? "border-emerald-300 bg-emerald-500 text-white"
                    : "border-white/25 text-transparent hover:border-emerald-300",
                )}
              >
                ✓
              </button>
              <button
                onClick={() => {
                  setEditing(c.id);
                  setDraft(c);
                  setModels([]);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm text-slate-100">{c.name}</span>
                <span className="block truncate text-[11px] text-slate-500">
                  {c.provider} · {c.model || "no model"} {c.apiKey ? "· 🔑" : ""}
                </span>
              </button>
              <button
                onClick={async () => {
                  await api.deleteConnection(c.id);
                  await reload();
                  if (editing === c.id) setEditing(null);
                }}
                className="rounded px-1.5 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/15"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {draft && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-slate-950/40 p-3">
          <Field label="Connection name">
            <TextInput value={draft.name} onChange={(v) => void saveDraft({ name: v })} />
          </Field>

          <Field label="Provider">
            <select
              value={draft.provider}
              onChange={(e) => {
                const p = PROVIDERS.find((x) => x.id === e.target.value);
                void saveDraft({ provider: e.target.value, baseUrl: p?.baseUrl ?? draft.baseUrl });
                setModels([]);
              }}
              className={inputCls}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="API base URL" hint="Any OpenAI-compatible /v1 endpoint works.">
            <TextInput value={draft.baseUrl} onChange={(v) => void saveDraft({ baseUrl: v })} />
          </Field>

          <Field label="API key" hint="Stored server-side and proxied — never exposed to the browser bundle.">
            <TextInput
              type="password"
              value={draft.apiKey}
              onChange={(v) => void saveDraft({ apiKey: v })}
              placeholder="sk-…"
            />
          </Field>

          <Field
            label="Model"
            action={
              <div className="flex gap-1.5">
                <Button size="xs" variant="soft" disabled={probing} onClick={() => void probe("models")}>
                  {probing ? "…" : "Fetch models"}
                </Button>
                <Button size="xs" variant="soft" disabled={probing} onClick={() => void probe("test")}>
                  Test
                </Button>
              </div>
            }
          >
            <TextInput
              value={draft.model}
              onChange={(v) => void saveDraft({ model: v })}
              placeholder="model id"
            />
            {modelOptions.length > 0 && (
              <select
                value=""
                onChange={(e) => e.target.value && void saveDraft({ model: e.target.value })}
                className={cx(inputCls, "mt-2")}
              >
                <option value="">Pick from {modelOptions.length} models…</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Slider
              label="Temperature"
              min={0}
              max={2}
              step={0.05}
              value={draft.temperature}
              onChange={(v) => void saveDraft({ temperature: v })}
            />
            <Slider
              label="Top P"
              min={0}
              max={1}
              step={0.01}
              value={draft.topP}
              onChange={(v) => void saveDraft({ topP: v })}
            />
            <Slider
              label="Max response tokens"
              min={128}
              max={4096}
              step={32}
              value={draft.maxTokens}
              onChange={(v) => void saveDraft({ maxTokens: v })}
            />
            <Slider
              label="Context window"
              min={2000}
              max={200000}
              step={1000}
              value={draft.contextSize}
              onChange={(v) => void saveDraft({ contextSize: v })}
            />
            <Slider
              label="Frequency penalty"
              min={-2}
              max={2}
              step={0.05}
              value={draft.frequencyPenalty}
              onChange={(v) => void saveDraft({ frequencyPenalty: v })}
            />
            <Slider
              label="Presence penalty"
              min={-2}
              max={2}
              step={0.05}
              value={draft.presencePenalty}
              onChange={(v) => void saveDraft({ presencePenalty: v })}
            />
          </div>

          <Field label="AI Writer connection" hint="Optionally use a different model for generation helpers and summaries.">
            <select
              value={settings.writerConnectionId ?? ""}
              onChange={(e) =>
                onSettings({
                  writerConnectionId: e.target.value ? Number(e.target.value) : null,
                })
              }
              className={inputCls}
            >
              <option value="">Same as chat connection</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.model || "no model"})
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}
