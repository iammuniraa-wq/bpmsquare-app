import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// After an action the screen must show what the action changed without a manual reload (live finding, 2026-10-27: "Send for approval" left the
// row on Draft and the tile on 0; "Ask for approval" left the button as it was; an approval left the contract value, budget and Revisions
// count as they were). Every mutating action on the contract project screens and on the tender deal's Costing and Competitors tabs must
// (1) re-read what its own screen shows from the endpoint that serves it, and (2) refresh the page, whose header tiles and status chip the
// server renders. These tests read the sources, as the neighbouring wiring tests do, and name each action.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const CP = "src/components/contractProjects/";

describe("the shared helper", () => {
  const hook = read(`${CP}useReloaded.ts`);
  it("re-reads the tab's own endpoint, applies it, then refreshes the page; a server render replaces the local copy", () => {
    expect(hook).toContain("reloadAfterSave<T>(url, setData, () => router.refresh())");
    expect(hook).toMatch(/useEffect\(\(\) => \{ setData\(fromServer\); \}, \[fromServer\]\)/);
  });
});

describe("Variations: add, edit, send for approval, approve, reject, withdraw, remove", () => {
  const tab = read(`${CP}VariationsTab.tsx`);
  const panel = read(`${CP}VariationPanel.tsx`);

  it("the tab reads its list and tiles from the variations endpoint and every change reloads it, then refreshes the page", () => {
    expect(tab).toContain("useReloaded<VariationsData>(`/api/contract-projects/${projectId}/variations`, fromServer)");
    expect(tab).toMatch(/const changed = \(opts\?: \{ keepOpen\?: boolean \}\) => \{ if \(!opts\?\.keepOpen\) setPanel\(null\); void reload\(\); \};/);
    expect(tab).not.toContain("router.refresh");
    expect(tab).toContain("onChanged={changed}");
  });

  it("add, edit, send, remove, withdraw, approve and reject all go through one runner that calls onChanged after a success", () => {
    expect(panel).toMatch(/try \{ if \(await fn\(\)\) onChanged\(\); \} finally/);
    for (const name of ["save", "send", "remove", "withdraw"]) expect(panel).toContain(`run("${name}"`);
    expect(panel).toContain("run(action, async () =>");
    expect(panel).toMatch(/onDecide\("approve"\)/);
    expect(panel).toMatch(/onDecide\("reject"\)/);
  });

  it("Send for approval refreshes even when the save went through and the send did not, and keeps the panel open", () => {
    expect(panel).toMatch(/if \(!sent\) onChanged\(\{ keepOpen: true \}\);/);
  });

  it("an approval's sentence is shown before the reload, and the tiles read the reloaded data", () => {
    expect(panel.indexOf("onOutcome?.(r.json.outcome")).toBeLessThan(panel.indexOf("return r.ok;"));
    expect(tab).toContain("Waiting for approval");
    expect(tab).toContain("data.variations.slice(0, PAGE)");
  });
});

describe("Invoicing: add, edit, mark paid, remove, create invoice", () => {
  const tab = read(`${CP}InvoicingTab.tsx`);
  const panel = read(`${CP}MilestonePanel.tsx`);

  it("the tab reads its schedule and tiles from the milestones endpoint; a change reloads it and refreshes the page", () => {
    expect(tab).toContain("useReloaded<MilestonesData>(`/api/contract-projects/${projectId}/milestones`, fromServer)");
    expect(tab).toContain("const changed = () => { setPanel(null); void reload(); };");
    expect(tab).not.toContain("router.refresh");
  });

  it("Create invoice reloads after a success and after a failure (a second person may have made it first)", () => {
    expect(tab).toMatch(/Draft invoice[^\n]*\n\s*await reload\(\);/);
    expect(tab).toMatch(/setError\(j\.error \?\? "Could not create the invoice"\); await reload\(\); return;/);
  });

  it("add, edit and mark paid (one save), and remove, each call onChanged only after the server said yes", () => {
    const saveAt = panel.indexOf("async function save()");
    const removeAt = panel.indexOf("async function remove()");
    expect(panel.slice(saveAt, removeAt)).toMatch(/if \(!res\.ok\) \{[^}]*return; \}\s*onChanged\(\);/);
    expect(panel.slice(removeAt)).toMatch(/if \(!res\.ok\) \{[^}]*return; \}\s*onChanged\(\);/);
    expect(tab).toContain("onChanged={changed}");
  });
});

describe("Baseline approval: ask, approve, reject, withdraw", () => {
  const src = read(`${CP}ApprovalControls.tsx`);
  it("the button and the state follow the re-read approval, not only the server render", () => {
    expect(src).toContain("const [approval, setApproval] = useState(approvalFromServer);");
    expect(src).toContain("const [revisionStatus, setRevisionStatus] = useState(statusFromServer);");
    expect(src).toMatch(/useEffect\(\(\) => \{ setApproval\(approvalFromServer\); \}, \[approvalFromServer\]\)/);
    expect(src).toMatch(/useEffect\(\(\) => \{ setRevisionStatus\(statusFromServer\); \}, \[statusFromServer\]\)/);
  });
  it("every action re-reads the project (the revision being looked at), applies the approval and the revision status, then refreshes the page", () => {
    expect(src).toContain("`/api/contract-projects/${projectId}${revisionId ? `?revision=${revisionId}` : \"\"}`");
    expect(src).toContain("if (v.approval !== undefined) setApproval(v.approval);");
    expect(src).toContain("setRevisionStatus(v.revision?.status ?? null)");
    expect(src).toContain("() => router.refresh()");
    expect(src).toMatch(/if \(!res\.ok\) \{ setError\(j\.error \?\? "That did not work"\); await reload\(\); return; \}\s*setRejecting\(false\); setComment\(""\);\s*await reload\(\);/);
  });
  it("all four actions go through that one call()", () => {
    for (const action of ['"POST", { revision_id: revisionId }', '{ action: "approve" }', '{ action: "reject", comment }', '{ action: "cancel" }']) expect(src).toContain(action);
    expect(src.match(/onClick=\{\(\) => call\(/g)?.length).toBe(4);
  });
});

describe("The other project actions refresh the page", () => {
  it("Edit details refreshes the header after the save, and keeps what was typed", () => {
    const f = read(`${CP}ProjectDetailsForm.tsx`);
    expect(f.indexOf("if (!res.ok)")).toBeLessThan(f.indexOf("router.refresh()"));
    expect(f).not.toContain("setF(initial");
  });
  it("Close and Reopen refresh the status chip; Delete leaves for the list", () => {
    const m = read(`${CP}ProjectMenu.tsx`);
    expect(m).toMatch(/if \(!res\.ok\) \{[^}]*return; \}\s*router\.refresh\(\);/);
    expect(m).toContain("router.push(ROUTES.contractProjects)");
  });
  it("Save allocation refreshes the header tiles and keeps what was saved", () => {
    const b = read(`${CP}BudgetGrid.tsx`);
    expect(b).toMatch(/setNotice\("Allocation saved"\);\s*router\.refresh\(\);/);
  });
  it("Start revision opens the new revision (a navigation, so the whole page is read again)", () => {
    expect(read(`${CP}RevisionsPanel.tsx`)).toContain("router.push(`${ROUTES.contractProject(p.id)}?tab=budget&revision=${j.id}`)");
  });
  it("the page feeds the tabs from the server, so a refresh brings every tile", () => {
    const page = read("src/app/(app)/contract-projects/[id]/page.tsx");
    expect(page).toContain("externalLine={<><ProjectPathBar path={view.path} /><ProjectKpiStrip view={view} /></>}");
    expect(page).toContain("<VariationsSection req={req} project={p} />");
    expect(page).toContain("<InvoicingSection req={req} project={p} />");
  });
});

describe("Tender deal, Costing: new RFQ, award and price, price rows, re-price, new estimate", () => {
  const tab = read("src/components/tender/CostingTab.tsx");
  const row = read("src/components/tender/costing/CostingRow.tsx");
  const missing = read("src/components/tender/MissingRfqButton.tsx");
  const compare = read("src/components/tender/costing/CompareAward.tsx");

  it("one afterChange reloads the tab and tells the page, and every action calls it", () => {
    expect(tab).toContain("const afterChange = useCallback(() => { void load(); onChanged?.(); }, [load, onChanged]);");
    expect(tab).toMatch(/onCreated=\{\(\) => \{ onNotice\?\.\("RFQ created"\); afterChange\(\); \}\}/);
    expect(tab).toMatch(/onChanged=\{afterChange\}/);
    expect(tab).toMatch(/onDone=\{\(m\) => \{ setPriceRowsFor\(null\); onNotice\?\.\(m\); afterChange\(\); \}\}/);
    const reprice = tab.slice(tab.indexOf("async function reprice"), tab.indexOf("const empty"));
    expect(reprice).toContain("afterChange();");
  });
  it("Award and price reloads the compare view and tells the tab", () => {
    expect(compare).toContain("void load(); onChanged();");
  });
  it("Raise RFQ for missing costs keeps the person on Costing and reloads, like New RFQ", () => {
    expect(missing).toContain("onCreated={onCreated ? () => onCreated() : undefined}");
    expect(row).toContain("guideId=\"costing.estimate.rfq\" onCreated={onRfqCreated}");
    expect(tab).toMatch(/onRfqCreated=\{\(\) => \{ onNotice\?\.\("RFQ created"\); afterChange\(\); \}\}/);
  });
  it("the list is read uncached", () => {
    expect(tab).toContain("fetch(url, { cache: \"no-store\" })");
  });
  it("New estimate leaves for the estimate page (a navigation)", () => {
    expect(tab).toContain("href={`/estimates/new?");
  });
  it("the page refreshes its header when Costing changes something", () => {
    const detail = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(detail).toMatch(/<CostingTab [^\n]*onChanged=\{\(\) => router\.refresh\(\)\}/);
  });
});

describe("Tender deal, Competitors: add, edit, mark winner, remove", () => {
  const tab = read("src/components/tender/competitors/CompetitorsTab.tsx");
  it("each reloads the list, then tells the page, after the server said yes", () => {
    expect(tab).toMatch(/\{ method: "PATCH", body: JSON\.stringify\(\{ is_winner: !x\.is_winner \}\) \}, "Could not save"\)\) \{\s*await load\(\);\s*onChanged\?\.\(\);/);
    expect(tab).toMatch(/\{ method: "DELETE" \}, "Could not remove"\)\) \{[\s\S]*?\n\s*await load\(\);\s*onChanged\?\.\(\);/);
    expect(tab).toMatch(/onSaved=\{async \(\) => \{[^\n]*await load\(\); onChanged\?\.\(\); \}\}/);
  });
  it("the list is read uncached", () => {
    expect(tab).toContain("/competitors`, { cache: \"no-store\" }");
  });
  it("the page refreshes its header (the winner is the deal's competitor)", () => {
    const detail = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(detail).toMatch(/<CompetitorsTab [^\n]*onChanged=\{\(\) => router\.refresh\(\)\}/);
  });
});
