import type { ChangeKind, EffortBand } from "./types";

// Effort bands are a RULE from the kind of change, never a model output and
// never a price (docs/process-design-studio-architecture.md section 6.4). The
// reviewer can change a stored band; nothing else does.

export const NEW_HOOK = "new_hook";

export function effortBand(
  kind: ChangeKind,
  ctx: { extensionHook: string | null; connector: string | null },
  known: { hooks: ReadonlySet<string>; connectors: ReadonlySet<string> },
): EffortBand {
  switch (kind) {
    case "setting":
    case "own_fields":
      return "small";
    case "extension":
      // An existing hook is a Medium piece of work; a hook that does not exist yet
      // means changing the product's extension surface first, which is Large.
      return ctx.extensionHook && ctx.extensionHook !== NEW_HOOK && known.hooks.has(ctx.extensionHook) ? "medium" : "large";
    case "new_build":
      return "large";
    case "integration":
      return ctx.connector && known.connectors.has(ctx.connector) ? "medium" : "large";
  }
}

/** Indicative working days a change adds to the plan, by band. Not shown as a price or a promise. */
export const BAND_DAYS: Record<EffortBand, number> = { small: 1, medium: 3, large: 10 };
