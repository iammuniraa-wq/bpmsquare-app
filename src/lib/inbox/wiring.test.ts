import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NAV, ROUTES } from "@/lib/constants";
import { OBJECT_FEATURE, featureForObject } from "@/lib/objectFeatures";
import { WORKCENTERS } from "@/lib/workcenters";
import { SETTINGS_MENU } from "@/lib/settingsMenu";
import { SEARCH_OBJECTS } from "@/lib/globalSearch";
import { ANALYTICS_META } from "@/lib/analyticsMeta";
import { RULES } from "@/lib/briefing/score";
import { EVENTS } from "@/lib/events/catalog";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { NOVA_OBJECTS } from "@/lib/novaAccess";
import { MODULE_LABEL } from "@/lib/capability/generate";
import { allManifests } from "@/lib/assistant/screens";
import { DEFERRED } from "@/lib/actions/registry";

// The Inbox is a new object, so bpmsquarecore.md 3b applies in full. This pins the surfaces that apply, and pins the
// ones that deliberately do NOT (v1 API, Data Workbench, Talk to data, the assistant reading mail) so nobody adds them
// by accident: mail is private correspondence.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
};
const nonTest = (files: string[]) => files.filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes(`${path.sep}testing${path.sep}`));

describe("3b surfaces that apply", () => {
  it("the flag: a platform-admin module, default off, in the editor and the new-tenant form", () => {
    expect(read("src/lib/constants.ts")).toMatch(/inbox: boolean;/);
    expect(read("src/app/admin/tenants/[id]/TenantEditor.tsx")).toMatch(/key: "inbox"/);
    expect(read("src/app/admin/tenants/new/NewTenantForm.tsx")).toMatch(/inbox: false/);
    expect(MODULE_LABEL.inbox).toBe("Shared Inbox");
  });
  it("OBJECT_FEATURE says which module owns the object, under every name a surface uses", () => {
    for (const k of ["inbox", "inbound_emails", "inbox_channels"]) expect(featureForObject(k), k).toBe("inbox");
    expect(OBJECT_FEATURE.inbound_emails).toBe("inbox");
  });
  it("a nav item gated on the module and the workcenter, which business roles can grant", () => {
    const item = NAV.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])])).find((i) => i.href === ROUTES.inbox);
    expect(item).toMatchObject({ label: "Inbox", featureKey: "inbox", workcenterKey: "inbox" });
    expect(WORKCENTERS.some((w) => w.key === "inbox")).toBe(true);
  });
  it("the settings page, the search object, the dashboard tile, the report metric and the briefing rule", () => {
    expect(SETTINGS_MENU.find((m) => m.id === "inbox-channels")).toMatchObject({ href: ROUTES.settingsInbox, adminOnly: true, featureKey: "inbox" });
    expect(SEARCH_OBJECTS.find((o) => o.type === "inbox_email")).toMatchObject({ featureKeys: ["inbox"], workcenters: ["inbox"] });
    expect(ANALYTICS_META.inbox_open).toMatchObject({ feature: "inbox" });
    expect(read("src/app/(app)/reports/ReportsClient.tsx")).toMatch(/inbox_open:\s+\{[^}]*feature: "inbox", workcenter: "inbox"/);
    expect(read("src/components/DashboardLayout.tsx")).toMatch(/case "inbox_open"/);
    expect(RULES.inbox_new.group(3)).toBe("3 new emails to read");
  });
  it("change history lists it, behind the module", () => {
    const src = read("src/app/(app)/administration/change-history/ChangeHistoryClient.tsx");
    expect(src).toMatch(/value: "inbound_emails"/);
    expect(src).toMatch(/value: "inbox_channels"/);
    expect(src).toMatch(/useTenantFeature\("inbox"\)/);
  });
  it("Nova: comments on a thread (checked against its channel), the mention inbox, and the open-inbox palette entry", () => {
    expect(NOVA_OBJECTS.inbound_emails).toMatchObject({ table: "inbound_emails", workcenters: ["inbox"] });
    expect(read("src/app/api/nova/comments/route.ts")).toMatch(/userCanSeeEmail/);
    expect(read("src/app/api/nova/inbox/route.ts")).toMatch(/inbound_emails: "Email"/);
    expect(read("src/app/api/nova/inbox/route.ts")).toMatch(/hiddenEmailIds/);
    expect(read("src/components/NovaInbox.tsx")).toMatch(/inbound_emails: ROUTES\.inboxMessage/);
    expect(read("src/components/NovaPalette.tsx")).toMatch(/Open inbox/);
    expect(read("src/app/(app)/inbox/[id]/page.tsx")).toMatch(/NovaTimelineSlot objectType="inbound_emails"/);
  });
  it("events: received, handled and converted are catalogued, and each is emitted", () => {
    expect([EVENTS.EMAIL_RECEIVED, EVENTS.EMAIL_HANDLED, EVENTS.EMAIL_CONVERTED]).toEqual(["email.received", "email.handled", "email.converted"]);
    const emitters = read("src/lib/events/emitters.ts");
    for (const k of ["EMAIL_RECEIVED", "EMAIL_HANDLED", "EMAIL_CONVERTED"]) expect(emitters, k).toContain(`EVENTS.${k}`);
  });
  it("the assistant knows how to use the screens (guide ids) and why it cannot read mail", { timeout: 60_000 }, () => {
    for (const id of ["nav.inbox", "inbox.detail", "settings.inbox_channels"]) expect(allManifests().some((m) => m.id === id), id).toBe(true);
    const ids = allManifests().filter((m) => m.id.includes("inbox")).flatMap((m) => m.controls.map((c) => c.id));
    const src = walk(path.join(ROOT, "src")).filter((f) => !/\.test\./.test(f) && !f.includes(`${path.sep}screens${path.sep}`)).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const id of ids) expect(src.includes(`data-guide="${id}"`), `data-guide ${id}`).toBe(true);
  });
  it("cron routes are authorised and public to the session gate; both are scheduled", () => {
    expect(read("src/proxy.ts")).toMatch(/startsWith\("\/api\/inbox\/cron\/"\)/);
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons.find((c) => c.path === "/api/inbox/cron/mailbox")?.schedule).toBe("*/5 * * * *");
    expect(vercel.crons.some((c) => c.path === "/api/inbox/cron/purge")).toBe(true);
    for (const p of ["mailbox", "purge"]) expect(read(`src/app/api/inbox/cron/${p}/route.ts`)).toMatch(/cronSecretOk\(/);
  });
  it("the capability doc exists and the committed facts include it", () => {
    expect(existsSync(path.join(ROOT, "docs/capabilities/inbox.md"))).toBe(true);
    expect(read("src/lib/capability/facts.generated.json")).toMatch(/"inbox"/);
  });
});

describe("what is deliberately NOT exposed: mail is private correspondence", () => {
  it("no v1 endpoint, no Data Workbench route, no Talk-to-data source, no MCP tool", () => {
    for (const mode of ["import", "export", "update"]) {
      for (const n of ["inbox", "inbound_emails", "inbox_channels", "emails"]) expect(existsSync(path.join(ROOT, "src/app/api", mode, n)), `${mode}/${n}`).toBe(false);
    }
    for (const n of ["inbox", "inbound-emails", "emails", "inbound_emails"]) expect(existsSync(path.join(ROOT, "src/app/api/v1", n)), `v1/${n}`).toBe(false);
    expect(Object.keys(LIST_SOURCES).filter((k) => /inbox|inbound|email/i.test(k))).toEqual([]);
    expect(read("mcp-server/mcp.json")).not.toMatch(/inbox|inbound_email/i);
    expect(read("src/lib/api/registry.ts")).not.toMatch(/inbox|inbound_email/i);
  });
  it("the assistant has no object, action or source that reads or writes mail", () => {
    expect(read("src/lib/assistant/objects.ts")).not.toMatch(/inbound_emails|inbox/i);
    expect(read("src/lib/actions/registry.ts")).not.toMatch(/inbound_emails/);
    // /api/inbox has no top-level POST, so the action registry's completeness test has nothing to decide; if one is ever
    // added it must be listed (with a reason) in DEFERRED.
    expect(existsSync(path.join(ROOT, "src/app/api/inbox/route.ts"))).toBe(true);
    expect(read("src/app/api/inbox/route.ts")).not.toMatch(/export\s+async\s+function\s+POST/);
    expect("inbox" in DEFERRED).toBe(false);
  });
});

describe("mail is untrusted data", () => {
  const ui = nonTest([...walk(path.join(ROOT, "src/components/inbox")), ...walk(path.join(ROOT, "src/app/(app)/inbox")), ...walk(path.join(ROOT, "src/app/(app)/settings/inbox"))]);
  it("is drawn as text: no raw HTML, no eval, anywhere on the Inbox screens", () => {
    expect(ui.length).toBeGreaterThan(5);
    for (const f of ui) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
    }
  });
  it("the server never fetches an address found in a message, and never builds one from it", () => {
    const server = nonTest(walk(path.join(ROOT, "src/lib/inbox")));
    for (const f of server) {
      const src = readFileSync(f, "utf8").replace(/(^|\s)\/\/[^\n]*/g, "$1");
      expect(src, f).not.toMatch(/\bfetch\(/);
      if (!f.endsWith("creators.ts")) expect(src, f).not.toMatch(/\bnew URL\(/);
    }
    const creators = readFileSync(path.join(ROOT, "src/lib/inbox/creators.ts"), "utf8");
    // The one place a URL is built is the in-process call to our own routes, with a fixed placeholder host.
    expect(creators.match(/new URL\(/g)).toHaveLength(1);
    expect(creators).toMatch(/new URL\(path, "http:\/\/internal\.invalid"\)/);
  });
  it("what is stored from a message is text: the HTML part is converted, never kept", () => {
    const ingest = readFileSync(path.join(ROOT, "src/lib/inbox/ingest.ts"), "utf8");
    expect(ingest).toMatch(/bodyFrom\(mail\)/);
    expect(ingest).not.toMatch(/html:\s*mail\.html/);
    expect(read("supabase/migrations/0214_inbox.sql")).not.toMatch(/\bbody_html\b/);
  });
});

describe("tenant scope", () => {
  const TABLES = ["inbox_channels", "inbound_emails", "inbound_email_attachments", "inbox_mailbox_state", "record_files", "record_sources"];
  // Statements that are cross-tenant on purpose, each with the reason: a routing lookup by the signed alias, and the cron
  // jobs, which sweep every workspace and then act on each row with that row's own tenant.
  const ON_PURPOSE = new Set([
    "ingest.ts:inbox_channels", "poll.ts:inbox_channels", "poll.ts:inbox_mailbox_state", "purge.ts:inbound_emails",
  ]);
  it("every query on an Inbox table names the tenant, except the four that route or sweep", () => {
    const offenders: string[] = [];
    const files = nonTest([...walk(path.join(ROOT, "src/lib/inbox")), ...walk(path.join(ROOT, "src/app/api/inbox")), ...walk(path.join(ROOT, "src/components/inbox"))]);
    for (const f of files) {
      const src = readFileSync(f, "utf8").replace(/(^|\s)\/\/[^\n]*/g, "$1");
      for (const m of src.matchAll(/\.from\("(\w+)"\)([^;]*);/g)) {
        if (!TABLES.includes(m[1])) continue;
        if (/tenant_id|tenantId/.test(m[2])) continue;
        const key = `${path.basename(f)}:${m[1]}`;
        if (!ON_PURPOSE.has(key)) offenders.push(`${f}: ${m[0].slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("every Inbox route starts from a guard", () => {
    const routes = walk(path.join(ROOT, "src/app/api/inbox")).filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(9);
    for (const f of routes) expect(readFileSync(f, "utf8"), f).toMatch(/inboxAccess\(|adminOnly\(|cronSecretOk\(|requireTenantUser\(/);
  });
  it("no route reads a tenant, channel owner or account owner from the request to decide access", () => {
    for (const f of walk(path.join(ROOT, "src/app/api/inbox")).filter((x) => x.endsWith("route.ts"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/body\??\.tenant_id|searchParams\.get\("tenant/);
    }
  });
});
