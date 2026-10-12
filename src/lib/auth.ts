/**
 * Server-side password gate.
 *
 * The whole app is protected by a single password supplied through the
 * `APP_PASSWORD` environment variable. A successful login mints a signed,
 * stateless session token (HMAC-SHA256) whose signing key is derived from the
 * password itself, so no extra secret has to be configured. Rotating
 * `APP_PASSWORD` therefore invalidates every existing session for free.
 *
 * Everything here runs on the server only (Next.js route handlers and the
 * `proxy.ts` request interceptor). It uses the Web Crypto API, which is part of
 * the Node.js runtime that `proxy.ts` runs in, so it never needs to be bundled
 * into client JavaScript. The password and signing key never leave the server.
 */

/** Name of the session cookie. Not itself a secret. */
export const COOKIE_NAME = "rp_session";

/** How long a login stays valid (30 days). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Namespace so the derived key can never collide with another use of the password. */
const KEY_CONTEXT = "roleplay-studio:session-key:v1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ------------------------------------------------------------------ */
/* base64url helpers (no Buffer — works in any Web Crypto runtime)     */
/* ------------------------------------------------------------------ */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("bad base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Copies bytes into a plain ArrayBuffer (the type Web Crypto accepts). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/* ------------------------------------------------------------------ */
/* Password configuration                                              */
/* ------------------------------------------------------------------ */

/** The configured password, or "" when APP_PASSWORD is unset/blank. */
export function getConfiguredPassword(): string {
  return process.env.APP_PASSWORD ?? "";
}

export function isPasswordConfigured(): boolean {
  return getConfiguredPassword().trim().length > 0;
}

/* ------------------------------------------------------------------ */
/* Constant-time comparison                                            */
/* ------------------------------------------------------------------ */

/**
 * Compares two strings without leaking their contents through timing. Both
 * sides are SHA-256 hashed first so the comparison is always over exactly 32
 * bytes regardless of input length.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Constant-time password check against the configured APP_PASSWORD. */
export function checkPassword(input: string, expected: string): Promise<boolean> {
  return constantTimeEqual(input, expected);
}

/* ------------------------------------------------------------------ */
/* Signed session tokens                                               */
/* ------------------------------------------------------------------ */

async function deriveSigningKey(password: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${KEY_CONTEXT}:${password}`),
  );
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function payloadFor(nowMs: number): string {
  return `v1.${Math.floor(nowMs / 1000)}`;
}

/** Mints a `<payload>.<signature>` token signed with a key derived from `password`. */
export async function createSessionToken(
  password: string,
  nowMs = Date.now(),
): Promise<string> {
  const payload = payloadFor(nowMs);
  const key = await deriveSigningKey(password);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${bytesToBase64Url(encoder.encode(payload))}.${bytesToBase64Url(
    new Uint8Array(signature),
  )}`;
}

/**
 * Verifies a session token's signature and age. Returns false for anything
 * malformed, expired, tampered with, or signed by a different password.
 */
export async function verifySessionToken(
  token: string,
  password: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!token || !password) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  let payloadBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    payloadBytes = base64UrlToBytes(parts[0]);
    signatureBytes = base64UrlToBytes(parts[1]);
  } catch {
    return false;
  }

  const payload = decoder.decode(payloadBytes);
  if (!payload.startsWith("v1.")) return false;
  const issuedAt = Number(payload.slice(3));
  if (!Number.isFinite(issuedAt)) return false;

  const nowSeconds = Math.floor(nowMs / 1000);
  if (issuedAt > nowSeconds + 300) return false; // clock-skew guard
  if (nowSeconds - issuedAt > SESSION_MAX_AGE_SECONDS) return false;

  const key = await deriveSigningKey(password);
  return crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(payloadBytes),
  );
}

/* ------------------------------------------------------------------ */
/* Failed-attempt throttling                                           */
/* ------------------------------------------------------------------ */

const FAIL_WINDOW_MS = 10 * 60_000; // failures roll off after 10 minutes
const MAX_FAILURES_BEFORE_LOCK = 8;
const LOCK_MS = 5 * 60_000; // locked out for 5 minutes after too many tries

type Bucket = { firstAt: number; failures: number; lockedUntil: number };
const buckets = new Map<string, Bucket>();

function bucketFor(key: string, nowMs: number): Bucket {
  const existing = buckets.get(key);
  if (!existing || nowMs - existing.firstAt > FAIL_WINDOW_MS) {
    const fresh: Bucket = { firstAt: nowMs, failures: 0, lockedUntil: 0 };
    buckets.set(key, fresh);
    return fresh;
  }
  return existing;
}

/** Records a failed attempt and returns the running failure count. */
export function registerFailure(key: string, nowMs = Date.now()): number {
  const bucket = bucketFor(key, nowMs);
  bucket.failures += 1;
  if (bucket.failures >= MAX_FAILURES_BEFORE_LOCK) bucket.lockedUntil = nowMs + LOCK_MS;
  return bucket.failures;
}

/** Milliseconds the caller must wait, given how many attempts have failed. */
export function failureDelayMs(failures: number): number {
  return Math.min(300 + failures * 350, 3000);
}

/** Remaining lockout in ms (0 when not locked out). */
export function lockoutRemainingMs(key: string, nowMs = Date.now()): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  if (bucket.lockedUntil <= nowMs) {
    // Only an *expired* lock clears the bucket. Merely checking while unlocked
    // must not reset the running failure count.
    if (bucket.lockedUntil > 0) buckets.delete(key);
    return 0;
  }
  return bucket.lockedUntil - nowMs;
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

/** Best-effort client identifier used for throttling. */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || "unknown";
  return headers.get("x-real-ip") ?? "unknown";
}

/* ------------------------------------------------------------------ */
/* Route authorization decision                                        */
/* ------------------------------------------------------------------ */

export type AuthOutcome = "allow" | "unconfigured" | "unauthorized";

/**
 * Paths that must stay reachable without a session: the login page itself, the
 * login/logout endpoints, and the PWA assets browsers request without cookies
 * (blocking those would break installing the app).
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/login",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/sw.js",
  "/api/auth/login",
  "/api/auth/logout",
]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * Decides whether a request may proceed.
 *
 * - With no password configured, production fails closed (`unconfigured`) so a
 *   misconfigured deploy can never expose the app; development is allowed so
 *   local setup stays frictionless.
 * - With a password configured, public paths pass, a valid session cookie
 *   passes, everything else is `unauthorized`.
 */
export async function authorize(opts: {
  pathname: string;
  cookieValue: string | undefined;
  password: string;
  isProduction: boolean;
  nowMs?: number;
}): Promise<AuthOutcome> {
  const { pathname, cookieValue, password, isProduction, nowMs } = opts;

  if (!password.trim()) return isProduction ? "unconfigured" : "allow";
  if (isPublicPath(pathname)) return "allow";
  if (cookieValue && (await verifySessionToken(cookieValue, password, nowMs))) {
    return "allow";
  }
  return "unauthorized";
}
