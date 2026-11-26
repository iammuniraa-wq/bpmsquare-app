// The SQL the starter-template seeds are made of (scripts/gen-estimate-seeds.ts writes the files). Pure and deterministic: the same
// starters give the same text, byte for byte, so a test can hold the committed seed and the bundle to the source.

import { STARTER_TEMPLATES } from "./starterTemplates";
import type { StarterTemplate } from "./starterTemplates";
import { productRowFor, starterCatalogue } from "./starterCatalogue";
import type { StarterCatalogueItem } from "./starterCatalogue";
import { validateTemplate } from "./template";
import { WASTEWATER_STARTERS } from "./starterTemplatesWastewater";

export const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function dq(tag: string, value: unknown): string {
  const json = JSON.stringify(value);
  if (json.includes(`$${tag}$`)) throw new Error(`The JSON contains the quote tag $${tag}$`);
  return `$${tag}$${json}$${tag}$::jsonb`;
}

const textArray = (xs: readonly string[]) => (xs.length > 0 ? `array[${xs.map(sqlText).join(", ")}]::text[]` : "null");

export function starterBody(s: StarterTemplate) {
  const v = validateTemplate({ geometry: s.geometry, inputs: s.inputs, rates: s.rates, rules: s.rules });
  if (!v.ok || !v.template) throw new Error(`${s.name} does not validate: ${JSON.stringify(v.issues)}`);
  return v.template;
}

/**
 * Installs (or refreshes) one starter template for the tenant in variable `t`. With `addOnly` the template is inserted when the
 * workspace has none of that name, and an existing one is left exactly as it is (a locked starter is not refreshed).
 */
export function installBlock(s: StarterTemplate, indent: string, opts: { addOnly?: boolean } = {}): string {
  const b = starterBody(s);
  const name = sqlText(s.name);
  const insert = `
if not exists (select 1 from estimate_templates where tenant_id = t and lower(name) = lower(${name})) then
  insert into estimate_templates (tenant_id, name, description, trade, geometry, version, is_active, quote_granularity, inputs, rates, rules, keywords, icon, locked, customer_visible)
  values (
    t, ${name}, ${sqlText(s.description)}, ${sqlText(s.trade)}, ${sqlText(s.geometry ?? "")}, 1, true, ${sqlText(s.quote_granularity)},
    ${dq("inputs", b.inputs)},
    ${dq("rates", b.rates)},
    ${dq("rules", b.rules)},
    ${textArray(s.keywords ?? [])}, ${s.icon ? sqlText(s.icon) : "null"}, ${s.locked ? "true" : "false"}, ${s.customer_visible ? "true" : "false"}
  );`;
  if (opts.addOnly) {
    return `${insert}
end if;`.split("\n").map((l) => (l ? indent + l : l)).join("\n");
  }
  const lines = `${insert}
else
  -- Already there: the catalogue fields are filled only where empty. A LOCKED starter is
  -- product-owned, so its inputs, rates and rules are refreshed to the current ones (the
  -- version goes up when they changed); an editable template of the workspace is left alone.
  update estimate_templates set
    keywords = coalesce(keywords, ${textArray(s.keywords ?? [])}),
    icon = coalesce(icon, ${s.icon ? sqlText(s.icon) : "null"})
  where tenant_id = t and lower(name) = lower(${name});
  ${s.locked ? `update estimate_templates set
    inputs = ${dq("inputs", b.inputs)},
    rates = ${dq("rates", b.rates)},
    rules = ${dq("rules", b.rules)},
    locked = true,
    version = case when inputs is distinct from ${dq("inputs", b.inputs)} or rules is distinct from ${dq("rules", b.rules)} then version + 1 else version end
  where tenant_id = t and lower(name) = lower(${name}) and locked = true;` : ""}
end if;${s.drawing_map && s.locked ? `
-- The layer map needs migration 0215 (estimate_templates.drawing_map); without it the starter is simply left without one.
if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'estimate_templates' and column_name = 'drawing_map') then
  update estimate_templates set drawing_map = ${dq("drawing_map", s.drawing_map)}
  where tenant_id = t and lower(name) = lower(${name}) and locked = true and drawing_map is distinct from ${dq("drawing_map", s.drawing_map)};
end if;` : ""}`;
  return lines.split("\n").map((l) => (l ? indent + l : l)).join("\n");
}

/**
 * The catalogue items the starters price from, for the tenant in variable `t`: a product is added when the workspace has none with
 * that SKU, with a business reference (PRD-####) after its highest. An item the workspace already has, edited, renamed or imported
 * from a rate sheet, is never touched. Marked illustrative until a rate sheet replaces the cost.
 */
export function catalogueBlock(items: readonly StarterCatalogueItem[], indent: string): string {
  const rows = items.map((i) => {
    const p = productRowFor(i);
    return { sku: p.sku, name: p.name, uom: p.uom, description: p.description, cost: p.cost_price, custom_data: p.custom_data };
  });
  const text = `
-- Catalogue items for the starters (${rows.length}). Needs the products table (migration 0098); skipped without it.
if to_regclass('public.products') is not null then
  select coalesce(max(nullif(regexp_replace(ref, '\\D', '', 'g'), '')::int), 0) into seq from products where tenant_id = t and ref ~ '^PRD-\\d+$';
  for item in select * from jsonb_to_recordset(${dq("items", rows)}) as x(sku text, name text, uom text, description text, cost numeric, custom_data jsonb) loop
    if not exists (select 1 from products where tenant_id = t and sku = item.sku) then
      seq := seq + 1;
      insert into products (tenant_id, ref, name, sku, uom, description, cost_price, status, custom_data)
      values (t, 'PRD-' || lpad(seq::text, 4, '0'), item.name, item.sku, item.uom, item.description, item.cost, 'active', item.custom_data);
    end if;
  end loop;
end if;`;
  return text.split("\n").map((l) => (l ? indent + l : l)).join("\n");
}

export const GUARD_0213 = `
  if not exists (select 1 from information_schema.columns where table_name = 'estimate_templates' and column_name = 'locked') then
    raise exception 'Run supabase/migrations/0213_estimate_template_catalogue.sql first (estimate_templates.locked is missing).';
  end if;
  if to_regclass('public.estimate_templates') is null then
    raise exception 'Run supabase/migrations/0131_estimator.sql first.';
  end if;`;

/** scripts/seed-estimate-templates-starter.sql */
export function startersSql(starters: readonly StarterTemplate[] = STARTER_TEMPLATES): string {
  return `-- Starter estimate templates (the chain-link fence, the tiles, porta cabin and GCC starters, and the catalogue fields of the others)
-- and the illustrative catalogue items the GCC starters (pipes, precast elements, civil basics) price their materials from.
-- Run AFTER supabase/migrations/0131_estimator.sql and 0213_estimate_template_catalogue.sql; the catalogue items need 0098 (products).
-- Idempotent: a template is added if the workspace has none of that name; a workspace's own
-- editable template is never changed; the LOCKED starters are refreshed to the current ones. A catalogue item is added only when the
-- workspace has no product with that SKU, so an item edited or repriced from a rate sheet is never overwritten.
-- GENERATED by scripts/gen-estimate-seeds.ts from src/lib/estimator/starterTemplates.ts; do not
-- edit by hand, change that file and regenerate.
--
-- WHO GETS IT: every DEMO tenant (is_demo = true) that has the estimator module on.
--
-- ONE OTHER WORKSPACE (for example a client that has the estimator module): either press
-- "Add the ... starter" in that workspace's Settings > Estimate templates (no SQL; it adds the catalogue items too),
-- or change the single line marked TARGET below to
--     select id from tenants where slug = '<the workspace slug>' and coalesce((features->>'estimator')::boolean, false)
-- and run it. A live client is never targeted by this file as shipped.

do $seed$
declare
  t uuid;
  seq int;
  item record;
begin${GUARD_0213}

  for t in -- TARGET
    select id from tenants where is_demo = true and coalesce((features->>'estimator')::boolean, false)
  loop
${starters.map((s) => installBlock(s, "    ")).join("\n")}
${catalogueBlock(starterCatalogue(starters), "    ")}
  end loop;
end
$seed$;
`;
}

export const BUNDLE_38_FILE = "run-bundle-38-starter-templates-pipes-precast-civil-2026-10-26.sql";

/** scripts/run-bundle-38-...: the starters seed with the bundle header (the same shape bundle 24 and 26 had). */
export function bundle38Sql(): string {
  const later = new Set(WASTEWATER_STARTERS.map((w) => w.name));
  return `-- Bundle 38 (2026-10-26): add the pipes and fittings, precast elements and civil basics (excavation, reinforced concrete, blockwork and plaster) starter estimate templates, and the illustrative catalogue items they price their materials from. Run AFTER migrations 0131, 0213 and 0098. No new migration. Safe to re-run. Run on dev and production.
${startersSql(STARTER_TEMPLATES.filter((s) => (s.catalogue ?? []).length > 0 && !later.has(s.name)))}`;
}

const wastewaterStarters = (): StarterTemplate[] => WASTEWATER_STARTERS.map((w) => {
  const hit = STARTER_TEMPLATES.find((s) => s.name === w.name);
  if (!hit) throw new Error(`${w.name} is not registered in STARTER_TEMPLATES`);
  return hit;
});

export const BUNDLE_57_FILE = "run-bundle-57-starter-wastewater-civil-2026-11-26.sql";
export const SLUG_SCRIPT_FILE = "seed-wastewater-civil-starter-for-slug.sql";
/** The one line that names the workspace in the slug script; a test reads it back so the slug is written in exactly one place. */
export const SLUG_VARIABLE_RE = /^ {2}v_slug text := '([^']*)';/m;

/** scripts/run-bundle-57-...: the wastewater plant civil package starter and the catalogue items it prices from, for demo tenants like bundle 38. */
export function bundle57Sql(): string {
  return `-- Bundle 57 (2026-11-26): add the locked starter estimate template "Wastewater plant civil package (illustrative)" and the illustrative catalogue items it prices from (waterproofing, geotextile, HDPE liner, crushed rock; the civil basics' fill, reinforcement, formwork and ready-mix items too, where a workspace lacks them). Run AFTER migrations 0131, 0213 and 0098. No new migration. Safe to re-run. Run on dev and production. For ONE named client workspace run scripts/${SLUG_SCRIPT_FILE} instead.
${startersSql(wastewaterStarters())}`;
}

/**
 * scripts/seed-wastewater-civil-starter-for-slug.sql: the same template and items for ONE named, non-demo workspace. Adds only what is
 * missing: an existing template of that name is not refreshed and an existing product with a SKU is never touched.
 */
export function wastewaterSlugSql(slug: string): string {
  const starters = wastewaterStarters();
  const names = starters.map((s) => s.name).join(", ");
  const items = starterCatalogue(starters);
  return `-- Add the locked starter estimate template "${names}" and the illustrative catalogue items it prices from, to ONE workspace.
-- Run by hand in the SQL editor of the database that holds the workspace. Needs supabase/migrations/0131_estimator.sql and
-- 0213_estimate_template_catalogue.sql; the catalogue items need 0098 (products) and are skipped without it.
--
-- WHICH WORKSPACE: change the one line marked CHANGE THIS (v_slug) and nothing else. The script stops, changing nothing, when
--   - no workspace has that slug,
--   - the workspace is flagged as a demo workspace (those get scripts/${BUNDLE_57_FILE} instead),
--   - the workspace does not have the Estimates module on (features.estimator): switch it on in /admin/tenants first.
--
-- ADD ONLY, never overwrite: the template is added when the workspace has none of that name, and an existing one is left exactly as it
-- is. Each of the ${items.length} catalogue items is added only when the workspace has no product with that SKU, so an item that was edited,
-- renamed or repriced from a rate sheet is never touched. Items are marked illustrative (name suffix, custom_data.illustrative, no cost date)
-- until a rate sheet replaces the cost. Safe to run again. Needs no other script first.
-- GENERATED by scripts/gen-estimate-seeds.ts from src/lib/estimator/starterTemplatesWastewater.ts; do not edit by hand, change that
-- file and regenerate.

do $seed$
declare
  v_slug text := ${sqlText(slug)}; -- CHANGE THIS: the slug of the workspace
  t uuid;
  v_demo boolean;
  v_est boolean;
  seq int;
  item record;
begin${GUARD_0213}

  select id, coalesce(is_demo, false), coalesce((features->>'estimator')::boolean, false) into t, v_demo, v_est from tenants where slug = v_slug;
  if t is null then
    raise exception 'No workspace with slug % was found. Nothing was changed. Check the slug in the tenants table.', v_slug;
  end if;
  if v_demo then
    raise exception 'The workspace % is flagged as a demo workspace. Run scripts/${BUNDLE_57_FILE} for demo workspaces. Nothing was changed.', v_slug;
  end if;
  if not v_est then
    raise exception 'The workspace % does not have the Estimates module on (features.estimator). Switch it on in /admin/tenants, then run this again. Nothing was changed.', v_slug;
  end if;
${starters.map((s) => installBlock(s, "  ", { addOnly: true })).join("\n")}
${catalogueBlock(items, "  ")}

  raise notice 'Done for workspace %: the template and the catalogue items were added where missing; nothing existing was changed.', v_slug;
end
$seed$;
`;
}
