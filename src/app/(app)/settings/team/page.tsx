import { redirect } from "next/navigation";
import { peopleRedirect } from "../people/logic";

// Settings > Team is now the People tab of Settings > People; the address stays so saved links keep working.
export default async function TeamRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(peopleRedirect(undefined, await searchParams));
}
