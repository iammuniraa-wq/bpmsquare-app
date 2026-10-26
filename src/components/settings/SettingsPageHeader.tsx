import PageHeader from "@/components/PageHeader";

/** Id of the right-hand slot in a settings page header. Anything that belongs
 *  there -- Save and its status, "+ New ..." -- is portalled in by
 *  SettingsHeaderActions, so a deeply nested client component can put its
 *  button top right without lifting its state to the page. */
export const SETTINGS_ACTIONS_ID = "settings-header-actions";

/**
 * The header every settings page uses: title and subtitle on the left, an
 * empty actions slot on the right (decision 1 of ui-restructure-spec section
 * 11: Save is always top right). Server-safe; the slot is filled client-side.
 */
export default function SettingsPageHeader({ title, subtitle, info, icon }: { title: string; subtitle?: string; info?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      info={info}
      icon={icon}
      action={<div id={SETTINGS_ACTIONS_ID} className="bpm-settings-actions" />}
    />
  );
}
