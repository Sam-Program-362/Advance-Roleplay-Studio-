import { completeOnce, listModels, probeHorde } from "@/lib/llm";
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
      // AI Horde gets a special, non-generating check: submitting a job here
      // would queue behind real work for minutes. Every other provider keeps
      // the usual one-token "reply CONNECTED" prompt.
      if (providerKind(body.provider) === "horde") {
        const reply = await probeHorde({
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
          model: body.model,
        });
        return json({ ok: true, reply });
      }
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
      );
      return json({ ok: true, reply: out });
    }
    const models = await listModels(body);
    return json({ ok: true, models });
  } catch (e) {
    return errorJson(e, 400);
  }
}
