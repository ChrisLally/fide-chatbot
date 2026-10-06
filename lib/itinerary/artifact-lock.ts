/**
 * Simple in-memory mutex per itinerary artifact id.
 * Serializes parallel patch / approve / UI writes so concurrent mutations
 * do not interleave on the same artifact.
 */

type Waiter = {
  resolve: () => void;
};

type LockState = {
  locked: boolean;
  queue: Waiter[];
};

const locks = new Map<string, LockState>();

function getState(artifactId: string): LockState {
  let state = locks.get(artifactId);
  if (!state) {
    state = { locked: false, queue: [] };
    locks.set(artifactId, state);
  }
  return state;
}

/** Acquire exclusive write access for `artifactId`. */
export async function withArtifactLock<T>(
  artifactId: string,
  fn: () => Promise<T> | T
): Promise<T> {
  const state = getState(artifactId);
  if (state.locked) {
    await new Promise<void>((resolve) => {
      state.queue.push({ resolve });
    });
  }
  state.locked = true;
  try {
    return await fn();
  } finally {
    const next = state.queue.shift();
    if (next) {
      next.resolve();
    } else {
      state.locked = false;
      locks.delete(artifactId);
    }
  }
}

/** Test helper — clear all locks. */
export function clearArtifactLocks(): void {
  locks.clear();
}
