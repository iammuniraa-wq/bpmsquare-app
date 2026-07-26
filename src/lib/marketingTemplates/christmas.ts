import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Red & Green", bannerBg: "linear-gradient(135deg,#7a1f1f 0%,#a3342f 55%,#173404 100%)", bannerFg: "#f6e9c8", accentColor: "#173404", highlightBg: "#f3f8ee" },
  { key: "minimal", label: "Minimal Snow White", bannerBg: "#f7fafc", bannerFg: "#a3342f", accentColor: "#173404", highlightBg: "#f3f8ee" },
  { key: "vibrant", label: "Vibrant Holiday Cheer", bannerBg: "linear-gradient(135deg,#e05252 0%,#f6b23c 45%,#1d9e75 100%)", bannerFg: "#ffffff", accentColor: "#a3342f", highlightBg: "#fef3f0" },
  { key: "elegant_dark", label: "Elegant Midnight & Gold", bannerBg: "linear-gradient(135deg,#0a1320 0%,#152233 60%,#1d3352 100%)", bannerFg: "#f6c86a", accentColor: "#c9922a", highlightBg: "#f4f6f9" },
  { key: "pastel", label: "Soft Winter Frost", bannerBg: "linear-gradient(135deg,#dceefc 0%,#ffe0e0 100%)", bannerFg: "#7a1f1f", accentColor: "#378add", highlightBg: "#f4f9fd" },
];

const COPY = [
  {
    opening: "As the year draws to a close and the festive season arrives, we wanted to wish you and your team a very Merry Christmas.",
    closing: "May the new year ahead bring you joy, good health, and continued success. Merry Christmas!",
  },
  {
    opening: "Wishing you a Christmas filled with warmth, good company, and well-deserved rest after a busy year.",
    closing: "Thank you for your partnership this year — here's to more success together in the year ahead.",
  },
  {
    opening: "This Christmas, we wanted to take a moment to thank you for being a valued part of our journey this year.",
    closing: "Wishing you and your family a joyful Christmas and a bright new year ahead.",
  },
  {
    opening: "May the magic of the season bring you peace, happiness, and cherished moments with loved ones.",
    closing: "Merry Christmas and a very Happy New Year from all of us!",
  },
  {
    opening: "As twinkling lights and festive cheer fill the season, we hope your Christmas is merry and bright.",
    closing: "Wishing you continued success and happiness in the year ahead.",
  },
];

export const CHRISTMAS_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "christmas",
    category: "Christmas",
    emoji: "🎄",
    title: "Merry Christmas",
    archetype,
    subject: "Merry Christmas from {{company_name}}! 🎄",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
