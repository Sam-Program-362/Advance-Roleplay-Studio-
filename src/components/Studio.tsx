"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  Character,
  ChatSession,
  Connection,
  FullChat,
  Lorebook,
} from "@/lib/client";
import { api, readJsonFile } from "@/lib/client";
import ChatView from "./ChatView";
import CharacterEditor, { emptyCharacter, type DraftCharacter } from "./CharacterEditor";
import LorebookPanel from "./LorebookPanel";
import SettingsPanel from "./SettingsPanel";
import { Avatar, Button, Modal, Toast, cx } from "./ui";

type View = "chat" | "editor" | "lore" | "settings";

export default function Studio() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [chat, setChat] = useState<FullChat | null>(null);
  const [view, setView] = useState<View>("chat");
  const [draft, setDraft] = useState<DraftCharacter | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [greetPick, setGreetPick] = useState<Character | null>(null);
  const [search, setSearch] = useState("");
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
        if (!target) {
          target = await api.addChat({ characterId: null, title: "Assistant", mode: "assistant" });
        }
        await reloadSessions(target.characterId);
        await loadChat(target.id);
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
      if (greetings.length > 1) {
        setGreetPick(c);
        return;
      }
      const s = await api.addChat({ characterId: c.id, title: "Session 1", mode: "roleplay" });
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

  async function importAny(file: File) {
    try {
      const data = await readJsonFile(file);
      const res = await api.importJson(data, "auto");
      await Promise.all([reloadCharacters(), reloadLorebooks()]);
      toast(`Imported ${res.kind}: ${res.name}`);
      if (res.kind === "character" && res.characterId) {
        const all = await api.characters();
        setCharacters(all);
        const c = all.find((x) => x.id === res.characterId);
        if (c) await openCharacter(c);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Import failed", "err");
    }
  }

  const filtered = characters.filter((c) =>
    (c.name + " " + (c.tags ?? []).join(" ")).toLowerCase().includes(search.toLowerCase()),
  );

  if (booting || !settings) {
    return (
      <div className="grid h-[100dvh] place-items-center bg-slate-950 text-slate-400">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <p className="text-sm">Loading Roleplay Studio…</p>
        </div>
      </div>
    );
  }

  const activeConn = connections.find((c) => c.id === settings.activeConnectionId) ?? connections[0];

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <div className="shrink-0 border-b border-white/10 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-sm">
            🎭
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">Roleplay Studio</p>
            <p className="truncate text-[10px] text-slate-500">
              {activeConn ? `${activeConn.provider} · ${activeConn.model || "no model"}` : "no connection"}
            </p>
          </div>
          <button
            onClick={() => setDrawer(false)}
            className="rounded px-2 py-1 text-slate-400 hover:bg-white/10 md:hidden"
          >
            ✕
          </button>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <button
            onClick={() => void startAssistant()}
            className={cx(
              "rounded-lg border px-2 py-1.5 text-[11px] font-medium transition",
              settings.mode === "assistant" && !activeCharacter
                ? "border-violet-400/60 bg-violet-500/20 text-white"
                : "border-white/10 text-slate-400 hover:bg-white/5",
            )}
          >
            🤖 Assistant
          </button>
          <button
            onClick={() => {
              void patchSettings({ mode: "roleplay" });
              if (activeCharacter) {
                setView("chat");
                setDrawer(false);
              } else if (characters[0]) {
                void openCharacter(characters[0]);
              } else {
                setDraft(emptyCharacter());
                setView("editor");
                setDrawer(false);
              }
            }}
            className={cx(
              "rounded-lg border px-2 py-1.5 text-[11px] font-medium transition",
              settings.mode === "roleplay" || activeCharacter
                ? "border-violet-400/60 bg-violet-500/20 text-white"
                : "border-white/10 text-slate-400 hover:bg-white/5",
            )}
          >
            🎭 Roleplay
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 px-3 py-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search characters…"
          className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 outline-none placeholder-slate-600 focus:border-violet-500/60"
        />
        <div className="flex gap-1.5">
          <Button
            size="xs"
            variant="primary"
            className="flex-1"
            onClick={() => {
              setDraft(emptyCharacter());
              setView("editor");
              setDrawer(false);
            }}
          >
            + Character
          </Button>
          <label className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">
            ⬆
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importAny(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-[11px] text-slate-600">
            No characters yet. Create one or import a JSON card.
          </p>
        )}
        <div className="space-y-1">
          {filtered.map((c) => (
            <div
              key={c.id}
              className={cx(
                "group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition",
                chat?.characterId === c.id
                  ? "border-violet-400/50 bg-violet-500/15"
                  : "border-transparent hover:bg-white/5",
              )}
            >
              <button
                onClick={() => void openCharacter(c)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <Avatar src={c.avatar} name={c.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-slate-100">{c.name}</span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {c.nsfw ? "🔞 " : ""}
                    {(c.tags ?? []).slice(0, 3).join(" · ") || "no tags"}
                  </span>
                </span>
              </button>
              <button
                title="Edit character"
                onClick={() => {
                  setDraft({ ...c });
                  setView("editor");
                  setDrawer(false);
                }}
                className="rounded px-1.5 py-1 text-[11px] text-slate-500 hover:bg-white/10 hover:text-white"
              >
                ✏️
              </button>
              <button
                title="Delete character"
                onClick={async () => {
                  if (!confirm(`Delete "${c.name}" and all its sessions?`)) return;
                  await api.deleteCharacter(c.id);
                  await reloadCharacters();
                  if (chat?.characterId === c.id) {
                    const list = await api.chats();
                    if (list[0]) await loadChat(list[0].id);
                    else setChat(null);
                  }
                  toast("Character deleted");
                }}
                className="rounded px-1.5 py-1 text-[11px] text-slate-600 hover:bg-rose-500/15 hover:text-rose-300"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 p-2">
        <div className="grid grid-cols-3 gap-1.5">
          <Button size="xs" variant="soft" onClick={() => { setView("chat"); setDrawer(false); }}>
            💬 Chat
          </Button>
          <Button size="xs" variant="soft" onClick={() => { setView("lore"); setDrawer(false); }}>
            📚 Lore
          </Button>
          <Button size="xs" variant="soft" onClick={() => { setView("settings"); setDrawer(false); }}>
            ⚙️ Setup
          </Button>
        </div>
        {!activeConn?.model && (
          <button
            onClick={() => { setView("settings"); setDrawer(false); }}
            className="mt-2 block w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200"
          >
            ⚠ No model configured — tap to set up your API connection
          </button>
        )}
      </div>
    </div>
  );

  const menuBtn = (
    <button
      onClick={() => setDrawer(true)}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 md:hidden"
    >
      ☰
    </button>
  );

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-slate-950 text-slate-100">
      <aside className="hidden w-[288px] shrink-0 border-r border-white/10 md:block">{sidebar}</aside>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[85vw] max-w-[320px] border-r border-white/10 shadow-2xl">
            {sidebar}
          </div>
        </div>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {view === "chat" &&
          (chat ? (
            <ChatView
              key={chat.id}
              chat={chat}
              character={activeCharacter}
              settings={settings}
              onReload={reloadChat}
              onOpenSessions={() => setSessionsOpen(true)}
              toast={toast}
              headerLeft={menuBtn}
            />
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div>
                {menuBtn}
                <p className="mt-4 text-sm text-slate-400">No session open.</p>
                <Button
                  className="mt-3"
                  variant="primary"
                  onClick={() => void startAssistant()}
                >
                  Start assistant chat
                </Button>
              </div>
            </div>
          ))}

        {view !== "chat" && (
          <div className="flex h-full min-h-0 flex-col">
            <header className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-slate-950/80 px-3 py-2">
              {menuBtn}
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                {view === "editor"
                  ? draft?.id
                    ? `Edit — ${draft.name || "character"}`
                    : "Create character"
                  : view === "lore"
                    ? "📚 Lorebooks"
                    : "⚙️ Studio settings"}
              </h2>
              <Button size="sm" variant="soft" onClick={() => setView("chat")}>
                ← Back to chat
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
              <div className="mx-auto h-full min-h-0 w-full max-w-4xl">
                {view === "editor" && draft && (
                  <CharacterEditor
                    initial={draft}
                    lorebooks={lorebooks}
                    nsfwGlobal={settings.nsfwEnabled}
                    toast={toast}
                    onOpenLorebooks={() => setView("lore")}
                    onClose={() => setView("chat")}
                    onSaved={async (c) => {
                      await reloadCharacters();
                      setDraft({ ...c });
                      if (!chat || chat.characterId !== c.id) {
                        let list = await api.chats(c.id);
                        if (!list.length) {
                          await api.addChat({
                            characterId: c.id,
                            title: "Session 1",
                            mode: "roleplay",
                          });
                          list = await api.chats(c.id);
                        }
                        setSessions(list);
                        if (list[0]) await loadChat(list[0].id);
                      } else {
                        await reloadChat();
                      }
                      void patchSettings({ mode: "roleplay" });
                      setView("chat");
                    }}
                  />
                )}
                {view === "lore" && (
                  <LorebookPanel
                    books={lorebooks}
                    characters={characters}
                    reload={reloadLorebooks}
                    toast={toast}
                    nsfw={settings.nsfwEnabled}
                  />
                )}
                {view === "settings" && (
                  <SettingsPanel
                    settings={settings}
                    connections={connections}
                    onSettings={(p) => void patchSettings(p)}
                    reloadConnections={reloadConnections}
                    toast={toast}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Sessions modal */}
      <Modal
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        title={`Sessions — ${activeCharacter?.name ?? "Assistant"}`}
        footer={
          <>
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
                "flex items-center gap-2 rounded-lg border px-3 py-2",
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

      {/* Greeting picker */}
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
                  className="block w-full rounded-xl border border-white/10 bg-slate-950/50 p-3 text-left text-sm text-slate-300 hover:border-violet-400/50 hover:bg-violet-500/10"
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
