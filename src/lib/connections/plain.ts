import type { TestResult } from "./spec";

// What a failed call says to a person. Pure. Every function returns words that name what to fix; nothing here ever
// puts an exception message, a stack, a header or a body into the text. A short vendor code (AADSTS7000222) travels in
// `reference` so support can look it up, and is the only piece of the remote answer that is passed on.

export const fail = (message: string, fix: string | null, over: Partial<TestResult> = {}): TestResult => ({
  ok: false, message, fix, httpStatus: null, reference: null, note: null, ...over,
});

export const pass = (message: string, over: Partial<TestResult> = {}): TestResult => ({
  ok: true, message, fix: null, httpStatus: null, reference: null, note: null, ...over,
});

/** The error codes buried in an exception: Node's fetch hides them under `cause`, sometimes two levels down. */
function codesOf(e: unknown): { codes: string[]; text: string } {
  const codes: string[] = [];
  let text = "";
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const o = cur as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (typeof o.code === "string") codes.push(o.code);
    if (typeof o.name === "string") codes.push(o.name);
    if (typeof o.message === "string") text += ` ${o.message}`;
    cur = o.cause;
  }
  return { codes, text: text.toLowerCase() };
}

/** A call that never got an answer: DNS, TLS, timeout, refused, our own address guard. */
export function describeNetworkError(e: unknown, timeoutSeconds = 15): TestResult {
  const { codes, text } = codesOf(e);
  const has = (...c: string[]) => c.some((x) => codes.includes(x));
  if (/private or internal network/.test(text)) {
    return fail("That address points at a private or internal network, which BPMSquare cannot reach.", "Use the public https address of the system. A server that is only inside your own network needs a public gateway first.");
  }
  if (/must use https|must start with https|isn't a valid url|not a web address/.test(text)) {
    return fail("The address is not a valid https web address.", "Write it in full, starting with https://, for example https://api.example.com.");
  }
  if (/redirected/.test(text)) {
    return fail("The address sends visitors somewhere else, and BPMSquare does not follow redirects.", "Open the address in a browser, copy the final address it lands on and use that one.");
  }
  if (has("ENOTFOUND", "EAI_AGAIN") || /could not be resolved|getaddrinfo/.test(text)) {
    return fail("The address could not be found.", "Check the spelling of the host name in the address. It must be a public name.");
  }
  if (has("TimeoutError", "AbortError", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT") || /timed out|timeout|aborted/.test(text)) {
    return fail(`The system did not answer within ${timeoutSeconds} seconds.`, "Check that the address and port are right and that the system is running. A firewall that drops outside traffic gives this too.");
  }
  if (has("ECONNREFUSED")) {
    return fail("Nothing is listening at that address.", "Check the port and that the service is running and open to the internet.");
  }
  if (has("ECONNRESET", "EPIPE", "UND_ERR_SOCKET")) {
    return fail("The connection was closed by the other side.", "Try again. If it keeps happening, the system may be limiting requests from outside its network.");
  }
  if (codes.some((c) => /^(CERT_|ERR_TLS|ERR_SSL|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_(VERIFY|GET)|EPROTO|ERR_SSL)/.test(c)) || /certificate|tls|ssl|handshake/.test(text)) {
    return fail("A secure connection could not be made.", "The system's certificate may be expired, self-signed or issued for another name. Ask whoever runs it to install a valid public certificate.");
  }
  return fail("The system could not be reached.", "Check the address, and that the system is online and open to the internet.");
}

/** The Microsoft Entra error codes people actually hit, in words. */
const AADSTS: { code: string; message: string; fix: string }[] = [
  { code: "7000222", message: "The client secret has expired.", fix: "In Microsoft Entra open the app registration, Certificates and secrets, make a new secret and paste its Value here." },
  { code: "7000215", message: "The client secret is wrong.", fix: "Paste the secret's Value, not its Secret ID. If you are not sure, make a new secret in Microsoft Entra." },
  { code: "7000218", message: "The client secret is missing or the app is set up as a public client.", fix: "In Microsoft Entra, Authentication, allow public client flows to be off, and paste the client secret." },
  { code: "90002", message: "Microsoft could not find that directory (tenant) ID.", fix: "Copy the directory (tenant) ID again from Microsoft Entra, Overview. Do not use the application ID." },
  { code: "900023", message: "That directory (tenant) ID is not valid.", fix: "Copy the directory (tenant) ID again from Microsoft Entra, Overview." },
  { code: "700016", message: "That client (application) ID was not found in this directory.", fix: "Check the application ID and that it belongs to the directory ID you entered." },
  { code: "700025", message: "The app is set up as a public client and cannot use a secret.", fix: "In Microsoft Entra, Authentication, turn off Allow public client flows." },
  { code: "70011", message: "The scope is not accepted.", fix: "Use the system's address followed by /.default, such as https://yourenv.operations.dynamics.com/.default." },
  { code: "500011", message: "The service the scope names was not found in this directory.", fix: "Check that the scope matches the address of the system, such as https://yourenv.operations.dynamics.com/.default." },
  { code: "invalid_scope", message: "The scope is not accepted.", fix: "Use the system's address followed by /.default." },
  { code: "invalid_client", message: "The sign-in server refused the client ID or secret.", fix: "Check the client ID and make a fresh secret if it is old." },
  { code: "unauthorized_client", message: "That client is not allowed to use this sign-in method.", fix: "Check that the app is allowed to sign in with a client secret." },
];

/** The sign-in server's own refusal (a 400 or 401 from the token address). */
export function describeTokenFailure(status: number, bodyText: string): TestResult {
  let desc = bodyText;
  let oauthError = "";
  try {
    const j = JSON.parse(bodyText) as { error?: unknown; error_description?: unknown };
    if (typeof j.error === "string") oauthError = j.error;
    desc = `${typeof j.error_description === "string" ? j.error_description : ""} ${oauthError}`;
  } catch { /* not JSON: use the text only to look for a code */ }
  const aad = /AADSTS(\d{3,7})/.exec(desc);
  if (aad) {
    const hit = AADSTS.find((a) => a.code === aad[1]);
    if (hit) return fail(hit.message, hit.fix, { httpStatus: status, reference: `AADSTS${aad[1]}` });
    return fail("Microsoft refused the sign-in.", "Check the directory ID, the client ID and the secret. The reference below helps support look it up.", { httpStatus: status, reference: `AADSTS${aad[1]}` });
  }
  const named = AADSTS.find((a) => a.code === oauthError);
  if (named) return fail(named.message, named.fix, { httpStatus: status, reference: oauthError });
  if (status === 404) return fail("The sign-in server address was not found.", "Check the token address, or the directory ID if you use Microsoft Entra.", { httpStatus: status });
  if (status === 401 || status === 403 || status === 400) return fail("The sign-in server refused the client ID and secret.", "Check the client ID, make a fresh secret if it is old, and check the scope.", { httpStatus: status });
  if (status >= 500) return fail("The sign-in server had an error.", "Try again in a few minutes.", { httpStatus: status });
  return fail("The sign-in server answered in a way BPMSquare does not understand.", "Check the token address.", { httpStatus: status });
}

export const TOKEN_EMPTY = () => fail("The sign-in server answered, but without an access token.", "Check the token address, the client ID and the scope.");

/** A permission name in the body of a 403, such as Dataverse's prvReadAccount. */
function missingPermission(body: string): string | null {
  const m = /\b(prv[A-Z][A-Za-z]{2,60})\b/.exec(body);
  return m ? m[1] : null;
}

/** The answer of the system itself, once signed in. `body` is only read for a permission name, never shown. */
export function describeHttpFailure(status: number, body: string, kind: "rest" | "odata" = "rest"): TestResult {
  if (status === 401) {
    return fail("The system refused the sign-in (401).", "Check the credentials are still valid: a secret or token may have expired, or the key may be wrong.", { httpStatus: 401 });
  }
  if (status === 403) {
    const perm = missingPermission(body);
    return fail(
      perm ? `Signed in, but the account is not allowed to read this (403). It is missing the permission ${perm}.` : "Signed in, but the account is not allowed to read this (403).",
      "Give the account behind these credentials a role that can read this data. For Dynamics 365 Finance and Operations, register the app under System administration, Microsoft Entra ID applications, and link it to a user with a security role.",
      { httpStatus: 403, reference: perm },
    );
  }
  if (status === 404) {
    return fail(
      kind === "odata" ? "The address answered, but it is not an OData service (404)." : "The address answered, but nothing is at this path (404).",
      kind === "odata" ? "The service address should end where $metadata can be read, such as .../data or .../api/data/v9.2." : "Check the address, or add a check path that exists, such as /health.",
      { httpStatus: 404 },
    );
  }
  if (status === 405) return fail("The address does not accept this kind of request (405).", "Check the address and the check path.", { httpStatus: 405 });
  if (status === 408 || status === 504) return fail("The system took too long to answer.", "Try again. If it keeps happening, ask whoever runs the system.", { httpStatus: status });
  if (status === 429) return fail("The system says there were too many requests (429).", "Wait a minute and test again.", { httpStatus: 429 });
  if (status >= 500) return fail(`The system had an error (HTTP ${status}).`, "Try again in a few minutes. If it keeps happening, ask whoever runs the system.", { httpStatus: status });
  if (status >= 300 && status < 400) return fail("The address sends visitors somewhere else, and BPMSquare does not follow redirects.", "Open the address in a browser, copy the final address it lands on and use that one.", { httpStatus: status });
  return fail(`The system answered with HTTP ${status}, which BPMSquare did not expect.`, "Check the address.", { httpStatus: status });
}

/** A 200 that is a web page: the address of the website, not of its API. */
export const NOT_DATA = (status: number) => fail("The address returned a web page, not data.", "This looks like the address of a website. Use the address of its API.", { httpStatus: status });
export const EMPTY_ANSWER = (status: number) => fail("The system answered, but with nothing in it.", "Check that the address is the API's address, not an empty page.", { httpStatus: status });
