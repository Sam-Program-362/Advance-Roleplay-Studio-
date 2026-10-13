/**
 * Streaming parser for the group-roleplay segment format.
 *
 * A group turn is written as a sequence of segments, each starting on its own
 * line with a bracketed speaker tag:
 *
 *   [Narrator]
 *   Rain hammers the roof of the tavern.
 *   [Kael]
 *   *He sets the mug down.* "You brought company."
 *
 * Every segment becomes its own message/bubble in the transcript, so the parser
 * has to work on a live token stream — a marker can be split across chunks
 * ("[Kae" + "l]\n…"), so anything that might still turn into a marker is held
 * back until it is known either way.
 *
 * Rules implemented here:
 *   - `<think>…</think>`-style reasoning blocks (and similar) are stripped
 *     before anything else looks at the text, so private planning can never be
 *     parsed — or saved — as a message.
 *   - `[Narrator]` (case-insensitive) starts a narration segment.
 *   - Any name in `speakers` (case-insensitive, trimmed) starts that speaker's
 *     segment; the id in the segment is the character id.
 *   - An UNKNOWN name does not start anything: the tag itself is dropped and
 *     the text that follows attaches to the previous speaker.
 *   - Prose written BEFORE the first recognised marker is DISCARDED: a model
 *     that thinks out loud first must not have that text attached to the
 *     Narrator or to the previous speaker.
 *   - A segment whose text still looks like meta-commentary about the task
 *     itself is dropped as a second safety net.
 */

export type SpeakerRef = { id: number; name: string };

export type SegmentKind = "narration" | "character";

export type GroupSegment = {
  /** Position in the turn (re-assigned to a dense 0..n-1 on flush). */
  index: number;
  /** Character id for a character segment, null for narration / the persona. */
  speakerId: number | null;
  speakerName: string;
  kind: SegmentKind;
  text: string;
};

export const NARRATOR_LABEL = "Narrator";

/** Bracket-tag a segment for the model-facing transcript ("[Kael] …"). */
export function segmentLabel(seg: Pick<GroupSegment, "speakerId" | "speakerName" | "kind">): string {
  return seg.kind === "narration" ? NARRATOR_LABEL : seg.speakerName;
}

/** How much discarded text we keep around for the debug log. */
const DROP_KEEP = 1200;
/** Log at most this many characters of a dropped block. */
const DROP_LOG_LIMIT = 300;

function logDropped(reason: string, text: string) {
  const body = text.replace(/\s+/g, " ").trim().slice(0, DROP_LOG_LIMIT);
  if (!body) return;
  console.warn(`[group] dropped ${reason}: ${body}`);
}

/* ------------------------------------------------------------------ */
/* Reasoning blocks — <think> and friends                              */
/* ------------------------------------------------------------------ */

/**
 * Tag names models and providers wrap their private reasoning in. Matched
 * case-insensitively, with optional attributes (`<think level="2">`).
 */
const REASONING_TAGS = [
  "think",
  "thinking",
  "thought",
  "thoughts",
  "reasoning",
  "reflection",
  "scratchpad",
  "analysis",
  "plan",
];

const OPEN_TAG_RE = new RegExp(`^<\\s*(${REASONING_TAGS.join("|")})\\b[^>]*>`, "i");
const CLOSE_TAG_RE = new RegExp(`^<\\s*/\\s*(${REASONING_TAGS.join("|")})\\s*>`, "i");

/**
 * True while `text` could still become a reasoning tag once more characters
 * arrive ("<", "<t", "<thi", "<think", "<think " …). Complete and unknown tags
 * are NOT held, so parsing can never stall on a tag that never closes.
 */
function couldStillBeTag(text: string): boolean {
  const m = /^<\s*\/?\s*([a-z]*)$/i.exec(text);
  if (!m) return false;
  const word = m[1].toLowerCase();
  return REASONING_TAGS.some((tag) => tag.startsWith(word));
}

/**
 * Incremental reasoning stripper. Feed it raw chunks; it returns only the text
 * outside any reasoning block, holding back partial tags so a tag split across
 * two chunks is still recognised. Dropped blocks are reported through `onDrop`.
 */
export function createReasoningStripper(onDrop?: (text: string) => void) {
  let buf = "";
  /** Text already inside the current (not yet closed) reasoning block. */
  let held = "";
  /** Name of the tag we are inside, or null when we are outside. */
  let inside: string | null = null;

  const closeRe = (tag: string) => new RegExp(`</\\s*${tag}\\s*>`, "i");

  function drain(): string {
    let out = "";
    for (;;) {
      if (inside) {
        const m = closeRe(inside).exec(buf);
        if (!m) {
          // Keep a tail that could still be part of the closing tag.
          const keep = inside.length + 4;
          if (buf.length > keep) {
            held = (held + buf.slice(0, buf.length - keep)).slice(-DROP_KEEP);
            buf = buf.slice(-keep);
          }
          return out;
        }
        held = (held + buf.slice(0, m.index)).slice(-DROP_KEEP);
        buf = buf.slice(m.index + m[0].length);
        inside = null;
        onDrop?.(held);
        held = "";
        continue;
      }

      const lt = buf.indexOf("<");
      if (lt < 0) {
        out += buf;
        buf = "";
        return out;
      }
      if (lt > 0) {
        out += buf.slice(0, lt);
        buf = buf.slice(lt);
      }

      const open = OPEN_TAG_RE.exec(buf);
      if (open) {
        inside = (open[1] ?? "").toLowerCase();
        buf = buf.slice(open[0].length);
        continue;
      }
      const close = CLOSE_TAG_RE.exec(buf);
      if (close) {
        // A stray closing tag with no opener — drop the tag itself.
        buf = buf.slice(close[0].length);
        continue;
      }
      if (couldStillBeTag(buf)) return out;

      // An ordinary "<" — part of the prose.
      out += buf[0];
      buf = buf.slice(1);
    }
  }

  return {
    feed(chunk: string): string {
      if (chunk) buf += chunk;
      return drain();
    },
    flush(): string {
      let out = drain();
      if (inside) {
        // The block was never closed: everything left is reasoning.
        onDrop?.((held + buf).slice(-DROP_KEEP));
        buf = "";
        held = "";
        inside = null;
      } else if (buf) {
        out += buf;
        buf = "";
      }
      return out;
    },
    /** True while we are inside a (possibly unclosed) reasoning block. */
    get inReasoning() {
      return inside !== null;
    },
  };
}

/** Strip every reasoning block from a complete (non-streaming) reply. */
export function stripReasoningBlocks(text: string, onDrop?: (text: string) => void): string {
  const stripper = createReasoningStripper(onDrop);
  return stripper.feed(text) + stripper.flush();
}

/* ------------------------------------------------------------------ */
/* Meta-commentary                                                     */
/* ------------------------------------------------------------------ */

/**
 * First-person planning openers ("We need to write the segments…"). These read
 * as the model talking about the task, so a segment starting with one is meta.
 */
const META_OPENERS = [
  "we need to",
  "we need",
  "we must",
  "we'll",
  "we will",
  "we should",
  "i need to",
  "i must",
  "i'll",
  "i will",
  "i should",
  "as an ai",
];

/**
 * Openers that are only meta when the segment also mentions the format, so
 * ordinary in-character lines like "Let me help you." or "Okay, I'll go."
 * are left alone.
 */
const META_WEAK_OPENERS = [
  "let me",
  "let's",
  "okay",
  "ok,",
  "sure",
  "alright",
  "first,",
  "firstly,",
  "step 1",
  "now i",
  "now we",
  "we can",
];

/** Tells that a segment is talking about the format rather than the scene. */
const META_PHRASES = [
  "create segments:",
  "segments:",
  "segment format",
  "as segments",
];

/** Weaker hints that only count together with a weak opener. */
const META_HINTS = [
  "segment",
  "speaker tag",
  "narrator tag",
  "instruction",
  "the format",
  "out of character",
  "the user's message",
];

function startsWithOpener(text: string, opener: string): boolean {
  if (!text.startsWith(opener)) return false;
  const next = text.charAt(opener.length);
  return next === "" || !/[a-z0-9]/.test(next);
}

/** True when a segment's text is obviously meta-commentary about the task. */
export function isMetaCommentary(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (META_PHRASES.some((p) => t.includes(p))) return true;
  if (META_OPENERS.some((opener) => startsWithOpener(t, opener))) return true;
  return (
    META_WEAK_OPENERS.some((opener) => startsWithOpener(t, opener)) &&
    META_HINTS.some((hint) => t.includes(hint))
  );
}

/* ------------------------------------------------------------------ */
/* Segment parser                                                      */
/* ------------------------------------------------------------------ */

function characterSegment(index: number, speaker: SpeakerRef | null): GroupSegment {
  return {
    index,
    speakerId: speaker ? speaker.id : null,
    speakerName: speaker ? speaker.name : NARRATOR_LABEL,
    kind: speaker ? "character" : "narration",
    text: "",
  };
}

export function createSegmentParser(speakers: SpeakerRef[]) {
  const byName = new Map<string, SpeakerRef>();
  for (const s of speakers) {
    const name = (s?.name ?? "").trim();
    if (name) byName.set(name.toLowerCase(), { id: s.id, name });
  }

  const segments: GroupSegment[] = [];
  let buf = "";
  /** True once a recognised `[Narrator]` / `[Name]` marker has been seen. */
  let started = false;
  /** Prose written before the first recognised marker — never shown. */
  let preamble = "";

  const stripper = createReasoningStripper((dropped) => logDropped("reasoning text", dropped));

  const current = () => segments[segments.length - 1];

  function append(text: string) {
    if (!text) return;
    if (!started) {
      preamble = (preamble + text).slice(-DROP_KEEP);
      return;
    }
    current().text += text;
  }

  function startSegment(speaker: SpeakerRef | null) {
    if (!started) {
      started = true;
      // Whatever the model wrote before its first marker was not a segment.
      logDropped("prose before the first segment marker", preamble);
      preamble = "";
    }
    const last = current();
    if (last && last.text === "") {
      // Nothing was written for the pending speaker yet — reuse its slot so a
      // tag with no content never leaves an empty bubble behind.
      last.speakerId = speaker ? speaker.id : null;
      last.speakerName = speaker ? speaker.name : NARRATOR_LABEL;
      last.kind = speaker ? "character" : "narration";
      return;
    }
    segments.push(characterSegment(segments.length, speaker));
  }

  /** Index of the next '[' that begins a line at or after `from`, else -1. */
  function nextTagOpen(from: number): number {
    let i = from;
    for (;;) {
      const at = buf.indexOf("[", i);
      if (at < 0) return -1;
      if (at === 0 || buf[at - 1] === "\n") return at;
      i = at + 1;
    }
  }

  function drain() {
    let from = 0;
    for (;;) {
      const open = nextTagOpen(from);
      if (open < 0) {
        append(buf.slice(from));
        buf = "";
        return;
      }

      const nl = buf.indexOf("\n", open);
      const rb = buf.indexOf("]", open + 1);

      if (rb < 0 || (nl >= 0 && nl < rb)) {
        if (nl >= 0) {
          // The line ended before any closing bracket, so this was opened
          // prose, not a tag — keep it verbatim.
          append(buf.slice(from, nl + 1));
          from = nl + 1;
          continue;
        }
        // Could still become a tag — hold from here until the next chunk.
        append(buf.slice(from, open));
        buf = buf.slice(open);
        return;
      }

      const raw = buf.slice(open + 1, rb).trim();
      const key = raw.toLowerCase();
      const known: SpeakerRef | "narrator" | null =
        key === NARRATOR_LABEL.toLowerCase() ? "narrator" : (byName.get(key) ?? null);

      append(buf.slice(from, open));

      let end = rb + 1;
      if (buf[end] === ":") end++;
      while (buf[end] === " " || buf[end] === "\t") end++;
      // A recognised tag occupies a line of its own, so the newline that ends
      // it belongs to the tag rather than to the prose. An UNKNOWN tag is left
      // attached to the previous speaker with a paragraph break intact.
      if (known) {
        if (buf[end] === "\r" && buf[end + 1] === "\n") end += 2;
        else if (buf[end] === "\n") end += 1;
      }
      buf = buf.slice(end);
      from = 0;

      if (known === "narrator") startSegment(null);
      else if (known) startSegment(known);
      // Unknown tag: dropped, and the text continues with the previous speaker.
    }
  }

  /** Segments already reported, so streaming does not log the same one twice. */
  const logged = new WeakSet<GroupSegment>();

  /**
   * Second safety net: never emit a segment that talks about the task. This is
   * non-destructive — the same segment object can still grow while streaming,
   * so it is only filtered out of what the caller sees and really removed on
   * flush. Only segments that cannot match again on their own are reported.
   */
  function dropMeta(): GroupSegment[] {
    const kept: GroupSegment[] = [];
    for (const s of segments) {
      if (isMetaCommentary(s.text)) {
        if (!logged.has(s)) {
          logged.add(s);
          logDropped("meta-commentary segment", s.text);
        }
        continue;
      }
      kept.push(s);
    }
    return kept;
  }

  return {
    /** Feed a stream chunk; returns the full current segment list. */
    push(chunk: string): GroupSegment[] {
      if (chunk) {
        const clean = stripper.feed(chunk);
        if (clean) {
          buf += clean;
          drain();
        }
      }
      return dropMeta().map((s) => ({ ...s }));
    },
    /** Current segments without changing state. */
    snapshot(): GroupSegment[] {
      return dropMeta().map((s) => ({ ...s }));
    },
    /**
     * Close the turn: leftover held text becomes prose, empty segments are
     * dropped and the survivors are re-indexed 0..n-1 in reading order.
     */
    flush(): GroupSegment[] {
      const tail = stripper.flush();
      if (tail) buf += tail;
      if (buf) {
        append(buf);
        buf = "";
      }
      return dropMeta()
        .map((s) => ({ ...s, text: s.text.trim() }))
        .filter((s) => s.text.length > 0)
        .map((s, i) => ({ ...s, index: i }));
    },
  };
}

export type SegmentParser = ReturnType<typeof createSegmentParser>;

/**
 * Parse a complete (non-streaming) group turn in one call.
 */
export function parseSegments(text: string, speakers: SpeakerRef[]): GroupSegment[] {
  const parser = createSegmentParser(speakers);
  parser.push(text);
  return parser.flush();
}
