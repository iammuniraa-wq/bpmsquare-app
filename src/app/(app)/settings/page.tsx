import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import { getVisibleSettingsMenu } from "@/lib/settingsMenuServer";

// The landing for /settings. On a desktop it fills the right pane beside the
// menu; on a phone only its header shows, above the menu (the menu is the
// page there -- see .bpm-settings in globals.css). The groups and entries
// come from the same visible-menu list the menu itself is drawn from, so this
// can never offer something the menu hides.
export default async function SettingsLandingPage() {
  const groups = await getVisibleSettingsMenu();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Configure your workspace, sales & service setup, and data."
      />
      <div className="bpm-settings-landing-body">
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)", maxWidth: 560 }}>
          Pick a setting from the menu, or search for it by name. Everything here applies to your whole workspace.
        </p>
        <div className="bpm-settings-landing-grid">
          {groups.map((g) => (
            <Card key={g.id} title={g.label}>
              <ul className="bpm-settings-landing-links">
                {g.items.map((item) => (
                  <li key={item.id}><Link href={item.href}>{item.label}</Link></li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
