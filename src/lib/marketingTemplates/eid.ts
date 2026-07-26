import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Emerald & Gold", bannerBg: "linear-gradient(135deg,#04342c 0%,#0f6b5c 60%,#1d9e75 100%)", bannerFg: "#f6e9c8", accentColor: "#c9922a", highlightBg: "#f3faf6" },
  { key: "minimal", label: "Minimal Ivory", bannerBg: "#f7fbf8", bannerFg: "#04342c", accentColor: "#1d9e75", highlightBg: "#f3faf6" },
  { key: "vibrant", label: "Vibrant Teal & Magenta", bannerBg: "linear-gradient(135deg,#0f6b5c 0%,#1d9e75 45%,#e0367f 100%)", bannerFg: "#ffffff", accentColor: "#0f6b5c", highlightBg: "#f3faf6" },
  { key: "elegant_dark", label: "Elegant Midnight Green", bannerBg: "linear-gradient(135deg,#04120e 0%,#0a2b23 60%,#123f33 100%)", bannerFg: "#f6c86a", accentColor: "#1d9e75", highlightBg: "#f3faf6" },
  { key: "pastel", label: "Soft Mint & Gold", bannerBg: "linear-gradient(135deg,#d7f3e7 0%,#fdeecb 100%)", bannerFg: "#04342c", accentColor: "#c9922a", highlightBg: "#f3faf6" },
];

const COPY = [
  {
    opening: "As the crescent moon marks the end of Ramadan, we wanted to wish you and your family a very Eid Mubarak.",
    closing: "May this Eid bring peace, happiness, and prosperity to you and your loved ones.",
  },
  {
    opening: "Eid Mubarak! We hope this special day is filled with joy, gratitude, and time spent with those you cherish.",
    closing: "Thank you for being a valued part of our journey — wishing you continued happiness and success.",
  },
  {
    opening: "This Eid, we wanted to pause and send our warmest wishes for peace and blessings to you and your family.",
    closing: "May the spirit of Eid bring renewed hope and prosperity in the days ahead.",
  },
  {
    opening: "As celebrations and feasting mark this joyous occasion, we hope your Eid is filled with warmth and togetherness.",
    closing: "Eid Mubarak — wishing you a wonderful celebration and a prosperous year ahead.",
  },
  {
    opening: "May this blessed occasion of Eid bring you closer to your loved ones and fill your home with happiness.",
    closing: "Wishing you and your family a joyful and peaceful Eid Mubarak.",
  },
];

export const EID_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "eid",
    category: "Eid",
    emoji: "🌙",
    title: "Eid Mubarak",
    archetype,
    subject: "Eid Mubarak from {{company_name}}! 🌙",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
