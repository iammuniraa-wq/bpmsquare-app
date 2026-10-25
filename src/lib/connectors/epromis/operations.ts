import { EpromisCallError, definition, send, secretsOf, type Creds, type EpromisDeps, DEFAULT_MAX_PAGES, DEFAULT_MAX_ROWS } from "./client";
import { applyTemplate, getPath, setPath } from "./jsonPath";
import { redactSecrets } from "./redact";
import {
  EPROMIS_OPERATION_LABEL, MASTER_OPERATION,
  type BudgetPayload, type CreateResult, type EpResult, type EpromisConfig, type EpromisOperation, type EpromisTestResult, type FlagValue,
  type MasterKind, type MasterPull, type MasterRow, type ProjectInfo, type ProjectPayload,
} from "./types";

// The operations the rest of BPMSquare calls. Each takes the connection (config + unsealed credential) and the
// normalised input, and answers a normalised EpResult: never a thrown error, never a vendor shape. An operation whose
// path is not in the endpoint map answers "Not configured" in plain words.

export type Connection = { cfg: EpromisConfig; creds: Creds };

const notConfigured = (op: EpromisOperation): EpResult<never> => ({
  ok: false, state: "not_configured",
  message: `Not configured: the ${EPROMIS_OPERATION_LABEL[op].toLowerCase()} address is not set. It is filled in once the ePROMIS API documentation is available (Settings > Connectors > ePROMIS).`,
});

function failure(e: unknown, conn: Connection): EpResult<never> {
  if (e instanceof EpromisCallError) return { ok: false, state: "error", message: e.message, ...(e.status ? { status: e.status } : {}) };
  const msg = redactSecrets((e as Error)?.message ?? "Something went wrong.", secretsOf(conn.cfg, conn.creds)).slice(0, 240);
  return { ok: false, state: "error", message: msg };
}

const scalar = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

const flagValue = (v: unknown): FlagValue => {
  if (typeof v === "string") return v.slice(0, 200);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  return null;
};

// ── Test ────────────────────────────────────────────────────────────────────

/**
 * With a ping path set, one authenticated call to it decides. Without one, an authenticated HEAD (then GET) of the base
 * address says whether the host answers and whether it refuses the credential; a plain 404 or 405 there is normal for an
 * API and is reported as "reached, credential not checked".
 */
export async function testConnection(conn: Connection, deps: EpromisDeps = {}): Promise<EpromisTestResult> {
  const ping = definition(conn.cfg, "ping");
  try {
    if (ping) {
      const r = await send(conn.cfg, conn.creds, { method: ping.method, path: ping.path }, deps);
      return { ok: true, verified: true, line: `Connected. ePROMIS answered the test address (${r.status}).`, failures: [] };
    }
    let status: number;
    try {
      status = (await send(conn.cfg, conn.creds, { method: "HEAD", path: "" }, deps)).status;
    } catch (e) {
      if (!(e instanceof EpromisCallError) || e.kind !== "http" || (e.status !== 405 && e.status !== 501 && e.status !== 404)) throw e;
      try {
        status = (await send(conn.cfg, conn.creds, { method: "GET", path: "" }, deps)).status;
      } catch (e2) {
        if (e2 instanceof EpromisCallError && e2.kind === "http" && (e2.status === 404 || e2.status === 405)) {
          return {
            ok: true, verified: false,
            line: `Reached ePROMIS: the address answers, but its front page says ${e2.status}, which is normal for an API. The credential is checked once a test address is set.`,
            failures: [],
          };
        }
        throw e2;
      }
    }
    return { ok: true, verified: true, line: `Connected. ePROMIS answered the base address (${status}) with the sign-in sent.`, failures: [] };
  } catch (e) {
    const f = failure(e, conn);
    const message = f.ok ? "The test failed." : f.message;
    return { ok: false, verified: false, line: message, failures: [{ label: "Connection", fix: message }] };
  }
}

// ── Reference lists ─────────────────────────────────────────────────────────

/** One page worth of rows from an answer, mapped. Rows with no code are counted, not guessed. */
function mapRows(json: unknown, rowsPath: string, fields: Record<string, string>, flags: Record<string, string>): { rows: MasterRow[]; skipped: number } {
  const raw = rowsPath ? getPath(json, rowsPath) : json;
  if (!Array.isArray(raw)) return { rows: [], skipped: 0 };
  const rows: MasterRow[] = [];
  let skipped = 0;
  for (const item of raw) {
    const code = scalar(getPath(item, fields.code));
    if (!code) { skipped++; continue; }
    const parent = fields.parent_code ? scalar(getPath(item, fields.parent_code)) : null;
    const out: Record<string, FlagValue> = {};
    for (const [name, path] of Object.entries(flags)) out[name] = flagValue(getPath(item, path));
    rows.push({ code, name: (fields.name ? scalar(getPath(item, fields.name)) : null) ?? code, parent_code: parent, flags: out });
  }
  return { rows, skipped };
}

/** Read a reference list (tenders, Resource Master, Cost Codes, justifications) as {code, name, parent_code, flags}. */
export async function pullMasters(conn: Connection, kind: MasterKind, deps: EpromisDeps = {}): Promise<EpResult<MasterPull>> {
  const op = MASTER_OPERATION[kind];
  const def = definition(conn.cfg, op);
  if (!def) return notConfigured(op);
  if (!def.fields?.code) {
    return { ok: false, state: "not_configured", message: `Not configured: the ${EPROMIS_OPERATION_LABEL[op].toLowerCase()} has an address but no field for the code. Map "code" to the field that holds it.` };
  }
  const fields = def.fields;
  const flags = def.flags ?? {};
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const maxRows = deps.maxRows ?? DEFAULT_MAX_ROWS;
  const rows: MasterRow[] = [];
  let skipped = 0;
  let pages = 0;
  let truncated = false;
  let next: string | null = null;
  const seen = new Set<string>();
  try {
    for (;;) {
      const r: Awaited<ReturnType<typeof send>> = await send(conn.cfg, conn.creds, next ? { method: def.method, path: def.path, absoluteUrl: next } : { method: def.method, path: def.path }, deps);
      pages++;
      const page = mapRows(r.json, def.rows_path ?? "", fields, flags);
      rows.push(...page.rows);
      skipped += page.skipped;
      if (rows.length >= maxRows) { rows.length = maxRows; truncated = true; break; }
      const link = def.next_path ? scalar(getPath(r.json, def.next_path)) : null;
      if (!link) break;
      // The same link twice is a loop, and past the page cap the rest is left (truncated says so).
      if (seen.has(link)) break;
      seen.add(link);
      if (pages >= maxPages) { truncated = true; break; }
      next = link;
    }
  } catch (e) {
    return failure(e, conn);
  }
  return { ok: true, data: { rows, skipped, pages, truncated } };
}

// ── Projects and budgets ────────────────────────────────────────────────────

export async function getProject(conn: Connection, code: string, deps: EpromisDeps = {}): Promise<EpResult<ProjectInfo | null>> {
  const def = definition(conn.cfg, "get_project");
  if (!def) return notConfigured("get_project");
  if (!def.fields?.code) return { ok: false, state: "not_configured", message: 'Not configured: the project read has an address but no field for the code. Map "code" to the field that holds it.' };
  try {
    const r = await send(conn.cfg, conn.creds, { method: def.method, path: def.path, vars: { code } }, deps);
    const root = def.rows_path ? getPath(r.json, def.rows_path) : r.json;
    const found = Array.isArray(root) ? root[0] : root;
    if (found === null || found === undefined || typeof found !== "object") return { ok: true, data: null };
    const pcode = scalar(getPath(found, def.fields.code));
    if (!pcode) return { ok: true, data: null };
    const flags: Record<string, FlagValue> = {};
    for (const [name, path] of Object.entries(def.flags ?? {})) flags[name] = flagValue(getPath(found, path));
    return { ok: true, data: { code: pcode, name: (def.fields.name ? scalar(getPath(found, def.fields.name)) : null) ?? pcode, flags, id: def.fields.id ? scalar(getPath(found, def.fields.id)) : null } };
  } catch (e) {
    // A project that does not exist is an answer, not an error.
    if (e instanceof EpromisCallError && e.kind === "http" && e.status === 404) return { ok: true, data: null };
    return failure(e, conn);
  }
}

function fillBody(body: Record<string, string>, values: Record<string, unknown>, into: Record<string, unknown>): void {
  for (const [path, template] of Object.entries(body)) {
    const v = applyTemplate(template, values);
    if (v !== undefined) setPath(into, path, v);
  }
}

export async function createProject(conn: Connection, payload: ProjectPayload, deps: EpromisDeps = {}): Promise<EpResult<CreateResult>> {
  const def = definition(conn.cfg, "create_project");
  if (!def) return notConfigured("create_project");
  if (!def.body) return { ok: false, state: "not_configured", message: "Not configured: the project create has an address but no body. Say which ePROMIS field takes each value." };
  const body: Record<string, unknown> = {};
  fillBody(def.body, payload as unknown as Record<string, unknown>, body);
  try {
    const r = await send(conn.cfg, conn.creds, { method: def.method, path: def.path, vars: payload as unknown as Record<string, unknown>, body }, deps);
    return { ok: true, data: { external_id: def.id_path ? scalar(getPath(r.json, def.id_path)) : null } };
  } catch (e) {
    return failure(e, conn);
  }
}

/** Send a budget: "replace" uses the replace address, "create" the create address. Lines are shaped by the map's `line`. */
export async function sendBudget(conn: Connection, payload: BudgetPayload, deps: EpromisDeps = {}): Promise<EpResult<CreateResult>> {
  const op: EpromisOperation = payload.mode === "replace" ? "replace_budget" : "create_budget";
  const def = definition(conn.cfg, op);
  if (!def) return notConfigured(op);
  if (!def.body && !def.lines_path) return { ok: false, state: "not_configured", message: `Not configured: the ${EPROMIS_OPERATION_LABEL[op].toLowerCase()} has an address but no body. Say which ePROMIS field takes each value.` };
  const values = payload as unknown as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  if (def.body) fillBody(def.body, values, body);
  if (def.lines_path) {
    const lines = payload.lines.map((l) => {
      const one: Record<string, unknown> = {};
      fillBody(def.line ?? {}, l as unknown as Record<string, unknown>, one);
      return one;
    });
    setPath(body, def.lines_path, lines);
  }
  try {
    const r = await send(conn.cfg, conn.creds, { method: def.method, path: def.path, vars: values, body }, deps);
    return { ok: true, data: { external_id: def.id_path ? scalar(getPath(r.json, def.id_path)) : null } };
  } catch (e) {
    return failure(e, conn);
  }
}
