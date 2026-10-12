import { db } from "@/db";
import { connections, type Connection } from "@/db/schema";
import { eq } from "drizzle-orm";
import { completeOnce, listModels, probeHorde } from "@/lib/llm";
import { providerKind } from "@/lib/defaults";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: "models" | "test";
      connectionId?: number;
      provider?: string;
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };

    // Resolve the connection server-side so test/model calls use the stored API
    // key and the browser never has to send (or receive) it. A freshly typed,
    // not-yet-saved key may still be passed in explicitly to test it up front.
    let stored: Connection | null = null;
    if (body.connectionId) {
      const rows = await db
        .select()
        .from(connections)
        .where(eq(connections.id, Number(body.connectionId)))
        .limit(1);
      stored = rows[0] ?? null;
    }

    const provider = body.provider || stored?.provider || "openai";
    const baseUrl = body.baseUrl || stored?.baseUrl || "";
    const model = body.model ?? stored?.model ?? "";
    const apiKey = (body.apiKey ?? "").trim() || stored?.apiKey || "";

    if (body.action === "test") {
      // AI Horde gets a special, non-generating check: submitting a job here
      // would queue behind real work for minutes. Every other provider keeps
      // the usual one-token "reply CONNECTED" prompt.
      if (providerKind(provider) === "horde") {
        const reply = await probeHorde({ baseUrl, apiKey, model });
        return json({ ok: true, reply });
      }
      const out = await completeOnce(
        {
          provider,
          baseUrl,
          apiKey,
          model,
          temperature: 0.7,
          maxTokens: 24,
          topP: 1,
        },
        [{ role: "user", content: "Reply with exactly: CONNECTED" }],
      );
      return json({ ok: true, reply: out });
    }

    const models = await listModels({ provider, baseUrl, apiKey });
    return json({ ok: true, models });
  } catch (e) {
    return errorJson(e, 400);
  }
}
