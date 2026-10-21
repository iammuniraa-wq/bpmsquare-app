import { ACTIVATE_BODY, closeActionBody, hasMarker } from "./payload";
import type { Outcome } from "./types";

// The Dataverse quote lifecycle as a resumable sequence of small steps, over a
// minimal HTTP interface (D365Client satisfies it; the tests use a fake
// Dataverse). Every step reads where the quote is NOW, so a retry after a
// failure in the middle continues instead of creating a twin.
//
//   Draft (statecode 0) -> activate -> Active (1) -> WinQuote -> Won (2)
//                                                 -> CloseQuote -> Closed (3)

export interface ErpHttp {
  requestRaw(method: string, pathOrUrl: string, init?: { query?: Record<string, string | undefined>; body?: unknown; headers?: Record<string, string> }): Promise<{ json: unknown; headers: Headers; status: number }>;
  get(pathOrUrl: string, query?: Record<string, string | undefined>, headers?: Record<string, string>): Promise<unknown>;
  create(entitySet: string, body: Record<string, unknown>): Promise<{ row: Record<string, unknown>; entityId: string | null; status?: number }>;
}

export type ErpStep = "find" | "create" | "activate" | "close";

/** An error tagged with the step it happened in. */
export class ErpStepError extends Error {
  constructor(readonly step: ErpStep, readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

export function asStepError(step: ErpStep, e: unknown): ErpStepError {
  if (e instanceof ErpStepError) return e;
  const x = e as { status?: number; message?: string; code?: string };
  return new ErpStepError(step, x.status ?? 0, x.message ?? "Unexpected error", x.code);
}

export type DataverseQuoteState = {
  quoteId: string;
  quoteNumber: string | null;
  statecode: number;
  statuscode: number | null;
  total: number | null;
  name: string | null;
  description: string | null;
};

function toState(row: Record<string, unknown>): DataverseQuoteState | null {
  const id = typeof row.quoteid === "string" ? row.quoteid : null;
  if (!id) return null;
  return {
    quoteId: id,
    quoteNumber: typeof row.quotenumber === "string" ? row.quotenumber : null,
    statecode: typeof row.statecode === "number" ? row.statecode : 0,
    statuscode: typeof row.statuscode === "number" ? row.statuscode : null,
    total: typeof row.totalamount === "number" ? row.totalamount : null,
    name: typeof row.name === "string" ? row.name : null,
    description: typeof row.description === "string" ? row.description : null,
  };
}

const STATE_SELECT = "quoteid,quotenumber,statecode,statuscode,totalamount,name,description";

export async function getQuoteState(http: ErpHttp, quoteId: string): Promise<DataverseQuoteState | null> {
  try {
    const row = (await http.get(`quotes(${quoteId})`, { $select: STATE_SELECT })) as Record<string, unknown> | null;
    return row ? toState({ quoteid: quoteId, ...row }) : null;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw asStepError("find", e);
  }
}

/** The quote this BPMSquare quote already is in Dataverse, found again by the marker
 *  written into its description (the quote's own id). Catches the case where Dataverse
 *  took the quote but our link was not saved. The ref only narrows the search: two
 *  workspaces sharing one Dataverse environment can both own an SQ-0003, and adopting
 *  the other's quote would close the wrong customer's document. */
export async function findQuoteByRef(http: ErpHttp, ref: string, docId: string): Promise<DataverseQuoteState | null> {
  const safe = ref.replace(/'/g, "''");
  try {
    const page = (await http.get("quotes", { $select: STATE_SELECT, $filter: `startswith(name,'${safe} ')`, $top: "50" })) as { value?: Record<string, unknown>[] } | null;
    const row = (page?.value ?? []).find((r) => hasMarker(r.description, docId));
    return row ? toState(row) : null;
  } catch (e) {
    throw asStepError("find", e);
  }
}

export type SendResult = {
  quoteId: string;
  quoteNumber: string | null;
  total: number | null;
  created: boolean;
  /** Plain steps that ran, for the message summary. */
  steps: string[];
  /** The ERP quote was already in the final state; nothing was sent. */
  alreadyDone: boolean;
};

/**
 * Take a Dataverse quote to its outcome.
 *
 * @param existing  the quote this BPMSquare quote already is in Dataverse (from
 *                  connector_links), if any -- the sequence resumes from its state
 * @param create    the deep-insert body, used only when there is no quote yet
 * @param onCreated called as soon as the quote exists, BEFORE activating it, so
 *                  the caller can save the link while the ERP quote is still a draft
 */
export async function sendDataverseQuote(
  http: ErpHttp,
  a: { ref: string; /** the BPMSquare quote id behind the marker; null = nothing can be adopted (the test quote) */ docId: string | null; outcome: Outcome; existingId: string | null; create: Record<string, unknown>; onCreated: (s: DataverseQuoteState) => Promise<void> },
): Promise<SendResult> {
  const steps: string[] = [];
  let state: DataverseQuoteState | null = null;
  let created = false;

  if (a.existingId) {
    state = await getQuoteState(http, a.existingId);
    if (state) steps.push("Found the quote already in Dynamics.");
  }
  if (!state && a.docId) {
    state = await findQuoteByRef(http, a.ref, a.docId);
    if (state) {
      steps.push("Found the quote already in Dynamics.");
      await a.onCreated(state);
    }
  }
  if (!state) {
    try {
      const { row, entityId } = await http.create("quotes", a.create);
      const withId = { quoteid: row.quoteid ?? entityId, ...row };
      state = toState(withId);
      if (!state) throw new ErpStepError("create", 0, "Dynamics did not return the new quote's id");
    } catch (e) {
      throw asStepError("create", e);
    }
    created = true;
    steps.push("Created the quote with its lines.");
    await a.onCreated(state);
  }

  // Already closed one way or the other.
  if (state.statecode === 2) {
    if (a.outcome === "awarded") return { quoteId: state.quoteId, quoteNumber: state.quoteNumber, total: state.total, created, steps: [...steps, "It was already marked Won."], alreadyDone: !created && steps.length === 1 };
    throw new ErpStepError("close", 409, "The quote is already Won in Dynamics, so it cannot be closed as Lost.");
  }
  if (state.statecode === 3) {
    if (a.outcome === "rejected") return { quoteId: state.quoteId, quoteNumber: state.quoteNumber, total: state.total, created, steps: [...steps, "It was already closed as Lost."], alreadyDone: !created && steps.length === 1 };
    throw new ErpStepError("close", 409, "The quote is already closed as Lost in Dynamics, so it cannot be marked Won.");
  }

  if (state.statecode === 0) {
    try {
      await http.requestRaw("PATCH", `quotes(${state.quoteId})`, { body: { ...ACTIVATE_BODY } });
    } catch (e) {
      throw asStepError("activate", e);
    }
    steps.push("Made the quote Active.");
    state = { ...state, statecode: 1, statuscode: 2 };
  }

  const act = closeActionBody(state.quoteId, a.ref, a.outcome);
  try {
    await http.requestRaw("POST", act.action, { body: act.body });
  } catch (e) {
    throw asStepError("close", e);
  }
  steps.push(a.outcome === "awarded" ? "Marked the quote Won." : "Closed the quote as Lost.");
  return { quoteId: state.quoteId, quoteNumber: state.quoteNumber, total: state.total, created, steps, alreadyDone: false };
}
