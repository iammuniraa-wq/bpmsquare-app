import { describe, expect, it, vi, afterEach } from "vitest";
import { assertPublicHost, assertPublicHttpUrl, assertSafeHttpsUrl, fetchPublic, isPrivateAddress, parseIPv6 } from "./safeHost";

// Audit 2026-10-21 (M2): a URL's hostname for [::ffff:127.0.0.1] is "[::ffff:7f00:1]" -- the
// hex form -- and the old dotted-only check let every IPv4-mapped, 6to4 and NAT64 spelling of
// 127.0.0.1 or 169.254.169.254 through as "public".

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "192.0.0.8", "198.18.0.1", "203.0.113.9", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fec0::1", "fd00::1", "fc00::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:0a00:0001", "0:0:0:0:0:ffff:a00:1",
    "::7f00:1", "::a9fe:a9fe",
    "64:ff9b::a9fe:a9fe", "64:ff9b::7f00:1", "64:ff9b:1::1",
    "2002:a9fe:a9fe::", "2002:7f00:1::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1",
  ])("treats %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.63.0.1", "198.20.0.1",
    "2606:4700:4700::1111", "2a00:1450:4009:81f::200e", "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "2002:808:808::",
  ])("treats %s as public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it("treats what it cannot parse as private", () => {
    expect(isPrivateAddress("1.2.3")).toBe(true);
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIPv6("::1::2")).toBeNull();
  });
});

describe("URL guards", () => {
  it("refuses the hostnames the URL parser produces for mapped loopback and metadata", async () => {
    for (const raw of ["https://[::ffff:127.0.0.1]/", "https://[::ffff:169.254.169.254]/latest", "https://[64:ff9b::a9fe:a9fe]/", "https://127.0.0.1/", "https://2130706433/", "https://0x7f.1/"]) {
      await expect(assertSafeHttpsUrl(raw), raw).rejects.toThrow(/private or internal/);
      await expect(assertPublicHttpUrl(raw.replace("https:", "http:")), raw).rejects.toThrow(/private or internal/);
    }
  });

  it("accepts a public literal address, https for the strict guard and http for the lenient one", async () => {
    await expect(assertSafeHttpsUrl("https://8.8.8.8/x")).resolves.toBeInstanceOf(URL);
    await expect(assertPublicHttpUrl("http://8.8.8.8/x")).resolves.toBeInstanceOf(URL);
    await expect(assertSafeHttpsUrl("http://8.8.8.8/x")).rejects.toThrow(/https/);
    await expect(assertPublicHttpUrl("ftp://8.8.8.8/x")).rejects.toThrow();
    await expect(assertPublicHost("localhost")).rejects.toThrow(/private or internal/);
  });
});

describe("fetchPublic", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never calls fetch for a private address", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(fetchPublic("http://[::ffff:7f00:1]:8080/admin")).rejects.toThrow(/private or internal/);
    expect(f).not.toHaveBeenCalled();
  });

  it("re-checks every redirect hop and refuses one that lands on a private address", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    vi.stubGlobal("fetch", f);
    await expect(fetchPublic("https://8.8.8.8/start")).rejects.toThrow(/private or internal/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("follows a public redirect, drops credentials across origins and turns a 302 into a GET", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://1.1.1.1/next" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await fetchPublic("https://8.8.8.8/start", { method: "POST", body: "{}", headers: { authorization: "Bearer x", "content-type": "application/json" } });
    expect(res.status).toBe(200);
    const second = f.mock.calls[1];
    expect(String(second[0])).toBe("https://1.1.1.1/next");
    expect(second[1].method).toBe("GET");
    expect(second[1].body).toBeUndefined();
    expect(new Headers(second[1].headers).get("authorization")).toBeNull();
    expect(second[1].redirect).toBe("manual");
  });
});
