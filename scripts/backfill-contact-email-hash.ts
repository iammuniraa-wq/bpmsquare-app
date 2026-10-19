// Fills contacts.email_hash (migration 0138) for contacts that existed before
// it. The hash is the blind index in src/lib/marketing/blindIndex.ts: an HMAC
// of the normalised email under a subkey derived from FIELD_ENCRYPTION_KEY.
//
//   npx jiti scripts/backfill-contact-email-hash.ts --dry-run
//   npx jiti scripts/backfill-contact-email-hash.ts
//   npx jiti scripts/backfill-contact-email-hash.ts --tenant <slug>
//   npx jiti scripts/backfill-contact-email-hash.ts --rehash     (recompute rows that already have a hash)
//
// Needs FIELD_ENCRYPTION_KEY, NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY (read from .env.local, like encrypt-existing-pii.mjs).
// Run it AFTER 0138. Idempotent: by default it only touches contacts that have
// an email and no hash, so running it twice, or after a partial run, is safe.
// Tenant-scoped: it walks tenants one at a time and every query names the
// tenant it is working on.

import { createDecipheriv } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { emailBlindIndex } from "../src/lib/marketing/blindIndex";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    process.env[t.slice(0, eq).trim()] ??= t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const DRY_RUN = process.argv.includes("--dry-run");
const REHASH = process.argv.includes("--rehash");
const tenantArgIdx = process.argv.indexOf("--tenant");
const ONLY_TENANT = tenantArgIdx >= 0 ? process.argv[tenantArgIdx + 1] : null;
const PAGE = 500;
const ENC_PREFIX = "enc:v1:";

const keyHex = process.env.FIELD_ENCRYPTION_KEY;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!keyHex) throw new Error("FIELD_ENCRYPTION_KEY is not set. The blind-index key is derived from it; there is no default.");
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

function decrypt(value: string | null): string | null {
  if (!value || !value.startsWith(ENC_PREFIX)) return value;
  const [ivB64, tagB64, dataB64] = value.slice(ENC_PREFIX.length).split(":");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyHex as string, "hex"), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return d.update(Buffer.from(dataB64, "base64")).toString("utf8") + d.final("utf8");
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  let tq = admin.from("tenants").select("id, slug");
  if (ONLY_TENANT) tq = tq.eq("slug", ONLY_TENANT);
  const { data: tenants, error: tErr } = await tq;
  if (tErr) throw new Error(`Could not list tenants: ${tErr.message}`);
  if (!tenants?.length) throw new Error(ONLY_TENANT ? `No tenant with slug "${ONLY_TENANT}".` : "No tenants found.");

  const totals = { scanned: 0, hashed: 0, skipped_no_valid_email: 0, failed: 0 };
  for (const tenant of tenants) {
    let lastId: string | null = null;
    const mine = { scanned: 0, hashed: 0, skipped: 0, failed: 0 };
    for (;;) {
      let q = admin
        .from("contacts")
        .select("id, email")
        .eq("tenant_id", tenant.id)
        .not("email", "is", null)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (!REHASH) q = q.is("email_hash", null);
      if (lastId) q = q.gt("id", lastId);
      const { data, error } = await q;
      if (error) throw new Error(`[${tenant.slug}] read failed (is 0138 applied?): ${error.message}`);
      if (!data?.length) break;

      for (const row of data as { id: string; email: string }[]) {
        mine.scanned++;
        lastId = row.id;
        let hash: string | null = null;
        try {
          hash = emailBlindIndex(decrypt(row.email), keyHex);
        } catch {
          mine.failed++;
          continue;
        }
        if (!hash) { mine.skipped++; continue; }
        if (DRY_RUN) { mine.hashed++; continue; }
        const { error: uErr } = await admin.from("contacts").update({ email_hash: hash }).eq("id", row.id).eq("tenant_id", tenant.id);
        if (uErr) { mine.failed++; console.error(`[${tenant.slug}] ${row.id}: ${uErr.message}`); } else mine.hashed++;
      }
      if (data.length < PAGE) break;
    }
    console.error(`[${tenant.slug}] scanned ${mine.scanned}, ${DRY_RUN ? "would hash" : "hashed"} ${mine.hashed}, no usable email ${mine.skipped}, failed ${mine.failed}`);
    totals.scanned += mine.scanned; totals.hashed += mine.hashed; totals.skipped_no_valid_email += mine.skipped; totals.failed += mine.failed;
  }
  console.error(`${DRY_RUN ? "[dry run] " : ""}Done. Scanned ${totals.scanned}, ${DRY_RUN ? "would hash" : "hashed"} ${totals.hashed}, skipped ${totals.skipped_no_valid_email}, failed ${totals.failed}.`);
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
