import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { Account, Contact } from "@/lib/types";

const ALGO = "aes-256-gcm";
const ENC_PREFIX = "enc:v1:";

// Missing key used to fail completely silently -- every PII write would land
// in the DB as plaintext with zero signal anywhere that encryption had
// stopped happening. Not a hard throw (that would turn one missing env var
// into a full outage on every account/contact read+write); logged loudly
// instead, once per process, so it's impossible to miss in server logs.
let warnedMissingKey = false;
function getKey(): Buffer | null {
  const hex = process.env.FIELD_ENCRYPTION_KEY;
  if (!hex) {
    if (!warnedMissingKey) {
      console.error("[encryption] FIELD_ENCRYPTION_KEY is not set -- PII fields are being read/written as PLAINTEXT.");
      warnedMissingKey = true;
    }
    return null;
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return plaintext ?? null;
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENC_PREFIX + [iv, authTag, encrypted].map((b) => b.toString("base64")).join(":");
}

export function decrypt(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined || ciphertext === "") return ciphertext ?? null;
  if (!ciphertext.startsWith(ENC_PREFIX)) return ciphertext;

  const key = getKey();
  if (!key) return ciphertext;

  const [ivB64, tagB64, dataB64] = ciphertext.slice(ENC_PREFIX.length).split(":");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return decipher.update(Buffer.from(dataB64, "base64")).toString("utf8") + decipher.final("utf8");
}

const ACCOUNT_PII: (keyof Account)[] = ["phone", "phone2", "email", "email2", "gstin"];
const CONTACT_PII: (keyof Contact)[] = ["phone", "phone2", "phone3", "email", "email2"];

export function encryptAccountFields<T extends Partial<Record<string, unknown>>>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const f of ACCOUNT_PII) if (f in out && typeof out[f] === "string") out[f] = encrypt(out[f] as string);
  return out as T;
}

export function decryptAccount(a: Account): Account {
  const out = { ...a } as Record<string, unknown>;
  for (const f of ACCOUNT_PII) if (f in out && typeof out[f] === "string") out[f] = decrypt(out[f] as string);
  return out as Account;
}

export function encryptContactFields<T extends Partial<Record<string, unknown>>>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const f of CONTACT_PII) if (f in out && typeof out[f] === "string") out[f] = encrypt(out[f] as string);
  return out as T;
}

export function decryptContact(c: Contact): Contact {
  const out = { ...c } as Record<string, unknown>;
  for (const f of CONTACT_PII) if (f in out && typeof out[f] === "string") out[f] = decrypt(out[f] as string);
  return out as Contact;
}
