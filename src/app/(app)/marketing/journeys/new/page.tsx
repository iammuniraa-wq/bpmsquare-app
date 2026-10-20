import { journeyPage } from "@/lib/marketing/journeys/access";
import { TEMPLATES } from "@/lib/marketing/journeys/definition";
import NewJourney from "./NewJourney";

export default async function NewJourneyPage() {
  const ctx = await journeyPage("create");
  return <NewJourney templates={TEMPLATES.map((t) => ({ id: t.id, name: t.name, hint: t.hint }))} canCreate={ctx.can.create} />;
}
