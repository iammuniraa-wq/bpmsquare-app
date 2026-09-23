/**
 * TEMPORARY DIAGNOSTIC — added 2026-09-23 for the BIM hang, remove once the
 * cause is found. Tracked in the incident notes, not a permanent facility.
 *
 * Why it logs on ENTRY to each stage rather than on exit: the failures we
 * are chasing end with the instance being killed (56 OOM kills and four
 * 300s timeouts on 2026-09-23, all on bim.bpmsquare.com, with Postgres
 * completely idle throughout). A killed process never runs its own exit
 * line, so an exit-only tracer prints nothing for exactly the request we
 * need to see. Logging on entry means the LAST line printed names the stage
 * that died.
 *
 * Uses console.error deliberately (CLAUDE.md §8 bans console.log): a
 * request slow enough to trip these thresholds is a genuine error.
 */

/** Stage entries are always printed; a slow total also prints a summary. */
const SLOW_TOTAL_MS = 3000;

function heapMb(): number {
  // Edge runtime has no process.memoryUsage; never let the tracer itself throw.
  try {
    return Math.round(process.memoryUsage().heapUsed / 1048576);
  } catch {
    return -1;
  }
}

export type Trace = {
  stage: (name: string) => void;
  done: (note?: string) => void;
};

export function trace(scope: string): Trace {
  const t0 = Date.now();
  const id = Math.random().toString(36).slice(2, 8);
  let last = t0;
  let lastName = "enter";

  return {
    stage(name: string) {
      const now = Date.now();
      console.error(
        `[trace ${scope}:${id}] +${now - t0}ms  ${lastName}=${now - last}ms  -> ${name}  heap=${heapMb()}MB`
      );
      last = now;
      lastName = name;
    },
    done(note?: string) {
      const now = Date.now();
      if (now - t0 < SLOW_TOTAL_MS) return;
      console.error(
        `[trace ${scope}:${id}] SLOW total=${now - t0}ms  last=${lastName}(${now - last}ms)  heap=${heapMb()}MB${note ? "  " + note : ""}`
      );
    },
  };
}
