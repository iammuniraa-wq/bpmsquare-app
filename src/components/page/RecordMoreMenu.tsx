"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MoreMenu from "@/components/ui/MoreMenu";
import type { MenuItem } from "@/components/ui/menuItems";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import { useFeel } from "@/components/FeelProvider";
import { useRecordEdit } from "./RecordEditContext";

export type RecordDelete = {
  /** The record's DELETE endpoint, e.g. `/api/suppliers/<id>`. */
  endpoint: string;
  /** Shown in the confirm dialog and the undo toast. */
  recordName: string;
  /** Lower-case singular, for the error toast: "Could not delete this supplier". */
  entityLabel: string;
  /** Overrides the confirm dialog text (default: "You'll have a few seconds to undo."). */
  confirmBody?: string;
  /** Where to go once the delete is queued (the list page). */
  afterHref: string;
};

/**
 * The record page's "⋯" menu, in the one order every object uses: Edit,
 * Print / PDF, Duplicate, any object-specific extras, Adapt (admins), then --
 * behind a divider -- Delete. Anything the caller leaves out is simply not
 * shown, so the menu never advertises an action the object does not have.
 *
 * Delete is the deferred-with-undo pattern the old per-object buttons used:
 * confirm, navigate away at once, and only fire the DELETE when the undo
 * window closes.
 */
export default function RecordMoreMenu({
  inlineEdit, editHref, printHref, duplicateHref, extraItems = [], adapt, remove,
}: {
  /** Edit toggles the Overview tab's inline field editor (ObjectSections). */
  inlineEdit?: { overviewHref: string };
  /** Edit opens a separate edit page instead. */
  editHref?: string;
  printHref?: string;
  duplicateHref?: string;
  /** Object-specific entries (link items only -- this prop crosses the server boundary). */
  extraItems?: MenuItem[];
  adapt?: { objectType: string; objectLabel: string; isAdmin: boolean };
  remove?: RecordDelete;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const recordEdit = useRecordEdit();
  const { confirm, toast, undoable } = useFeel();
  const [, startTransition] = useTransition();
  const [adaptOpen, setAdaptOpen] = useState(false);

  const items = useMemo<MenuItem[]>(() => {
    async function handleDelete() {
      if (!remove) return;
      if (!(await confirm({ title: `Delete "${remove.recordName}"?`, body: remove.confirmBody ?? "You'll have a few seconds to undo.", tone: "danger" }))) return;
      startTransition(() => {
        undoable({
          text: `"${remove.recordName}" deleted`,
          action: async () => {
            const res = await fetch(remove.endpoint, { method: "DELETE", keepalive: true });
            if (!res.ok) {
              const j = await res.json().catch(() => ({}));
              toast({ text: j.error ?? `Could not delete this ${remove.entityLabel}`, tone: "error" });
            }
          },
        });
        router.push(remove.afterHref);
      });
    }

    function handleEdit() {
      if (!inlineEdit) return;
      recordEdit?.request();
      if (search.get("tab")) router.replace(inlineEdit.overviewHref, { scroll: false });
    }

    return [
      { label: "Edit", hidden: !inlineEdit && !editHref, href: editHref, onSelect: inlineEdit ? handleEdit : undefined },
      { label: "Print / PDF", hidden: !printHref, href: printHref, newTab: true },
      { label: "Duplicate", hidden: !duplicateHref, href: duplicateHref },
      ...extraItems,
      { label: "Adapt fields", hidden: !adapt?.isAdmin, onSelect: () => setAdaptOpen(true) },
      { label: "Delete", danger: true, hidden: !remove, onSelect: handleDelete },
    ];
  }, [inlineEdit, editHref, printHref, duplicateHref, extraItems, adapt?.isAdmin, remove, recordEdit, search, router, confirm, toast, undoable]);

  return (
    <>
      <MoreMenu items={items} />
      {adapt && (
        <AdaptObjectDrawer
          objectType={adapt.objectType}
          objectLabel={adapt.objectLabel}
          isAdmin={adapt.isAdmin}
          open={adaptOpen}
          onOpenChange={setAdaptOpen}
          hideTrigger
        />
      )}
    </>
  );
}
