import { WORKCENTERS, type WorkcenterKey } from "@/lib/workcenters";
import type { Control, HiddenControl, ScreenAccess, ScreenField, ScreenManifest, ScreenTab, VisibleScreen } from "./types";

// What a manifest may reveal to one person. The same gates the sidebar, the Settings menu and the palette use run
// before anything reaches the prompt: a control the caller cannot use is not offered to the model as something to
// point at; it comes back as "not available, and why", and nothing else about it (docs/design/assistant-smarter.md 1.4).

const wcLabel = (wc: WorkcenterKey) => WORKCENTERS.find((w) => w.key === wc)?.label ?? wc;
const featureLabel = (key: string) => key.replace(/_/g, " ");

/** Whether the person may open the screen at all. */
function screenAllowed(m: ScreenManifest, a: ScreenAccess): boolean {
  if (m.featureKey && a.features[m.featureKey] !== true) return false;
  if (m.featureAnyOf && !m.featureAnyOf.some((k) => a.features[k] === true)) return false;
  if (m.hiddenWhenFeature && a.features[m.hiddenWhenFeature] === true) return false;
  if (m.workcenter && !a.canView(m.workcenter)) return false;
  if (m.adminOnly && !a.isAdmin && !(m.editWorkcenter && a.canEdit(m.editWorkcenter))) return false;
  return true;
}

function controlBlock(c: Control, m: ScreenManifest, a: ScreenAccess): { reason: string; alternative: string } | null {
  if (c.featureKey && a.features[c.featureKey] !== true) {
    return { reason: `the ${featureLabel(c.featureKey)} module is not switched on for this workspace`, alternative: "Ask an admin about adding the module." };
  }
  const wc = c.workcenter ?? m.workcenter;
  if (c.workcenter && !a.canView(c.workcenter)) {
    return { reason: `your role has no access to ${wcLabel(c.workcenter)}`, alternative: "Ask an admin to change your role." };
  }
  if (c.needs === "admin" && !a.isAdmin) return { reason: "only an admin can use it", alternative: "Ask an admin." };
  if (c.needs === "create" || c.needs === "edit") {
    const allowed = wc ? (c.needs === "create" ? a.canCreate(wc) : a.canEdit(wc)) : a.isAdmin;
    if (!allowed) {
      return { reason: wc ? `your role has no ${c.needs} grant on ${wcLabel(wc)}` : `it needs the ${c.needs} grant`, alternative: "Ask an admin to change your role." };
    }
  }
  return null;
}

/** The manifest as this caller may see it: the screen itself, the usable controls and tabs, the rest named with a reason. */
export function applyAccess(m: ScreenManifest, fields: ScreenField[], a: ScreenAccess): VisibleScreen | null {
  if (!screenAllowed(m, a)) return null;

  const hidden: HiddenControl[] = [];
  const blocked = new Map<string, { reason: string; alternative: string }>();
  for (const c of m.controls) {
    const b = controlBlock(c, m, a);
    if (b) blocked.set(c.id, b);
  }
  // A control inside a menu that is itself unavailable is unavailable for the same reason.
  for (const c of m.controls) {
    if (!blocked.has(c.id) && c.within && blocked.has(c.within)) blocked.set(c.id, blocked.get(c.within)!);
  }
  const controls = m.controls.filter((c) => {
    const b = blocked.get(c.id);
    if (b) hidden.push({ id: c.id, label: c.label, reason: b.reason, alternative: b.alternative });
    return !b;
  });
  const tabs: ScreenTab[] | undefined = m.tabs?.filter((t) => !t.featureKey || a.features[t.featureKey] === true);
  // A control that sits on a tab the workspace does not have cannot be pointed at either.
  const tabIds = tabs ? new Set(tabs.map((t) => t.id)) : null;
  const usable = controls.filter((c) => !(c.tab && tabIds && !tabIds.has(c.tab)));

  return { manifest: { ...m, controls: usable, tabs }, fields, hidden };
}

// ── What goes into the prompt ───────────────────────────────────────────────────────────────────────────────

/** Roughly 2 000 tokens: the upper end of the 0.8 to 2 k the design allows for one screen. */
export const MAX_BLOCK_CHARS = 8000;

/**
 * Tenant-typed text (a custom field's label) and hand-written text both pass through here. A manifest is data for the
 * model to read, so it cannot carry markup that would close the wrapper tag, line breaks that start a new "rule", or
 * an unbounded string.
 */
export function cleanText(s: unknown, max = 160): string {
  const plain = [...String(s ?? "").replace(/[<>`]/g, "")].map((ch) => { const n = ch.charCodeAt(0); return n < 32 || n === 127 || n === 0x2028 || n === 0x2029 ? " " : ch; }).join("");
  const t = plain.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function renderScreenBlock(v: VisibleScreen, max = MAX_BLOCK_CHARS): string {
  const m = v.manifest;
  const lines: string[] = [];
  let used = 0;
  const push = (line: string, reserve = 0): boolean => {
    if (used + line.length + 1 > max - reserve) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };

  push(`Screen ${cleanText(m.id, 60)}: ${cleanText(m.title, 80)}. ${cleanText(m.purpose)}`);
  if (m.prerequisites?.length) push(`Needs: ${m.prerequisites.map((p) => cleanText(p)).join("; ")}`);
  if (m.tabs?.length) {
    push("TABS (id | label | what):");
    for (const t of m.tabs) if (!push(`- ${cleanText(t.id, 40)} | ${cleanText(t.label, 40)} | ${cleanText(t.what, 100)}`)) break;
  }
  if (m.controls.length) {
    push("CONTROLS you may point a person at (id | label | what it does):");
    for (const c of m.controls) {
      const where = [c.tab ? `on tab ${cleanText(c.tab, 30)}` : "", c.within ? `inside ${cleanText(c.within, 40)}` : ""].filter(Boolean).join(", ");
      if (!push(`- ${cleanText(c.id, 60)} | ${cleanText(c.label, 60)} | ${cleanText(c.does, 120)}${where ? ` (${where})` : ""}`)) break;
    }
  }
  if (v.hidden.length) {
    push("NOT AVAILABLE to this person (never point at these; say why and give the alternative):");
    for (const h of v.hidden) if (!push(`- ${cleanText(h.id, 60)} | ${cleanText(h.label, 60)}: ${cleanText(h.reason, 100)}. ${cleanText(h.alternative ?? "", 60)}`)) break;
  }
  if (m.tasks.length) {
    const usable = new Set(m.controls.map((c) => c.id));
    const blocked = new Map(v.hidden.map((h) => [h.id, h.reason]));
    push("TASKS (common jobs, as ordered steps):");
    for (const t of m.tasks) {
      const steps = t.steps.map((s, i) => {
        const note = s.control && blocked.has(s.control) ? ` [not available: ${cleanText(blocked.get(s.control), 60)}]` : s.control && !usable.has(s.control) && !s.control.includes(".field.") ? " [not on this workspace]" : "";
        return `${i + 1}. ${s.control ? `[${cleanText(s.control, 60)}] ` : ""}${cleanText(s.text, 140)}${note}`;
      });
      if (!push(`- ${cleanText(t.id, 40)}: ${cleanText(t.label, 80)}`)) break;
      for (const st of steps) if (!push(`  ${st}`)) break;
    }
  }
  if (v.fields.length) {
    // Last and cut first when the block is full: the fields are the part that grows with the tenant's own customisation.
    const required = v.fields.filter((f) => f.required);
    push(`FIELDS of this screen (${v.fields.length}; id is ${m.objectType ?? "object"}.field.KEY; * = required, custom = added by this workspace):`);
    let shown = 0;
    for (const f of [...required, ...v.fields.filter((f) => !f.required)]) {
      // Room is kept back for the closing "more" line.
      if (!push(`- ${cleanText(f.key, 40)} | ${cleanText(f.label, 60)}${f.required ? " *" : ""}${f.custom ? " (custom)" : ""} | ${cleanText(f.section, 40)}`, 80)) break;
      shown++;
    }
    if (shown < v.fields.length) push(`- ... ${v.fields.length - shown} more fields not listed`);
  }
  return `<screen_guide>\n${lines.join("\n")}\n</screen_guide>`;
}

/** What the volatile block says on a page the assistant has no manifest for. */
export const NO_SCREEN_KNOWLEDGE = "No screen knowledge for this page: answer from the capability list, offer navigate, and do not claim to know its buttons.";
