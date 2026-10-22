// How a screen asks the AI slider to analyse a company. The slider owns the conversation, the consent chips and the
// card (docs/design/account-analysis.md 3); a screen only raises one event with a prepared question, the same way the
// Account 360 drawer is opened (nova:open-account-360). Client-safe and pure apart from the dispatch.

export const AI_DOCK_ASK_EVENT = "bpm:ai-dock-ask";

export type DockAskDetail = {
  /** The prepared question the slider sends as if the person had typed it. */
  question: string;
  /** The account the question is about, when there is one, so the slider can send it as the open record. */
  accountId: string | null;
};

/** "Analyse Najd Precast" when nothing is saved; "Refresh the analysis of Najd Precast" when a card exists and the person wants new facts. */
export const analyseQuestion = (name: string, refresh = false): string => {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 120);
  return refresh ? `Refresh the analysis of ${n}` : `Analyse ${n}`;
};

export function askDock(question: string, accountId: string | null): void {
  if (typeof window === "undefined") return;
  const detail: DockAskDetail = { question, accountId };
  window.dispatchEvent(new CustomEvent<DockAskDetail>(AI_DOCK_ASK_EVENT, { detail }));
}

export const askDockToAnalyse = (name: string, accountId: string | null, refresh = false): void => askDock(analyseQuestion(name, refresh), accountId);

/** The two platform-admin switches the ability hangs off. The server decides again on every call; this only hides a button. */
export const canAnalyse = (features: { ai_assistant?: boolean; ai_assistant_web?: boolean } | null | undefined): boolean =>
  features?.ai_assistant === true && features?.ai_assistant_web === true;
