import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Red & Gold", bannerBg: "linear-gradient(135deg,#7a1f2b 0%,#a3342f 60%,#f6b23c 100%)", bannerFg: "#fff7e6", accentColor: "#a3342f", highlightBg: "#fdf3ec" },
  { key: "minimal", label: "Minimal Ivory", bannerBg: "#fff8ec", bannerFg: "#7a1f2b", accentColor: "#a3342f", highlightBg: "#fdf3ec" },
  { key: "vibrant", label: "Vibrant Nine Colours", bannerBg: "linear-gradient(135deg,#e0367f 0%,#f6b23c 25%,#1d9e75 50%,#378add 75%,#7f77dd 100%)", bannerFg: "#ffffff", accentColor: "#7f77dd", highlightBg: "#f6f2fd" },
  { key: "elegant_dark", label: "Elegant Deep Maroon", bannerBg: "linear-gradient(135deg,#1c0a08 0%,#3a1210 60%,#5c1f16 100%)", bannerFg: "#f6c86a", accentColor: "#c9622a", highlightBg: "#faf3ed" },
  { key: "pastel", label: "Soft Festive Pastel", bannerBg: "linear-gradient(135deg,#ffe0e6 0%,#fff3c4 100%)", bannerFg: "#7a1f2b", accentColor: "#a3342f", highlightBg: "#fff6f1" },
];

const COPY = [
  {
    opening: "As the nine nights of Navratri bring festivity and devotion, we wanted to send you our warmest wishes for the season.",
    closing: "May Dussehra bring the triumph of good over every challenge you face. Wishing you strength and success ahead.",
  },
  {
    opening: "Navratri and Dussehra are a time of celebration, renewal, and victory — we hope this season brings all three your way.",
    closing: "Wishing you and your family a joyful and prosperous festive season.",
  },
  {
    opening: "As garba nights and festive lights fill the air, we wanted to take a moment to wish you a wonderful Navratri.",
    closing: "May this Dussehra mark new beginnings and continued success for you and your business.",
  },
  {
    opening: "This festive season, we're grateful for partners like you who've been part of our journey through the year.",
    closing: "Wishing you a joyous Navratri and a victorious Dussehra.",
  },
  {
    opening: "May the spirit of Navratri fill your days with devotion, dance, and good cheer.",
    closing: "Here's wishing you triumph and prosperity this Dussehra and always.",
  },
];

export const NAVRATRI_DUSSEHRA_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "navratri_dussehra",
    category: "Navratri & Dussehra",
    emoji: "🪘",
    title: "Happy Navratri & Dussehra",
    archetype,
    subject: "Happy Navratri & Dussehra from {{company_name}}! 🪘",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
