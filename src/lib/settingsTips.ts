// The explanations the general Settings pages keep behind an "i" instead of printing them
// (docs/design/settings-simplification.md, batch S1). One place, so a test can hold every text to the
// InfoTip limit (two sentences, 160 characters).

export const SETTINGS_TIPS = {
  navigation: "Show or hide sidebar items for the whole workspace, on every device. Hidden items can still be opened by their address.",
  appearance: "Applies to your whole workspace, every user and every device.",
  accent: "The workspace accent for links, tabs and focus rings. The theme colour above is separate.",
  dashboard: "Which dashboard the workspace opens on. Everyone can still switch from the dashboard itself, and their saved layouts are untouched.",
  spectacular: "The shell blends two colours, so pick a mix or set each end yourself. The accent colours links and buttons, so it stays darker than the shell.",
  layout: "These come with Next-gen and are on already. Changing one reloads the page.",
  layoutIdentity: "Moves your name and sign-out from the sidebar footer into the top bar, and frees up the bottom of the rail.",
  layoutPalette: "Ctrl + K opens a search-and-jump box over the page: records, screens and new-record actions. Top bar search keeps working.",
  layoutNavy: "A dark navy left rail against the light workspace, with a clearly marked selected item. Dark mode is unaffected.",
  compactSidebar: "Reduces the padding between navigation items.",
  developer: "A REST API with filter, select, sort, aggregate and search, an OpenAPI spec and a change feed. Send your key as Authorization: Bearer followed by the key.",
  apiReference: "Import this address into Postman or your integration tool, sending your API key as a Bearer token. It lists every endpoint your keys can reach.",
  scopedKeys: "A narrower alternative to the full-access key: limit a key to read-only or to chosen objects, and revoke it on its own. The token is shown once.",
  emailOutput: "Where quotations, invoices, campaigns and workforce notifications are actually delivered.",
  businessNews: "Headlines for the topics below. Unlike Client news it needs no accounts, so it has content on day one.",
  productTips: "Rotating cards on things the menu does not reveal, such as bulk import and API keys. Only tips for modules this workspace has are shown.",
} as const;
