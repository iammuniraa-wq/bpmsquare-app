import type { TourStepDef } from "@/lib/studio/tourSteps";

export const FORM_TOUR: readonly TourStepDef[] = [
  { target: "basicsSec", label: "Basics", text: "Start with the name only your team sees, the web address and the heading your visitors read." },
  { target: "fieldsSec", label: "Fields", text: "Choose what to ask. Email is always asked, because that is how we find a person again and attach their consent to them." },
  { target: "consentSec", label: "Consent", text: "Write the words people agree to and pick the consent topics they are agreeing to hear about. The box is never ticked for them, and these exact words are saved with every answer." },
  { target: "afterSec", label: "After sending", text: "Choose what happens after sending: a thank-you message, or a page on your own domain." },
  { target: "shareSec", label: "Share", text: "When the form is Live, share the hosted address or paste the embed code into your website." },
  { target: "frCanvas", label: "Preview", text: "This is the form exactly as a visitor sees it. It updates as you change the options." },
  { target: "frTabs", label: "Answers", text: "Answers lists the latest people who sent the form." },
];
