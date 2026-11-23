import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAWING_FILE_BUCKET } from "./files";

// The two reads the register makes of a stored file without loading it whole into memory: the first bytes (to decide what it really is
// and how big it is) and the SHA-256 of all of it (checked again at release against the fingerprint taken at upload). Both go through a
// short-lived signed link on the service role; the bucket has no member policy (0255).

export const DRAWING_BUCKET_NAME = DRAWING_FILE_BUCKET;

async function signed(admin: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await admin.storage.from(DRAWING_BUCKET_NAME).createSignedUrl(path, 60);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

export async function readHead(admin: SupabaseClient, path: string): Promise<{ ok: true; head: Uint8Array; size: number } | { ok: false }> {
  const url = await signed(admin, path);
  if (!url) return { ok: false };
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-4095" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { ok: false };
    const head = new Uint8Array(await res.arrayBuffer()).subarray(0, 4096);
    const range = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
    const size = range ? Number(range[1]) : Number(res.headers.get("content-length") ?? head.byteLength);
    return { ok: true, head: new Uint8Array(head), size: Number.isFinite(size) ? size : head.byteLength };
  } catch {
    return { ok: false };
  }
}

export async function hashOfObject(admin: SupabaseClient, path: string): Promise<{ ok: true; sha256: string } | { ok: false }> {
  const url = await signed(admin, path);
  if (!url) return { ok: false };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(50_000) });
    if (!res.ok || !res.body) return { ok: false };
    const hash = createHash("sha256");
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return { ok: true, sha256: hash.digest("hex") };
  } catch {
    return { ok: false };
  }
}
