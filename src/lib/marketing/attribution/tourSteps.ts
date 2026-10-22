import type { TourStepDef } from "@/lib/studio/tourSteps";

export const ATTRIBUTION_TOUR: readonly TourStepDef[] = [
  { target: "bySec", label: "What to look at", text: "Choose what you want to look at: campaigns, newsletters, forms, journeys, WhatsApp templates or events." },
  { target: "modelSec", label: "Who gets the credit", text: "Choose who gets the credit for starting a deal. First touch, last touch and an even share answer different questions, so try all three." },
  { target: "modeSec", label: "What counts as a touch", text: "Choose what counts as a touch. By default only something a person did counts, because being sent a message is not influence." },
  { target: "attCanvas", label: "The answer", text: "Here is the answer. Read the notes under the table: they say what these figures can and cannot tell you." },
];
