import { completeOnce, listModels } from "@/lib/llm";
import { providerKind } from "@/lib/defaults";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: "models" | "test";
      provider: string;
      baseUrl: string;
      apiKey: string;
      model?: string;
    };
    if (body.action === "test") {
      const out = await completeOnce(
        {
          provider: body.provider,
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
          model: body.model ?? "",
          temperature: 0.7,
          maxTokens: 24,
          topP: 1,
        },
        [{ role: "user", content: "Reply with exactly: CONNECTED" }],
        // A Horde job may sit in the queue — keep the probe inside its own limit.
        providerKind(body.provider) === "horde" ? { timeoutMs: 45_000 } : undefined,
      );
      return json({ ok: true, reply: out });
    }
    const models = await listModels(body);
    return json({ ok: true, models });
  } catch (e) {
    return errorJson(e, 400);
  }
}
