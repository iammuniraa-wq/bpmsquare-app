// A body from a host a tenant typed is read up to a byte cap, never whole: a hostile
// or broken receiver can stream hundreds of MB into a warm shared instance.

export class BodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`The answer is larger than ${Math.round(maxBytes / 1024 / 1024 * 10) / 10} MB`);
    this.name = "BodyTooLargeError";
  }
}

async function readUpTo(res: Response, maxBytes: number, onOverflow: "throw" | "truncate"): Promise<{ text: string; truncated: boolean }> {
  const declared = Number(res.headers.get("content-length"));
  if (onOverflow === "throw" && Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  const reader = res.body?.getReader();
  if (!reader) {
    const t = await res.text();
    if (Buffer.byteLength(t) > maxBytes) {
      if (onOverflow === "throw") throw new BodyTooLargeError(maxBytes);
      return { text: Buffer.from(t).subarray(0, maxBytes).toString("utf8"), truncated: true };
    }
    return { text: t, truncated: false };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => {});
      if (onOverflow === "throw") throw new BodyTooLargeError(maxBytes);
      chunks.push(Buffer.from(value.subarray(0, maxBytes - total)));
      truncated = true;
      break;
    }
    total += value.byteLength;
    chunks.push(Buffer.from(value));
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}

/** The whole body as text, or BodyTooLargeError past `maxBytes` (the reader is cancelled at the cap). */
export async function readBounded(res: Response, maxBytes: number): Promise<string> {
  return (await readUpTo(res, maxBytes, "throw")).text;
}

/** The first `maxBytes` of the body; the rest is dropped, not an error. For logging an answer we never act on. */
export async function readTruncated(res: Response, maxBytes: number): Promise<string> {
  return (await readUpTo(res, maxBytes, "truncate")).text;
}
