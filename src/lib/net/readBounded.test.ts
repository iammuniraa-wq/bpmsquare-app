import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readBounded, readTruncated } from "./readBounded";

function streamOf(chunks: string[], pulled: { n: number }): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= chunks.length) return c.close();
      pulled.n++;
      c.enqueue(enc.encode(chunks[i++]));
    },
  });
}

describe("readBounded", () => {
  it("returns a small body whole", async () => {
    expect(await readBounded(new Response("hello"), 100)).toBe("hello");
  });

  it("throws on a declared length over the cap without reading", async () => {
    const res = new Response("x", { headers: { "content-length": "5000000" } });
    await expect(readBounded(res, 1000)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("stops reading an oversized stream at the cap", async () => {
    const pulled = { n: 0 };
    const res = new Response(streamOf(Array(1000).fill("x".repeat(100)), pulled));
    await expect(readBounded(res, 1000)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(pulled.n).toBeLessThan(50);
  });
});

describe("readTruncated", () => {
  it("keeps the first bytes of an oversized stream and does not throw", async () => {
    const pulled = { n: 0 };
    const res = new Response(streamOf(Array(1000).fill("abcdefghij"), pulled));
    const t = await readTruncated(res, 25);
    expect(t).toBe("abcdefghij".repeat(2) + "abcde");
    expect(pulled.n).toBeLessThan(50);
  });

  it("returns a small body whole", async () => {
    expect(await readTruncated(new Response("ok"), 25)).toBe("ok");
  });
});
