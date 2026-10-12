"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  Character,
  ChatMessage,
  Checkpoint,
  Connection,
  FullChat,
} from "@/lib/client";
import { api, generate } from "@/lib/client";
import type { HordeStatus } from "@/lib/llm";
import { providerKind } from "@/lib/defaults";
import { AutoTextarea, Avatar, Button, Field, ImageUpload, Modal, Slider, cx } from "./ui";
import { HordeQueueCard, HordeWaitBar } from "./HordeQueue";
import PersonaManager from "./PersonaManager";

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
  connections,
  onReload,
  onPatchCharacter,
  onPatchSettings,
  onOpenSessions,
  onOpenSettings,
  toast,
  headerLeft,
}: {
  chat: FullChat;
  character: Character | null;
  settings: AppSettings;
  connections: Connection[];
  onReload: () => Promise<void>;
  onPatchCharacter?: (id: number, patch: Partial<Character>) => Promise<void>;
  onPatchSettings: (patch: Partial<AppSettings>) => void;
  onOpenSessions: () => void;
  onOpenSettings?: () => void;
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

  /* AI Horde queue state — Horde connections only */
  const [horde, setHorde] = useState<HordeStatus | null>(null);
  const [hordeAt, setHordeAt] = useState(0);
  const [procStart, setProcStart] = useState<number | null>(null);
  const [plainWait, setPlainWait] = useState<{ label: string; startedAt: number } | null>(null);
  /** Wall-clock tick (state, not Date.now() in render) that drives the timers. */
  const [hordeNow, setHordeNow] = useState(0);
  /** True only for the streaming generate actions (not impersonate/summaries). */
  const [generating, setGenerating] = useState(false);

  /* persona quick-switcher */
  const [personaOpen, setPersonaOpen] = useState(false);

  /* temporary scene image — kept in component state only, never persisted */
  const [imgOpen, setImgOpen] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgSrc, setImgSrc] = useState("");
  const [imgModel, setImgModel] = useState("");
  const [imgErr, setImgErr] = useState("");

  /* chat background (unique to this character) */
  const [bgOpen, setBgOpen] = useState(false);
  const [bgDraft, setBgDraft] = useState("");
  const [bgBlur, setBgBlur] = useState(6);
  const [bgOpacity, setBgOpacity] = useState(35);
  const [bgBusy, setBgBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSummaryDraft(chat.summary);
    setSummaryInstr(chat.summaryInstructions);
  }, [chat.id, chat.summary, chat.summaryInstructions]);

  useEffect(() => {
    if (!character) return;
    setBgDraft(character.background ?? "");
    setBgBlur(character.backgroundBlur ?? 6);
    setBgOpacity(character.backgroundOpacity ?? 35);
  }, [character?.id, character?.background, character?.backgroundBlur, character?.backgroundOpacity]);

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

  /* AI Horde detection — mirrors the server's getActiveConnection resolution. */
  const chatConn = useMemo(
    () => connections.find((c) => c.id === settings.activeConnectionId) ?? connections[0] ?? null,
    [connections, settings.activeConnectionId],
  );
  const chatIsHorde = chatConn ? providerKind(chatConn.provider) === "horde" : false;
  /* Nothing to generate with yet — a fresh install has no connections at all. */
  const noConnection = !chatConn;
  const writerConn = useMemo(
    () =>
      connections.find((c) => c.id === (settings.writerConnectionId ?? settings.activeConnectionId)) ??
      chatConn,
    [connections, settings.writerConnectionId, settings.activeConnectionId, chatConn],
  );
  const writerIsHorde = writerConn ? providerKind(writerConn.provider) === "horde" : false;

  const hordeActive = streaming && chatIsHorde;
  useEffect(() => {
    if (!hordeActive && !plainWait) return;
    const iv = setInterval(() => setHordeNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [hordeActive, plainWait]);

  const hordeSince =
    horde && hordeAt && hordeNow ? Math.max(0, Math.floor((hordeNow - hordeAt) / 1000)) : 0;
  const hordeQueue = horde ? Math.max(0, horde.queuePosition - hordeSince) : 0;
  const hordeElapsed = (horde?.elapsedSec ?? 0) + hordeSince;
  const hordeStage = horde
    ? horde.processing > 0
      ? procStart && hordeNow - procStart > 3500
        ? "Writing"
        : "A worker picked it up"
      : "Joined the queue"
    : "Joining the queue…";
  const waitElapsed =
    plainWait && hordeNow ? Math.max(0, Math.floor((hordeNow - plainWait.startedAt) / 1000)) : 0;

  async function run(action: "send" | "regenerate" | "continue" | "elaborate", userContent?: string) {
    if (streaming) return;
    setStreaming(true);
    setGenerating(true);
    setStreamText("");
    setStreamMode(
      action === "continue"
        ? "append"
        : action === "regenerate"
          ? "replace"
          : "insert",
    );
    setHorde(null);
    setHordeAt(0);
    setProcStart(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await generate(
        { chatId: chat.id, action, userContent },
        {
          onMeta: (m) => setStats(m.stats),
          onDelta: (t) => setStreamText((p) => p + t),
          onHorde: (s) => {
            const now = Date.now();
            setHorde(s);
            setHordeAt(now);
            setHordeNow(now);
            setProcStart((p) => (s.processing > 0 ? p ?? now : null));
          },
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
      setGenerating(false);
      setHorde(null);
      setProcStart(null);
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
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (chatIsHorde) setPlainWait({ label: "Waiting for AI Horde…", startedAt: Date.now() });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chat.id, action: "impersonate" }),
        signal: ctrl.signal,
      });
      const j = (await res.json()) as { text?: string; error?: string };
      if (j.error) throw new Error(j.error);
      const text = (j.text ?? "").trim();
      if (!text) {
        throw new Error(
          "The model returned an empty response. Try again, or pick a different model in Settings → Connections.",
        );
      }
      setInput(text);
      toast("Impersonated reply placed in your composer");
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast(e instanceof Error ? e.message : "Impersonate failed", "err");
      }
    } finally {
      setStreaming(false);
      setPlainWait(null);
      abortRef.current = null;
    }
  }

  /* ---------- temporary scene image ---------- */
  async function genImage() {
    setImgBusy(true);
    setImgErr("");
    try {
      const res = await api.image(chat.id);
      setImgSrc(res.image);
      setImgModel(res.model);
    } catch (e) {
      setImgErr(e instanceof Error ? e.message : "Image generation failed");
    } finally {
      setImgBusy(false);
    }
  }

  function openImage() {
    setImgOpen(true);
    void genImage();
  }

  function closeImage() {
    setImgOpen(false);
    setImgSrc("");
    setImgErr("");
  }

  async function downloadImage() {
    if (!imgSrc) return;
    try {
      const res = await fetch(imgSrc);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scene-image-${chat.id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      window.open(imgSrc, "_blank");
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
    const ctrl = new AbortController();
    summaryAbortRef.current = ctrl;
    if (writerIsHorde) setPlainWait({ label: "Waiting for AI Horde…", startedAt: Date.now() });
    try {
      await api.saveChat(chat.id, { summaryInstructions: summaryInstr });
      const res = await api.summarize(chat.id, summaryInstr || undefined, fromScratch, ctrl.signal);
      setSummaryDraft(res.summary);
      await onReload();
      toast("Story memory updated");
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast(e instanceof Error ? e.message : "Summarise failed", "err");
      }
    } finally {
      setSummaryBusy(false);
      setPlainWait(null);
      summaryAbortRef.current = null;
    }
  }

  /** Stop whichever AI Horde job is currently running. */
  function stopHorde() {
    abortRef.current?.abort();
    summaryAbortRef.current?.abort();
    setStreaming(false);
    setGenerating(false);
    setSummaryBusy(false);
    setHorde(null);
    setPlainWait(null);
  }

  async function applyBackground() {
    if (!character || !onPatchCharacter) return;
    setBgBusy(true);
    try {
      await onPatchCharacter(character.id, {
        background: bgDraft,
        backgroundBlur: bgBlur,
        backgroundOpacity: bgOpacity,
      });
      setBgOpen(false);
      toast("Background updated");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save background", "err");
    } finally {
      setBgBusy(false);
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
            style={{
              backgroundImage: `url(${bg})`,
              filter: `blur(${blur}px)`,
              opacity,
              transform: "scale(1.08)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/50 to-slate-950/85" />
        </div>
      )}

      {/* Header */}
      <header className="relative z-10 flex shrink-0 items-center gap-2.5 border-b border-white/10 bg-[#0d1120]/80 px-4 py-2.5 backdrop-blur-md">
        {headerLeft}
        <Avatar src={character?.avatar} name={character?.name ?? "Assistant"} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">
            {character?.name ?? "Assistant"}
          </p>
          <button
            onClick={onOpenSessions}
            className="flex items-center gap-1 max-w-full truncate text-[11px] font-medium text-slate-400 hover:text-violet-300 transition"
          >
            <span className="truncate">{chat.title}</span>
            <span className="text-[9px]">▾</span>
          </button>
        </div>

        {character && onPatchCharacter && (
          <button
            onClick={() => setBgOpen(true)}
            title="Chat background for this character"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-[#14192d] text-slate-300 transition hover:bg-white/15 hover:text-white active:scale-95"
          >
            🖼
          </button>
        )}
        <a
          href={`/api/export?type=chat&id=${chat.id}`}
          title="Export this session as JSON"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-[#14192d] text-slate-300 transition hover:bg-white/15 hover:text-white active:scale-95"
        >
          ⬇
        </a>
        <Button
          size="xs"
          variant="soft"
          className="rounded-full max-w-[130px]"
          onClick={() => setPersonaOpen(true)}
          title="Switch persona"
        >
          🧑
          <span className="hidden sm:inline ml-1 truncate">{settings.personaName || "Persona"}</span>
        </Button>
        <Button size="xs" variant="soft" className="rounded-full" onClick={() => setMemoryOpen(true)} title="Story memory">
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

      {noConnection && (
        <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-amber-400/20 bg-amber-500/10 px-3 py-2 text-center text-[11px] text-amber-200">
          <span>Add a connection in Settings first.</span>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="rounded-full border border-amber-300/40 px-2.5 py-0.5 font-semibold text-amber-100 transition hover:bg-amber-400/20"
            >
              Open Settings
            </button>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-4">
          {!hasMessages && (
            <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-10 text-center">
              <div>
                <p className="text-3xl">💬</p>
                {noConnection ? (
                  <>
                    <p className="mt-2 text-sm text-amber-200">Add a connection in Settings first.</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {character?.name ?? "The assistant"} replies are generated through one of your own
                      AI provider connections — OpenAI, OpenRouter, Claude, Gemini, a local model or AI
                      Horde. Add one to start writing.
                    </p>
                    {onOpenSettings && (
                      <Button className="mt-4 rounded-full" variant="primary" onClick={onOpenSettings}>
                        ⚙ Open Settings
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">
                    Start the scene — send the first message.
                  </p>
                )}
              </div>
            </div>
          )}

          {chat.messages.map((m, idx) => {
            const isUser = m.role === "user";
            const isLast = idx === chat.messages.length - 1;
            const cp = cpByMessage.get(m.id);
            const showStream = streaming && !chatIsHorde && isLast && streamMode !== "insert";
            return (
              <div key={m.id} className={cx("group flex gap-2.5 animate-fade-in", isUser && "flex-row-reverse")}>
                {!isUser && <Avatar src={character?.avatar} name={character?.name ?? "AI"} size={32} />}
                <div className={cx("min-w-0 max-w-[88%] sm:max-w-[80%]", isUser && "items-end")}>
                  {cp && (
                    <button
                      onClick={() => void restore(cp)}
                      className="mb-1 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-500/30 transition"
                      title="Revert the conversation to this point"
                    >
                      🔖 {cp.name} · revert
                    </button>
                  )}
                  <div
                    className={cx(
                      "rounded-2xl sm:rounded-3xl border px-4 py-3 text-[14.5px] leading-relaxed shadow-md space-y-3 transition-all",
                      isUser
                        ? "border-violet-500/30 bg-gradient-to-br from-violet-600/30 to-indigo-600/20 text-slate-50"
                        : "border-white/10 bg-[#121627]/90 text-slate-200 backdrop-blur-md shadow-lg shadow-black/20",
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

          {generating && chatIsHorde && (
            <HordeQueueCard
              queue={hordeQueue}
              waitTime={horde?.waitTime ?? 0}
              elapsed={hordeElapsed}
              stage={hordeStage}
              avatar={character?.avatar}
              name={character?.name ?? "AI"}
              onStop={stopHorde}
            />
          )}
          {streaming && !chatIsHorde && streamMode === "insert" && (
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

      {plainWait && (
        <HordeWaitBar label={plainWait.label} elapsed={waitElapsed} onStop={stopHorde} />
      )}

      {/* Action bar */}
      <div className="relative z-10 shrink-0 border-t border-white/10 bg-[#0c1020]/85 px-3 py-2 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar">
          <Button
            size="xs"
            variant="soft"
            className="rounded-full"
            disabled={streaming || !canExtend}
            onClick={() => void run("regenerate")}
            title="Re-roll the last AI message"
          >
            🔄 Regenerate
          </Button>
          <Button
            size="xs"
            variant="soft"
            className="rounded-full"
            disabled={streaming || !canExtend}
            onClick={() => void run("continue")}
            title="Seamlessly continue the last message from where it stopped"
          >
            ▶ Continue
          </Button>
          <Button
            size="xs"
            variant="accent"
            className="rounded-full"
            disabled={streaming || !canExtend}
            onClick={() => void run("elaborate")}
            title="Expand and deepen the current scene without advancing past it"
          >
            ✨ Elaborate
          </Button>
          <Button size="xs" variant="soft" className="rounded-full" disabled={streaming} onClick={() => void impersonate()}>
            🎭 Impersonate
          </Button>
          <Button
            size="xs"
            variant="soft"
            className="rounded-full"
            disabled={summaryBusy || !hasMessages}
            onClick={() => setMemoryOpen(true)}
          >
            🧠 Summarise
          </Button>
          <Button
            size="xs"
            variant="soft"
            className="rounded-full"
            disabled={streaming || imgBusy || !hasMessages}
            onClick={() => openImage()}
            title="Generate an image of the current scenario — temporary, never saved to your roleplay"
          >
            🎨 Scene image
          </Button>
          {streaming && !chatIsHorde && (
            <Button
              size="xs"
              variant="danger"
              className="rounded-full"
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
      <div className="relative z-10 shrink-0 border-t border-white/10 bg-[#0c1020]/95 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2.5">
          <div className="min-w-0 flex-1">
            <AutoTextarea
              value={input}
              onChange={setInput}
              minRows={1}
              maxRows={8}
              placeholder={
                character ? `Write as ${settings.personaName || "you"}…` : "Ask anything…"
              }
              className="bg-[#121627] border-white/15 focus:border-violet-500 rounded-2xl shadow-inner text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={streaming || !input.trim() || noConnection}
            className={cx(
              "grid h-[44px] w-[44px] shrink-0 place-items-center rounded-2xl text-lg transition-all duration-200 active:scale-95 shadow-md",
              streaming || !input.trim() || noConnection
                ? "bg-slate-800/80 text-slate-600"
                : "bg-gradient-to-tr from-violet-600 to-indigo-500 text-white shadow-violet-600/40 hover:from-violet-500 hover:to-indigo-400 hover:scale-102",
            )}
            title={noConnection ? "Add a connection in Settings first" : "Send message"}
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

      {/* Background modal */}
      <Modal
        open={bgOpen}
        onClose={() => setBgOpen(false)}
        title={`🖼 Chat background — ${character?.name ?? ""}`}
        wide
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => {
                setBgDraft("");
                setBgBlur(6);
                setBgOpacity(35);
              }}
              disabled={!bgDraft && bgBlur === 6 && bgOpacity === 35}
            >
              Restore default
            </Button>
            <Button variant="ghost" onClick={() => setBgOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={bgBusy} onClick={() => void applyBackground()}>
              {bgBusy ? "Saving…" : "Apply"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-[11px] leading-relaxed text-slate-500">
            This background is saved on <span className="text-slate-300">{character?.name}</span>{" "}
            only — every character you chat with keeps its own image, blur and visibility. The
            preview is live behind this window.
          </p>
          <ImageUpload
            label="Background image"
            value={bgDraft}
            onChange={setBgDraft}
            maxSize={1400}
            aspect="aspect-video"
          />
          <Slider
            label="Blur density"
            value={bgBlur}
            min={0}
            max={24}
            onChange={setBgBlur}
            suffix="px"
          />
          <Slider
            label="Background visibility"
            value={bgOpacity}
            min={0}
            max={100}
            onChange={setBgOpacity}
            suffix="%"
          />
          <Field label="Quick presets" hint="Adjust the sliders and hit Apply.">
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Crisp", blur: 0, opacity: 55 },
                { label: "Soft", blur: 6, opacity: 35 },
                { label: "Hazy", blur: 12, opacity: 22 },
                { label: "Dark", blur: 3, opacity: 15 },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    setBgBlur(p.blur);
                    setBgOpacity(p.opacity);
                  }}
                  className="rounded-full border border-white/15 px-3 py-1 text-[11px] text-slate-300 hover:border-violet-400/60 hover:text-white"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
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

      {/* Persona switcher modal */}
      <Modal
        open={personaOpen}
        onClose={() => setPersonaOpen(false)}
        title="🧑 Personas"
        wide
        footer={
          <Button variant="primary" onClick={() => setPersonaOpen(false)}>
            Done
          </Button>
        }
      >
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
          Switch who <span className="text-slate-300">you</span> are in this story — the active
          persona supplies the <code className="text-violet-300">{"{{user}}"}</code> name and is
          pinned into every prompt, just like SillyTavern personas.
        </p>
        <PersonaManager settings={settings} onPatch={onPatchSettings} toast={toast} />
      </Modal>

      {/* Temporary scene image modal */}
      <Modal
        open={imgOpen}
        onClose={closeImage}
        title="🎨 Scene image"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={closeImage}>
              Close
            </Button>
            <Button variant="soft" disabled={imgBusy} onClick={() => void genImage()}>
              {imgBusy ? "Generating…" : "↻ Regenerate"}
            </Button>
            <Button variant="primary" disabled={imgBusy || !imgSrc} onClick={() => void downloadImage()}>
              ⬇ Download
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Built from the last few turns plus the character and your active persona —{" "}
            <span className="text-slate-300">temporary</span>: it is never saved to your roleplay,
            so download it if you want to keep it.
          </p>

          {imgBusy && (
            <div className="grid place-items-center rounded-2xl border border-white/10 bg-slate-950/50 p-12 text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
              <p className="text-sm text-slate-300">Generating scene image…</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {settings.imageModel
                  ? `Model: ${settings.imageModel}`
                  : "Model from your image connection"}
              </p>
            </div>
          )}

          {!imgBusy && imgErr && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-950/30 p-6 text-center">
              <p className="text-sm leading-relaxed text-rose-200">{imgErr}</p>
              <Button
                size="sm"
                variant="soft"
                className="mt-3 rounded-full"
                onClick={() => void genImage()}
              >
                Try again
              </Button>
            </div>
          )}

          {!imgBusy && imgSrc && (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgSrc} alt="Generated scene" className="mx-auto max-h-[62vh] w-auto" />
            </div>
          )}

          {!imgBusy && imgSrc && imgModel && (
            <p className="text-[10px] text-slate-500">Model: {imgModel}</p>
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
