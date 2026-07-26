import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Sunrise", bannerBg: "linear-gradient(135deg,#c9622a 0%,#f6b23c 60%,#fbe08a 100%)", bannerFg: "#3a2510", accentColor: "#c9622a", highlightBg: "#fdf6ec" },
  { key: "minimal", label: "Minimal Wheat", bannerBg: "#fdf6ec", bannerFg: "#c9622a", accentColor: "#c9622a", highlightBg: "#fdf6ec" },
  { key: "vibrant", label: "Vibrant Kite Sky", bannerBg: "linear-gradient(135deg,#378add 0%,#f6b23c 55%,#e0367f 100%)", bannerFg: "#ffffff", accentColor: "#378add", highlightBg: "#eff6fc" },
  { key: "elegant_dark", label: "Elegant Harvest Gold", bannerBg: "linear-gradient(135deg,#241a0f 0%,#3a2510 60%,#5c3a14 100%)", bannerFg: "#f6c86a", accentColor: "#c9622a", highlightBg: "#faf6ed" },
  { key: "pastel", label: "Soft Golden Hour", bannerBg: "linear-gradient(135deg,#fff3c4 0%,#ffe0b3 100%)", bannerFg: "#7a4a10", accentColor: "#c9622a", highlightBg: "#fffaf0" },
];

const COPY = [
  {
    opening: "As the sun begins its journey northward and kites fill the sky, we wanted to wish you a joyful Makar Sankranti and Pongal.",
    closing: "May this harvest season bring abundance, warmth, and prosperity to you and your family.",
  },
  {
    opening: "Makar Sankranti marks new beginnings and gratitude for the harvest — we hope this season brings you both.",
    closing: "Wishing you a bright and prosperous Pongal and Makar Sankranti.",
  },
  {
    opening: "As tilgul and fresh harvest are shared with loved ones, we wanted to send our warm wishes for this festive season.",
    closing: "May the sweetness of this festival stay with you all year long. Happy Sankranti!",
  },
  {
    opening: "This harvest season, we're grateful for the trust you've placed in us throughout the year.",
    closing: "Wishing you a joyful Makar Sankranti and Pongal, filled with good fortune.",
  },
  {
    opening: "May the changing season bring fresh energy, good harvests, and prosperity into your life and business.",
    closing: "Happy Makar Sankranti and Pongal to you and your family!",
  },
];

export const MAKAR_SANKRANTI_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "makar_sankranti",
    category: "Makar Sankranti & Pongal",
    emoji: "🪁",
    title: "Happy Makar Sankranti & Pongal",
    archetype,
    subject: "Happy Makar Sankranti & Pongal from {{company_name}}! 🪁",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
