"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings, Character, ChatSession, Connection, FullChat, Lorebook } from "@/lib/client";
import { api, readJsonFile } from "@/lib/client";
import ChatView from "./ChatView";
import CharacterEditor, { emptyCharacter, type DraftCharacter } from "./CharacterEditor";
import LorebookPanel from "./LorebookPanel";
import SettingsPanel from "./SettingsPanel";
import { Avatar, Button, Modal, Toast, cx } from "./ui";

type View = "characters" | "chat" | "editor" | "lore" | "settings";
type FilterMode = "all" | "sfw" | "nsfw";

const JSON_ACCEPT =
  ".json,.txt,.jsonc,application/json,text/plain,application/octet-stream";

export default function Studio() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [chat, setChat] = useState<FullChat | null>(null);
  const [view, setView] = useState<View>("characters");
  const [draft, setDraft] = useState<DraftCharacter | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [greetPick, setGreetPick] = useState<Character | null>(null);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [toastMsg, setToastMsg] = useState<{ m: string; k: "ok" | "err" } | null>(null);
  const [booting, setBooting] = useState(true);

  const toast = useCallback((m: string, k: "ok" | "err" = "ok") => {
    setToastMsg({ m, k });
    setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const loadChat = useCallback(async (id: number) => {
    try {
      const full = await api.chat(id);
      setChat(full);
      localStorage.setItem("rp.activeChat", String(id));
    } catch {
      setChat(null);
      localStorage.removeItem("rp.activeChat");
    }
  }, []);

  const reloadSessions = useCallback(async (characterId: number | null) => {
    const list = await api.chats(characterId);
    setSessions(list);
    return list;
  }, []);

  const reloadCharacters = useCallback(async () => {
    setCharacters(await api.characters());
  }, []);

  const reloadLorebooks = useCallback(async () => {
    setLorebooks(await api.lorebooks());
  }, []);

  const reloadConnections = useCallback(async () => {
    setConnections(await api.connections());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [s, conns, chars, books, allChats] = await Promise.all([
          api.settings(),
          api.connections(),
          api.characters(),
          api.lorebooks(),
          api.chats(),
        ]);
        setSettings(s);
        setConnections(conns);
        setCharacters(chars);
        setLorebooks(books);

        const stored = Number(localStorage.getItem("rp.activeChat") ?? 0);
        let target = allChats.find((c) => c.id === stored) ?? allChats[0];
        if (!target && chars.length > 0) {
          target = await api.addChat({ characterId: chars[0].id, title: "Session 1", mode: "roleplay" });
        } else if (!target) {
          target = await api.addChat({ characterId: null, title: "Assistant", mode: "assistant" });
        }
        if (target) {
          await reloadSessions(target.characterId);
          await loadChat(target.id);
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "Failed to load", "err");
      } finally {
        setBooting(false);
      }
    })();
  }, [loadChat, reloadSessions, toast]);

  const patchSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      setSettings((p) => (p ? { ...p, ...patch } : p));
      try {
        await api.saveSettings(patch);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Save failed", "err");
      }
    },
    [toast],
  );

  const patchCharacter = useCallback(
    async (id: number, patch: Partial<Character>) => {
      await api.saveCharacter(id, patch);
      await reloadCharacters();
    },
    [reloadCharacters],
  );

  const activeCharacter = useMemo(
    () => characters.find((c) => c.id === chat?.characterId) ?? null,
    [characters, chat?.characterId],
  );

  const reloadChat = useCallback(async () => {
    if (chat) await loadChat(chat.id);
  }, [chat, loadChat]);

  async function openCharacter(c: Character, forceNew = false) {
    const list = await reloadSessions(c.id);
    if (list.length && !forceNew) {
      await loadChat(list[0].id);
    } else {
      const greetings = [c.firstMessage, ...(c.alternateGreetings ?? [])].filter((g) => g?.trim());
      if (greetings.length > 1 && forceNew) {
        setGreetPick(c);
        return;
      }
      const s = await api.addChat({ characterId: c.id, title: `Session ${list.length + 1}`, mode: "roleplay" });
      await reloadSessions(c.id);
      await loadChat(s.id);
    }
    setView("chat");
    setDrawer(false);
  }

  async function newSession(c: Character | null, greetingIndex = 0) {
    const existing = c ? await api.chats(c.id) : await api.chats(null);
    const s = await api.addChat({
      characterId: c?.id ?? null,
      title: `Session ${existing.length + 1}`,
      mode: c ? "roleplay" : "assistant",
      greetingIndex,
    });
    await reloadSessions(c?.id ?? null);
    await loadChat(s.id);
    setView("chat");
    setSessionsOpen(false);
    setGreetPick(null);
    setDrawer(false);
  }

  async function startAssistant() {
    const list = await api.chats(null);
    const assistant = list.find((c) => c.characterId === null);
    if (assistant) {
      await reloadSessions(null);
      await loadChat(assistant.id);
    } else {
      await newSession(null);
    }
    void patchSettings({ mode: "assistant" });
    setView("chat");
    setDrawer(false);
  }

  /** Handles character cards, lorebooks and standalone session JSON. */
  async function importAny(file: File) {
    try {
      const data = await readJsonFile(file);
      const res = await api.importJson(data, "auto", chat?.characterId ?? null);

      if (res.kind === "chat" && res.chatId) {
        await reloadSessions(res.characterId ?? null);
        await loadChat(res.chatId);
        setView("chat");
        setSessionsOpen(false);
        toast(`Session imported · ${res.messages ?? 0} messages`);
        return;
      }

      if (res.kind === "lorebook") {
        await reloadLorebooks();
        toast(`Lorebook imported · ${res.name}`);
        return;
      }

      await Promise.all([reloadCharacters(), reloadLorebooks()]);
      toast(`Character imported · ${res.name ?? file.name}`);
      if (res.characterId) {
        const all = await api.characters();
        setCharacters(all);
        const c = all.find((x) => x.id === res.characterId);
        if (c) await openCharacter(c);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Import failed", "err");
    }
  }

  const filtered = useMemo(() => {
    return characters.filter((c) => {
      if (filterMode === "sfw" && c.nsfw) return false;
      if (filterMode === "nsfw" && !c.nsfw) return false;
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      const tags = (c.tags ?? []).join(" ").toLowerCase();
      return (
        c.name.toLowerCase().includes(s) ||
        tags.includes(s) ||
        (c.creatorNotes ?? "").toLowerCase().includes(s) ||
        (c.personality ?? "").toLowerCase().includes(s)
      );
    });
  }, [characters, filterMode, search]);

  if (booting || !settings) {
    return (
      <div className="grid h-[100dvh] place-items-center bg-[#0b0e1b] text-slate-400">
        <div className="text-center animate-fade-in">
          <div className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <p className="text-sm font-medium text-slate-300">Loading Roleplay Studio…</p>
        </div>
      </div>
    );
  }

  const activeConn = connections.find((c) => c.id === settings.activeConnectionId) ?? connections[0];

  /* ---------------- Header Component (matching screenshot) ---------------- */
  const header = (
    <header className="shrink-0 space-y-2.5 px-3 pt-3 pb-2.5 bg-[#0b0e1b] border-b border-white/5">
      {/* Row 1: Mask Icon + Mode pill segmented toggle + Settings pill button */}
      <div className="flex items-center justify-between gap-2 max-w-4xl mx-auto">
        <button
          onClick={() => setView("characters")}
          title="Roleplay Studio Home"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-sky-400 via-indigo-500 to-violet-600 text-lg text-white shadow-md shadow-sky-500/25 transition-transform active:scale-95"
        >
          🎭
        </button>

        {/* Center: Mode Segmented Pill */}
        <div className="flex items-center rounded-full bg-[#131728] border border-white/10 p-0.5 shadow-inner">
          <button
            onClick={() => {
              void patchSettings({ mode: "roleplay" });
              if (activeCharacter) setView("chat");
              else if (characters[0]) void openCharacter(characters[0]);
              else setView("characters");
            }}
            className={cx(
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200",
              settings.mode === "roleplay"
                ? "bg-violet-600 text-white shadow-md shadow-violet-700/40"
                : "text-slate-300 hover:text-white",
            )}
          >
            <span>🎭</span>
            <span>Roleplay</span>
          </button>
          <button
            onClick={() => void startAssistant()}
            className={cx(
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200",
              settings.mode === "assistant"
                ? "bg-violet-600 text-white shadow-md shadow-violet-700/40"
                : "text-slate-300 hover:text-white",
            )}
          >
            <span>🤖</span>
            <span>Assistant</span>
          </button>
        </div>

        {/* Right: Settings Pill Button */}
        <button
          onClick={() => setView("settings")}
          className={cx(
            "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-all duration-200 active:scale-95",
            view === "settings"
              ? "bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-700/30"
              : "bg-[#131728] border-white/10 text-slate-200 hover:text-white hover:bg-[#1a2037]",
          )}
        >
          <span>⚙</span>
          <span className="hidden sm:inline">Settings</span>
        </button>
      </div>

      {/* Row 2: Navigation Pills Bar (Characters | Chat | Lorebooks) */}
      <div className="flex items-center rounded-full bg-[#101424] border border-white/5 p-1 max-w-lg mx-auto shadow-inner">
        <button
          onClick={() => setView("characters")}
          className={cx(
            "flex-1 flex items-center justify-center gap-1.5 rounded-full py-1.5 px-3 text-xs font-semibold transition-all duration-200 active:scale-98",
            view === "characters"
              ? "bg-violet-600 text-white shadow-md shadow-violet-600/35"
              : "text-slate-400 hover:text-slate-200",
          )}
        >
          <span>👥</span>
          <span>Characters</span>
        </button>
        <button
          onClick={() => {
            if (!chat && characters[0]) void openCharacter(characters[0]);
            else setView("chat");
          }}
          className={cx(
            "flex-1 flex items-center justify-center gap-1.5 rounded-full py-1.5 px-3 text-xs font-semibold transition-all duration-200 active:scale-98",
            view === "chat"
              ? "bg-violet-600 text-white shadow-md shadow-violet-600/35"
              : "text-slate-400 hover:text-slate-200",
          )}
        >
          <span>💬</span>
          <span>Chat</span>
        </button>
        <button
          onClick={() => setView("lore")}
          className={cx(
            "flex-1 flex items-center justify-center gap-1.5 rounded-full py-1.5 px-3 text-xs font-semibold transition-all duration-200 active:scale-98",
            view === "lore"
              ? "bg-violet-600 text-white shadow-md shadow-violet-600/35"
              : "text-slate-400 hover:text-slate-200",
          )}
        >
          <span>📖</span>
          <span>Lorebooks</span>
        </button>
      </div>
    </header>
  );

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#0b0e1b] text-slate-100">
      {/* Top Header Always Present */}
      {header}

      {/* Main Content Area */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* VIEW 1: Characters Feed (Directly matches the screenshot!) */}
        {view === "characters" && (
          <div className="flex h-full min-h-0 flex-col overflow-y-auto px-3 py-3 animate-fade-in">
            <div className="mx-auto w-full max-w-4xl space-y-3 pb-8">
              {/* Row 3: Search input */}
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                  🔍
                </span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search characters, tags..."
                  className="w-full rounded-full border border-white/10 bg-[#121626] py-2 pl-9 pr-4 text-xs text-slate-100 placeholder-slate-500 outline-none transition focus:border-violet-500 focus:ring-1 focus:ring-violet-500 shadow-inner"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Row 4: Tag Filter Pills + Create Character Button + Filter Menu Icon */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setFilterMode("all")}
                    className={cx(
                      "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95",
                      filterMode === "all"
                        ? "bg-violet-600 text-white shadow-md shadow-violet-600/35"
                        : "bg-[#15192c] border border-white/10 text-slate-300 hover:text-white",
                    )}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setFilterMode("sfw")}
                    className={cx(
                      "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95",
                      filterMode === "sfw"
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/35"
                        : "bg-[#15192c] border border-white/10 text-slate-300 hover:text-white",
                    )}
                  >
                    SFW
                  </button>
                  <button
                    onClick={() => setFilterMode("nsfw")}
                    className={cx(
                      "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95",
                      filterMode === "nsfw"
                        ? "bg-rose-600 text-white shadow-md shadow-rose-600/35"
                        : "bg-[#15192c] border border-white/10 text-slate-300 hover:text-white",
                    )}
                  >
                    NSFW
                  </button>
                </div>

                {/* + Create Character button */}
                <button
                  onClick={() => {
                    setDraft(emptyCharacter());
                    setView("editor");
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs py-2 px-4 shadow-lg shadow-violet-600/30 transition-all duration-200 active:scale-97 whitespace-nowrap"
                >
                  <span className="text-sm font-bold">+</span>
                  <span>Create Character</span>
                </button>

                {/* Filter/Drawer Menu icon */}
                <button
                  onClick={() => setDrawer((d) => !d)}
                  title="Filter options"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#15192c] border border-white/10 text-slate-300 hover:text-white hover:bg-[#1f243f] transition active:scale-95"
                >
                  <span className="text-xs">☰</span>
                </button>
              </div>

              {/* Row 5: Import button */}
              <label
                title="Import character cards or session JSON"
                className="w-full cursor-pointer flex items-center justify-center gap-2 rounded-xl bg-[#141829] hover:bg-[#1b2138] border border-white/10 hover:border-violet-500/40 py-2.5 text-xs font-semibold text-slate-200 transition-all duration-200 active:scale-98 shadow-sm"
              >
                <span>📲</span>
                <span>Import</span>
                <input
                  type="file"
                  accept={JSON_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importAny(f);
                    e.target.value = "";
                  }}
                />
              </label>

              {/* Character Cards Feed */}
              {filtered.length === 0 ? (
                <div className="grid place-items-center rounded-3xl border border-dashed border-white/10 bg-[#121626] p-12 text-center animate-fade-in">
                  <div>
                    <p className="text-4xl">🎭</p>
                    <p className="mt-3 text-sm font-medium text-slate-300">No characters found</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Try clearing filters or hit &quot;+ Create Character&quot; to begin.
                    </p>
                    <Button
                      size="sm"
                      variant="primary"
                      className="mt-4 rounded-full"
                      onClick={() => {
                        setDraft(emptyCharacter());
                        setView("editor");
                      }}
                    >
                      + Create Character
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filtered.map((c) => (
                    <CharacterCard
                      key={c.id}
                      character={c}
                      sessionsCount={sessions.filter((s) => s.characterId === c.id).length}
                      onChat={() => void openCharacter(c)}
                      onEdit={() => {
                        setDraft({ ...c });
                        setView("editor");
                      }}
                      onExport={() => {
                        window.location.href = `/api/export?type=character&id=${c.id}&chats=1`;
                      }}
                      onDelete={async () => {
                        if (!confirm(`Delete "${c.name}" and all sessions?`)) return;
                        await api.deleteCharacter(c.id);
                        await reloadCharacters();
                        toast("Character deleted");
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: Chat View */}
        {view === "chat" &&
          (chat ? (
            <ChatView
              key={chat.id}
              chat={chat}
              character={activeCharacter}
              settings={settings}
              onReload={reloadChat}
              onPatchCharacter={patchCharacter}
              onOpenSessions={() => setSessionsOpen(true)}
              toast={toast}
              headerLeft={
                <button
                  onClick={() => setView("characters")}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 transition"
                  title="Back to characters"
                >
                  ←
                </button>
              }
            />
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center animate-fade-in">
              <div>
                <p className="text-3xl">💬</p>
                <p className="mt-2 text-sm text-slate-400">No active session.</p>
                <Button
                  className="mt-3 rounded-full"
                  variant="primary"
                  onClick={() => setView("characters")}
                >
                  Pick a character
                </Button>
              </div>
            </div>
          ))}

        {/* VIEW 3: Editor */}
        {view === "editor" && draft && (
          <div className="flex h-full min-h-0 flex-col animate-fade-in">
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0f1424] px-4 py-2.5">
              <h2 className="text-sm font-semibold text-white">
                {draft.id ? `Edit — ${draft.name || "character"}` : "Create Character"}
              </h2>
              <Button size="xs" variant="soft" className="rounded-full" onClick={() => setView("characters")}>
                ✕ Close
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
              <div className="mx-auto h-full min-h-0 w-full max-w-4xl">
                <CharacterEditor
                  initial={draft}
                  lorebooks={lorebooks}
                  nsfwGlobal={settings.nsfwEnabled}
                  toast={toast}
                  onOpenLorebooks={() => setView("lore")}
                  onClose={() => setView("characters")}
                  onSaved={async (c) => {
                    await reloadCharacters();
                    setDraft({ ...c });
                    void patchSettings({ mode: "roleplay" });
                    await openCharacter(c);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* VIEW 4: Lorebooks */}
        {view === "lore" && (
          <div className="flex h-full min-h-0 flex-col animate-fade-in">
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0f1424] px-4 py-2.5">
              <h2 className="text-sm font-semibold text-white">📖 Lorebooks & World Info</h2>
              <Button size="xs" variant="soft" className="rounded-full" onClick={() => setView("characters")}>
                ← Characters
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
              <div className="mx-auto h-full min-h-0 w-full max-w-4xl">
                <LorebookPanel
                  books={lorebooks}
                  characters={characters}
                  reload={reloadLorebooks}
                  toast={toast}
                  nsfw={settings.nsfwEnabled}
                />
              </div>
            </div>
          </div>
        )}

        {/* VIEW 5: Settings */}
        {view === "settings" && (
          <div className="flex h-full min-h-0 flex-col animate-fade-in">
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0f1424] px-4 py-2.5">
              <h2 className="text-sm font-semibold text-white">⚙️ Studio Settings & AI Connections</h2>
              <Button size="xs" variant="soft" className="rounded-full" onClick={() => setView("characters")}>
                ← Back
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
              <div className="mx-auto h-full min-h-0 w-full max-w-4xl">
                <SettingsPanel
                  settings={settings}
                  connections={connections}
                  onSettings={(p) => void patchSettings(p)}
                  reloadConnections={reloadConnections}
                  toast={toast}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Drawer quick list */}
      {drawer && (
        <div className="fixed inset-0 z-40 animate-fade-in">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 right-0 w-[85vw] max-w-[320px] bg-[#0f1424] border-l border-white/10 p-4 shadow-2xl flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <p className="text-sm font-bold text-white">Quick Switch</p>
              <button
                onClick={() => setDrawer(false)}
                className="text-slate-400 hover:text-white px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto space-y-1">
              {characters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    void openCharacter(c);
                    setDrawer(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left hover:bg-white/5 transition"
                >
                  <Avatar src={c.avatar} name={c.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-white">{c.name}</p>
                    <p className="truncate text-[10px] text-slate-500">
                      {c.nsfw ? "🔞 " : ""}
                      {(c.tags ?? [])[0] ?? "Character"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sessions Modal */}
      <Modal
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        title={`Sessions — ${activeCharacter?.name ?? "Assistant"}`}
        footer={
          <>
            <label
              title="Import session JSON"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
            >
              ⬆ Import session
              <input
                type="file"
                accept={JSON_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importAny(f);
                  e.target.value = "";
                }}
              />
            </label>
            <Button variant="ghost" onClick={() => setSessionsOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void newSession(activeCharacter)}>
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
                chat?.id === s.id
                  ? "border-violet-400/50 bg-violet-500/15"
                  : "border-white/10 bg-slate-950/40",
              )}
            >
              <button
                onClick={async () => {
                  await loadChat(s.id);
                  setSessionsOpen(false);
                  setView("chat");
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm text-slate-100">{s.title}</span>
                <span className="block text-[10px] text-slate-500">
                  {new Date(s.updatedAt).toLocaleString()}
                  {s.summary ? " · 🧠 memory" : ""}
                </span>
              </button>
              <button
                title="Export this session as JSON"
                onClick={() => {
                  window.location.href = `/api/export?type=chat&id=${s.id}`;
                }}
                className="rounded px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ⬇
              </button>
              <button
                onClick={async () => {
                  const name = prompt("Rename session", s.title);
                  if (!name) return;
                  await api.saveChat(s.id, { title: name });
                  await reloadSessions(activeCharacter?.id ?? null);
                  if (chat?.id === s.id) await loadChat(s.id);
                }}
                className="rounded px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/10"
              >
                ✏️
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`Delete session "${s.title}"?`)) return;
                  await api.deleteChat(s.id);
                  const list = await reloadSessions(activeCharacter?.id ?? null);
                  if (chat?.id === s.id) {
                    if (list[0]) await loadChat(list[0].id);
                    else setChat(null);
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

      {/* Greeting Picker */}
      <Modal
        open={!!greetPick}
        onClose={() => setGreetPick(null)}
        title="Choose an opening"
        wide
      >
        <div className="space-y-2">
          {greetPick &&
            [greetPick.firstMessage, ...(greetPick.alternateGreetings ?? [])]
              .filter((g) => g?.trim())
              .map((g, i) => (
                <button
                  key={i}
                  onClick={() => void newSession(greetPick, i)}
                  className="block w-full rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-left text-sm text-slate-300 hover:border-violet-400/50 hover:bg-violet-500/10 transition"
                >
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-violet-300">
                    {i === 0 ? "Default greeting" : `Alternate ${i}`}
                  </span>
                  <span className="line-clamp-6 whitespace-pre-wrap">{g}</span>
                </button>
              ))}
        </div>
      </Modal>

      {toastMsg && <Toast msg={toastMsg.m} kind={toastMsg.k} />}
    </div>
  );
}

/* ---------------- Character Card Component (Matching screenshot) ---------------- */
function CharacterCard({
  character,
  sessionsCount,
  onChat,
  onEdit,
  onExport,
  onDelete,
}: {
  character: Character;
  sessionsCount: number;
  onChat: () => void;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const c = character;
  const tagHandle = (c.tags && c.tags[0]) ? `@${c.tags[0]}` : `@${c.name.replace(/\s+/g, "")}`;
  const banner = c.background || c.avatar || "";
  const blurb =
    c.creatorNotes?.trim() ||
    c.personality?.trim().slice(0, 150) ||
    c.scenario?.trim().slice(0, 150) ||
    "An intriguing roleplay character.";

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10 bg-[#131728] shadow-xl transition-all duration-300 ease-out hover:-translate-y-1 hover:border-violet-500/40 hover:shadow-2xl hover:shadow-violet-950/30">
      {/* Top Banner Image with Zoom on hover */}
      <div
        onClick={onChat}
        className="relative h-36 sm:h-44 w-full cursor-pointer overflow-hidden bg-slate-900"
      >
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner}
            alt={c.name}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-indigo-900 via-slate-900 to-violet-950 flex items-center justify-center">
            <span className="text-4xl opacity-30">🎭</span>
          </div>
        )}

        {/* Gradient shadow overlay for banner bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#131728] via-transparent to-black/30 pointer-events-none" />

        {/* Top Right SFW / NSFW pill badge */}
        <div className="absolute top-3 right-3 z-10">
          {c.nsfw ? (
            <span className="inline-block rounded-full bg-[#f43f5e] text-white text-[10px] font-black uppercase px-2.5 py-0.5 tracking-wider shadow-md">
              NSFW
            </span>
          ) : (
            <span className="inline-block rounded-full bg-[#10b981] text-white text-[10px] font-black uppercase px-2.5 py-0.5 tracking-wider shadow-md">
              SFW
            </span>
          )}
        </div>
      </div>

      {/* Circular Avatar overlapping the banner bottom edge */}
      <div className="relative -mt-9 ml-4 z-10 flex items-end justify-between pr-4 pointer-events-none">
        <div
          onClick={onChat}
          className="pointer-events-auto h-16 w-16 sm:h-18 sm:w-18 cursor-pointer rounded-full overflow-hidden ring-4 ring-[#131728] shadow-xl bg-slate-800 shrink-0 transition-transform duration-200 group-hover:scale-102"
        >
          {c.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.avatar} alt={c.name} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-violet-600 to-indigo-700 text-lg font-bold text-white">
              {c.name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="flex flex-1 flex-col px-4 pt-2 pb-3">
        {/* Name and Handle */}
        <div onClick={onChat} className="cursor-pointer">
          <h3 className="text-base sm:text-lg font-bold text-white transition-colors duration-200 group-hover:text-violet-300 truncate">
            {c.name}
          </h3>
          <p className="text-xs font-semibold text-violet-400 mt-0.5 truncate">{tagHandle}</p>
        </div>

        {/* Blurb Description */}
        <p
          onClick={onChat}
          className="mt-1.5 text-xs sm:text-sm text-slate-300 leading-relaxed line-clamp-2 cursor-pointer flex-1"
        >
          {blurb}
        </p>

        {/* Bottom Card Footer: metadata count + action icons */}
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2.5 text-xs text-slate-400">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span>📚</span>
            <span>{sessionsCount || 1} sess</span>
          </div>

          {/* Action icon buttons */}
          <div className="flex items-center gap-3 text-sm">
            <button
              onClick={onEdit}
              title="Edit character"
              className="text-slate-400 hover:text-white transition-colors p-1"
            >
              ✏️
            </button>
            <button
              onClick={onExport}
              title="Download character JSON"
              className="text-slate-400 hover:text-white transition-colors p-1"
            >
              ⬇
            </button>
            <button
              onClick={onDelete}
              title="Delete character"
              className="text-rose-400/90 hover:text-rose-300 transition-colors p-1"
            >
              🗑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
