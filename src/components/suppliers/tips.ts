// The explanations the supplier group screens keep behind an "i" (bpmsquarecore 6b); held to two sentences, 160 characters by a test.

export const GROUP_TIPS = {
  groups: "A group is a client's approved suppliers. For that client's tenders and projects only its members can be asked, with no override.",
  client: "The client this list belongs to. A client has one group; a client with none can be asked any supplier.",
  members: "Tick the suppliers on the client's approved list. A supplier can be in several groups.",
} as const;

export type GroupTipKey = keyof typeof GROUP_TIPS;
