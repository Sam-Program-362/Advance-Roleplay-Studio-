"use client";

import { useEffect, useState, type FormEvent } from "react";

/**
 * Password gate. Posts to /api/auth/login, which sets a signed httpOnly cookie
 * on success. The password never appears in client code — only what the user
 * typed is sent, over POST, to the server.
 */
export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/");

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("next");
    // Only allow same-origin, root-relative destinations.
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) setNext(raw);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = next;
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Login failed. Please try again.");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#0b0e1b] px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-tr from-sky-400 via-indigo-500 to-violet-600 text-2xl shadow-lg shadow-sky-500/25">
            🎭
          </div>
          <h1 className="mt-4 text-lg font-bold text-white">Roleplay Studio</h1>
          <p className="mt-1 text-xs text-slate-400">
            Enter the studio password to continue.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-3 rounded-2xl border border-white/10 bg-[#121626] p-5 shadow-2xl shadow-black/40"
        >
          <label
            htmlFor="password"
            className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            className="w-full rounded-lg border border-white/10 bg-[#0b0e1b] px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 outline-none transition focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-[12px] text-rose-200"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition-all hover:from-violet-500 hover:to-fuchsia-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-600">
          Sessions are signed and stored in an httpOnly cookie. The password is
          never sent anywhere except this app&apos;s own server.
        </p>
      </div>
    </main>
  );
}
