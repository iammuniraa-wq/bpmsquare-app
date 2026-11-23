// How a screen asks the AI slider to analyse a company. The slider owns the conversation, the consent chips and the
// card (docs/design/account-analysis.md 3); a screen only raises one event with a prepared question, the same way the
// Account 360 drawer is opened (nova:open-account-360). Client-safe and pure apart from the dispatch.

export const AI_DOCK_ASK_EVENT = "bpm:ai-dock-ask";

export type DockAskDetail = {
  /** The prepared question the slider sends as if the person had typed it. */
  question: string;
  /** The account the question is about, when there is one, so the slider can send it as the open record. */
  accountId: string | null;
  /** A company brief request of its own (Refresh, Try the missing parts): the slider answers it with the chip or the saved brief and no model. */
  report?: { account_id?: string; lead_id?: string; name?: string; domain?: string; country?: string; refresh?: boolean; retry?: boolean };
};

/** "Analyse Najd Precast" when nothing is saved; "Refresh the analysis of Najd Precast" when a card exists and the person wants new facts. */
export const analyseQuestion = (name: string, refresh = false): string => {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 120);
  return refresh ? `Refresh the analysis of ${n}` : `Analyse ${n}`;
};

export function askDock(question: string, accountId: string | null, report?: DockAskDetail["report"]): void {
  if (typeof window === "undefined") return;
  const detail: DockAskDetail = { question, accountId, ...(report ? { report } : {}) };
  window.dispatchEvent(new CustomEvent<DockAskDetail>(AI_DOCK_ASK_EVENT, { detail }));
}

export const askDockToAnalyse = (name: string, accountId: string | null, refresh = false): void => askDock(analyseQuestion(name, refresh), accountId);

/** The two platform-admin switches the ability hangs off. The server decides again on every call; this only hides a button. */
export const canAnalyse = (features: { ai_assistant?: boolean; ai_assistant_web?: boolean } | null | undefined): boolean =>
  features?.ai_assistant === true && features?.ai_assistant_web === true;

/** "Company brief on Najd Precast": the prepared question, and for an account the brief request itself, so the slider asks (or shows the saved brief) with no model. */
export const briefQuestion = (name: string): string => `Company report on ${name.replace(/\s+/g, " ").trim().slice(0, 120)}`;

export const askDockForBrief = (name: string, accountId: string | null, o: { refresh?: boolean; retry?: boolean } = {}): void =>
  askDock(
    o.retry ? `Try the missing parts of the brief on ${name.replace(/\s+/g, " ").trim().slice(0, 120)}` : o.refresh ? `Refresh the report on ${name.replace(/\s+/g, " ").trim().slice(0, 120)}` : briefQuestion(name),
    accountId,
    accountId ? { account_id: accountId, ...(o.refresh ? { refresh: true } : {}), ...(o.retry ? { retry: true } : {}) } : undefined,
  );
