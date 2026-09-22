import { completeOnce, listModels } from "@/lib/llm";
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
      );
      return json({ ok: true, reply: out });
    }
    const models = await listModels(body);
    return json({ ok: true, models });
  } catch (e) {
    return errorJson(e, 400);
  }
}
