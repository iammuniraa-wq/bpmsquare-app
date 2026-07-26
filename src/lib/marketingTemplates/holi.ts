import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Colour Splash", bannerBg: "linear-gradient(135deg,#e0367f 0%,#f6b23c 55%,#1d9e75 100%)", bannerFg: "#ffffff", accentColor: "#e0367f", highlightBg: "#fdf1f7" },
  { key: "minimal", label: "Minimal White", bannerBg: "#ffffff", bannerFg: "#e0367f", accentColor: "#7f77dd", highlightBg: "#f4f6f9" },
  { key: "vibrant", label: "Vibrant Rainbow", bannerBg: "linear-gradient(135deg,#e0367f 0%,#e05252 25%,#f6b23c 50%,#1d9e75 75%,#378add 100%)", bannerFg: "#ffffff", accentColor: "#7f77dd", highlightBg: "#f4f0fd" },
  { key: "elegant_dark", label: "Elegant Deep Purple", bannerBg: "linear-gradient(135deg,#26215c 0%,#3f2f7a 60%,#7f2f6a 100%)", bannerFg: "#f6c86a", accentColor: "#e0367f", highlightBg: "#f8f3fb" },
  { key: "pastel", label: "Soft Pastel Rainbow", bannerBg: "linear-gradient(135deg,#ffd6e8 0%,#fff3c4 33%,#c9f2e0 66%,#d6e4ff 100%)", bannerFg: "#7a1f4f", accentColor: "#e0367f", highlightBg: "#fff8fb" },
];

const COPY = [
  {
    opening: "As the colours of Holi fill the air, we wanted to send you and your team our warmest wishes for a joyful, vibrant festival.",
    closing: "May this Holi wash away the year's worries and bring in fresh colour and energy. Happy Holi!",
  },
  {
    opening: "Holi is a reminder to celebrate togetherness and new beginnings. We're glad to have you as part of ours.",
    closing: "Wishing you a Holi filled with laughter, colour, and good company. Thank you for your continued partnership.",
  },
  {
    opening: "Here's wishing you a Holi as bright and joyful as the colours in the air — full of good cheer and gulal.",
    closing: "May the year ahead bring you as much colour and happiness as this festival. Happy Holi!",
  },
  {
    opening: "As the festival of colours arrives, we wanted to take a moment to thank you for being a valued part of our journey.",
    closing: "Wishing you and your family a safe, happy, and colourful Holi.",
  },
  {
    opening: "May this Holi bring new colours of joy, success, and prosperity into your life and business.",
    closing: "Here's to a vibrant year ahead. Happy Holi from all of us!",
  },
];

export const HOLI_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "holi",
    category: "Holi",
    emoji: "🎨",
    title: "Happy Holi",
    archetype,
    subject: "Happy Holi from {{company_name}}! 🎨",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
