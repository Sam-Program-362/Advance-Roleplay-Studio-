"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  ChatMessage,
  ChatSession,
  Connection,
  FullChat,
  Group,
} from "@/lib/client";
import { api, generate } from "@/lib/client";
import type { HordeStatus } from "@/lib/llm";
import type { GroupSegment } from "@/lib/groupSegments";
import { providerKind } from "@/lib/defaults";
import {
  CHARACTER_CARD_FIELDS,
  GLOBAL_CARD_FIELDS,
  GLOBAL_CARD_SUBJECT,
  type CardData,
} from "@/lib/groupCards";
import { DEPTH_LABELS } from "@/lib/groups";
import { AutoTextarea, Avatar, Button, Field, Modal, cx } from "./ui";
import { HordeQueueCard, HordeWaitBar } from "./HordeQueue";
import PersonaManager from "./PersonaManager";

/* ---------- prose renderer (same conventions as 1:1 chat) ---------- */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => (
        <p key={bi} className="whitespace-pre-wrap leading-relaxed">
          {tokenize(block).map((t, i) =>
            t.kind === "action" ? (
              <em key={i} className="italic text-violet-300/90">
                {t.text}
              </em>
            ) : t.kind === "quote" ? (
              <span key={i} className="font-medium text-sky-100">
                {t.text}
              </span>
            ) : (
              <span key={i}>{t.text}</span>
            ),
          )}
        </p>
      ))}
    </>
  );
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

export default function GroupChatView({
  chat,
  group,
  settings,
  connections,
  onReload,
  onPatchSettings,
  onBack,
  onOpenGroup,
  onOpenSession,
  toast,
}: {
  chat: FullChat;
  group: Group;
  settings: AppSettings;
  connections: Connection[];
  onReload: () => Promise<void>;
  onPatchSettings: (patch: Partial<AppSettings>) => void;
  onBack: () => void;
  onOpenGroup?: () => void;
  /** Switch the active session (the parent owns which chat is loaded). */
  onOpenSession: (id: number) => Promise<void>;
  toast: (m: string, k?: "ok" | "err") => void;
}) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [segments, setSegments] = useState<GroupSegment[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");

  /* cast bar — optimistic override while a presence change is in flight */
  const [presenceOverride, setPresenceOverride] = useState<number[] | null>(null);

  /* modals */
  const [cardsOpen, setCardsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgSrc, setImgSrc] = useState("");
  const [imgModel, setImgModel] = useState("");
  const [imgErr, setImgErr] = useState("");

  /* memory + cards */
  const [summaryDraft, setSummaryDraft] = useState(chat.summary);
  const [summaryInstr, setSummaryInstr] = useState(chat.summaryInstructions);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [cards, setCards] = useState<Record<string, CardData>>({});
  const [cardsBusy, setCardsBusy] = useState(false);

  /* group sessions list */
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  /* AI Horde queue */
  const [horde, setHorde] = useState<HordeStatus | null>(null);
  const [hordeAt, setHordeAt] = useState(0);
  const [procStart, setProcStart] = useState<number | null>(null);
  const [plainWait, setPlainWait] = useState<{ label: string; startedAt: number } | null>(null);
  const [hordeNow, setHordeNow] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const memberByCharacter = useMemo(
    () => new Map(group.members.map((m) => [m.characterId, m])),
    [group.members],
  );

  /**
   * Presence is derived from the chat row (never copied into state), so a
   * reload always shows exactly what the server has. An unset list means
   * "everyone who starts present" — the state a brand-new session opens with.
   */
  const storedPresent = chat.groupState?.present;
  const savedPresence = useMemo(
    () =>
      Array.isArray(storedPresent)
        ? storedPresent
        : group.members.filter((m) => m.startsPresent).map((m) => m.characterId),
    [storedPresent, group.members],
  );
  const presence = presenceOverride ?? savedPresence;
  const presentSet = useMemo(() => new Set(presence), [presence]);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [chat.id, scrollToBottom]);

  useEffect(() => {
    if (streaming) scrollToBottom();
  }, [segments, streaming, scrollToBottom]);

  const chatConn = useMemo(
    () => connections.find((c) => c.id === settings.activeConnectionId) ?? connections[0] ?? null,
    [connections, settings.activeConnectionId],
  );
  const chatIsHorde = chatConn ? providerKind(chatConn.provider) === "horde" : false;
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

  const lastMsg = chat.messages[chat.messages.length - 1];
  const canRegenerate = lastMsg?.role === "assistant";
  const hasMessages = chat.messages.length > 0;

  /* ---------------------------- actions ---------------------------- */

  async function reloadSessions() {
    try {
      setSessions(await api.groupChats(group.id));
    } catch {
      setSessions([]);
    }
  }

  /** Sessions are only ever needed inside their modal, so load on open. */
  async function openSessions() {
    setSessionsOpen(true);
    await reloadSessions();
  }

  function openMemory() {
    setSummaryDraft(chat.summary);
    setSummaryInstr(chat.summaryInstructions);
    setMemoryOpen(true);
  }

  async function run(action: "send" | "regenerate", userContent?: string) {
    if (streaming) return;
    setStreaming(true);
    setSegments([]);
    setStats(null);
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
          onSegments: (segs) => setSegments(segs),
          onHorde: (s) => {
            const now = Date.now();
            setHorde(s);
            setHordeAt(now);
            setHordeNow(now);
            setProcStart((p) => (s.processing > 0 ? p ?? now : null));
          },
          onDone: async () => {
            setSegments([]);
            setStreaming(false);
            await onReload();
            setTimeout(() => scrollToBottom(), 60);
          },
          onError: (msg) => {
            toast(msg.slice(0, 220), "err");
            setStreaming(false);
            setSegments([]);
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
      setSegments([]);
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
  }

  async function togglePresence(characterId: number) {
    const next = new Set(presence);
    if (next.has(characterId)) next.delete(characterId);
    else next.add(characterId);
    const list = group.members.map((m) => m.characterId).filter((id) => next.has(id));
    setPresenceOverride(list);
    try {
      await api.saveChat(chat.id, { groupState: { present: list } });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update the cast", "err");
    } finally {
      // Drop the override: the reloaded chat row is the source of truth.
      await onReload();
      setPresenceOverride(null);
    }
  }

  async function delTurn(m: ChatMessage) {
    if (m.turnId && !confirm("Delete this whole turn (every character's part in it)?")) return;
    await api.deleteMessage(m.id, false, Boolean(m.turnId));
    await onReload();
  }

  async function saveEdit() {
    if (!editing) return;
    await api.saveMessage(editing.id, editText);
    setEditing(null);
    await onReload();
    toast("Message updated");
  }

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

  function closeImage() {
    setImgOpen(false);
    setImgSrc("");
    setImgErr("");
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

  function stop() {
    abortRef.current?.abort();
    summaryAbortRef.current?.abort();
    setStreaming(false);
    setSummaryBusy(false);
    setHorde(null);
    setPlainWait(null);
  }

  /* ---------------------------- cards ---------------------------- */

  /** Cards are only needed inside their panel, so load on open. */
  async function openCards() {
    setCardsOpen(true);
    await loadCards();
  }

  async function loadCards() {
    setCardsBusy(true);
    try {
      const rows = await api.memoryCards(chat.id);
      const map: Record<string, CardData> = { [GLOBAL_CARD_SUBJECT]: {} };
      for (const m of group.members) map[String(m.characterId)] = {};
      for (const r of rows) map[String(r.subject)] = r.data ?? {};
      setCards(map);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load the cards", "err");
    } finally {
      setCardsBusy(false);
    }
  }

  function setCardField(subject: string, key: string, value: string) {
    setCards((c) => ({ ...c, [subject]: { ...(c[subject] ?? {}), [key]: value } }));
  }

  async function saveCard(subject: string, label: string) {
    try {
      await api.saveMemoryCard(chat.id, subject, cards[subject] ?? {});
      toast(`${label} card saved`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the card", "err");
    }
  }

  async function newSession() {
    try {
      const created = await api.addChat({ groupId: group.id, title: group.name });
      setSessionsOpen(false);
      toast("New group session started");
      if (created?.id) await onOpenSession(created.id);
      await reloadSessions();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start a session", "err");
    }
  }

  const lastStreamIndex = segments.length - 1;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <header className="relative z-10 flex shrink-0 items-center gap-2.5 border-b border-white/10 bg-[#0d1120]/80 px-3 py-2.5 backdrop-blur-md">
        <button
          onClick={onBack}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/10"
          title="Back to groups"
        >
          ←
        </button>
        <Avatar src={group.avatar} name={group.name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{group.name}</p>
          <button
            onClick={() => void openSessions()}
            className="flex max-w-full items-center gap-1 truncate text-[11px] font-medium text-slate-400 transition hover:text-violet-300"
          >
            <span className="truncate">{chat.title}</span>
            <span className="text-[9px]">▾</span>
          </button>
        </div>
        {onOpenGroup && (
          <button
            onClick={onOpenGroup}
            title="Edit this group"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-[#14192d] text-slate-300 transition hover:bg-white/15 hover:text-white active:scale-95"
          >
            ✏️
          </button>
        )}
        <button
          onClick={() => void openCards()}
          title="Memory cards"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-[#14192d] text-slate-300 transition hover:bg-white/15 hover:text-white active:scale-95"
        >
          🗂
        </button>
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
          <span className="ml-1 hidden truncate sm:inline">{settings.personaName || "Persona"}</span>
        </Button>
        <Button
          size="xs"
          variant="soft"
          className="rounded-full"
          onClick={openMemory}
          title="Story memory"
        >
          🧠<span className="ml-1 hidden sm:inline">Memory</span>
        </Button>
      </header>

      {/* Cast bar */}
      <div className="relative z-10 shrink-0 border-b border-white/5 bg-[#0b0e1b]/80 px-3 py-2">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Cast
          </span>
          {group.members.length === 0 && (
            <span className="text-[11px] text-slate-500">No members yet — edit the group.</span>
          )}
          {group.members.map((m) => {
            const isPresent = presentSet.has(m.characterId);
            return (
              <button
                key={m.id}
                onClick={() => void togglePresence(m.characterId)}
                title={
                  isPresent
                    ? `${m.name} is present — tap to send them away`
                    : `${m.name} is away — tap to bring them in`
                }
                className={cx(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 transition active:scale-95",
                  isPresent
                    ? "border-violet-400/50 bg-violet-500/15 text-white"
                    : "border-white/10 bg-slate-950/50 text-slate-500 opacity-60",
                )}
              >
                <Avatar
                  src={m.avatar}
                  name={m.name}
                  size={24}
                  className={isPresent ? "" : "grayscale"}
                />
                <span className="max-w-[86px] truncate text-[11px] font-semibold">{m.name}</span>
                {isPresent && m.role.trim() && (
                  <span className="rounded-full bg-violet-600/40 px-1.5 text-[9px] uppercase tracking-wide">
                    {m.role.trim()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

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
        <div className="relative z-10 flex shrink-0 items-center justify-center border-b border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          Add a connection in Settings first.
        </div>
      )}

      {/* Transcript */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-4">
          {!hasMessages && (
            <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-8 text-center">
              <div>
                <p className="text-3xl">🎭</p>
                <p className="mt-2 text-sm text-slate-400">
                  The opening scene is on its way. Send the first line as{" "}
                  {settings.personaName || "yourself"} to start the group scene.
                </p>
              </div>
            </div>
          )}

          {chat.messages.map((m, idx) => {
            const isUser = m.role === "user";
            const isNarration = !isUser && m.kind === "narration";
            const speaker = m.speakerId ? memberByCharacter.get(m.speakerId) : undefined;
            const isLast = idx === chat.messages.length - 1;
            const nextTurnSame = chat.messages[idx + 1]?.turnId === m.turnId && !!m.turnId;
            return (
              <div key={m.id} className="animate-fade-in">
                {isNarration ? (
                  <div className="mx-auto max-w-[94%] px-2 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/70">
                      Narrator
                    </p>
                    <div className="mt-1 space-y-2 text-[14px] italic leading-relaxed text-slate-300/95">
                      <Prose text={m.content} />
                    </div>
                  </div>
                ) : isUser ? (
                  <div className="flex flex-row-reverse gap-2.5">
                    <div className="max-w-[88%] rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-600/30 to-indigo-600/20 px-4 py-3 text-[14.5px] text-slate-50 shadow-md sm:rounded-3xl">
                      <Prose text={m.content} />
                    </div>
                  </div>
                ) : (
                  <div className="group flex gap-2.5">
                    <Avatar
                      src={speaker?.avatar}
                      name={speaker?.name ?? "Character"}
                      size={32}
                    />
                    <div className="min-w-0 max-w-[88%] sm:max-w-[80%]">
                      <p className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold text-violet-200">
                        {speaker?.name ?? "Character"}
                        {speaker?.role?.trim() && (
                          <span className="rounded-full border border-violet-400/30 px-1.5 text-[9px] font-semibold uppercase tracking-wide text-violet-300/80">
                            {speaker.role.trim()}
                          </span>
                        )}
                      </p>
                      <div className="space-y-3 rounded-2xl border border-white/10 bg-[#121627]/90 px-4 py-3 text-[14.5px] leading-relaxed text-slate-200 shadow-lg shadow-black/20 backdrop-blur-md sm:rounded-3xl">
                        <Prose text={m.content} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Turn-level actions (only under the last segment of a turn) */}
                {!isUser && !nextTurnSame && (
                  <div
                    className={cx(
                      "mt-1 flex flex-wrap gap-1 text-[10px] opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100",
                      isNarration ? "justify-center" : "pl-11",
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
                    <MsgBtn danger onClick={() => void delTurn(m)}>
                      🗑 Delete turn
                    </MsgBtn>
                    {isLast && (
                      <MsgBtn onClick={() => void run("regenerate")}>🔄 Regenerate turn</MsgBtn>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {generatingCard()}

          <div ref={bottomRef} className="h-1" />
        </div>
      </div>

      {plainWait && <HordeWaitBar label={plainWait.label} elapsed={waitElapsed} onStop={stop} />}

      {/* Action bar */}
      <div className="relative z-10 shrink-0 border-t border-white/10 bg-[#0c1020]/85 px-3 py-2 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar">
          <Button
            size="xs"
            variant="soft"
            className="rounded-full"
            disabled={streaming || !canRegenerate}
            onClick={() => void run("regenerate")}
            title="Re-roll the whole turn — every character's part in it"
          >
            🔄 Regenerate
          </Button>
          <Button
            size="xs"
            variant="soft"
            className="rounded-full"
            onClick={() => void openCards()}
            title="View and edit the Memory Cards"
          >
            🗂 Cards
          </Button>
          <Button
            size="xs"
            variant="soft"
            className="rounded-full"
            disabled={streaming || imgBusy || !hasMessages}
            onClick={() => {
              setImgOpen(true);
              void genImage();
            }}
            title="Illustrate the present cast together — temporary, never saved"
          >
            🎨 Scene image
          </Button>
          {presentSet.size === 0 && (
            <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] text-amber-200">
              Nobody present — narration only
            </span>
          )}
          {streaming && (
            <Button size="xs" variant="danger" className="rounded-full" onClick={stop}>
              ■ Stop
            </Button>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="relative z-10 shrink-0 border-t border-white/10 bg-[#0c1020]/95 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2.5">
          <div className="min-w-0 flex-1">
            <AutoTextarea
              value={input}
              onChange={setInput}
              minRows={1}
              maxRows={8}
              placeholder={`Write as ${settings.personaName || "yourself"}…`}
              className="rounded-2xl border-white/15 bg-[#121627] text-sm shadow-inner focus:border-violet-500"
            />
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={streaming || !input.trim() || noConnection}
            className={cx(
              "grid h-[44px] w-[44px] shrink-0 place-items-center rounded-2xl text-lg shadow-md transition-all duration-200 active:scale-95",
              streaming || !input.trim() || noConnection
                ? "bg-slate-800/80 text-slate-600"
                : "bg-gradient-to-tr from-violet-600 to-indigo-500 text-white shadow-violet-600/40 hover:scale-102 hover:from-violet-500 hover:to-indigo-400",
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
        title="Edit segment"
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

      {/* Cards modal */}
      <Modal
        open={cardsOpen}
        onClose={() => setCardsOpen(false)}
        title="🗂 Memory cards"
        wide
        footer={
          <Button variant="primary" onClick={() => setCardsOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="space-y-5">
          <p className="text-[11px] leading-relaxed text-slate-500">
            The cards are pinned into every turn and outrank the recent text. Keep them to short
            compressed phrases —{" "}
            <span className="text-slate-300">
              automatic updating arrives in the next update
            </span>
            ; for now you edit them by hand.
          </p>

          {cardsBusy && <p className="text-xs text-slate-400">Loading cards…</p>}

          <CardEditor
            title="Global card"
            subject={GLOBAL_CARD_SUBJECT}
            data={cards[GLOBAL_CARD_SUBJECT] ?? {}}
            onChange={setCardField}
            onSave={saveCard}
          />

          {group.members.map((m) => (
            <CardEditor
              key={m.id}
              title={m.name}
              subtitle={`${m.role?.trim() || "no role"} · depth ${m.depth} · ${DEPTH_LABELS[m.depth] ?? ""}`}
              subject={String(m.characterId)}
              data={cards[String(m.characterId)] ?? {}}
              dimmed={!presentSet.has(m.characterId)}
              dimNote="Absent — their card is not sent to the model"
              onChange={setCardField}
              onSave={saveCard}
            />
          ))}
        </div>
      </Modal>

      {/* Story memory modal */}
      <Modal
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        title="🧠 Story memory"
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
          <Field label="Summary instructions (optional)" hint="What the archivist should track.">
            <AutoTextarea value={summaryInstr} onChange={setSummaryInstr} minRows={3} />
          </Field>
          <Field
            label="Story memory"
            hint="Pinned prose memory of everything that has happened. Never evicted from the prompt."
            action={
              <Button
                size="xs"
                variant="soft"
                disabled={summaryBusy}
                onClick={() => void doSummarize(true)}
              >
                Rebuild from scratch
              </Button>
            }
          >
            <AutoTextarea value={summaryDraft} onChange={setSummaryDraft} minRows={10} maxRows={24} />
          </Field>
        </div>
      </Modal>

      {/* Group sessions modal */}
      <Modal
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        title={`Sessions — ${group.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSessionsOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void newSession()}>
              + New session
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          {sessions.length === 0 && (
            <p className="py-4 text-center text-[11px] text-slate-500">No sessions yet.</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={cx(
                "flex items-center gap-2 rounded-xl border px-3 py-2 transition",
                chat.id === s.id
                  ? "border-violet-400/50 bg-violet-500/15"
                  : "border-white/10 bg-slate-950/40",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{s.title}</span>
                <span className="block text-[10px] text-slate-500">
                  {new Date(s.updatedAt).toLocaleString()}
                  {s.summary ? " · 🧠 memory" : ""}
                </span>
              </span>
              <button
                onClick={async () => {
                  setSessionsOpen(false);
                  await onOpenSession(s.id);
                }}
                className="rounded px-2 py-1 text-[11px] text-violet-300 hover:bg-white/10"
              >
                Open
              </button>
              <button
                onClick={async () => {
                  const name = prompt("Rename session", s.title);
                  if (!name) return;
                  await api.saveChat(s.id, { title: name });
                  await reloadSessions();
                  if (chat.id === s.id) await onReload();
                }}
                className="rounded px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/10"
              >
                ✏️
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`Delete session "${s.title}"?`)) return;
                  await api.deleteChat(s.id);
                  await reloadSessions();
                  if (chat.id === s.id) {
                    toast("Session deleted — pick another one", "ok");
                    await onReload();
                  }
                }}
                className="rounded px-1.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/15"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </Modal>

      {/* Persona switcher */}
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
        <PersonaManager settings={settings} onPatch={onPatchSettings} toast={toast} />
      </Modal>

      {/* Scene image */}
      <Modal
        open={imgOpen}
        onClose={closeImage}
        title="🎨 Group scene image"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={closeImage}>
              Close
            </Button>
            <Button variant="soft" disabled={imgBusy} onClick={() => void genImage()}>
              {imgBusy ? "Generating…" : "↻ Regenerate"}
            </Button>
            <Button
              variant="primary"
              disabled={imgBusy || !imgSrc}
              onClick={() => window.open(imgSrc, "_blank")}
            >
              Open
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Built from the present cast, the world and the last few turns — everyone in the scene
            appears together. Temporary: it is never saved to your story.
          </p>
          {imgBusy && (
            <div className="grid place-items-center rounded-2xl border border-white/10 bg-slate-950/50 p-12 text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
              <p className="text-sm text-slate-300">Generating group scene…</p>
            </div>
          )}
          {!imgBusy && imgErr && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-950/30 p-6 text-center">
              <p className="text-sm leading-relaxed text-rose-200">{imgErr}</p>
              <Button size="sm" variant="soft" className="mt-3 rounded-full" onClick={() => void genImage()}>
                Try again
              </Button>
            </div>
          )}
          {!imgBusy && imgSrc && (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgSrc} alt="Generated group scene" className="mx-auto max-h-[62vh] w-auto" />
            </div>
          )}
          {!imgBusy && imgSrc && imgModel && (
            <p className="text-[10px] text-slate-500">Model: {imgModel}</p>
          )}
        </div>
      </Modal>
    </div>
  );

  /* ---------------- streaming bubbles ---------------- */
  function generatingCard() {
    if (!streaming) return null;
    if (chatIsHorde) {
      return (
        <HordeQueueCard
          queue={hordeQueue}
          waitTime={horde?.waitTime ?? 0}
          elapsed={hordeElapsed}
          stage={hordeStage}
          avatar={group.avatar}
          name={group.name}
          onStop={stop}
        />
      );
    }
    if (!segments.length) {
      return (
        <div className="mx-auto max-w-[94%] px-2 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/70">
            Narrator
          </p>
          <p className="mt-1 text-[13px] italic text-slate-500">
            the scene is forming…<span className="animate-pulse text-violet-400"> ▍</span>
          </p>
        </div>
      );
    }
    return segments.map((seg, i) => {
      const member = seg.speakerId ? memberByCharacter.get(seg.speakerId) : undefined;
      const cursor = i === lastStreamIndex ? <span className="animate-pulse text-violet-400">▍</span> : null;
      if (seg.kind === "narration") {
        return (
          <div key={i} className="mx-auto max-w-[94%] px-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/70">
              Narrator
            </p>
            <div className="mt-1 space-y-2 text-[14px] italic leading-relaxed text-slate-300/95">
              <Prose text={seg.text} />
              {cursor}
            </div>
          </div>
        );
      }
      return (
        <div key={i} className="flex gap-2.5">
          <Avatar src={member?.avatar} name={seg.speakerName} size={32} />
          <div className="min-w-0 max-w-[88%] sm:max-w-[80%]">
            <p className="mb-0.5 text-[11px] font-bold text-violet-200">{seg.speakerName}</p>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-[#121627]/90 px-4 py-3 text-[14.5px] leading-relaxed text-slate-200 shadow-lg shadow-black/20 backdrop-blur-md sm:rounded-3xl">
              <Prose text={seg.text} />
              {cursor}
            </div>
          </div>
        </div>
      );
    });
  }
}

function CardEditor({
  title,
  subtitle,
  subject,
  data,
  dimmed,
  dimNote,
  onChange,
  onSave,
}: {
  title: string;
  subtitle?: string;
  subject: string;
  data: CardData;
  dimmed?: boolean;
  dimNote?: string;
  onChange: (subject: string, key: string, value: string) => void;
  onSave: (subject: string, label: string) => Promise<void>;
}) {
  const fields = subject === GLOBAL_CARD_SUBJECT ? GLOBAL_CARD_FIELDS : CHARACTER_CARD_FIELDS;
  return (
    <div
      className={cx(
        "space-y-3 rounded-2xl border p-3.5",
        dimmed ? "border-white/5 bg-slate-950/60 opacity-55" : "border-white/10 bg-[#121626]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-white">{title}</p>
          {(subtitle || (dimmed && dimNote)) && (
            <p className="text-[10px] text-slate-500">{dimmed && dimNote ? dimNote : subtitle}</p>
          )}
        </div>
        <Button size="xs" variant="soft" className="rounded-full" onClick={() => void onSave(subject, title)}>
          Save card
        </Button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} label={`${f.key} · ${f.label}`} hint={f.hint}>
            <input
              value={data[f.key] ?? ""}
              onChange={(e) => onChange(subject, f.key, e.target.value)}
              placeholder="(empty)"
              className="w-full rounded-lg border border-white/10 bg-[#111528] px-3 py-2 text-xs text-slate-100 placeholder-slate-600 outline-none transition focus:border-violet-500"
            />
          </Field>
        ))}
      </div>
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
