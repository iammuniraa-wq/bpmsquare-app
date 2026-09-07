// AI-drafted intake (Fence Configurator concept differentiator #1,
// docs/fence-configurator-architecture.md §0/§14b): paste a client's
// email and get a starting fence_projects configuration, instead of a
// rep typing four lengths by hand. Reuses the SAME tool-forced
// extraction engine Data Workbench and Nova's paste-to-draft feature
// already use (src/lib/import/extract.ts's extractRowsFromDocument) --
// no new LLM plumbing, prompt design, or error handling. Nothing is
// created here; this only proposes values for the configurator to open
// with, same as NovaDraft.tsx's review-before-create pattern.
//
// fence_projects is deliberately NOT added to the real ImportObjectId
// union (that would pull it into Data Workbench/registrySchema.ts's
// Record<ImportObjectId,...> maps, which is out of scope -- explicitly
// deferred per bpmsquarecore §3b). extractRowsFromDocument never
// branches on spec.id at runtime, only spec.label/spec.fields, so this
// cast is purely a typing convenience, not a behavior change.

import "server-only";
import { extractRowsFromDocument } from "@/lib/import/extract";
import type { ObjectSpec, ImportObjectId } from "@/lib/import/types";
import type { FenceGateInput } from "./geometry";
import type { FenceSecurityProfileRow } from "./data";

export interface FenceDraft {
  name: string | null;
  layout: "open_run" | "closed_perimeter" | null;
  totalLength: number | null;
  securityProfileId: string | null;
  gates: { type: FenceGateInput["type"]; width_m: number }[];
  documentNotes: string[];
  /** Set when the model named a "what's being protected" description that
   *  didn't match any of the tenant's real profiles -- shown to the rep so
   *  they know to pick one manually instead of it silently defaulting. */
  unmatchedProfileText: string | null;
}

const GATE_TYPES = new Set(["single_swing", "double_swing", "sliding"]);

function buildSpec(profiles: FenceSecurityProfileRow[]): ObjectSpec {
  const profileHint =
    profiles.length > 0
      ? `Which ONE of these exactly matches what's being protected -- copy the label verbatim, or leave blank if none clearly fit: ${profiles.map((p) => `"${p.label}"`).join(", ")}`
      : "A short description of what's being protected (e.g. \"bonded warehouse\", \"vehicle yard\") -- leave blank if unclear.";

  return {
    id: "fence_projects" as unknown as ImportObjectId,
    label: "fence project",
    icon: "⌗",
    description: "A configured fence run drafted from a client email",
    dependsOn: [],
    sampleRows: [],
    fields: [
      { key: "name", label: "Name", type: "text", hint: "A short name for the project -- the site or yard name mentioned, if any", required: false },
      { key: "layout", label: "Layout", type: "enum", hint: 'Either "open_run" (a single straight run) or "closed_perimeter" (a full boundary around a site) -- infer from context', required: true },
      { key: "total_length_m", label: "Total length (m)", type: "text", hint: "Total fence length in meters, as a plain number with no units or commas", required: true },
      { key: "security_profile", label: "What's being protected", type: "text", hint: profileHint, required: false },
      { key: "gate_type", label: "Gate type", type: "enum", hint: 'One of "single_swing", "double_swing", "sliding" -- default to "double_swing" if a vehicle gate is mentioned without a type', required: true, scope: "line" },
      { key: "gate_width_m", label: "Gate width (m)", type: "text", hint: "Gate width in meters, as a plain number", required: true, scope: "line" },
    ],
  };
}

function matchProfileLabel(text: string, profiles: FenceSecurityProfileRow[]): string | null {
  const norm = text.trim().toLowerCase();
  if (!norm) return null;
  const hit = profiles.find((p) => p.label.trim().toLowerCase() === norm);
  return hit?.id ?? null;
}

export async function draftFenceProject(text: string, profiles: FenceSecurityProfileRow[]): Promise<FenceDraft> {
  const spec = buildSpec(profiles);
  const { rows, documentNotes } = await extractRowsFromDocument(spec, { kind: "text", text }, "pasted email");

  if (rows.length === 0) {
    return { name: null, layout: null, totalLength: null, securityProfileId: null, gates: [], documentNotes, unmatchedProfileText: null };
  }

  const header = rows[0].values;
  const layoutRaw = header.layout?.trim();
  const layout = layoutRaw === "open_run" || layoutRaw === "closed_perimeter" ? layoutRaw : null;
  const lengthNum = Number(header.total_length_m);
  const totalLength = Number.isFinite(lengthNum) && lengthNum > 0 ? lengthNum : null;

  const profileText = header.security_profile?.trim() ?? "";
  const securityProfileId = matchProfileLabel(profileText, profiles);

  const gates = rows
    .map((r) => {
      const type = GATE_TYPES.has(r.values.gate_type) ? (r.values.gate_type as FenceGateInput["type"]) : null;
      const width = Number(r.values.gate_width_m);
      return type && Number.isFinite(width) && width > 0 ? { type, width_m: width } : null;
    })
    .filter((g): g is { type: FenceGateInput["type"]; width_m: number } => g !== null);

  return {
    name: header.name?.trim() || null,
    layout,
    totalLength,
    securityProfileId,
    gates,
    documentNotes,
    unmatchedProfileText: profileText && !securityProfileId ? profileText : null,
  };
}
