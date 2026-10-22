import type { TourStepDef } from "@/lib/studio/tourSteps";

export const NEWSLETTER_TOUR: readonly TourStepDef[] = [
  { target: "startSec", label: "Start", text: "Start here. Write one line about this issue and press Write it for me, or pick one of your templates or a built-in design. English comes first." },
  { target: "nlBlocksList", label: "Blocks", text: "These are the pieces your newsletter is built from. Drag to reorder, hide what you do not need, add more from the list below." },
  { target: "nlEditor", label: "Block editor", text: "Click a block to change its words. Rewrite makes it shorter, friendlier or more formal; you keep what you like." },
  { target: "langSec", label: "Languages", text: "Add a language on top of the English. AI translates every block and keeps product names and prices as they are." },
  { target: "nlStage", label: "Check this", text: "Check this marks the lines the translation was unsure about. Accept or edit each one; a language can be sent once every line is checked." },
  { target: "nlDevice", label: "Device view", text: "See it as a phone or a desktop, light or dark, exactly as it is built for email programs." },
  { target: "nlHeadActions", label: "More menu", text: "In the ⋯ menu, Save as template keeps this design to start from next time, beside the built-in designs. Versions and the email HTML are there too." },
  { target: "nlHeadActions", label: "Send", text: "Send opens one panel: pick who gets it and send. Each person gets their own language, and only people who agreed to this topic are emailed. On a phone it is the button at the bottom." },
];
