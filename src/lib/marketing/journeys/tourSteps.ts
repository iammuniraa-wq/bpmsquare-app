import type { TourStepDef } from "@/lib/studio/tourSteps";

export const JOURNEY_TOUR: readonly TourStepDef[] = [
  { target: "whenSec", label: "When it starts", text: "Choose what starts the journey. It can come from Sales, Service or a form, not only from marketing." },
  { target: "rulesSec", label: "Rules", text: "These rules protect your customers. Consent is always checked again at the moment of sending." },
  { target: "jnSteps", label: "Steps", text: "Each line is a step. Under every step is a plain sentence saying when it fires; the guards chip says what can stop it." },
  { target: "jnEntry", label: "Who would enter", text: "Before you go live, see who would enter today and read the messages about consent and volume." },
  { target: "jnTry", label: "Try a person", text: "Pick a real person and see the exact path and dates they would get, with the reason at every turn. Nothing is sent." },
  { target: "jnActivity", label: "Activity", text: "Once it is live, this shows who is waiting, who is stuck and who was skipped and why. Click a reason to see the people." },
];
