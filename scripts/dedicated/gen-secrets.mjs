// Prints the fresh secrets a dedicated instance needs (docs/dedicated-instance.md section 7.1), one KEY=value per line,
// ready to paste into Vercel > Settings > Environment Variables (the "Import .env" box takes this format).
// Nothing is written to disk and nothing is sent anywhere. Run it in your own terminal, paste, then clear the screen.
// FIELD_ENCRYPTION_KEY cannot be rotated and the data is unreadable without it: store it in the password manager first.
import { randomBytes } from "node:crypto";

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
