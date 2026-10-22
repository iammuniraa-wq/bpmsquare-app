import type { TourStepDef } from "@/lib/studio/tourSteps";

export const SIGNALS_TOUR: readonly TourStepDef[] = [
  { target: "sgList", label: "Accounts list", text: "This is who looks ready to buy. The highest score is at the top." },
  { target: "sgColStage", label: "Stage", text: "Stage is plain words for how close they look: Silent, Looking, Comparing, Deciding. A highlighted row moved up in the last week." },
  { target: "sgColScore", label: "Score", text: "The score is a sum of named signals with their points. Open an account to see every line. It is not a guess by AI. The small line shows the last eight weeks." },
  { target: "sgColWhy", label: "Why", text: "Why is one sentence built from the strongest signals, such as a quote asked for or a link clicked." },
  { target: "sgColNext", label: "Next step", text: "One suggested next step per account: call, follow up, start a quote, or add to a campaign." },
  { target: "sgInterest", label: "Interests", text: "Interests are the subjects you sell. Tag a newsletter link with one and a click on it counts for more." },
  { target: "sgTabs", label: "Did it work?", text: "After a campaign or newsletter, open Did it work? to see which accounts moved up a stage." },
];
