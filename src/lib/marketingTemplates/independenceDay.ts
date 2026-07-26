import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Tricolour", bannerBg: "linear-gradient(135deg,#c9622a 0%,#f7f4ec 45%,#0f6b5c 100%)", bannerFg: "#152233", accentColor: "#152233", highlightBg: "#f4f6f9" },
  { key: "minimal", label: "Minimal Ashoka Navy", bannerBg: "#f7fafc", bannerFg: "#152233", accentColor: "#378add", highlightBg: "#eef2f6" },
  { key: "vibrant", label: "Vibrant Flag Wave", bannerBg: "linear-gradient(135deg,#e06a2a 0%,#ffffff 50%,#1d9e75 100%)", bannerFg: "#152233", accentColor: "#0f6b5c", highlightBg: "#f3faf6" },
  { key: "elegant_dark", label: "Elegant Midnight Tricolour", bannerBg: "linear-gradient(135deg,#0e1a28 0%,#152233 45%,#123f33 100%)", bannerFg: "#f6b23c", accentColor: "#c9622a", highlightBg: "#f4f6f9" },
  { key: "pastel", label: "Soft Saffron & Sage", bannerBg: "linear-gradient(135deg,#fde3cc 0%,#e3f3ea 100%)", bannerFg: "#152233", accentColor: "#0f6b5c", highlightBg: "#f3faf6" },
];

const COPY = [
  {
    opening: "As the tricolour flies high across the nation, we wanted to wish you and your team a very Happy Independence Day.",
    closing: "May the spirit of freedom and progress inspire everything we build together in the year ahead.",
  },
  {
    opening: "Independence Day is a moment to reflect on how far we've come — and to look ahead with pride and purpose.",
    closing: "Wishing you a proud and joyful Independence Day, from all of us.",
  },
  {
    opening: "This 15th of August, we wanted to celebrate not just our nation's journey, but the partnerships that help all of us grow.",
    closing: "Happy Independence Day — here's to continued progress, together.",
  },
  {
    opening: "As we celebrate the freedom our nation has cherished for decades, we're grateful for partners like you who help us move forward.",
    closing: "Wishing you and your family a happy and meaningful Independence Day.",
  },
  {
    opening: "May this Independence Day remind us of the strength that comes from unity, resilience, and shared purpose.",
    closing: "Jai Hind — wishing you a very Happy Independence Day!",
  },
];

export const INDEPENDENCE_DAY_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "independence_day",
    category: "Independence Day",
    emoji: "🇮🇳",
    title: "Happy Independence Day",
    archetype,
    subject: "Happy Independence Day from {{company_name}}! 🇮🇳",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
