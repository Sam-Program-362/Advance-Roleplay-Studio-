import { NextResponse } from "next/server";
import {
  COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  checkPassword,
  clearFailures,
  clientKeyFromHeaders,
  createSessionToken,
  failureDelayMs,
  getConfiguredPassword,
  lockoutRemainingMs,
  registerFailure,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(req: Request) {
  const configured = getConfiguredPassword();
  if (!configured.trim()) {
    return NextResponse.json(
      { error: "APP_PASSWORD is not configured on the server." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const clientKey = clientKeyFromHeaders(req.headers);

  const lockedMs = lockoutRemainingMs(clientKey);
  if (lockedMs > 0) {
    const seconds = Math.ceil(lockedMs / 1000);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${seconds}s.` },
      { status: 429, headers: { "retry-after": String(seconds), "cache-control": "no-store" } },
    );
  }

  let submitted = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    submitted = typeof body.password === "string" ? body.password : "";
  } catch {
    submitted = "";
  }

  const ok = await checkPassword(submitted, configured);
  if (!ok) {
    // Slow every failure down (and slow repeated failures down further) so
    // brute-forcing the password is impractical.
    const failures = registerFailure(clientKey);
    await sleep(failureDelayMs(failures));
    return NextResponse.json(
      { error: "Incorrect password." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  clearFailures(clientKey);
  const token = await createSessionToken(configured);
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
