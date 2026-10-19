import crypto from "crypto";

// Certificate login for Microsoft Entra ID: instead of sending a secret, we
// send a short-lived JWT ("client assertion") signed with the certificate's
// private key. Entra checks the signature against the certificate the
// customer uploaded to their app registration, identified by its thumbprint.
// Pure (Node crypto only) so it is unit-tested directly.

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** DER bytes of the first certificate in a PEM bundle. */
export function certDerFromPem(pem: string): Buffer {
  const cert = new crypto.X509Certificate(pem);
  return cert.raw;
}

export function buildClientAssertion(args: {
  clientId: string;
  tokenUrl: string;
  certDer: Buffer;
  privateKeyPem: string;
  nowSec?: number;
  jti?: string;
}): string {
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  const header = {
    // Microsoft's current spec (Entra "certificate credentials"): alg PS256
    // with PSS padding, the certificate named by x5t#S256. The SHA-1 x5t is
    // still sent for directories not yet matching on SHA-256.
    alg: "PS256",
    typ: "JWT",
    x5t: b64url(crypto.createHash("sha1").update(args.certDer).digest()),
    "x5t#S256": b64url(crypto.createHash("sha256").update(args.certDer).digest()),
  };
  const payload = {
    aud: args.tokenUrl,
    iss: args.clientId,
    sub: args.clientId,
    jti: args.jti ?? crypto.randomUUID(),
    // Short-lived: the spec asks for exp at most 5-10 minutes after nbf.
    nbf: now - 30,
    iat: now,
    exp: now + 300,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), { key: args.privateKeyPem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST });
  return `${signingInput}.${b64url(signature)}`;
}

/** Entra directory: a GUID or a verified domain -- anything else would let a
 *  typed value change the token URL's path. */
export function validDirectory(dir: string | undefined): boolean {
  return !!dir && (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dir) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(dir));
}

export function tokenUrl(directory: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(directory)}/oauth2/v2.0/token`;
}

export function authorizeUrl(directory: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(directory)}/oauth2/v2.0/authorize`;
}

/** Problems with an uploaded certificate / private key pair, as a sentence
 *  for the admin -- or null when they belong together and the certificate
 *  is in date. Caught at save time instead of as an opaque AADSTS error at
 *  the first sync. */
export function checkCertificatePair(certPem: string | undefined, keyPem: string | undefined, nowMs: number = Date.now()): string | null {
  let cert: crypto.X509Certificate | null = null;
  if (certPem) {
    try { cert = new crypto.X509Certificate(certPem); } catch { return "That certificate isn't a valid PEM certificate (-----BEGIN CERTIFICATE-----)."; }
    if (Date.parse(cert.validTo) < nowMs) return `That certificate expired on ${cert.validTo}. Upload the renewed one (and add it to the app registration).`;
    if (Date.parse(cert.validFrom) > nowMs) return `That certificate isn't valid until ${cert.validFrom}.`;
  }
  let key: crypto.KeyObject | null = null;
  if (keyPem) {
    if (/ENCRYPTED PRIVATE KEY/.test(keyPem)) return "The private key is password-protected. Export it unencrypted (-----BEGIN PRIVATE KEY-----).";
    try { key = crypto.createPrivateKey(keyPem); } catch { return "That private key isn't a valid PEM private key (-----BEGIN PRIVATE KEY-----)."; }
    if (key.asymmetricKeyType !== "rsa") return "Microsoft Entra needs an RSA key for certificate sign-in.";
  }
  if (cert && key) {
    const fromKey = crypto.createPublicKey(key).export({ type: "spki", format: "der" });
    const fromCert = cert.publicKey.export({ type: "spki", format: "der" });
    if (!Buffer.from(fromKey).equals(Buffer.from(fromCert))) return "The private key doesn't belong to that certificate.";
  }
  return null;
}
