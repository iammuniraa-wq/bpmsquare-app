import { c } from "@/lib/theme";
import { cardStyle } from "./Shell";
import PageHeader from "./PageHeader";

// Used by nav targets not yet built in this slice (App shell + Accounts hub).
export default function Placeholder({
  title,
  subtitle,
  blurb,
}: {
  title: string;
  subtitle?: string;
  blurb?: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🚧</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Coming in a later slice</div>
        <div style={{ fontSize: 13, color: c.muted, maxWidth: 420, margin: "0 auto" }}>
          {blurb ??
            "This pillar is mapped in the prototype and the data model. The first build slice ships the app shell and the Accounts connected hub."}
        </div>
      </div>
    </>
  );
}
