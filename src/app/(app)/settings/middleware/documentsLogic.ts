import type { DocumentPatch, DocumentView } from "./api";

// The pure parts of the link panel: what the person has changed since the last save,
// whether it may be saved, and the words for the status dot. There is no "when" and no
// automatic/manual choice (round 2): a quote goes only when it is awarded, and a
// rejected one never leaves.

export type DocDraft = {
  target: string;
  include: Record<string, boolean>;
  /** The fallback price list ("If the customer has none"); "" = none chosen. */
  priceList: string;
};

export function draftFromDocument(d: DocumentView, priceList: string = d.fallbackPriceListId ?? ""): DocDraft {
  return {
    target: d.target.key,
    include: Object.fromEntries(d.include.map((i) => [i.key, i.on])),
    priceList,
  };
}

export const priceListChanged = (storedPriceList: string | null | undefined, draft: DocDraft): boolean => (storedPriceList ?? "") !== draft.priceList;

/** Only what differs from the stored document; an unchanged panel sends nothing. The fallback price list is one of its settings. */
export function draftPatch(d: DocumentView, draft: DocDraft, storedPriceList: string | null | undefined = d.fallbackPriceListId): DocumentPatch {
  const patch: DocumentPatch = {};
  if (draft.target !== d.target.key) patch.target = draft.target;
  const include: Record<string, boolean> = {};
  for (const i of d.include) if (i.allowed && draft.include[i.key] !== undefined && draft.include[i.key] !== i.on) include[i.key] = draft.include[i.key];
  if (Object.keys(include).length) patch.include = include;
  if (priceListChanged(storedPriceList, draft)) patch.fallbackPriceListId = draft.priceList || null;
  return patch;
}

export const isDraftDirty = (d: DocumentView, draft: DocDraft, storedPriceList: string | null | undefined = d.fallbackPriceListId): boolean =>
  Object.keys(draftPatch(d, draft, storedPriceList)).length > 0;

/** The one reason a save is refused before asking, or null. Said in the panel, not hidden. */
export function draftProblem(d: DocumentView, draft: DocDraft): string | null {
  const t = d.targets.find((x) => x.key === draft.target);
  if (t && !t.available) return t.hint ?? "That is not available for this ERP yet.";
  return null;
}

/** The fallback price list line is for a Dynamics Quote or Sales Order only. The server's own word wins when it gave one for the stored target. */
export const showsFallbackPriceList = (productKey: string | null | undefined, targetKey: string, doc?: Pick<DocumentView, "showFallbackPriceList" | "target">): boolean =>
  doc && doc.showFallbackPriceList !== null && doc.target.key === targetKey
    ? doc.showFallbackPriceList
    : productKey === "dataverse" && (targetKey === "quote" || targetKey === "sales_order");

export type DocStatus = "off" | "ok" | "attention";
/** Grey = switched off, green = on and the ERP is connected, amber = on but nowhere to send. */
export function documentStatus(d: Pick<DocumentView, "enabled">, connected: boolean): DocStatus {
  if (!d.enabled) return "off";
  return connected ? "ok" : "attention";
}
export const STATUS_WORD: Record<DocStatus, string> = { off: "Off", ok: "On", attention: "Not connected" };

/** Whether the "Links" set-up tick may be on: the document is on and was saved once. */
export const documentsConfirmed = (docs: readonly DocumentView[] | null | undefined): boolean =>
  !!docs && docs.some((d) => d.enabled && !!d.confirmedAt);

/** The dropdown's choices: an unavailable one stays visible but disabled, with its one-line hint. */
export function targetOptions(d: DocumentView): { key: string; label: string; disabled: boolean; hint: string | null }[] {
  return d.targets.map((t) => ({ key: t.key, label: t.label, disabled: !t.available, hint: t.available ? null : t.hint }));
}
