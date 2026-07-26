import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Vermilion & Gold", bannerBg: "linear-gradient(135deg,#a3342f 0%,#e0562e 60%,#f6b23c 100%)", bannerFg: "#fff7e6", accentColor: "#e0562e", highlightBg: "#fdf3ec" },
  { key: "minimal", label: "Minimal Saffron", bannerBg: "#fff3e0", bannerFg: "#a3342f", accentColor: "#e0562e", highlightBg: "#fdf3ec" },
  { key: "vibrant", label: "Vibrant Marigold", bannerBg: "linear-gradient(135deg,#f6b23c 0%,#e0562e 100%)", bannerFg: "#ffffff", accentColor: "#a3342f", highlightBg: "#fdf3ec" },
  { key: "elegant_dark", label: "Elegant Deep Red", bannerBg: "linear-gradient(135deg,#2a0e0c 0%,#5c1f16 100%)", bannerFg: "#f6c86a", accentColor: "#e0562e", highlightBg: "#faf3ed" },
  { key: "pastel", label: "Soft Marigold", bannerBg: "linear-gradient(135deg,#ffe9c9 0%,#ffd6c2 100%)", bannerFg: "#7a1f1f", accentColor: "#e0562e", highlightBg: "#fff6f1" },
];

const COPY = [
  {
    opening: "As Lord Ganesha's blessings of wisdom and new beginnings arrive, we wanted to wish you a joyful Ganesh Chaturthi.",
    closing: "May this festival bring prosperity and remove every obstacle from your path ahead. Ganpati Bappa Morya!",
  },
  {
    opening: "Ganesh Chaturthi is a time of new beginnings and good fortune — we hope this festive season brings both your way.",
    closing: "Wishing you and your family a blessed and joyful celebration.",
  },
  {
    opening: "May Lord Ganesha bless you with wisdom, prosperity, and success this Ganesh Chaturthi.",
    closing: "Thank you for being a valued part of our journey — here's to more good times ahead. Ganpati Bappa Morya!",
  },
  {
    opening: "This Ganesh Chaturthi, we wanted to pause and send our heartfelt wishes for happiness and prosperity to you and yours.",
    closing: "May the coming days be filled with good fortune. Happy Ganesh Chaturthi!",
  },
  {
    opening: "As the festivities of Ganesh Chaturthi begin, we hope your home and workplace are filled with positivity and joy.",
    closing: "Wishing you a wonderful celebration this year.",
  },
];

export const GANESH_CHATURTHI_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "ganesh_chaturthi",
    category: "Ganesh Chaturthi",
    emoji: "🙏",
    title: "Happy Ganesh Chaturthi",
    archetype,
    subject: "Happy Ganesh Chaturthi from {{company_name}}! 🙏",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
