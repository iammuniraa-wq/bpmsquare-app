/**
 * One-time migration: encrypt plaintext PII in accounts and contacts.
 * Run with FIELD_ENCRYPTION_KEY and Supabase env vars set in .env.local.
 *
 * Usage: node scripts/encrypt-existing-pii.mjs
 *        node scripts/encrypt-existing-pii.mjs --dry-run
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually
const envPath = resolve(process.cwd(), ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  const k = trimmed.slice(0, eq).trim();
  const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  process.env[k] ??= v;
}

const DRY_RUN = process.argv.includes("--dry-run");
const ALGO = "aes-256-gcm";
const ENC_PREFIX = "enc:v1:";

function getKey() {
  const hex = process.env.FIELD_ENCRYPTION_KEY;
  if (!hex) throw new Error("FIELD_ENCRYPTION_KEY not set");
  return Buffer.from(hex, "hex");
}

function isEncrypted(v) {
  return typeof v === "string" && v.startsWith(ENC_PREFIX);
}

function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already encrypted
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENC_PREFIX + [iv, authTag, encrypted].map((b) => b.toString("base64")).join(":");
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ACCOUNT_PII = ["phone", "phone2", "email", "email2", "gstin"];
const CONTACT_PII = ["phone", "phone2", "phone3", "email", "email2"];

async function migrateTable(table, piiFields) {
  console.log(`\n── ${table} ──`);
  let offset = 0;
  const PAGE = 500;
  let total = 0, updated = 0, skipped = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(["id", ...piiFields].join(","))
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    total += data.length;

    for (const row of data) {
      const patch = {};
      for (const f of piiFields) {
        if (row[f] && !isEncrypted(row[f])) patch[f] = encrypt(row[f]);
      }

      if (Object.keys(patch).length === 0) { skipped++; continue; }

      if (DRY_RUN) {
        console.log(`  [dry-run] ${table} ${row.id}: would encrypt`, Object.keys(patch).join(", "));
      } else {
        const { error: ue } = await supabase.from(table).update(patch).eq("id", row.id);
        if (ue) { console.error(`  ERROR ${row.id}:`, ue.message); continue; }
      }
      updated++;
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`  total=${total}  encrypted=${updated}  already-ok=${skipped}${DRY_RUN ? "  (dry-run)" : ""}`);
}

console.log(DRY_RUN ? "DRY RUN — no writes" : "LIVE RUN — writing to Supabase");
await migrateTable("accounts", ACCOUNT_PII);
await migrateTable("contacts", CONTACT_PII);
console.log("\nDone.");
