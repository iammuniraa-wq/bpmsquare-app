// Page-header convention: paddingLeft + accent left border. Pass `action` for a top-right CTA.
//
// The title/subtitle carry their look in `.bpm-page-header-title` /
// `.bpm-page-header-sub` (globals.css) rather than inline, because a theme has
// to be able to restyle them: Spectacular paints a navy band across the top of
// <main> and needs this text white and unbarred on it, and an inline style
// always beats a stylesheet rule. The class on the wrapper is also what that
// band's `main:has(.bpm-page-header)` selector looks for -- a page without
// this component deliberately gets no band.
export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="bpm-page-header"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        // wrap + gap is purely additive: on any page where title+action
        // already fit on one line (every existing caller, at normal widths)
        // this changes nothing -- it only kicks in once the combined
        // content is wider than the viewport, wrapping the action below
        // the title instead of forcing horizontal overflow.
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 16,
      }}
    >
      <div>
        <h1 className="bpm-page-header-title" style={{ margin: 0 }}>
          {title}
        </h1>
        {subtitle && <div className="bpm-page-header-sub">{subtitle}</div>}
      </div>
      {/* The decorative avatar that used to sit here hardcoded "VP" (a
          prototype-era Vikas Pioneers leftover, shown to every tenant) --
          removed rather than dynamized: it carried no information. */}
      {action && <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{action}</div>}
    </div>
  );
}
