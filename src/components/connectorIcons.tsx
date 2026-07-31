// Real brand marks for the Connectors page. Gmail and Google Calendar are
// verified official glyphs (path data + brand hex extracted from the
// simple-icons project, MIT-licensed SVGs of registered trademarks used
// here only to identify the service being connected to -- the standard,
// legitimate use for an integrations page). Slack's mark isn't available
// from that verified source, so rather than reconstruct its (fairly
// intricate, four-colour pinwheel) logo from memory and risk getting the
// shape wrong, it uses Slack's own well-documented brand colour (the
// aubergine used throughout Slack's own product chrome) with a simple
// monogram -- honestly a badge, not a claim to be the exact trademarked glyph.
//
// Each entry supplies just the glyph -- the tile itself (ConnectorsClient)
// renders the surrounding badge circle at a consistent size/style and
// supplies `bg`/`fg`, so all three read as one family rather than three
// differently-designed icons bolted together.

function GmailGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="#EA4335" d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  );
}

function GoogleCalendarGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z" />
    </svg>
  );
}

function SlackGlyph() {
  return <span style={{ fontWeight: 800, fontSize: 15, lineHeight: 1, fontFamily: "system-ui, sans-serif" }}>#</span>;
}

export const CONNECTOR_ICONS: Record<string, { Glyph: () => React.ReactNode; bg: string; fg: string }> = {
  slack:           { Glyph: SlackGlyph,           bg: "#4A154B", fg: "#fff" },
  gmail:           { Glyph: GmailGlyph,           bg: "#FCE8E6", fg: "#EA4335" },
  google_calendar: { Glyph: GoogleCalendarGlyph,  bg: "#E8F0FE", fg: "#4285F4" },
};
