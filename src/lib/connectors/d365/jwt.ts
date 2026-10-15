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
    alg: "RS256",
    typ: "JWT",
    // SHA-1 thumbprint is what Entra has always matched on; the SHA-256 one
    // is the newer form. Sending both is allowed and works on either side
    // of Microsoft's migration.
    x5t: b64url(crypto.createHash("sha1").update(args.certDer).digest()),
    "x5t#S256": b64url(crypto.createHash("sha256").update(args.certDer).digest()),
  };
  const payload = {
    aud: args.tokenUrl,
    iss: args.clientId,
    sub: args.clientId,
    jti: args.jti ?? crypto.randomUUID(),
    nbf: now - 60,
    iat: now,
    exp: now + 600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), { key: args.privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING });
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
