// Prints the fresh secrets a dedicated instance needs (docs/dedicated-instance.md section 7.1), one KEY=value per line,
// ready to paste into Vercel > Settings > Environment Variables (the "Import .env" box takes this format).
// Nothing is written to disk and nothing is sent anywhere. Run it in your own terminal, paste, then clear the screen.
// FIELD_ENCRYPTION_KEY cannot be rotated and the data is unreadable without it: store it in the password manager first.
//
//   node scripts/dedicated/gen-secrets.mjs                   the instance secrets
//   node scripts/dedicated/gen-secrets.mjs --control-plane   a fresh Ed25519 keypair for the control plane (once, or on rotation):
//                                                            CONTROL_PLANE_PRIVATE_KEY goes ONLY to the control plane's Vercel
//                                                            project; CONTROL_PLANE_PUBLIC_KEYS goes to every instance.
import { generateKeyPairSync, randomBytes } from "node:crypto";

if (process.argv.includes("--control-plane")) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const b64 = (pem) => Buffer.from(pem).toString("base64");
  console.log("# Control plane project ONLY (never an instance). Keep it in the password manager.");
  console.log(`CONTROL_PLANE_PRIVATE_KEY=${b64(privateKey.export({ type: "pkcs8", format: "pem" }))}`);
  console.log("# Every instance (comma separate several public keys while rotating), plus that instance's own slug.");
  console.log(`CONTROL_PLANE_PUBLIC_KEYS=${b64(publicKey.export({ type: "spki", format: "pem" }))}`);
  console.log("INSTANCE_SLUG=<this instance's slug, as registered in /admin/instances>");
} else {
  const hex = () => randomBytes(32).toString("hex");
  const keys = [
    "FIELD_ENCRYPTION_KEY",
    "QUOTE_PUBLIC_LINK_SECRET",
    "CRON_SECRET",
    "ASSISTANT_ACTION_SECRET",
    "RFQ_LINK_SECRET",
    "INBOUND_EMAIL_SECRET",
  ];
  for (const k of keys) console.log(`${k}=${hex()}`);
}
