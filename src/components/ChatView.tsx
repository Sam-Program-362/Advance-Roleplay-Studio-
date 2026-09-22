"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  Character,
  ChatMessage,
  Checkpoint,
  FullChat,
} from "@/lib/client";
import { api, generate } from "@/lib/client";
import { AutoTextarea, Avatar, Button, Field, Modal, cx } from "./ui";

/* ---------- roleplay prose renderer ---------- */
function renderContent(text: string) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, bi) => (
    <p key={bi} className="whitespace-pre-wrap leading-relaxed">
      {tokenize(block).map((t, i) =>
        t.kind === "action" ? (
          <em key={i} className="text-violet-300/90 italic">
            {t.text}
          </em>
        ) : t.kind === "quote" ? (
          <span key={i} className="text-sky-100 font-medium">
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </p>
  ));
}

function tokenize(s: string) {
  const out: { kind: "plain" | "action" | "quote"; text: string }[] = [];
  const re = /(\*[^*]+\*)|("[^"]*")|(“[^”]*”)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ kind: "plain", text: s.slice(last, m.index) });
    const tok = m[0];
    out.push({ kind: tok.startsWith("*") ? "action" : "quote", text: tok });
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ kind: "plain", text: s.slice(last) });
  return out;
}

export default function ChatView({
  chat,
  character,
  settings,
  onReload,
  onOpenSessions,
  toast,
  headerLeft,
}: {
  chat: FullChat;
  character: Character | null;
  settings: AppSettings;
  onReload: () => Promise<void>;
  onOpenSessions: () => void;
  toast: (m: string, k?: "ok" | "err") => void;
  headerLeft?: React.ReactNode;
}) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamMode, setStreamMode] = useState<"insert" | "append" | "replace">("insert");
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(chat.summary);
  const [summaryInstr, setSummaryInstr] = useState(chat.summaryInstructions);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSummaryDraft(chat.summary);
    setSummaryInstr(chat.summaryInstructions);
  }, [chat.id, chat.summary, chat.summaryInstructions]);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [chat.id, scrollToBottom]);

  useEffect(() => {
    if (streaming) scrollToBottom();
  }, [streamText, streaming, scrollToBottom]);

  const cpByMessage = useMemo(() => {
    const m = new Map<number, Checkpoint>();
    for (const cp of chat.checkpoints) m.set(cp.messageId, cp);
    return m;
  }, [chat.checkpoints]);

  const hasMessages = chat.messages.length > 0;
  const lastMsg = chat.messages[chat.messages.length - 1];
  const canExtend = lastMsg?.role === "assistant";

  async function run(action: "send" | "regenerate" | "continue" | "elaborate", userContent?: string) {
    if (streaming) return;
    setStreaming(true);
    setStreamText("");
    setStreamMode(
      action === "continue" || action === "elaborate"
        ? "append"
        : action === "regenerate"
          ? "replace"
          : "insert",
    );
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await generate(
        { chatId: chat.id, action, userContent },
        {
          onMeta: (m) => setStats(m.stats),
          onDelta: (t) => setStreamText((p) => p + t),
          onDone: async () => {
            setStreamText("");
            setStreaming(false);
            await onReload();
            setTimeout(() => scrollToBottom(), 60);
          },
          onError: (msg) => {
            toast(msg.slice(0, 220), "err");
            setStreaming(false);
            setStreamText("");
            void onReload();
          },
        },
        ctrl.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast(e instanceof Error ? e.message : "Generation failed", "err");
      }
      await onReload();
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await run("send", text);
    void maybeAutoSummarize();
  }

  async function maybeAutoSummarize() {
    if (!settings.autoSummarize) return;
    const pending = chat.messages.filter((m) => m.id > (chat.summarizedUpTo ?? 0)).length;
    if (pending >= settings.autoSummarizeEvery) {
      try {
        await api.summarize(chat.id, summaryInstr || undefined);
        await onReload();
      } catch {
        /* silent */
      }
    }
  }

  async function impersonate() {
    if (streaming) return;
    setStreaming(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chat.id, action: "impersonate" }),
      });
      const j = (await res.json()) as { text?: string; error?: string };
      if (j.error) throw new Error(j.error);
      setInput(j.text ?? "");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Impersonate failed", "err");
    } finally {
      setStreaming(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    await api.saveMessage(editing.id, editText);
    setEditing(null);
    await onReload();
    toast("Message updated");
  }

  async function del(m: ChatMessage, cascade: boolean) {
    if (cascade && !confirm("Delete this message and everything after it?")) return;
    await api.deleteMessage(m.id, cascade);
    await onReload();
  }

  async function makeCheckpoint(m: ChatMessage) {
    const name = prompt("Checkpoint name", `Checkpoint @ ${chat.messages.indexOf(m) + 1}`);
    if (name === null) return;
    await api.addCheckpoint(chat.id, m.id, name || undefined);
    await onReload();
    toast("Checkpoint saved");
  }

  async function restore(cp: Checkpoint) {
    if (!confirm(`Revert the story back to "${cp.name}"? Later messages will be removed.`)) return;
    await api.restoreCheckpoint(chat.id, cp.messageId);
    await onReload();
    toast("Reverted to checkpoint");
  }

  async function doSummarize(fromScratch: boolean) {
    setSummaryBusy(true);
    try {
      await api.saveChat(chat.id, { summaryInstructions: summaryInstr });
      const res = await api.summarize(chat.id, summaryInstr || undefined, fromScratch);
      setSummaryDraft(res.summary);
      await onReload();
      toast("Story memory updated");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Summarise failed", "err");
    } finally {
      setSummaryBusy(false);
    }
  }

  const bg = character?.background;
  const blur = character?.backgroundBlur ?? 6;
  const opacity = (character?.backgroundOpacity ?? 35) / 100;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {bg && (
        <div className="pointer-events-none absolute inset-0 z-0">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${bg})`, filter: `blur(${blur}px)`, opacity, transform: "scale(1.08)" }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/50 to-slate-950/85" />
        </div>
      )}

      {/* Header */}
      <header className="relative z-10 flex shrink-0 items-center gap-2 border-b border-white/10 bg-slate-950/70 px-3 py-2 backdrop-blur">
        {headerLeft}
        <Avatar src={character?.avatar} name={character?.name ?? "Assistant"} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {character?.name ?? "Assistant"}
          </p>
          <button
            onClick={onOpenSessions}
            className="block max-w-full truncate text-[11px] text-slate-400 hover:text-violet-300"
          >
            {chat.title} · switch session ▾
          </button>
        </div>
        <Button size="xs" variant="soft" onClick={() => setMemoryOpen(true)} title="Story memory">
          🧠<span className="hidden sm:inline ml-1">Memory</span>
        </Button>
      </header>

      {stats && (
        <div className="relative z-10 shrink-0 overflow-x-auto border-b border-white/5 bg-slate-950/50 px-3 py-1 text-[10px] text-slate-500 no-scrollbar">
          <span className="whitespace-nowrap">
            pinned {String(stats.pinnedTokens)}t · history {String(stats.historyTokens)}t · lore{" "}
            {String(stats.loreTokens)}t
            {Number(stats.droppedMessages) > 0
              ? ` · ${String(stats.droppedMessages)} old turns trimmed`
              : ""}
            {Array.isArray(stats.activeLore) && stats.activeLore.length
              ? ` · lore: ${(stats.activeLore as string[]).join(", ")}`
              : ""}
          </span>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-4">
          {!hasMessages && (
            <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-10 text-center">
              <div>
                <p className="text-3xl">💬</p>
                <p className="mt-2 text-sm text-slate-400">
                  Start the scene — send the first message.
                </p>
              </div>
            </div>
          )}

          {chat.messages.map((m, idx) => {
            const isUser = m.role === "user";
            const isLast = idx === chat.messages.length - 1;
            const cp = cpByMessage.get(m.id);
            const showStream = streaming && isLast && streamMode !== "insert";
            return (
              <div key={m.id} className={cx("group flex gap-2.5", isUser && "flex-row-reverse")}>
                {!isUser && <Avatar src={character?.avatar} name={character?.name ?? "AI"} size={32} />}
                <div className={cx("min-w-0 max-w-[88%] sm:max-w-[80%]", isUser && "items-end")}>
                  {cp && (
                    <button
                      onClick={() => void restore(cp)}
                      className="mb-1 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-500/30"
                      title="Revert the conversation to this point"
                    >
                      🔖 {cp.name} · revert
                    </button>
                  )}
                  <div
                    className={cx(
                      "rounded-2xl border px-3.5 py-2.5 text-[15px] shadow-sm space-y-3",
                      isUser
                        ? "border-violet-400/25 bg-violet-600/25 text-slate-50"
                        : "border-white/10 bg-slate-900/80 text-slate-200 backdrop-blur-sm",
                    )}
                  >
                    {renderContent(
                      showStream && streamMode === "replace"
                        ? streamText || "…"
                        : showStream && streamMode === "append"
                          ? m.content + (streamText ? "\n\n" + streamText : "")
                          : m.content,
                    )}
                    {showStream && <span className="inline-block animate-pulse text-violet-400">▍</span>}
                  </div>
                  <div
                    className={cx(
                      "mt-1 flex flex-wrap gap-1 text-[10px] opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100",
                      isUser && "justify-end",
                    )}
                  >
                    <MsgBtn
                      onClick={() => {
                        setEditing(m);
                        setEditText(m.content);
                      }}
                    >
                      ✏️ Edit
                    </MsgBtn>
                    <MsgBtn onClick={() => void navigator.clipboard.writeText(m.content)}>
                      ⧉ Copy
                    </MsgBtn>
                    <MsgBtn onClick={() => void makeCheckpoint(m)}>🔖 Checkpoint</MsgBtn>
                    <MsgBtn danger onClick={() => void del(m, false)}>
                      🗑 Delete
                    </MsgBtn>
                    <MsgBtn danger onClick={() => void del(m, true)}>
                      ⏪ Delete from here
                    </MsgBtn>
                  </div>
                </div>
              </div>
            );
          })}

          {streaming && streamMode === "insert" && (
            <div className="flex gap-2.5">
              <Avatar src={character?.avatar} name={character?.name ?? "AI"} size={32} />
              <div className="max-w-[88%] rounded-2xl border border-white/10 bg-slate-900/80 px-3.5 py-2.5 text-[15px] text-slate-200 backdrop-blur-sm space-y-3">
                {streamText ? renderContent(streamText) : <span className="text-slate-500">thinking…</span>}
                <span className="inline-block animate-pulse text-violet-400">▍</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} className="h-1" />
        </div>
      </div>

      {/* Action bar */}
      <div className="relative z-10 shrink-0 border-t border-white/10 bg-slate-950/80 px-2 py-1.5 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar">
          <Button
            size="xs"
            variant="soft"
            disabled={streaming || !canExtend}
            onClick={() => void run("regenerate")}
            title="Re-roll the last AI message"
          >
            🔄 Regenerate
          </Button>
          <Button
            size="xs"
            variant="soft"
            disabled={streaming || !canExtend}
            onClick={() => void run("continue")}
            title="Seamlessly continue the last message from where it stopped"
          >
            ▶ Continue
          </Button>
          <Button
            size="xs"
            variant="accent"
            disabled={streaming || !canExtend}
            onClick={() => void run("elaborate")}
            title="Expand and deepen the current scene without advancing past it"
          >
            ✨ Elaborate
          </Button>
          <Button size="xs" variant="soft" disabled={streaming} onClick={() => void impersonate()}>
            🎭 Impersonate
          </Button>
          <Button
            size="xs"
            variant="soft"
            disabled={summaryBusy || !hasMessages}
            onClick={() => setMemoryOpen(true)}
          >
            🧠 Summarise
          </Button>
          {streaming && (
            <Button
              size="xs"
              variant="danger"
              onClick={() => {
                abortRef.current?.abort();
                setStreaming(false);
              }}
            >
              ■ Stop
            </Button>
          )}
        </div>
      </div>

      {/* Composer — always rendered */}
      <div className="relative z-10 shrink-0 border-t border-white/10 bg-slate-950/90 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <div className="min-w-0 flex-1">
            <AutoTextarea
              value={input}
              onChange={setInput}
              minRows={1}
              maxRows={8}
              placeholder={
                character ? `Write as ${settings.personaName || "you"}…` : "Ask anything…"
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="bg-slate-900/90"
            />
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={streaming || !input.trim()}
            className={cx(
              "grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl text-lg transition",
              streaming || !input.trim()
                ? "bg-slate-800 text-slate-600"
                : "bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-900/40 hover:from-violet-500 active:scale-95",
            )}
            title="Send (Enter)"
          >
            {streaming ? "…" : "➤"}
          </button>
        </div>
      </div>

      {/* Edit modal */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit message"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveEdit()}>
              Save
            </Button>
          </>
        }
      >
        <AutoTextarea value={editText} onChange={setEditText} minRows={10} maxRows={26} />
      </Modal>

      {/* Memory modal */}
      <Modal
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        title="🧠 Story memory & summarisation"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setMemoryOpen(false)}>
              Close
            </Button>
            <Button
              variant="soft"
              disabled={summaryBusy}
              onClick={async () => {
                await api.saveChat(chat.id, {
                  summary: summaryDraft,
                  summaryInstructions: summaryInstr,
                });
                await onReload();
                toast("Memory saved");
              }}
            >
              Save manually
            </Button>
            <Button variant="primary" disabled={summaryBusy} onClick={() => void doSummarize(false)}>
              {summaryBusy ? "Summarising…" : "Update memory"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="Summary instructions (optional)"
            hint="Tell the model what matters in this story — plot threads to track, tone, what to ignore."
          >
            <AutoTextarea
              value={summaryInstr}
              onChange={setSummaryInstr}
              minRows={3}
              placeholder="Track the blood-debt subplot and Kael's shifting loyalty. Keep the tone grim."
            />
          </Field>
          <Field
            label="Story memory"
            hint="Unformatted prose describing how the story built up and progressed. Pinned to the context and never evicted."
            action={
              <Button size="xs" variant="soft" disabled={summaryBusy} onClick={() => void doSummarize(true)}>
                Rebuild from scratch
              </Button>
            }
          >
            <AutoTextarea
              value={summaryDraft}
              onChange={setSummaryDraft}
              minRows={10}
              maxRows={24}
              placeholder="No memory yet — hit Update memory once the scene has developed."
            />
          </Field>
          {chat.checkpoints.length > 0 && (
            <Field label="Checkpoints">
              <div className="space-y-1.5">
                {chat.checkpoints.map((cp) => (
                  <div
                    key={cp.id}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                      🔖 {cp.name}
                    </span>
                    <Button size="xs" variant="soft" onClick={() => void restore(cp)}>
                      Revert
                    </Button>
                    <Button
                      size="xs"
                      variant="danger"
                      onClick={async () => {
                        await api.deleteCheckpoint(chat.id, cp.id);
                        await onReload();
                      }}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            </Field>
          )}
        </div>
      </Modal>
    </div>
  );
}

function MsgBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "rounded border px-1.5 py-0.5 transition",
        danger
          ? "border-rose-500/25 text-rose-300/80 hover:bg-rose-500/15 hover:text-rose-200"
          : "border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-100",
      )}
    >
      {children}
    </button>
  );
}
