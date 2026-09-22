import {
  errorJson,
  getActiveConnection,
  getSettings,
  json,
  toLlmConfig,
} from "@/lib/server";
import { completeOnce } from "@/lib/llm";
import { WRITER_BLOCKS, buildWriterSystemPrompt, type WriterBlock } from "@/lib/defaults";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

type Body = {
  block: WriterBlock;
  currentText?: string;
  hint?: string;
  nsfw?: boolean;
  connectionId?: number | null;
  context?: {
    name?: string;
    contextBlock?: string;
    personality?: string;
    scenario?: string;
    firstMessage?: string;
    exampleDialogue?: string;
    creatorNotes?: string;
    tags?: string[];
    // lorebook specific
    lorebookName?: string;
    lorebookDescription?: string;
    entryTitle?: string;
    entryKeys?: string[];
    siblingEntries?: string[];
  };
};

/** Only expose the fields that are legitimately useful for the target block. */
function contextLines(block: WriterBlock, ctx: NonNullable<Body["context"]>): string[] {
  const out: string[] = [];
  const add = (label: string, value?: string) => {
    if (value && value.trim()) out.push(`${label}: ${value.trim().slice(0, 2500)}`);
  };

  if (block === "lorebook" || block === "lorebook_keys") {
    add("Lorebook name", ctx.lorebookName);
    add("Lorebook purpose / context supplied by the author", ctx.lorebookDescription);
    add("Subject of THIS entry (its title)", ctx.entryTitle);
    if (ctx.entryKeys?.length) add("Trigger keywords for THIS entry", ctx.entryKeys.join(", "));
    if (ctx.siblingEntries?.length) {
      out.push(
        `Other entries already in this lorebook (do NOT duplicate or write about them): ${ctx.siblingEntries
          .slice(0, 25)
          .join(" | ")}`,
      );
    }
    add("Associated character", ctx.name);
    add("World / scenario the lorebook belongs to", ctx.scenario);
    return out;
  }

  add("Character name", ctx.name);
  add("Author's direction (Context Block)", ctx.contextBlock);
  if (ctx.tags?.length) add("Tags", ctx.tags.join(", "));
  add("Creator notes", ctx.creatorNotes);

  if (block !== "personality") add("Personality field (reference only — never copy into your output)", ctx.personality);
  if (block !== "scenario") add("Scenario field (reference only — never copy into your output)", ctx.scenario);
  if (block !== "greeting") add("First message (reference only — never copy into your output)", ctx.firstMessage);
  if (block !== "example") add("Example dialogue (reference only)", ctx.exampleDialogue);

  return out;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const block = body.block;
    if (!block || !WRITER_BLOCKS[block]) {
      return errorJson(new Error("Unknown writer block"), 400);
    }

    const s = await getSettings();
    const conn = await getActiveConnection(
      body.connectionId ?? s.writerConnectionId ?? s.activeConnectionId,
    );
    if (!conn || !conn.model) {
      return errorJson(
        new Error("No API connection with a model is configured. Open Settings → Connections."),
        400,
      );
    }

    const def = WRITER_BLOCKS[block];
    const nsfw = Boolean(body.nsfw ?? s.nsfwEnabled);
    const system = buildWriterSystemPrompt(block, nsfw);

    const ctx = body.context ?? {};
    const lines = contextLines(block, ctx);
    const current = (body.currentText ?? "").trim();

    const user: string[] = [];
    user.push(`=== AVAILABLE CONTEXT ===`);
    user.push(lines.length ? lines.join("\n\n") : "(no other context has been filled in yet)");

    if (current) {
      user.push(
        `=== EXISTING CONTENT OF THE "${def.label}" FIELD — THE AUTHOR WROTE THIS ===\n${current}`,
      );
      user.push(
        `=== TASK: EXPAND ===\n` +
          `Take the author's existing text above and EXPAND it into the finished "${def.label}" field.\n` +
          `- Every idea, name, fact and intent in the author's text MUST survive in your output. Never discard, replace or contradict it.\n` +
          `- Keep the author's own wording where it already works; weave your additions around it.\n` +
          `- Add the depth, specificity and structure the field is missing so it becomes a complete, professional "${def.label}".\n` +
          `- Stay strictly inside the scope of this field. ${def.forbidden}\n` +
          `- Return the COMPLETE rewritten field, not a diff and not only the new part.`,
      );
    } else {
      user.push(
        `=== TASK: GENERATE FROM SCRATCH ===\n` +
          `The "${def.label}" field is empty. Read every piece of context above and invent a coherent, high-quality "${def.label}" that fits it perfectly.\n` +
          `- If context is thin, make confident, interesting creative choices rather than writing something generic.\n` +
          `- Stay strictly inside the scope of this field. ${def.forbidden}`,
      );
    }

    if (body.hint && body.hint.trim()) {
      user.push(`=== AUTHOR'S EXTRA INSTRUCTION FOR THIS GENERATION ===\n${body.hint.trim()}`);
    }

    user.push(
      `=== OUTPUT ===\nReturn ONLY the raw text for the "${def.label}" field. ${def.shape}`,
    );

    const raw = await completeOnce(
      {
        ...toLlmConfig(conn),
        temperature: block === "lorebook_keys" || block === "name" ? 0.85 : 0.95,
        maxTokens: block === "lorebook_keys" || block === "name" ? 120 : Math.max(700, conn.maxTokens),
      },
      [
        { role: "system", content: system },
        { role: "user", content: user.join("\n\n") },
      ],
    );

    return json({ ok: true, text: sanitize(raw, def.label), block });
  } catch (e) {
    return errorJson(e, 500);
  }
}

function sanitize(text: string, label: string): string {
  let t = (text ?? "").trim();
  // strip code fences
  t = t.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "");
  // strip a leading "Field Name:" / "**Field Name**" header
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  t = t.replace(new RegExp(`^\\s*\\**\\s*${esc}\\s*\\**\\s*[:\\-–]\\s*`, "i"), "");
  t = t.replace(/^\s*#{1,6}\s*.*\n+/, (m) =>
    /personality|scenario|greeting|first message|lorebook|entry|name/i.test(m) ? "" : m,
  );
  // strip surrounding quotes if the whole body is quoted
  if (/^"[\s\S]+"$/.test(t) && !t.slice(1, -1).includes('"')) t = t.slice(1, -1);
  // strip trailing meta-offers
  t = t.replace(
    /\n+\s*(let me know|would you like|i can (also )?(expand|adjust|tweak)|feel free to)[\s\S]*$/i,
    "",
  );
  return t.trim();
}
