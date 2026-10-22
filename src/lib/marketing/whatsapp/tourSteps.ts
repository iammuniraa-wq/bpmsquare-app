import type { TourStepDef } from "@/lib/studio/tourSteps";

export const WHATSAPP_TOUR: readonly TourStepDef[] = [
  { target: "basicsSec", label: "Basics", text: "Name the template for your team and choose its language. Each language is its own template, because WhatsApp approves them separately." },
  { target: "messageSec", label: "Message", text: "Write the message. Pick a detail from the list to drop a person's name or a quote number in; the preview on the right shows how it will read." },
  { target: "topicSec", label: "Consent topic", text: "Choose the consent topic. Only people who agreed to hear about it on WhatsApp will receive this message." },
  { target: "approvalSec", label: "Approval", text: "WhatsApp only lets you start a conversation with an approved template. Mark it approved once your provider has accepted it; until then it cannot be sent." },
  { target: "waCanvas", label: "Preview", text: "This is the message as the person sees it, with sample details filled in." },
];
