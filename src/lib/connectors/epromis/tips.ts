// The explanations behind the "i" on the ePROMIS screen (bpmsquarecore.md 6b): two short sentences at most, held to the
// limit by tips.test.ts. Nothing here is printed under a field.

export const EPROMIS_TIPS = {
  page: "Connects BPMSquare to ePROMIS: its lists come in and awarded projects and budgets go out. Only workspace admins can edit it.",
  baseUrl: "The address ePROMIS gave you for its API, starting with https. An address on a private or internal network is refused.",
  authType: "How ePROMIS expects every request to sign in. The ePROMIS documentation says which one.",
  keyHeader: "The name of the header that carries the API key, spelled as the ePROMIS documentation spells it.",
  username: "The ePROMIS user that requests sign in as.",
  credential: "Stored encrypted and never shown again. Leave it blank when editing to keep the stored one.",
  company: "A company or database code some ePROMIS setups need on every request. Leave it blank if ePROMIS does not ask for one.",
  companySent: "Whether the code travels in a header or in the address, and under which name.",
  endpointMap: "Where each ePROMIS operation lives. It is filled from the ePROMIS API documentation; until then every operation answers Not configured.",
  template: "Fills the box with the empty shape of the map. No address or field is guessed.",
} as const;

export type EpromisTipKey = keyof typeof EPROMIS_TIPS;
