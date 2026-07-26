import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Maroon & Gold", bannerBg: "linear-gradient(135deg,#7a1f2b 0%,#a3342f 60%,#c9622a 100%)", bannerFg: "#fdeecb", accentColor: "#c9622a", highlightBg: "#fdf6ec" },
  { key: "minimal", label: "Minimal Cream", bannerBg: "#fff8ec", bannerFg: "#7a1f2b", accentColor: "#c9622a", highlightBg: "#fdf6ec" },
  { key: "vibrant", label: "Vibrant Rangoli", bannerBg: "linear-gradient(135deg,#e0562e 0%,#e0367f 55%,#7a3fc9 100%)", bannerFg: "#ffffff", accentColor: "#e0367f", highlightBg: "#fdf1f7" },
  { key: "elegant_dark", label: "Elegant Midnight Gold", bannerBg: "linear-gradient(135deg,#0e0a06 0%,#241a0f 60%,#3a2510 100%)", bannerFg: "#f6c86a", accentColor: "#c9922a", highlightBg: "#faf6ed" },
  { key: "pastel", label: "Soft Peach", bannerBg: "linear-gradient(135deg,#ffe3cc 0%,#ffd0d8 100%)", bannerFg: "#7a1f2b", accentColor: "#c9622a", highlightBg: "#fff6f1" },
];

const COPY = [
  {
    opening: "As the diyas light up and the festival of lights fills the air with joy, we wanted to take a moment to wish you and your team a very Happy Diwali.",
    closing: "May this festive season bring you prosperity, good health, and success in everything you do. Thank you for being a valued part of our journey.",
  },
  {
    opening: "Diwali reminds us that light always finds a way through the darkness. We hope your homes and workplaces are filled with warmth this season.",
    closing: "Here's wishing you a Diwali as bright as the diyas and as sweet as the mithai. Thank you for your continued trust in us.",
  },
  {
    opening: "Another year, another Diwali — and we're grateful you've been part of ours. Wishing you a festival full of laughter, lights, and good fortune.",
    closing: "May the coming year bring new opportunities and continued success your way. Happy Diwali!",
  },
  {
    opening: "This Diwali, we wanted to pause and thank you for your partnership over the past year. It means more to us than a festive card can say.",
    closing: "Wishing you and your loved ones a joyous, prosperous, and safe Diwali.",
  },
  {
    opening: "May the glow of a thousand diyas light up your path to prosperity this Diwali. We're honoured to have you as a valued customer.",
    closing: "Here's to a bright new year ahead, filled with growth and good health. Happy Diwali to you and your family!",
  },
];

export const DIWALI_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "diwali",
    category: "Diwali",
    emoji: "🪔",
    title: "Happy Diwali",
    archetype,
    subject: "Happy Diwali from {{company_name}}! 🪔",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
