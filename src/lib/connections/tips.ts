// The explanations the Connections and Endpoints screens keep behind an "i" (bpmsquarecore 6b): two sentences, 160 characters,
// held to the limit by connections.tips.test.ts. The screens never print these as running text.

export const CONNECTION_TIPS = {
  section: "Systems you connect yourself, next to your ERP connectors. Test says in plain words what to fix.",
  type: "A REST API suits most web services. OData is the standard of Dynamics 365, SAP and Business Central.",
  address: "The web address, starting with https://. For OData it is the service root, where $metadata can be read.",
  signIn: "How BPMSquare proves who it is. Choose No sign-in only for an open service.",
  keyIn: "Choose Header unless the system's documentation says the key goes in the web address.",
  keyName: "The name the system expects the key under, such as X-API-Key.",
  secret: "Paste it once. After saving it shows as Stored and cannot be read back; leave it blank to keep it.",
  provider: "Microsoft Entra signs in Dynamics 365 and most Microsoft services. Choose Another server for any other OAuth 2 sign-in.",
  directory: "The directory (tenant) ID from Microsoft Entra, Overview. A Microsoft domain such as contoso.onmicrosoft.com works too.",
  clientId: "The application (client) ID of the app registration. Finance and Operations also needs the app listed under Microsoft Entra ID applications.",
  clientSecret: "Paste the secret's Value, not its ID. Make a new secret in Microsoft Entra before it expires.",
  tokenUrl: "The address of the server that hands out access tokens. Its documentation calls it the token endpoint.",
  scope: "Leave empty for Microsoft: it becomes the system's address followed by /.default. Fill it in only if the system asks for something else.",
  checkPath: "A path BPMSquare reads to prove the connection works, such as /health. Empty reads the address itself.",
  test: "Reads the system once with these details and says what to fix. Nothing is changed in the system.",
  status: "The result of the last Test. Editing a connection clears it until you test again.",
  webhooks: "Webhooks to send and receive are made in Settings > Webhooks, in one list. Open it from here.",
  email: "Your own mailbox (IMAP and SMTP) is a connector in Settings > Connectors. Connect it there.",
  existing: "Your ERP connectors keep their own panel, behind their chip above. Open it to test or change them.",
  needsUpdate: "Adding connections needs a one-time database update that your BPMSquare administrator runs. Your ERP connectors work as before.",
} as const;

export const ENDPOINT_TIPS = {
  section: "What BPMSquare may read from or send to this system. It starts empty; add only what you need.",
  operation: "For a REST API, the request method and path. For OData, the entity set, such as ProjectsV2.",
  direction: "In brings records from the system into BPMSquare. Out sends BPMSquare records to the system.",
  object: "The BPMSquare object this endpoint serves. It decides which fields the mapping offers on the BPMSquare side.",
  runMode: "Manual runs from here. Schedule and On change are saved for the run engine, which is not switched on yet.",
  enabled: "A switched-off endpoint is kept but never used. Switch it on once its mapping is saved.",
  fromMetadata: "Reads the system's own description and lists what it offers. Pick the ones you want; nothing is added until you do.",
  fromTemplate: "A starting list for a known system. Pick what you need; nothing is added by itself.",
  tryIt: "Reads the first rows from the system and records the call in the Monitor. Nothing is changed in the system.",
  mapping: "Fields are matched in the Mapping tab, once per connection and object.",
} as const;
