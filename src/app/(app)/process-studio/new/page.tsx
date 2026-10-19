import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import NewStudyForm from "./NewStudyForm";

export default async function NewStudyPage() {
  await requireWorkcenterView("process_studio");
  await requireFeature("process_studio");
  return <NewStudyForm />;
}
