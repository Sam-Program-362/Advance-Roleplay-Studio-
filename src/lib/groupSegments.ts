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
 *   - `[Narrator]` (case-insensitive) starts a narration segment.
 *   - Any name in `speakers` (case-insensitive, trimmed) starts that speaker's
 *     segment; the id in the segment is the character id.
 *   - An UNKNOWN name does not start anything: the tag itself is dropped and
 *     the text that follows attaches to the previous speaker.
 *   - Anything before the first recognised marker is narration.
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

function narrationDraft(index: number): GroupSegment {
  return { index, speakerId: null, speakerName: NARRATOR_LABEL, kind: "narration", text: "" };
}

export function createSegmentParser(speakers: SpeakerRef[]) {
  const byName = new Map<string, SpeakerRef>();
  for (const s of speakers) {
    const name = (s?.name ?? "").trim();
    if (name) byName.set(name.toLowerCase(), { id: s.id, name });
  }

  const segments: GroupSegment[] = [narrationDraft(0)];
  let buf = "";

  const current = () => segments[segments.length - 1];

  function append(text: string) {
    if (text) current().text += text;
  }

  function startSegment(speaker: SpeakerRef | null) {
    const last = current();
    if (last.text === "") {
      // Nothing was written for the pending speaker yet — reuse its slot so a
      // tag with no content never leaves an empty bubble behind.
      last.speakerId = speaker ? speaker.id : null;
      last.speakerName = speaker ? speaker.name : NARRATOR_LABEL;
      last.kind = speaker ? "character" : "narration";
      return;
    }
    segments.push({
      index: segments.length,
      speakerId: speaker ? speaker.id : null,
      speakerName: speaker ? speaker.name : NARRATOR_LABEL,
      kind: speaker ? "character" : "narration",
      text: "",
    });
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
        key === NARRATOR_LABEL.toLowerCase()
          ? "narrator"
          : (byName.get(key) ?? null);

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

  return {
    /** Feed a stream chunk; returns the full current segment list. */
    push(chunk: string): GroupSegment[] {
      if (chunk) {
        buf += chunk;
        drain();
      }
      return segments.map((s) => ({ ...s }));
    },
    /** Current segments without changing state. */
    snapshot(): GroupSegment[] {
      return segments.map((s) => ({ ...s }));
    },
    /**
     * Close the turn: leftover held text becomes prose, empty segments are
     * dropped and the survivors are re-indexed 0..n-1 in reading order.
     */
    flush(): GroupSegment[] {
      if (buf) {
        append(buf);
        buf = "";
      }
      return segments
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
