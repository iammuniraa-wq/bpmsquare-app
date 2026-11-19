import { describe, expect, it } from "vitest";
import { NAV } from "@/lib/constants";
import { CREATE_ACTIONS } from "@/lib/createActions";
import { SETTINGS_MENU, visibleSettingsMenu } from "@/lib/settingsMenu";
import type { WorkcenterKey } from "@/lib/workcenters";
import { answerUnavailableAsk, isPushback, judgeNavigation, NAV_NONE, namedGroups, notTheSameAgain, saidBefore, unavailableAsk, unavailableFollowUp, type GuardTurn } from "./navGuard";
import { buildNavTargets, dataWorkbenchTarget, matchNavigation, screenCatalog, tenderBoqTarget, TENDER_BOQ_LIST_TARGET, type NavGateCtx } from "./navTargets";
import { navigateTool } from "./navTools";

// Deterministic: the server's check on the model's navigate pick, per workspace type. No model is called.
// Regression: KAMCO, "where is data workbench" -> "I've added a button that opens Analytics" (Data Workbench is not
// switched on there, and the old tool had to pick some id).

const UUID = "0b8f2a6e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

function ctxOf(features: string[], over: Partial<NavGateCtx> & { view?: WorkcenterKey[]; create?: WorkcenterKey[] } = {}): NavGateCtx {
  const { view, create, ...rest } = over;
  return {
    features: Object.fromEntries(features.map((f) => [f, true])),
    isAdmin: true,
    isWfmSupervisor: false,
    canView: (wc) => (view ? view.includes(wc) : true),
    canCreate: (wc) => (create ? create.includes(wc) : true),
    canEdit: () => false,
    ...rest,
  };
}

const everyFeature = (): string[] => {
  const keys = new Set<string>();
  const walk = (items: typeof NAV[number]["items"]) => items.forEach((i) => { if (i.featureKey) keys.add(i.featureKey); walk(i.children ?? []); });
  NAV.forEach((g) => walk(g.items));
  CREATE_ACTIONS.forEach((a) => keys.add(a.featureKey));
  SETTINGS_MENU.forEach((m) => { if (m.featureKey) keys.add(m.featureKey); (m.featureAnyOf ?? []).forEach((k) => keys.add(k)); });
  return [...keys];
};

// Gulf tender workspace: the tender edition and the pipeline are on, Data Workbench is not.
const KAMCO = () => ctxOf(["accounts", "contacts", "pipeline", "gcc_tender", "reports", "estimator", "contract_projects", "rfq"]);
// Everything switched on, an unrestricted admin.
const DEMO = () => ctxOf(everyFeature());
// Everything switched on, but a member whose Business Role only views Accounts and is not an admin.
const MEMBER = () => ctxOf(everyFeature(), { isAdmin: false, view: ["accounts"], create: [] });

type Outcome = { kind: "open"; ids: string[] } | { kind: "unavailable"; text: string } | { kind: "unknown" };
type Case = { say: string; pick: string; askedFor?: string; expect: Outcome };

function run(ctx: NavGateCtx, c: Case, extra: ReturnType<typeof tenderBoqTarget>[] = []) {
  const targets = [...buildNavTargets(ctx), ...extra];
  return judgeNavigation({ pick: c.pick, askedFor: c.askedFor, message: c.say, targets, ctx });
}

function check(name: string, make: () => NavGateCtx, cases: Case[], extra: ReturnType<typeof tenderBoqTarget>[] = []) {
  describe(name, () => {
    for (const c of cases) {
      it(`"${c.say}" (model: ${c.pick} / ${c.askedFor ?? "-"}) -> ${c.expect.kind}`, () => {
        const d = run(make(), c, extra);
        expect(d.kind).toBe(c.expect.kind);
        if (c.expect.kind === "open" && d.kind === "open") expect(d.targets.map((t) => t.id)).toEqual(c.expect.ids);
        if (c.expect.kind === "unavailable" && d.kind === "unavailable") expect(d.message).toContain(c.expect.text);
        if (d.kind !== "open") {
          // Whatever it says, it is never a button to the screen the model substituted.
          if (d.kind === "unknown") expect(d.suggestions.map((s) => s.id)).not.toContain(c.pick);
        }
      });
    }
  });
}

check("KAMCO-like workspace (tender edition on, Data Workbench off)", KAMCO, [
  { say: "where is data workbench", pick: "nav:/reports", askedFor: "data workbench", expect: { kind: "unavailable", text: "Data Workbench is not switched on in your workspace. Ask your administrator to enable it." } },
  { say: "where is data workbench", pick: NAV_NONE, askedFor: "data workbench", expect: { kind: "unavailable", text: "Data Workbench is not switched on" } },
  { say: "I want to bulk import from Excel, where do I do that", pick: "nav:/accounts", askedFor: "data workbench", expect: { kind: "unavailable", text: "Data Workbench is not switched on" } },
  { say: "import accounts", pick: "nav:/accounts", askedFor: "import accounts", expect: { kind: "unavailable", text: "Import Accounts is not switched on" } },
  { say: "import accounts", pick: NAV_NONE, askedFor: "import accounts", expect: { kind: "unavailable", text: "Import Accounts is not switched on" } },
  { say: "export tender boq lines", pick: "nav:/pipeline", askedFor: "export tender boq lines", expect: { kind: "unavailable", text: "Export Tender BOQ lines is not switched on" } },
  { say: "analytics", pick: "nav:/reports", askedFor: "analytics", expect: { kind: "open", ids: ["nav:/reports"] } },
  { say: "where can I see analytics", pick: "nav:/reports", expect: { kind: "open", ids: ["nav:/reports"] } },
  { say: "where do I see tenders", pick: TENDER_BOQ_LIST_TARGET, askedFor: "tenders", expect: { kind: "open", ids: [TENDER_BOQ_LIST_TARGET] } },
  { say: "how do I upload a BOQ", pick: TENDER_BOQ_LIST_TARGET, askedFor: "upload boq", expect: { kind: "open", ids: [TENDER_BOQ_LIST_TARGET] } },
  { say: "where is the budget cockpit", pick: "nav:/reports", askedFor: "budget cockpit", expect: { kind: "unknown" } },
  // The model cannot talk its way past the person's words by writing a convenient asked_for.
  { say: "where is the budget cockpit", pick: "nav:/reports", askedFor: "analytics", expect: { kind: "unknown" } },
  { say: "where is the flux capacitor", pick: NAV_NONE, askedFor: "flux capacitor", expect: { kind: "unknown" } },
  { say: "where do I change my brand colour", pick: "settings:appearance", askedFor: "brand colour", expect: { kind: "open", ids: ["settings:appearance"] } },
  { say: "where is invoices", pick: "nav:/reports", askedFor: "invoices", expect: { kind: "unavailable", text: "Invoices is not switched on" } },
  { say: "please take me to the thing", pick: "nav:/reports", askedFor: "", expect: { kind: "unknown" } },
]);

check("KAMCO-like workspace with a tender open", KAMCO, [
  { say: "how do I upload a BOQ", pick: tenderBoqTarget(UUID).id, askedFor: "upload boq", expect: { kind: "open", ids: [tenderBoqTarget(UUID).id] } },
], [tenderBoqTarget(UUID)]);

check("demo-like workspace (everything on)", DEMO, [
  { say: "where is data workbench", pick: "nav:/data-workbench", askedFor: "data workbench", expect: { kind: "open", ids: ["nav:/data-workbench"] } },
  { say: "where is data workbench", pick: "nav:/reports", askedFor: "data workbench", expect: { kind: "open", ids: ["nav:/data-workbench"] } },
  { say: "where is data workbench", pick: NAV_NONE, askedFor: "data workbench", expect: { kind: "open", ids: ["nav:/data-workbench"] } },
  { say: "I want to bulk import from Excel", pick: "nav:/data-workbench", askedFor: "data workbench", expect: { kind: "open", ids: ["nav:/data-workbench"] } },
  // An object and a mode: the deep link the page opens on, whatever the model picked beside it.
  { say: "import accounts", pick: dataWorkbenchTarget("import", "accounts"), askedFor: "import accounts", expect: { kind: "open", ids: ["nav:/data-workbench?tab=import&object=accounts"] } },
  { say: "import accounts", pick: "nav:/accounts", askedFor: "import accounts", expect: { kind: "open", ids: ["nav:/data-workbench?tab=import&object=accounts"] } },
  { say: "export tender BOQ lines", pick: NAV_NONE, askedFor: "export tender boq lines", expect: { kind: "open", ids: ["nav:/data-workbench?tab=export&object=tender_boq_lines"] } },
  { say: "I need to bulk update contacts", pick: "nav:/contacts", askedFor: "bulk update contacts", expect: { kind: "open", ids: ["nav:/data-workbench?tab=update&object=contacts"] } },
  { say: "download customers", pick: NAV_NONE, askedFor: "download customers", expect: { kind: "open", ids: ["nav:/data-workbench?tab=export&object=accounts"] } },
  { say: "analytics", pick: "nav:/reports", askedFor: "analytics", expect: { kind: "open", ids: ["nav:/reports"] } },
  { say: "where are the people settings", pick: "settings:people", askedFor: "people settings", expect: { kind: "open", ids: ["settings:people"] } },
  { say: "where do I create a new account", pick: "create:/accounts/new", askedFor: "new account", expect: { kind: "open", ids: ["create:/accounts/new"] } },
  { say: "where is the flux capacitor", pick: "nav:/reports", askedFor: "flux capacitor", expect: { kind: "unknown" } },
]);

check("restricted member (Accounts view only, not an admin)", MEMBER, [
  { say: "where is data workbench", pick: "nav:/accounts", askedFor: "data workbench", expect: { kind: "unavailable", text: "You do not have access to Data Workbench." } },
  { say: "analytics", pick: "nav:/accounts", askedFor: "analytics", expect: { kind: "unavailable", text: "You do not have access to Analytics." } },
  { say: "where are the single sign-on settings", pick: "nav:/accounts", askedFor: "single sign-on", expect: { kind: "unavailable", text: "only for workspace administrators" } },
  { say: "where are my accounts", pick: "nav:/accounts", askedFor: "accounts", expect: { kind: "open", ids: ["nav:/accounts"] } },
  { say: "where are my accounts", pick: "nav:/reports", askedFor: "accounts", expect: { kind: "open", ids: ["nav:/accounts"] } },
  { say: "import accounts", pick: "nav:/accounts", askedFor: "import accounts", expect: { kind: "unavailable", text: "You do not have access to Import Accounts." } },
]);

// Data Workbench on, but this workspace never bought Cases or the tender edition: the page opens, the object does not.
const BENCH_ONLY = () => ctxOf(["data_workbench", "accounts", "contacts", "pipeline"]);
check("workspace with Data Workbench but without Cases or the tender edition", BENCH_ONLY, [
  { say: "import accounts", pick: "nav:/accounts", askedFor: "import accounts", expect: { kind: "open", ids: ["nav:/data-workbench?tab=import&object=accounts"] } },
  { say: "import cases", pick: "nav:/accounts", askedFor: "import cases", expect: { kind: "unavailable", text: "Import Cases is not switched on" } },
  { say: "export tender boq lines", pick: NAV_NONE, askedFor: "export tender boq lines", expect: { kind: "unavailable", text: "Export Tender BOQ lines is not switched on" } },
]);

describe("the answer when a named screen is out of reach", () => {
  it("says which reason applies: module off, role without a grant, administrators only", () => {
    expect(answerUnavailableAsk("where is data workbench", buildNavTargets(KAMCO()), KAMCO())).toBe("Data Workbench is not switched on in your workspace. Ask your administrator to enable it.");
    expect(answerUnavailableAsk("where is data workbench", buildNavTargets(MEMBER()), MEMBER())).toBe("You do not have access to Data Workbench.");
    expect(answerUnavailableAsk("open settings", buildNavTargets(MEMBER()), MEMBER())).toBe("Settings is only for workspace administrators.");
  });

  it("is silent when the screen is reachable, when a data question merely mentions it, and for names it does not know", () => {
    const k = KAMCO(); const t = buildNavTargets(k);
    expect(answerUnavailableAsk("where is analytics", t, k)).toBeNull();
    expect(answerUnavailableAsk("how many tenders are open", t, k)).toBeNull();
    expect(answerUnavailableAsk("show me invoices by status", t, k)).toBeNull();
    expect(answerUnavailableAsk("where is the flux capacitor", t, k)).toBeNull();
    expect(answerUnavailableAsk("", t, k)).toBeNull();
  });

  it("the plain 'open X' shortcut does not follow a screen the workspace lacks", () => {
    expect(matchNavigation("open data workbench", buildNavTargets(KAMCO()))).toBeNull();
    expect(matchNavigation("open data workbench", buildNavTargets(DEMO()))?.href).toBe("/data-workbench");
  });
});

describe("unknown names", () => {
  it("quote the name back and offer nothing misleading", () => {
    const k = KAMCO();
    const d = judgeNavigation({ pick: NAV_NONE, askedFor: "flux capacitor", message: "where is the flux capacitor", targets: buildNavTargets(k), ctx: k });
    expect(d).toEqual({ kind: "unknown", message: 'I do not know a screen called "flux capacitor".', suggestions: [] });
  });

  it("offers an allowed screen only when it clearly matches a word the person used", () => {
    const k = KAMCO();
    const d = judgeNavigation({ pick: NAV_NONE, askedFor: "estimate sheets", message: "where are my estimate sheets", targets: buildNavTargets(k), ctx: k });
    // 'estimate' names the Estimates screen outright, so this resolves to it rather than to the unknown answer.
    expect(d.kind).toBe("open");
    const d2 = judgeNavigation({ pick: NAV_NONE, askedFor: "tender cockpit", message: "where is the tender cockpit", targets: buildNavTargets(k), ctx: k });
    expect(d2.kind).toBe("open"); // 'tender' is the Tenders tab
    const d3 = judgeNavigation({ pick: NAV_NONE, askedFor: "contract cockpit", message: "contract cockpit", targets: buildNavTargets(k), ctx: k });
    expect(d3.kind).toBe("unknown");
    if (d3.kind === "unknown") expect(d3.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("the model's asked_for is cleaned before it is printed back", () => {
    const k = KAMCO();
    const d = judgeNavigation({ pick: NAV_NONE, askedFor: "<script>alert(1)</script> thing", message: "where is it", targets: buildNavTargets(k), ctx: k });
    expect(d.kind).toBe("unknown");
    if (d.kind === "unknown") expect(d.message).not.toMatch(/[<>()]/);
  });
});

describe("naming", () => {
  it("finds the longest name only: 'standard quote' is not also 'quote'", () => {
    const g = namedGroups("where are my standard quotes");
    expect(g).toHaveLength(1);
    expect(g[0].entries.map((e) => e.id)).toContain("nav:/standard-quotes");
    expect(g[0].entries.map((e) => e.id)).not.toContain("nav:/quotations");
  });
  it("matches whole words only", () => {
    expect(namedGroups("showcases and caseworkers")).toEqual([]);
  });
});

describe("the catalogue and the list the model sees cannot disagree", () => {
  const contexts: [string, NavGateCtx][] = [
    ["kamco", KAMCO()], ["demo", DEMO()], ["member", MEMBER()],
    ["supervisor", ctxOf(everyFeature(), { isAdmin: false, isWfmSupervisor: true })],
    ["settings editor", ctxOf(everyFeature(), { isAdmin: false, canEdit: (wc) => wc === "quotations" })],
  ];
  for (const [name, c] of contexts) {
    it(`${name}: an entry is a target exactly when its gate says it is reachable`, () => {
      const targets = new Set(buildNavTargets(c).map((t) => t.id));
      for (const e of screenCatalog()) expect(targets.has(e.id), e.id).toBe(e.gate(c) === null);
    });
    it(`${name}: the Settings pages offered are the ones the Settings menu shows`, () => {
      const offered = buildNavTargets(c).filter((t) => t.kind === "settings").map((t) => t.id.replace(/^settings:/, ""));
      const shown = visibleSettingsMenu({ isAdmin: c.isAdmin, canEdit: c.canEdit, features: c.features }).flatMap((g) => g.items.map((i) => i.id));
      expect(offered).toEqual(shown);
    });
  }
  it("a Data Workbench object is reachable exactly when the page is, its module is on and its extra flags are on", () => {
    const e = screenCatalog().find((x) => x.id === "nav:/data-workbench?tab=import&object=tender_boq_lines")!;
    expect(e.gate(DEMO())).toBeNull();
    expect(e.gate(ctxOf(["data_workbench", "gcc_tender"]))).toBe("not_enabled"); // the Pipeline too
    expect(e.gate(ctxOf(["data_workbench", "pipeline"]))).toBe("not_enabled"); // the tender edition too
    expect(e.gate(ctxOf(["gcc_tender", "pipeline"]))).toBe("not_enabled"); // the page itself
    expect(e.gate(MEMBER())).toBe("no_access");
    expect(e.gate(ctxOf(["data_workbench", "gcc_tender", "pipeline"]))).toBeNull();
  });
  it("Data Workbench is gated by the data_workbench module", () => {
    const e = screenCatalog().find((x) => x.id === "nav:/data-workbench")!;
    expect(e.gate(KAMCO())).toBe("not_enabled");
    expect(e.gate(DEMO())).toBeNull();
    expect(e.gate(MEMBER())).toBe("no_access");
  });
});

describe("the navigate tool can decline", () => {
  it("offers none beside the allowed ids and requires asked_for", () => {
    const tool = navigateTool(buildNavTargets(KAMCO()));
    const props = tool.input_schema.properties as { target: { enum: string[] }; asked_for: { type: string } };
    expect(props.target.enum).toContain(NAV_NONE);
    expect(props.target.enum).toContain("nav:/reports");
    expect(props.target.enum).not.toContain("nav:/data-workbench");
    expect(props.asked_for.type).toBe("string");
    expect(tool.input_schema.required).toEqual(["asked_for", "target"]);
    expect(tool.description).toContain("never pick a different screen");
  });
});

// Owner, KAMCO 2026-11-19, a workspace admin: "Email is not switched on in your workspace. Ask your administrator to
// enable it." three times in a row, the last two in reply to "i am admin".
describe("an unavailable screen is explained to a person, not recited", () => {
  const ADMIN = () => ({ ...KAMCO(), isWorkspaceAdmin: true });
  const NOT_ADMIN = () => ({ ...KAMCO(), isAdmin: false, isWorkspaceAdmin: false });
  const said = (ctx: NavGateCtx) => unavailableAsk("where is email", buildNavTargets(ctx), ctx)!;

  it("a workspace admin is told BPMSquare adds the module; a member is told to ask their administrator", () => {
    expect(said(ADMIN()).message).toContain("Email is not part of your workspace yet. Modules are added by BPMSquare, not in Settings, so ask your BPMSquare contact to switch it on.");
    expect(said(ADMIN()).message).not.toContain("Ask your administrator");
    expect(said(NOT_ADMIN()).message).toBe("Email is not switched on in your workspace. Ask your administrator to enable it.");
    // Only "module off" changes with the role: the other reasons were already right.
    const m = { ...MEMBER(), isWorkspaceAdmin: false };
    expect(answerUnavailableAsk("where is data workbench", buildNavTargets(m), m)).toBe("You do not have access to Data Workbench.");
  });

  it("offers the mail settings the caller can reach, and nothing to a caller who cannot reach them", () => {
    const a = said(ADMIN());
    expect(a.related.map((t) => t.id)).toEqual(["settings:connectors", "settings:email-output"]);
    expect(a.message).toContain("mailbox your emails go out from");
    expect(said(NOT_ADMIN()).related).toEqual([]);
    // A screen that is not about mail gets no mail buttons.
    expect(unavailableAsk("where is data workbench", buildNavTargets(ADMIN()), ADMIN())!.related).toEqual([]);
    const v = judgeNavigation({ pick: NAV_NONE, askedFor: "email", message: "I need email here", targets: buildNavTargets(ADMIN()), ctx: ADMIN() });
    expect(v.kind === "unavailable" && v.related.map((t) => t.id)).toEqual(["settings:connectors", "settings:email-output"]);
  });

  it("the owner's two replies are follow-ups: they carry the facts for the model, never the fixed sentence", () => {
    const ctx = ADMIN(); const targets = buildNavTargets(ctx);
    const first: GuardTurn[] = [{ role: "user", text: "where is email" }, { role: "assistant", text: said(ctx).message }];
    for (const reply of ["where to switch it on? i am admin", "I understand but i am an admin"]) {
      expect(isPushback(reply)).toBe(true);
      expect(answerUnavailableAsk(reply, targets, ctx)).toBeNull();
      const f = unavailableFollowUp([...first, { role: "user", text: reply }], targets, ctx)!;
      expect(f.fact).toContain('"Email"');
      expect(f.fact).toContain("Only BPMSquare");
      expect(f.fact).toContain("IS a workspace administrator");
      expect(f.fact).toContain("Settings: Connectors");
      expect(f.related.map((t) => t.id)).toEqual(["settings:connectors", "settings:email-output"]);
    }
    // Two turns later the model's own wording sits between, and the reply is still understood.
    const later: GuardTurn[] = [...first, { role: "user", text: "where to switch it on? i am admin" }, { role: "assistant", text: "You can't switch it on yourself; BPMSquare adds modules." }, { role: "user", text: "I understand but i am an admin" }];
    expect(unavailableFollowUp(later, targets, ctx)).not.toBeNull();
  });

  it("is not a follow-up without an unavailable answer before it, or when the next question is about something else", () => {
    const ctx = ADMIN(); const targets = buildNavTargets(ctx);
    expect(unavailableFollowUp([{ role: "user", text: "but i am an admin" }], targets, ctx)).toBeNull();
    const first: GuardTurn[] = [{ role: "user", text: "where is email" }, { role: "assistant", text: said(ctx).message }];
    expect(unavailableFollowUp([...first, { role: "user", text: "how many tenders are open" }], targets, ctx)).toBeNull();
    // Asking the very same thing again is one: the second answer is the model's.
    expect(unavailableFollowUp([...first, { role: "user", text: "where is email" }], targets, ctx)).not.toBeNull();
    expect(saidBefore(first, said(ctx).message)).toBe(true);
  });

  it("the last guard never lets the same words go out twice in a row", () => {
    const h: GuardTurn[] = [{ role: "user", text: "x" }, { role: "assistant", text: "You do not have access to Analytics." }];
    const again = notTheSameAgain(h, "You do not have access to  analytics.");
    expect(again).not.toBe("You do not have access to Analytics.");
    expect(again).toContain("You do not have access to");
    expect(notTheSameAgain(h, "There are 4.")).toBe("There are 4.");
    expect(notTheSameAgain([], "There are 4.")).toBe("There are 4.");
  });
});
