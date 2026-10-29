import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { tipTextProblems } from "@/lib/infoTip";
import { RFQ_TIPS } from "@/lib/rfq/tips";
import { GROUP_TIPS } from "@/components/suppliers/tips";
import { readSupplierSource, tenderSupplierSource } from "@/components/rfq/useRfqSuppliers";
import { handoverUrl, isPending, packageUrl, packagesUrl, buyoutUrl } from "./api";
import {
  againstText, applyFilter, awardNeedsReason, buyoutVisible, committedFor, currentRound, filterCounts, lowestValid, orderRounds, overBudget, reasonOk, roundResult, statusText, tileSubs,
} from "./rules";
import { readPicker } from "./SendRequestForm";
import { BUYOUT_TIPS } from "./tips";
import { data, packages, rounds, row } from "./testData";
import { readGroups, readCreatedId } from "@/components/suppliers/groupsApi";

// The Buy-out screens' rules, words and wiring (docs/design/contract-buyout.md): the pure helpers, the explanations held to the InfoTip limit,
// the one thin client module that matches the contract's routes, and the source-level checks that every action re-reads and refreshes, that
// nothing but api.ts fetches, and that no component carries a literal colour.

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const DIR = "src/components/contractProjects/buyout/";

describe("the explanations behind the i", () => {
  it("every Buy-out, group and approved-list text is two sentences at most and 160 characters at most", () => {
    for (const [key, text] of Object.entries(BUYOUT_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
    for (const [key, text] of Object.entries(GROUP_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
    expect(tipTextProblems(RFQ_TIPS.approvedList)).toEqual([]);
  });
});

describe("filters and counts", () => {
  it("counts each status and All, and a filter keeps only its status", () => {
    const counts = filterCounts(packages);
    expect(counts).toEqual({ all: 5, draft: 1, out: 1, ready: 1, awarded: 1, handed_over: 1 });
    expect(applyFilter(packages, "ready").map((p) => p.id)).toEqual(["precast"]);
    expect(applyFilter(packages, "all")).toHaveLength(5);
  });

  it("says how many replied while a package is out, and plain words otherwise", () => {
    expect(statusText({ status: "out", asked: 3, replied: 2 })).toBe("Out, 2 of 3 replied");
    expect(statusText({ status: "out" })).toBe("Out");
    expect(statusText({ status: "draft" })).toBe("Not sent");
    expect(statusText({ status: "ready" })).toBe("Ready to award");
  });
});

describe("tiles and the against-budget cell", () => {
  it("works the words under each tile from the rows", () => {
    const s = tileSubs(data(), "INR");
    expect(s.budget).toBe("5 packages, 12 budget lines");
    expect(s.committed).toBe("18% of INR 924,670, 2 awarded");
    expect(s.committedTone).toBe("info");
    expect(s.best).toBe("under budget where quotes are in");
    expect(s.bestTone).toBe("good");
    expect(s.bestValue).toBe("+INR 1,030");
    expect(s.decision).toBe("1 ready to award, 1 waiting on replies");
  });

  it("warns, in words and a warn tone, when committed is over the budget; it never blocks", () => {
    const s = tileSubs(data({ tiles: { budget: 100, committed: 130, best_vs_budget: -30, needs_decision: 0, packages: 1 } }), "INR");
    expect(s.committedTone).toBe("warn");
    expect(s.committed).toContain("over the budget by INR 30");
    expect(s.bestTone).toBe("warn");
    expect(overBudget(130, 100)).toBe(30);
    expect(overBudget(100, 100)).toBe(0);
    expect(overBudget(null, 100)).toBe(0);
  });

  it("shows under, over, on budget and a dash", () => {
    expect(againstText({ against_budget: 5270 }, "INR")).toEqual({ text: "INR 5,270 under", tone: "good" });
    expect(againstText({ against_budget: -11000 }, "INR")).toEqual({ text: "INR 11,000 over", tone: "bad" });
    expect(againstText({ against_budget: 0 }, "INR").text).toBe("On budget");
    expect(againstText({ against_budget: null }, "INR").text).toBe("—");
  });
});

describe("rounds and quotes", () => {
  it("lists rounds newest first and finds the current one by the package's own pointer", () => {
    const shuffled = [rounds[1], rounds[0]];
    expect(orderRounds(shuffled).map((r) => r.round)).toEqual([2, 1]);
    expect(currentRound(shuffled, "rfq9")?.round).toBe(1);
    expect(currentRound(shuffled, null)?.round).toBe(2);
    expect(currentRound([], null)).toBeNull();
  });

  it("the lowest valid price ignores unanswered and expired quotes, and the audit line says who replied", () => {
    expect(lowestValid(rounds[0].quotes)).toBe(431000);
    expect(roundResult(rounds[0], "INR")).toBe("3 of 4 replied, lowest INR 431,000");
    expect(roundResult({ ...rounds[0], quotes: [] }, "INR")).toBe("0 of 0 replied");
  });

  it("an award that is not the lowest valid price needs a reason of a few characters", () => {
    expect(awardNeedsReason({ lowest_valid: true })).toBe(false);
    expect(awardNeedsReason({ lowest_valid: false })).toBe(true);
    expect(reasonOk("  ")).toBe(false);
    expect(reasonOk("Better lead time")).toBe(true);
  });
});

describe("where Buy-out belongs", () => {
  it("only a contract project made from a tender, with both module flags on", () => {
    expect(buyoutVisible({ source_opportunity_id: "o1" }, { gcc_tender: true, contract_projects: true })).toBe(true);
    expect(buyoutVisible({ source_opportunity_id: null }, { gcc_tender: true, contract_projects: true })).toBe(false);
    expect(buyoutVisible({ source_opportunity_id: "o1" }, { gcc_tender: true })).toBe(false);
    expect(buyoutVisible({ source_opportunity_id: "o1" }, { contract_projects: true })).toBe(false);
    expect(buyoutVisible({ source_opportunity_id: "o1" }, null)).toBe(false);
  });

  it("a budget line's committed amount is found by its stable key first, then by id", () => {
    expect(committedFor({ k1: 100, i1: 5 }, { id: "i1", line_key: "k1" })).toBe(100);
    expect(committedFor({ i1: 5 }, { id: "i1", line_key: "k1" })).toBe(5);
    expect(committedFor({ x: 1 }, { id: "i1", line_key: "k1" })).toBeNull();
    expect(committedFor(null, { id: "i1", line_key: "k1" })).toBeNull();
  });
});

describe("the client module matches the contract's routes", () => {
  it("builds exactly the paths of section 5", () => {
    expect(buyoutUrl("p1")).toBe("/api/contract-projects/p1/buyout");
    expect(packagesUrl("p1")).toBe("/api/contract-projects/p1/buyout/packages");
    expect(packageUrl("p1", "k1")).toBe("/api/contract-projects/p1/buyout/packages/k1");
    expect(handoverUrl("p1", "k1")).toBe("/api/contract-projects/p1/buyout/packages/k1/handover");
    const api = read(`${DIR}api.ts`);
    for (const tail of ["/suppliers", "/rounds", "/award", "/unaward"]) expect(api, tail).toContain("${packageUrl(projectId, packageId)}" + tail);
    expect(api).toContain('send("POST", { action: "mark_sent", ...body })');
    expect(tenderSupplierSource("o1")).toBe("/api/opportunities/o1/tender/costing/suppliers");
  });

  it("reads a pending database as a state, not a failure", () => {
    expect(isPending(200, { pending: true })).toBe(true);
    expect(isPending(404, {})).toBe(true);
    expect(isPending(503, null)).toBe(true);
    expect(isPending(200, {})).toBe(false);
    expect(isPending(403, {})).toBe(false);
  });
});

describe("tolerant readers of the lists the contract leaves open", () => {
  it("the supplier picker answers { restricted, suppliers } or a bare list", () => {
    expect(readPicker({ restricted: true, suppliers: [{ id: "s1", name: "A", email: null }], group: { name: "G" } })).toMatchObject({ restricted: true, suppliers: [{ id: "s1" }], group: { name: "G" } });
    expect(readPicker([{ id: "s1", name: "A", email: null }])).toMatchObject({ restricted: false, suppliers: [{ id: "s1" }] });
    expect(readPicker(null)).toEqual({ restricted: false, suppliers: [], group: null });
  });

  it("the composer's source drops inactive suppliers, names the group and reads a bare list as unrestricted", () => {
    const r = readSupplierSource({ restricted: true, group: { name: "Red Sea approved vendors" }, suppliers: [{ id: "a", name: "A", email: "a@x.com", status: "active" }, { id: "b", name: "B", status: "inactive" }, { nope: 1 }] });
    expect(r.scope).toEqual({ restricted: true, group: "Red Sea approved vendors" });
    expect(r.suppliers.map((s) => s.id)).toEqual(["a"]);
    expect(readSupplierSource([{ id: "a", name: "A" }]).scope).toEqual({ restricted: false, group: null });
    expect(readSupplierSource({ restricted: false, suppliers: [{ id: "a", name: "A" }] }).suppliers[0]).toMatchObject({ id: "a", email: null, city: null, status: "active" });
  });

  it("the groups list answers an array or { groups }, and a create answers the group or { group }", () => {
    expect(readGroups([{ id: "g1", name: "A", account_id: null }])).toHaveLength(1);
    expect(readGroups({ groups: [{ id: "g1", name: "A", account_id: null }, { name: "no id" }] })).toHaveLength(1);
    expect(readGroups(null)).toEqual([]);
    expect(readCreatedId({ id: "g1" })).toBe("g1");
    expect(readCreatedId({ group: { id: "g2" } })).toBe("g2");
    expect(readCreatedId({})).toBeNull();
  });
});

describe("package rows: a row is one unit the rest of the screen reads", () => {
  it("a row carries the contract's fields", () => {
    const r = row();
    for (const k of ["id", "ref", "name", "kind", "status", "line_count", "budget", "bid_cost", "best_quote", "committed", "against_budget", "current_round", "rounds", "handover"]) expect(r, k).toHaveProperty(k);
  });
});

describe("after every action the screen re-reads and the page refreshes", () => {
  const tab = read(`${DIR}BuyoutTab.tsx`);
  const panel = read(`${DIR}PackagePanel.tsx`);
  const newPanel = read(`${DIR}NewPackagePanel.tsx`);
  const section = read(`${DIR}BuyoutSection.tsx`);

  it("the tab reads its list and tiles from the buy-out endpoint through the shared hook; a change reloads it and refreshes the page", () => {
    expect(tab).toContain("useReloaded<BuyoutData>(buyoutUrl(projectId), fromServer)");
    expect(tab).toContain("const changed = () => { void reload(); };");
    expect(tab).not.toContain("router.refresh");
    expect(tab).toContain("onChanged={changed}");
    expect(tab).toMatch(/onCreated=\{\(created\) => \{ setPanel\(created\?\.id \? \{ id: created\.id \} : null\); changed\(\); \}\}/);
  });

  it("the shared hook does both: it re-reads the endpoint and refreshes the router", () => {
    const hook = read("src/components/contractProjects/useReloaded.ts");
    expect(hook).toContain("reloadAfterSave<T>(url, setData, () => router.refresh())");
  });

  it("every panel action goes through one runner that re-reads the package and tells the tab", () => {
    expect(panel).toContain("await reloadAfterSave<PackageDetail>(url, setDetail, onChanged);");
    for (const name of ["award", "unaward", "send", "handover", "delete"]) expect(panel, name).toContain(`run("${name}"`);
    expect(panel).toContain("run(\"delete\", () => deletePackage(projectId, row.id), { gone: true })");
    expect(panel).toMatch(/if \(opts\.gone\) \{ onChanged\(\); onClose\(\); return true; \}/);
  });

  it("a failed action keeps its panel open and says why; a success clears the inline form", () => {
    expect(panel).toContain('setError(r.json.error ?? "That did not work. Try again.")');
    expect(panel).toContain("setAction(null); setReason(\"\");");
  });

  it("a new package tells the tab, which re-reads and opens it", () => {
    expect(newPanel).toContain("onCreated(r.json.package ?? (r.json.id ? (r.json as PackageRow) : null))");
  });

  it("the first load reads the endpoint once and a pending database is a sentence, not a crash", () => {
    expect(section).toContain("loadBuyout<BuyoutData>(projectId)");
    expect(section).toContain("isPending(r.status, r.json)");
    expect(section).toContain("Buy-out needs a database update");
  });

  it("the supplier groups view re-reads its list after a save and after a delete", () => {
    const groups = read("src/components/suppliers/GroupsClient.tsx");
    expect(groups).toContain("const changed = (message?: string) => { setPanel(null); setNotice(message ?? \"\"); void reload(); };");
    expect(groups).toContain("onChanged={changed}");
    expect(groups).toMatch(/const r = await deleteGroup\(group\.id\);[\s\S]*onChanged\(\);/);
  });
});

describe("nothing but the client modules fetches, and no component carries a colour of its own", () => {
  const files = readdirSync(path.join(ROOT, DIR)).filter((f) => /\.(tsx?)$/.test(f) && !/test|testData|types/.test(f));

  it("only api.ts calls fetch in the Buy-out folder", () => {
    for (const f of files) {
      const src = read(`${DIR}${f}`);
      if (f === "api.ts") expect(src).toContain("fetch(url");
      else expect(src, f).not.toMatch(/\bfetch\(/);
    }
  });

  it("no literal hex or rgb colour in the Buy-out screens, the groups view or the composer note", () => {
    for (const f of [...files.map((x) => `${DIR}${x}`), "src/components/suppliers/GroupsClient.tsx", "src/components/rfq/SupplierPicker.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/\brgba?\(/);
    }
  });

  it("no coloured top-edge line on a tile: tiles are the shared StatTile", () => {
    const tab = read(`${DIR}BuyoutTab.tsx`);
    expect(tab).toContain("StatTile");
    expect(tab).not.toMatch(/border(Top|Left):\s*[`"]?[2-9]px solid/);
  });
});

describe("the composer follows the deal's account group", () => {
  it("the three tender entry points pass the deal's supplier source; the standard ones do not", () => {
    for (const f of ["src/components/tender/CostingTab.tsx", "src/components/rfq/TenderLinesRfq.tsx", "src/components/tender/MissingRfqButton.tsx"]) {
      expect(read(f), f).toContain("supplierSource={tenderSupplierSource(");
    }
    expect(read("src/components/sales/DocumentLinesEditor.tsx")).not.toContain("supplierSource");
    expect(read("src/components/rfq/RecordRfqsCard.tsx")).not.toContain("supplierSource");
  });

  it("the source is plumbed button -> dialog -> composer -> hook -> picker, and falls back to the ordinary list", () => {
    expect(read("src/components/rfq/CreateRfqButton.tsx")).toContain("supplierSource={supplierSource}");
    expect(read("src/components/rfq/RfqDialog.tsx")).toContain("supplierSource={supplierSource}");
    expect(read("src/components/rfq/RfqComposer.tsx")).toContain("useRfqSuppliers(productKey, supplierSource)");
    expect(read("src/components/rfq/RfqComposer.tsx")).toContain("scope={supplierSource ? scope : null}");
    const hook = read("src/components/rfq/useRfqSuppliers.ts");
    expect(hook).toContain("void ordinary()");
    expect(hook).toContain("allowed.has(s.supplier_id)");
  });
});
