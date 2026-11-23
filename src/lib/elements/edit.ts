import { cleanElementCode, cleanTypeCode } from "./pattern";
import { cleanQty } from "./quantity";
import { ELEMENT_LIMITS } from "./types";

// A change to one line's element fields (the element panel), pure: what a request may say and what is refused. The routes apply it.

export type ElementEdit = {
  element_type?: string | null;
  element_code?: string | null;
  model_qty?: number | null;
  /** Project only: put the model quantity into the budget quantity ("Budget uses: Model"). */
  accept_model?: boolean;
  /** Project only: put the client quantity back into the budget quantity ("Budget uses: Client"). */
  use_client?: boolean;
};

export type ParsedEdit = { ok: true; edit: ElementEdit } | { ok: false; error: string };

const blank = (v: unknown) => v === null || v === "";

/**
 * `types` is the set of ACTIVE element types of the workspace. A line may keep a type that was switched off since (codes already issued stay
 * valid), so the current one is passed in `keep`.
 */
export function parseElementEdit(body: unknown, opts: { codeMax?: number; types: ReadonlySet<string>; keep?: string | null }): ParsedEdit {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const edit: ElementEdit = {};
  if ("element_type" in b) {
    if (blank(b.element_type)) edit.element_type = null;
    else {
      const t = cleanTypeCode(b.element_type);
      if (!t) return { ok: false, error: "An element type is 2 to 5 letters or digits" };
      if (!opts.types.has(t) && t !== opts.keep) return { ok: false, error: `${t} is not in your Element types list. Add it in Settings, Contract projects` };
      edit.element_type = t;
    }
  }
  if ("element_code" in b) {
    if (blank(b.element_code)) edit.element_code = null;
    else {
      const c = cleanElementCode(b.element_code, opts.codeMax ?? ELEMENT_LIMITS.codeMaxDefault);
      if (!c.ok) return { ok: false, error: c.error };
      edit.element_code = c.code;
    }
  }
  if ("model_qty" in b) {
    if (blank(b.model_qty)) edit.model_qty = null;
    else {
      const q = cleanQty(b.model_qty, ELEMENT_LIMITS.qtyMax);
      if (q === null) return { ok: false, error: "The model quantity must be a number of 0 or more" };
      edit.model_qty = q;
    }
  }
  if (b.accept_model === true) edit.accept_model = true;
  if (b.use_client === true) edit.use_client = true;
  if (edit.accept_model && edit.use_client) return { ok: false, error: "Choose the model quantity or the client quantity, not both" };
  if (Object.keys(edit).length === 0) return { ok: false, error: "Nothing to change" };
  return { ok: true, edit };
}

export type EditTarget = {
  element_type: string | null;
  element_code: string | null;
  model_qty: number | null;
  is_category: boolean;
  /** The line is split across buildings. */
  mixed: boolean;
  /** The line sits in a building at all. */
  building_code: string | null;
};

/** The reason an edit cannot be made on this line, else null. */
export function editProblem(line: EditTarget, edit: ElementEdit): string | null {
  const touchesElement = "element_type" in edit || "element_code" in edit;
  if (line.is_category && touchesElement) return "A cost line has no element code of its own: it takes it from its contract line";
  if (touchesElement && line.mixed && (edit.element_type || edit.element_code)) return "An element belongs to one building. Put the line in one building first";
  const nextCode = "element_code" in edit ? edit.element_code ?? null : line.element_code;
  if ("element_type" in edit && (edit.element_type ?? null) !== line.element_type && line.element_code && nextCode === line.element_code) {
    return `${line.element_code} was issued for ${line.element_type ?? "another type"}. Clear the code first, then change the type`;
  }
  if (("accept_model" in edit || "use_client" in edit) && edit.accept_model && (edit.model_qty ?? line.model_qty) === null) return "There is no model quantity to accept yet";
  return null;
}
