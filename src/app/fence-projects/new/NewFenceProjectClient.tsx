"use client";

import { useState } from "react";
import FenceIntake from "@/components/fence/FenceIntake";
import FenceConfigurator, { type FenceDraftValues } from "@/components/fence/FenceConfigurator";
import type { FenceSecurityProfileRow } from "@/lib/fence/data";
import type { FenceCatalogRow } from "@/lib/fence/materialMatch";

export default function NewFenceProjectClient({
  profiles,
  catalog,
  accounts,
  contacts,
  estimatesNote = false,
}: {
  profiles: FenceSecurityProfileRow[];
  catalog: FenceCatalogRow[];
  accounts: { id: string; name: string }[];
  contacts: { id: string; name: string; account_id: string }[];
  estimatesNote?: boolean;
}) {
  const [mode, setMode] = useState<"intake" | "configure">("intake");
  const [draft, setDraft] = useState<FenceDraftValues | undefined>(undefined);

  if (mode === "configure") {
    return <FenceConfigurator profiles={profiles} catalog={catalog} accounts={accounts} contacts={contacts} draft={draft} estimatesNote={estimatesNote} />;
  }

  const profileLabels = Object.fromEntries(profiles.map((p) => [p.id, p.label]));
  return (
    <FenceIntake
      profileLabels={profileLabels}
      onSkip={() => setMode("configure")}
      onDrafted={(d) => { setDraft(d); setMode("configure"); }}
    />
  );
}
