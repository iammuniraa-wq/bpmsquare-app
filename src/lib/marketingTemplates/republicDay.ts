import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Tricolour", bannerBg: "linear-gradient(135deg,#c9622a 0%,#f7f4ec 45%,#0f6b5c 100%)", bannerFg: "#152233", accentColor: "#152233", highlightBg: "#f4f6f9" },
  { key: "minimal", label: "Minimal Chakra Navy", bannerBg: "#f7fafc", bannerFg: "#152233", accentColor: "#378add", highlightBg: "#eef2f6" },
  { key: "vibrant", label: "Vibrant Parade Colours", bannerBg: "linear-gradient(135deg,#e06a2a 0%,#f6b23c 30%,#ffffff 60%,#1d9e75 100%)", bannerFg: "#152233", accentColor: "#0f6b5c", highlightBg: "#f3faf6" },
  { key: "elegant_dark", label: "Elegant Midnight Tricolour", bannerBg: "linear-gradient(135deg,#0e1a28 0%,#152233 45%,#123f33 100%)", bannerFg: "#f6b23c", accentColor: "#c9622a", highlightBg: "#f4f6f9" },
  { key: "pastel", label: "Soft Saffron & Sage", bannerBg: "linear-gradient(135deg,#fde3cc 0%,#e3f3ea 100%)", bannerFg: "#152233", accentColor: "#0f6b5c", highlightBg: "#f3faf6" },
];

const COPY = [
  {
    opening: "As the nation celebrates the day our Constitution came into force, we wanted to send our warmest wishes to you and your team.",
    closing: "May this Republic Day inspire renewed commitment to the values that hold us all together.",
  },
  {
    opening: "Republic Day is a reminder of the ideals we build upon — justice, equality, and progress for all.",
    closing: "Wishing you a proud and thoughtful Republic Day, from all of us.",
  },
  {
    opening: "This 26th of January, we wanted to pause and celebrate both our republic's journey and the relationships that keep us moving forward.",
    closing: "Happy Republic Day — here's to continued growth, together.",
  },
  {
    opening: "As tricolour parades and cultural showcases fill the day, we're grateful for partners like you who are part of our own journey.",
    closing: "Wishing you and your family a very Happy Republic Day.",
  },
  {
    opening: "May this Republic Day renew our shared commitment to progress, integrity, and unity in everything we do.",
    closing: "Jai Hind — wishing you a very Happy Republic Day!",
  },
];

export const REPUBLIC_DAY_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "republic_day",
    category: "Republic Day",
    emoji: "🇮🇳",
    title: "Happy Republic Day",
    archetype,
    subject: "Happy Republic Day from {{company_name}}! 🇮🇳",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
