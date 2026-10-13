/**
 * Sequencing for one group turn: plan → produce → commit.
 *
 * The single most important rule here is that the PREVIOUS turn is never
 * touched until the new one exists. Regenerate used to delete the old turn up
 * front, so a provider error, a timeout, a user pressing Stop or an empty reply
 * left the session with the old turn gone and nothing in its place. Now the old
 * turn is removed only inside `commit`, together with the insert of the new
 * segments (the caller wraps that in a database transaction).
 *
 * Kept pure and dependency-free so `npm run test` can prove the sequencing
 * without a database or a provider.
 */

import type { GroupSegment } from "./groupSegments";

export type GroupAction = "send" | "regenerate" | "continue" | "elaborate" | "impersonate";

/** The minimum a stored message must expose for turn planning. */
export type TurnMessage = {
  id: number;
  role: string;
  content: string;
  turnId?: string | null;
};

/** The part of a plan that says "nothing is being replaced". */
export type Replacement = {
  /** Messages that belong to the turn being replaced. */
  replacedIds: number[];
  /** Turn id to delete on commit (null when the old turn has no id). */
  replaceTurnId: string | null;
  /** Fallback for a turn without an id (e.g. the opening narration). */
  replaceMessageId: number | null;
};

/** The full plan, still generic over the caller's own message row type. */
export type RegeneratePlan<M extends TurnMessage = TurnMessage> = Replacement & {
  /** History the prompt must be built from — WITHOUT the replaced turn. */
  history: M[];
};

/** Nothing is being replaced (a plain send, or nothing regenerable). */
export function noReplacement(): Replacement {
  return { replacedIds: [], replaceTurnId: null, replaceMessageId: null };
}

/**
 * Decides what a regenerate replaces and which history the model sees. Nothing
 * is deleted here: this is only a description of the intended change.
 */
export function planGroupRegenerate<M extends TurnMessage>(messages: M[]): RegeneratePlan<M> {
  const last = messages[messages.length - 1];
  // Only the AI's own last turn can be regenerated.
  if (!last || last.role !== "assistant") {
    return { ...noReplacement(), history: messages };
  }
  const turnId = (last.turnId ?? "") || null;
  const replacedIds = turnId
    ? messages.filter((m) => m.turnId === turnId).map((m) => m.id)
    : [last.id];
  const replaced = new Set(replacedIds);
  return {
    replacedIds,
    replaceTurnId: turnId,
    replaceMessageId: turnId ? null : last.id,
    history: messages.filter((m) => !replaced.has(m.id)),
  };
}

/** Exactly what `commit` needs to swap the old turn for the new one atomically. */
export type CommitArgs<S extends GroupSegment> = {
  replaceTurnId: string | null;
  replaceMessageId: number | null;
  segments: S[];
  turnId: string;
};

export const EMPTY_GROUP_TURN =
  "The model returned an empty response. Try again, or pick a different model in Settings → Connections.";

export type RunGroupTurnOptions<M extends TurnMessage, S extends GroupSegment, P, R> = {
  action: GroupAction;
  /** The transcript as currently stored (including the turn to regenerate). */
  messages: M[];
  /** Turn id stamped on this turn's new segments. */
  turnId: string;
  /**
   * Builds everything the prompt needs from `history` (which already excludes
   * the turn being replaced, so the model never sees the text it replaces).
   */
  prepare: (history: M[], plan: RegeneratePlan<M>) => P | Promise<P>;
  /**
   * Produces the turn's segments. Anything thrown or rejected here — provider
   * error, abort, timeout, empty reply — stops the turn before commit, so the
   * old turn survives untouched.
   */
  produce: (prepared: P, plan: RegeneratePlan<M>) => Promise<S[]>;
  /**
   * The ONLY place the old turn is removed: delete + insert in one step.
   * Returns whatever the caller wants handed back (e.g. the inserted rows).
   */
  commit: (args: CommitArgs<S>) => Promise<R>;
};

export type GroupTurnOutcome<S extends GroupSegment, R> = {
  turnId: string;
  segments: S[];
  plan: RegeneratePlan;
  committed: R;
};

/**
 * Runs one group turn. Regenerate plans the replacement, builds the prompt from
 * history without the old turn, generates, and only then commits.
 */
export async function runGroupTurn<M extends TurnMessage, S extends GroupSegment, P, R>(
  opts: RunGroupTurnOptions<M, S, P, R>,
): Promise<GroupTurnOutcome<S, R>> {
  const plan: RegeneratePlan<M> =
    opts.action === "regenerate"
      ? planGroupRegenerate(opts.messages)
      : { ...noReplacement(), history: opts.messages };

  const prepared = await opts.prepare(plan.history, plan);
  const segments = await opts.produce(prepared, plan);
  if (!segments.length) {
    // Nothing was generated: the old turn must stay exactly as it was.
    throw new Error(EMPTY_GROUP_TURN);
  }

  const committed = await opts.commit({
    replaceTurnId: plan.replaceTurnId,
    replaceMessageId: plan.replaceMessageId,
    segments,
    turnId: opts.turnId,
  });

  return { turnId: opts.turnId, segments, plan, committed };
}
