/**
 * Test harness for the Group Roleplay foundation (PR 1).
 *
 *   bun scripts/test-group.ts
 *
 * Covers the two pure pieces that decide what a group turn looks like:
 *   - src/lib/groupSegments.ts — the streaming segment parser
 *   - src/lib/prompt.ts        — buildGroupPrompt / buildHordeGroupPrompt
 *
 * No database and no network: both modules are deliberately pure so they can be
 * exercised directly here.
 */

import {
  NARRATOR_LABEL,
  createSegmentParser,
  parseSegments,
  type GroupSegment,
  type SpeakerRef,
} from "../src/lib/groupSegments";
import { buildGroupPrompt, buildHordeGroupPrompt, depthHint, type GroupBuildArgs } from "../src/lib/prompt";
import {
  EMPTY_GROUP_TURN,
  planGroupRegenerate,
  runGroupTurn,
  type TurnMessage,
} from "../src/lib/groupTurn";

/* ------------------------------------------------------------------ */
/* tiny assertion helpers                                              */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${extra === undefined ? "" : `\n      ${JSON.stringify(extra)}`}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

function section(title: string) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* 1. segment parser                                                   */
/* ------------------------------------------------------------------ */

const CAST: SpeakerRef[] = [
  { id: 11, name: "Kael" },
  { id: 22, name: "Mira Thorn" },
];

function shape(segs: GroupSegment[]) {
  return segs.map((s) => [s.kind, s.speakerId, s.speakerName, s.text]);
}

section("segment parser — markers");

{
  const segs = parseSegments(
    "[Narrator]\nRain hammers the roof.\n[Kael]\n*He shrugs.* \"Late again.\"",
    CAST,
  );
  eq("narrator + character become two segments", shape(segs), [
    ["narration", null, NARRATOR_LABEL, "Rain hammers the roof."],
    ["character", 11, "Kael", '*He shrugs.* "Late again."'],
  ]);
}

{
  const segs = parseSegments("[narrator]\nLower case tag.\n[miRA thorn]:\nShe nods.", CAST);
  eq("tags are case-insensitive and may carry a colon", shape(segs), [
    ["narration", null, NARRATOR_LABEL, "Lower case tag."],
    ["character", 22, "Mira Thorn", "She nods."],
  ]);
}

{
  const segs = parseSegments("[Kael] One line only.", CAST);
  eq("prose may follow the tag on the same line", shape(segs), [
    ["character", 11, "Kael", "One line only."],
  ]);
}

{
  // A model that thinks out loud first must not have that text become a
  // segment: it is discarded, never attached to the Narrator.
  const segs = parseSegments("Some framing prose.\n[Narrator]\nThen the rain.", CAST);
  eq("prose before the first marker is discarded, not narrated", shape(segs), [
    ["narration", null, NARRATOR_LABEL, "Then the rain."],
  ]);
  check(
    "the discarded preamble reaches no segment",
    !segs.some((s) => s.text.includes("Some framing prose")),
    shape(segs),
  );
}

section("segment parser — unknown names");

{
  const segs = parseSegments("[Kael]\n*He shrugs.*\n[Ghost]\n*Nobody is there.*", CAST);
  eq("an unknown tag attaches its text to the previous speaker", shape(segs), [
    ["character", 11, "Kael", "*He shrugs.*\n\n*Nobody is there.*"],
  ]);
  check(
    "the unknown tag itself is dropped from the prose",
    !segs.some((s) => s.text.includes("[Ghost]") || s.speakerName === "Ghost"),
  );
}

{
  // No valid marker has started the turn yet, so there is nothing the unknown
  // tag's text may legitimately attach to — it is discarded with the preamble.
  const segs = parseSegments("[Ghost]\nPrologue only.", CAST);
  eq("an unknown name before the first real marker leaks nothing", segs.length, 0);
}

{
  const segs = parseSegments("[Kael]\n*He shrugs.*\n[Ghost]\nA.\n[Mira Thorn]\n*She looks up.*", CAST);
  eq("an unknown tag does not disturb the next real tag", shape(segs), [
    ["character", 11, "Kael", "*He shrugs.*\n\nA."],
    ["character", 22, "Mira Thorn", "*She looks up.*"],
  ]);
}

section("segment parser — streaming");

{
  const text = [
    "[Narrator]",
    "The tavern goes quiet.",
    "[Kael]",
    "*He sets the mug down.* \"You brought company.\"",
    "[Mira Thorn]",
    "*She steps out of the dark.*",
  ].join("\n");

  const oneShot = parseSegments(text, CAST);

  // One character at a time — the worst case for tag detection.
  const charParser = createSegmentParser(CAST);
  for (const ch of text) charParser.push(ch);
  const charByChar = charParser.flush();
  eq("char-by-char streaming matches a single parse", shape(charByChar), shape(oneShot));

  // Uneven chunks, including a tag split across two pushes.
  const parser = createSegmentParser(CAST);
  parser.push("[Nar");
  parser.push("rator]\nThe tavern ");
  parser.push("goes quiet.\n[Ka");
  parser.push("el]\n*He sets the mug down.* ");
  parser.push('"You brought company."\n[Mira Tho');
  parser.push("rn]\n*She steps out of the dark.*");
  const streamed = parser.flush();
  eq("chunked streaming matches a single parse", shape(streamed), shape(oneShot));

  check(
    "no partial tag leaks into the prose",
    streamed.every((s) => !s.text.includes("[")),
    shape(streamed),
  );
  check(
    "the prose itself survives chunking",
    streamed.map((s) => s.text).join(" ").includes("*She steps out of the dark.*"),
    shape(streamed),
  );
}

{
  // A "[" that can never close on its line is prose, not a tag.
  const segs = parseSegments("[Narrator]\nHe opens the door [hesitating\nand stops.", CAST);
  eq("an unclosed bracket on its line stays prose", segs[0].text, "He opens the door [hesitating\nand stops.");
  eq("and produces no extra segment", segs.length, 1);
}

{
  const parser = createSegmentParser(CAST);
  const mid = parser.push("[Kael]\n*He starts to ans");
  check(
    "streaming emits the visible text early",
    mid.length === 1 && mid[0].text === "*He starts to ans",
    mid,
  );
  const afterUnknown = parser.push("wer*\n[Ghost");
  check(
    "an in-flight tag is withheld until it closes",
    afterUnknown[0].text === "*He starts to answer*\n",
    afterUnknown,
  );
  parser.push("]\n*Nothing.*");
  const final = parser.flush();
  eq("the withheld text lands on the previous speaker", shape(final), [
    ["character", 11, "Kael", "*He starts to answer*\n\n*Nothing.*"],
  ]);
}

section("segment parser — model reasoning is never saved");

{
  const raw = [
    "<think>",
    "We need to plan this turn. The user is at the door, so [Kael] should react first.",
    "</think>",
    "[Narrator]",
    "Rain hammers the roof.",
    "[Kael]",
    "*He shrugs.*",
  ].join("\n");
  const segs = parseSegments(raw, CAST);
  eq("a <think> block is stripped before segment parsing starts", shape(segs), [
    ["narration", null, NARRATOR_LABEL, "Rain hammers the roof."],
    ["character", 11, "Kael", "*He shrugs.*"],
  ]);
  check(
    "no reasoning text survives into a segment",
    !segs.some((s) => /plan this turn|at the door/i.test(s.text)),
    shape(segs),
  );
}

{
  const raw = "<thinking>Let me think about [Mira Thorn].</thinking>[Narrator]\nThe hall is cold.";
  const segs = parseSegments(raw, CAST);
  eq("other reasoning tags are stripped too", shape(segs), [
    ["narration", null, NARRATOR_LABEL, "The hall is cold."],
  ]);
}

{
  eq("an unclosed reasoning block is dropped", parseSegments("<think>unclosed reasoning about [Kael]", CAST).length, 0);
}

{
  // A bracketed name inside prose wrapped in <analysis> must not start a turn.
  const raw = [
    "<analysis>",
    "We need to write segments: [Kael] speaks, then [Mira Thorn] answers.",
    "</analysis>",
    "[Narrator]",
    "A beat passes.",
  ].join("\n");
  eq("a bracketed name inside a reasoning block is not a speaker", shape(parseSegments(raw, CAST)), [
    ["narration", null, NARRATOR_LABEL, "A beat passes."],
  ]);
}

{
  const text =
    "<think>We must plan: [Narrator] first.</think>\n[Narrator]\nRain.\n[Kael]\n*He shrugs.*";
  const parser = createSegmentParser(CAST);
  for (const ch of text) parser.push(ch);
  eq(
    "char-by-char streaming strips reasoning exactly like a single parse",
    shape(parser.flush()),
    shape(parseSegments(text, CAST)),
  );
}

section("segment parser — leaked reasoning and meta-commentary");

{
  // Raw shape seen from models that narrate their plan before the first marker.
  const raw = [
    "Let me think about this turn. I need to give [Narrator] a beat, then have [Kael] answer.",
    "",
    "[Narrator]",
    "Rain hammers the roof.",
    "[Kael]",
    "*He shrugs.*",
  ].join("\n");
  const segs = parseSegments(raw, CAST);
  eq("reasoning prose before the first marker produces no segment", shape(segs), [
    ["narration", null, NARRATOR_LABEL, "Rain hammers the roof."],
    ["character", 11, "Kael", "*He shrugs.*"],
  ]);
  check(
    "the preamble is attached to nobody",
    !segs.some((s) => /let me think|i need to give/i.test(s.text)),
    shape(segs),
  );
}

{
  // The meta line itself is parsed as Kael's segment and must be dropped.
  const raw = ["[Kael]", "We need to write this as segments: [Kael] reacts first, then [Mira Thorn] answers."].join("\n");
  eq("meta-commentary holding a bracketed name is dropped", parseSegments(raw, CAST).length, 0);
}

{
  const raw = [
    "[Narrator]",
    "The room is quiet.",
    "[Mira Thorn]",
    "We must create segments: [Mira Thorn] steps forward, then [Kael] replies.",
  ].join("\n");
  eq("only the meta segment is dropped, real ones stay", shape(parseSegments(raw, CAST)), [
    ["narration", null, NARRATOR_LABEL, "The room is quiet."],
  ]);
}

{
  // In-character dialogue the words are fine in.
  const quoted = parseSegments('[Kael]\n"We need to leave. Now."\n*He starts for the door.*', CAST);
  check(
    "quoted in-character dialogue is not mistaken for meta-commentary",
    quoted.length === 1 && quoted[0].text.includes("We need to leave"),
    shape(quoted),
  );

  const soft = parseSegments("[Kael]\nLet me help you with that.\n*He steps in.*", CAST);
  check(
    "a weak opener without any format talk stays in character",
    soft.length === 1 && soft[0].text.startsWith("Let me help you"),
    shape(soft),
  );

  const strong = parseSegments("[Kael]\nOkay, let me narrate the segments now.", CAST);
  eq("a weak opener plus format talk is still dropped", strong.length, 0);
}

{
  const raw = [
    "We need to plan the segments first.",
    "[Narrator]",
    "The room is quiet.",
  ].join("\n");
  const parser = createSegmentParser(CAST);
  const head = "We need to plan the segm";
  const early = parser.push(head);
  check("nothing is streamed before the first marker", early.length === 0, early);
  parser.push(raw.slice(head.length));
  eq("the full streamed turn matches a single parse", shape(parser.flush()), shape(parseSegments(raw, CAST)));
}

section("segment parser — housekeeping");

{
  const segs = parseSegments("[Kael]\n[Mira Thorn]\n*She looks up.*", CAST);
  eq("empty segments never create empty bubbles", shape(segs), [
    ["character", 22, "Mira Thorn", "*She looks up.*"],
  ]);
}

{
  const segs = parseSegments("[Narrator]\nA.\n[Kael]\nB.\n[Mira Thorn]\nC.", CAST);
  eq("flushed segments are re-indexed in reading order", segs.map((s) => s.index), [0, 1, 2]);
}

{
  const segs = parseSegments("", CAST);
  eq("an empty generation yields no segments", segs.length, 0);
}

/* ------------------------------------------------------------------ */
/* 2. buildGroupPrompt                                                 */
/* ------------------------------------------------------------------ */

function makeArgs(overrides: Partial<GroupBuildArgs> = {}): GroupBuildArgs {
  return {
    group: {
      name: "The Ashen Court",
      worldDescription: "A rain-soaked port city under a dying sun.",
      plot: "Two rivals must hold the harbour until dawn.",
      concept: "A pact of rivals surviving one winter.",
      tags: ["intrigue", "slow burn"],
      narratorStyle: "Close third person, present tense.",
    },
    members: [
      {
        characterId: 11,
        name: "Kael",
        role: "Protagonist",
        depth: 5,
        personality: "KAEL_PERSONALITY_TEXT — a tired smuggler with a debt.",
        scenario: "KAEL_SCENARIO_TEXT — owes the harbour master.",
        contextBlock: "KAEL_CONTEXT_TEXT — keep his speech clipped.",
        exampleDialogue: "KAEL_EXAMPLE_TEXT — \"You brought company.\"",
        card: { STAT: "KAEL_CARD_STATUS", GOAL: "KAEL_CARD_GOAL" },
      },
    ],
    personaName: "Robin",
    personaDescription: "PERSONA_TEXT — a harbour clerk with a secret.",
    nsfw: false,
    nsfwPrompt: "",
    summary: "SUMMARY_TEXT — they met in the flooded cellar.",
    globalCard: { SCN: "GLOBAL_CARD_SCENE", ARC: "GLOBAL_CARD_ARC" },
    history: [
      { role: "assistant", content: "The lamp gutters.", speaker: NARRATOR_LABEL },
      { role: "user", content: "Robin waits." },
    ],
    lorebookEntries: [
      {
        id: 1,
        lorebookId: 1,
        title: "Harbour",
        keys: [],
        secondaryKeys: [],
        content: "LOREBODY_TEXT — the harbour freezes every winter.",
        enabled: true,
        constant: true,
        caseSensitive: false,
        priority: 100,
        insertionOrder: 0,
      },
    ],
    lorebookBudget: 1200,
    contextSize: 16000,
    maxTokens: 900,
    ...overrides,
  };
}

function flatten(args: GroupBuildArgs, horde = false) {
  const built = horde ? buildHordeGroupPrompt(args) : buildGroupPrompt(args);
  return built.messages.map((m) => m.content).join("\n\n");
}

const ABSENT_NAME = "ABSENT_CHARACTER_NAME";
const ABSENT_CARD = "ABSENT_CARD_SECRET";

section("buildGroupPrompt — content");

{
  const args = makeArgs();
  const text = flatten(args);

  check("world description is pinned", text.includes("A rain-soaked port city"));
  check("plot is pinned", text.includes("hold the harbour until dawn"));
  check("concept is pinned", text.includes("A pact of rivals surviving one winter"));
  check("tags are pinned", text.includes("intrigue, slow burn") || text.includes("intrigue"));
  check("narrator style is pinned", text.includes("Close third person, present tense"));
  check("the narrator is an independent voice", /\[Narrator\]/.test(text) && /third-person/i.test(text));
  check("present member's full profile is pinned", text.includes("KAEL_PERSONALITY_TEXT"));
  check("present member's scenario is pinned", text.includes("KAEL_SCENARIO_TEXT"));
  check("present member's context block is pinned", text.includes("KAEL_CONTEXT_TEXT"));
  check("present member's example dialogue is pinned", text.includes("KAEL_EXAMPLE_TEXT"));
  check("present member's Memory Card is pinned", text.includes("KAEL_CARD_STATUS") && text.includes("KAEL_CARD_GOAL"));
  check("role is pinned", text.includes("Protagonist"));
  check("depth hint is pinned", text.includes(depthHint(5)));
  check("global card is pinned", text.includes("GLOBAL_CARD_SCENE") && text.includes("GLOBAL_CARD_ARC"));
  check(
    "cards are labelled as higher priority than recent text",
    /higher priority than recent text/i.test(text),
  );
  check("persona is pinned", text.includes("PERSONA_TEXT"));
  check(
    "the model is told never to write the user",
    /never write the human roleplayer|never write their words/i.test(text),
  );
  check("world lorebook is pinned", text.includes("LOREBODY_TEXT"));
  check("story summary is pinned", text.includes("SUMMARY_TEXT"));
  check("segment format is spelled out", text.includes("[Narrator]") && text.includes("[Kael]"));
  check("history is carried in", text.includes("The lamp gutters") && text.includes("Robin waits"));
  check("generated history is tagged with its speaker", text.includes(`[${NARRATOR_LABEL}]`));
  check("stats report the pinned tokens", buildGroupPrompt(args).stats.pinnedTokens > 0);
}

section("buildGroupPrompt — absent characters are excluded");

{
  const absent = {
    characterId: 99,
    name: ABSENT_NAME,
    role: "Rival",
    depth: 4,
    personality: "ABSENT_PERSONALITY",
    scenario: "ABSENT_SCENARIO",
    contextBlock: "ABSENT_CONTEXT",
    exampleDialogue: "ABSENT_EXAMPLE",
    card: { KEY: ABSENT_CARD },
  };

  // The route only ever passes present members; this proves that passing the
  // absent ones through would be visible, and that the builder itself adds
  // nothing about them.
  const withAbsent = makeArgs({ members: [...makeArgs().members, absent] });
  check("sanity: an included member really does show up", flatten(withAbsent).includes(ABSENT_NAME));

  const present = makeArgs();
  const text = flatten(present);
  const horde = flatten(present, true);

  for (const [label, body] of [
    ["chat prompt", text],
    ["horde prompt", horde],
  ] as const) {
    check(`${label}: absent name is not sent`, !body.includes(ABSENT_NAME));
    check(`${label}: absent profile text is not sent`, !body.includes("ABSENT_"));
    check(`${label}: absent Memory Card is not sent`, !body.includes(ABSENT_CARD));
  }
}

section("group prompt — voices stay separate, output stays in character");

{
  const chat = flatten(makeArgs());
  const horde = flatten(makeArgs(), true);

  for (const [label, body] of [
    ["chat prompt", chat],
    ["horde prompt", horde],
  ] as const) {
    check(
      `${label}: tells the model never to narrate its own instructions`,
      body.includes(
        "Never narrate or explain your own instructions, formatting, or what you are about to do. Output only in-character segments.",
      ),
    );
    check(
      `${label}: locks each character to their own voice`,
      /VOICE LOCK/.test(body) && /never adopts another character's traits/.test(body),
    );
    check(
      `${label}: forbids a character referring to themselves by name`,
      /never refers to themselves in the third person by name/i.test(body),
    );
    check(
      `${label}: personality is marked as the deepest part of a character`,
      /deepest part of Kael/i.test(body),
    );
    check(
      `${label}: the personal situation is shallower than the personality`,
      /shallower than the personality above/i.test(body),
    );
    check(
      `${label}: the personality block survives the pinned-section order`,
      body.indexOf("KAEL_PERSONALITY_TEXT") < body.indexOf("KAEL_SCENARIO_TEXT"),
    );
  }
}

section("buildGroupPrompt — AI Horde parity");

{
  const args = makeArgs();
  const horde = buildHordeGroupPrompt(args);
  const text = horde.messages.map((m) => m.content).join("\n\n");
  check("horde prompt is a single flat message", horde.messages.length === 1);
  check("horde carries the same segment format", /\[Narrator\]/.test(text) && /\[Kael\]/.test(text));
  check("horde keeps the cast profile", text.includes("KAEL_PERSONALITY_TEXT"));
  check("horde keeps the cards", text.includes("KAEL_CARD_STATUS") && text.includes("GLOBAL_CARD_SCENE"));
  check("horde keeps the lorebook", text.includes("LOREBODY_TEXT"));
  check(
    "horde stops before the human speaks",
    horde.stopSequence === "\nRobin:",
    horde.stopSequence,
  );
}

/* ------------------------------------------------------------------ */
/* 3. depth hints                                                      */
/* ------------------------------------------------------------------ */

section("depth hints");

{
  const hints = [1, 2, 3, 4, 5].map((d) => depthHint(d));
  check("all five depths have distinct hints", new Set(hints).size === 5);
  check("depth 5 asks for the most", /most segments|driving voice/i.test(hints[4]));
  check("depth 1 asks for the least", /barely there|at most one short line/i.test(hints[0]));
  eq("out-of-range depth is clamped", depthHint(9), hints[4]);
  eq("a zero depth falls back to regular", depthHint(0), depthHint(3));
}

/* ------------------------------------------------------------------ */
/* 4. group turn — the old turn is only replaced on commit           */
/* ------------------------------------------------------------------ */

/** Stored rows of an existing session: one user line and a two-segment turn. */
function existingTurn(): TurnMessage[] {
  return [
    { id: 1, role: "user", content: "Robin pushes the door open.", turnId: null },
    { id: 2, role: "assistant", content: "Rain hammers the roof.", turnId: "t1" },
    { id: 3, role: "assistant", content: "*Kael looks up.*", turnId: "t1" },
  ];
}

function seg(text: string, speakerId: number | null, kind: "narration" | "character", name: string) {
  return { index: 0, speakerId, speakerName: name, kind, text };
}
const NEW_SEGMENTS = [
  seg("The fire gutters.", null, "narration", NARRATOR_LABEL),
  seg("*He shrugs.*", 11, "character", "Kael"),
];

/**
 * A stand-in for the database: `commit` is the only thing that may change the
 * transcript, exactly like the real transaction. It records every call so the
 * test can prove nothing was touched on a failure.
 */
function fakeStore(rows: TurnMessage[]) {
  let store = [...rows];
  const deletes: string[] = [];
  let commits = 0;
  const commit = async (args: {
    replaceTurnId: string | null;
    replaceMessageId: number | null;
    segments: GroupSegment[];
    turnId: string;
  }) => {
    commits++;
    // Mirrors the real transaction: only a turn id (or, for a turn without one,
    // a single message id) can remove anything — both are null for a send.
    if (args.replaceTurnId) {
      store = store.filter((m) => m.turnId !== args.replaceTurnId);
      deletes.push(args.replaceTurnId);
    } else if (args.replaceMessageId) {
      store = store.filter((m) => m.id !== args.replaceMessageId);
      deletes.push(`id:${args.replaceMessageId}`);
    }
    const inserted = args.segments.map((s, i) => ({
      id: 900 + i,
      role: "assistant",
      content: s.text,
      turnId: args.turnId,
    }));
    store = [...store, ...inserted];
    return inserted;
  };
  return {
    get rows() {
      return store;
    },
    commit,
    get commits() {
      return commits;
    },
    get deletes() {
      return deletes;
    },
  };
}

async function groupTurnCases() {
  section("group turn — regenerate never deletes before generating");

  {
    const store = fakeStore(existingTurn());
    const before = JSON.stringify(store.rows);
    let error = "";
    try {
      await runGroupTurn({
        action: "regenerate",
        messages: store.rows,
        turnId: "t2",
        prepare: (history) => history,
        produce: async () => {
          throw new Error("provider exploded");
        },
        commit: store.commit,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    check(
      "failed regenerate keeps the old turn",
      error === "provider exploded" && store.commits === 0 && JSON.stringify(store.rows) === before,
      { error, commits: store.commits, rows: store.rows },
    );
  }

  {
    // A Stop / timeout surfaces as an abort rejection from the stream.
    const store = fakeStore(existingTurn());
    const before = JSON.stringify(store.rows);
    let aborted = false;
    try {
      await runGroupTurn({
        action: "regenerate",
        messages: store.rows,
        turnId: "t2",
        prepare: (history) => history,
        produce: async () => {
          throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        },
        commit: store.commit,
      });
    } catch (e) {
      aborted = (e as Error).name === "AbortError";
    }
    check(
      "a stopped regenerate leaves the old turn alone",
      aborted && store.commits === 0 && JSON.stringify(store.rows) === before,
      { aborted, commits: store.commits },
    );
  }

  {
    const store = fakeStore(existingTurn());
    const before = JSON.stringify(store.rows);
    let error = "";
    try {
      await runGroupTurn({
        action: "regenerate",
        messages: store.rows,
        turnId: "t2",
        prepare: (history) => history,
        produce: async () => [],
        commit: store.commit,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    check(
      "an empty regenerate reply leaves the old turn alone",
      error === EMPTY_GROUP_TURN && store.commits === 0 && JSON.stringify(store.rows) === before,
      { error, commits: store.commits },
    );
  }

  {
    const store = fakeStore(existingTurn());
    const seen: string[] = [];
    const outcome = await runGroupTurn({
      action: "regenerate",
      messages: store.rows,
      turnId: "t2",
      prepare: (history) => {
        seen.push(...history.map((m) => m.content));
        return history;
      },
      produce: async () => NEW_SEGMENTS,
      commit: store.commit,
    });
    check(
      "the prompt never sees the turn being replaced",
      !seen.some((c) => c.includes("Rain hammers the roof") || c.includes("Kael looks up")) &&
        seen.includes("Robin pushes the door open."),
      seen,
    );
    check("the replaced turn is identified by its turn id", outcome.plan.replaceTurnId === "t1");
    check(
      "all segments of the old turn are replaced at once",
      JSON.stringify(outcome.plan.replacedIds) === JSON.stringify([2, 3]),
      outcome.plan.replacedIds,
    );
    check("the old turn is only touched once, on commit", store.commits === 1 && store.deletes.length === 1);
    check(
      "the new segments replace the old ones",
      store.rows.length === 3 &&
        store.rows.filter((m) => m.turnId === "t1").length === 0 &&
        store.rows.filter((m) => m.turnId === "t2").length === 2,
      store.rows,
    );
  }

  {
    // The opening narration has no turn id, so only that one row is replaced.
    const store = fakeStore([{ id: 1, role: "assistant", content: "The hall is cold.", turnId: null }]);
    const outcome = await runGroupTurn({
      action: "regenerate",
      messages: store.rows,
      turnId: "t2",
      prepare: (history) => history,
      produce: async () => NEW_SEGMENTS,
      commit: store.commit,
    });
    check(
      "a turn without an id falls back to replacing the single message",
      outcome.plan.replaceTurnId === null && outcome.plan.replaceMessageId === 1,
      outcome.plan,
    );
    eq("the replacement message is gone", store.rows.filter((m) => m.id === 1).length, 0);
  }

  {
    const store = fakeStore(existingTurn());
    const seen: string[] = [];
    const outcome = await runGroupTurn({
      action: "send",
      messages: store.rows,
      turnId: "t2",
      prepare: (history) => {
        seen.push(...history.map((m) => m.content));
        return history;
      },
      produce: async () => NEW_SEGMENTS,
      commit: store.commit,
    });
    check("a plain send replaces nothing", outcome.plan.replaceTurnId === null && store.deletes.length === 0);
    check("a plain send still sees the whole transcript", seen.length === 3, seen);
    check("a plain send appends its segments", store.rows.length === 5, store.rows);
  }

  section("group turn — regenerate planning");

  {
    const plan = planGroupRegenerate(existingTurn());
    eq("the plan keeps the history without the last turn", plan.history.map((m) => m.id), [1]);
    check("nothing is deleted by planning", plan.replacedIds.length === 2);
  }

  {
    // A trailing user message is not regenerable.
    const plan = planGroupRegenerate([
      ...existingTurn(),
      { id: 4, role: "user", content: "Robin waits.", turnId: null },
    ]);
    check(
      "a trailing user message is never replaced",
      plan.replaceTurnId === null && plan.replaceMessageId === null && plan.history.length === 4,
      plan,
    );
  }
}

/* ------------------------------------------------------------------ */
/* summary                                                             */
/* ------------------------------------------------------------------ */

groupTurnCases().then(
  () => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  - ${f}`);
      process.exitCode = 1;
    }
  },
  (e) => {
    console.error("harness crashed:", e);
    process.exitCode = 1;
  },
);
