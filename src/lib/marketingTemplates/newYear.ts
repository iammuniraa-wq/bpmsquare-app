import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Navy & Gold", bannerBg: "linear-gradient(135deg,#0e1a28 0%,#152233 60%,#1d3352 100%)", bannerFg: "#f6b23c", accentColor: "#378add", highlightBg: "#f4f6f9" },
  { key: "minimal", label: "Minimal Slate", bannerBg: "#f4f6f9", bannerFg: "#152233", accentColor: "#378add", highlightBg: "#eef2f6" },
  { key: "vibrant", label: "Vibrant Fireworks", bannerBg: "linear-gradient(135deg,#7f77dd 0%,#e0367f 45%,#f6b23c 100%)", bannerFg: "#ffffff", accentColor: "#7f77dd", highlightBg: "#f6f2fd" },
  { key: "elegant_dark", label: "Elegant Black & Gold", bannerBg: "linear-gradient(135deg,#0a0a0a 0%,#1c1c1c 60%,#2e2410 100%)", bannerFg: "#f6c86a", accentColor: "#c9922a", highlightBg: "#faf6ed" },
  { key: "pastel", label: "Soft Champagne", bannerBg: "linear-gradient(135deg,#fdf3d9 0%,#e6eefc 100%)", bannerFg: "#152233", accentColor: "#378add", highlightBg: "#f7fafd" },
];

const COPY = [
  {
    opening: "As we step into a new year, we wanted to pause and thank you for your continued trust and partnership over the past year.",
    closing: "Wishing you and your team a year ahead filled with growth, good health, and continued success.",
  },
  {
    opening: "A new year brings new opportunities — we're grateful you'll be part of ours again this year.",
    closing: "Here's to a fresh start and even greater success together. Happy New Year!",
  },
  {
    opening: "As the clock strikes midnight and a new chapter begins, we wanted to send our warmest wishes your way.",
    closing: "May this year bring you prosperity, good health, and new milestones. Happy New Year!",
  },
  {
    opening: "Looking back, we're thankful for the trust you've placed in us. Looking ahead, we're excited for what's next.",
    closing: "Wishing you a bright and successful year ahead.",
  },
  {
    opening: "May the year ahead be filled with fresh energy, new opportunities, and continued partnership.",
    closing: "Happy New Year — here's to another great year together!",
  },
];

export const NEW_YEAR_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "new_year",
    category: "New Year",
    emoji: "🎆",
    title: "Happy New Year",
    archetype,
    subject: "Wishing you a wonderful year ahead — from {{company_name}} 🎆",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
