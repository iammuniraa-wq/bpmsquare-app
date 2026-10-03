/**
 * Request timing, and the memory guard that stops a runaway from being
 * SIGKILL'd before it can report itself.
 *
 * This started life on 2026-09-23 as a temporary tracer that logged a line on
 * ENTRY to every stage, because an OOM-killed instance loses its whole log
 * buffer and told us nothing. That shape found the bug (139,000
 * Intl.DateTimeFormat constructions inside buildRows) and then became a cost
 * of its own: it sits inside requireTenantUser(), so it wrote four or five log
 * lines on every authenticated request, app-wide, for ten days.
 *
 * So it now BUFFERS instead of streaming, and emits a single line only when a
 * scope breaches its budget (docs/performance-and-scale.md, R5). Healthy
 * requests cost one Date.now() per stage and write nothing at all. The reason
 * entry-logging is no longer needed is that the memory guard below throws
 * before the reaper fires, so the process survives to flush.
 */

/** A scope slower than this is worth a line. Everything else is silence. */
const BUDGET_MS = 1000;

/**
 * Throw before the OOM reaper fires. Instances are 2048MB and the 2026-09-23
 * failures used every byte; tripping at 1400MB means the process SURVIVES to
 * name the stage that did it, where a SIGKILL would lose the log buffer.
 */
const MAX_HEAP_MB = 1400;

function heapMb(): number {
  // Edge runtime has no process.memoryUsage; never let this itself throw.
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
  let last = t0;
  let lastName = "enter";
  const stages: { name: string; ms: number }[] = [];

  return {
    stage(name: string) {
      const now = Date.now();
      stages.push({ name: lastName, ms: now - last });
      last = now;
      const previous = lastName;
      lastName = name;

      const heap = heapMb();
      if (heap > MAX_HEAP_MB) {
        throw new Error(
          `memory guard: heap ${heap}MB after "${previous}" in ${scope} (entering "${name}", +${now - t0}ms)`
        );
      }
    },

    done(note?: string) {
      const now = Date.now();
      const total = now - t0;
      if (total < BUDGET_MS) return;
      stages.push({ name: lastName, ms: now - last });
      // Slowest first: the point of the line is to name the culprit, not to
      // reproduce the whole timeline.
      const worst = [...stages].sort((a, b) => b.ms - a.ms).slice(0, 3)
        .map((s) => `${s.name}=${s.ms}ms`).join(" ");
      console.error(`[slow ${scope}] total=${total}ms  ${worst}  heap=${heapMb()}MB${note ? "  " + note : ""}`);
    },
  };
}
