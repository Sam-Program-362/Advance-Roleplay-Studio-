import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, authorize } from "@/lib/auth";

/**
 * Next.js 16 request interceptor (the successor to `middleware.ts`). It runs on
 * the Node.js runtime and gates every page and every `/api/*` route behind the
 * password in `APP_PASSWORD`.
 *
 * Behaviour:
 *   - no password + production  -> 503 "APP_PASSWORD is not configured"
 *   - no password + development  -> allow, with a one-time console warning
 *   - unauthenticated page       -> redirect to /login
 *   - unauthenticated /api route -> 401 JSON (never a redirect, so clients and
 *                                   streaming endpoints get a clean error)
 */

const UNCONFIGURED_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>APP_PASSWORD is not configured</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #0b0e1b; color: #e2e8f0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .card {
        max-width: 34rem; margin: 1.5rem; padding: 2rem;
        background: #131728; border: 1px solid rgba(244, 63, 94, 0.35);
        border-radius: 1rem; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      }
      h1 { margin: 0 0 0.75rem; font-size: 1.25rem; color: #fff; }
      p { margin: 0 0 0.75rem; line-height: 1.6; color: #cbd5e1; }
      code {
        background: rgba(255, 255, 255, 0.08); padding: 0.1rem 0.35rem;
        border-radius: 0.35rem; font-size: 0.85em; color: #fecdd3;
      }
      .detail { color: #94a3b8; font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>⛔ APP_PASSWORD is not configured</h1>
      <p>
        This deployment is locked because no password has been set. Set the
        <code>APP_PASSWORD</code> environment variable in your hosting project,
        then redeploy.
      </p>
      <p class="detail">
        The whole app is gated by <code>APP_PASSWORD</code>. Until it is set, every
        page and API route stays blocked — this is intentional so a misconfigured
        deployment can never expose saved API keys.
      </p>
    </div>
  </body>
</html>`;

let devWarningLogged = false;

export async function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD ?? "";
  const isProduction = process.env.NODE_ENV === "production";
  const { pathname } = request.nextUrl;

  const outcome = await authorize({
    pathname,
    cookieValue: request.cookies.get(COOKIE_NAME)?.value,
    password,
    isProduction,
  });

  if (outcome === "allow") {
    if (!password.trim() && !isProduction && !devWarningLogged) {
      devWarningLogged = true;
      console.warn(
        "[auth] APP_PASSWORD is not set — running with no password protection. " +
          "Set APP_PASSWORD before deploying.",
      );
    }
    return NextResponse.next();
  }

  if (outcome === "unconfigured") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "APP_PASSWORD is not configured" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return new NextResponse(UNCONFIGURED_HTML, {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  // outcome === "unauthorized"
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next's own immutable build output and the favicon,
  // so the login page can still load its JS/CSS while every real route is gated.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
