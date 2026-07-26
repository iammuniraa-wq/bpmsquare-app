import { festivalTemplate, type MarketingTemplateDef, type StyleArchetype } from "./shared";

const ARCHETYPES: StyleArchetype[] = [
  { key: "classic", label: "Classic Red & Gold", bannerBg: "linear-gradient(135deg,#a3342f 0%,#c9622a 100%)", bannerFg: "#fdeecb", accentColor: "#c9622a", highlightBg: "#fdf6ec" },
  { key: "minimal", label: "Minimal Ivory", bannerBg: "#fff8ec", bannerFg: "#a3342f", accentColor: "#c9622a", highlightBg: "#fdf6ec" },
  { key: "vibrant", label: "Vibrant Coral", bannerBg: "linear-gradient(135deg,#e05252 0%,#f6b23c 100%)", bannerFg: "#ffffff", accentColor: "#e05252", highlightBg: "#fef2f2" },
  { key: "elegant_dark", label: "Elegant Maroon", bannerBg: "linear-gradient(135deg,#3a0f10 0%,#6b1f1f 100%)", bannerFg: "#f6c86a", accentColor: "#c9622a", highlightBg: "#faf3ed" },
  { key: "pastel", label: "Soft Blush", bannerBg: "linear-gradient(135deg,#ffd9d9 0%,#ffe9c9 100%)", bannerFg: "#7a1f1f", accentColor: "#c9622a", highlightBg: "#fff6f1" },
];

const COPY = [
  {
    opening: "Raksha Bandhan is a celebration of trust and togetherness — values we're proud to share with customers like you.",
    closing: "Wishing you and your family a joyful Raksha Bandhan filled with warmth and good memories.",
  },
  {
    opening: "This Raksha Bandhan, we wanted to send our warm wishes and thank you for the trust you've placed in us.",
    closing: "May the bonds of care and support in your life continue to grow stronger. Happy Raksha Bandhan!",
  },
  {
    opening: "Just as a rakhi symbolises protection and trust, we're committed to being a dependable partner for you.",
    closing: "Wishing you a Raksha Bandhan filled with love and celebration.",
  },
  {
    opening: "On this special day of Raksha Bandhan, we're grateful for relationships like ours built on trust and reliability.",
    closing: "Here's wishing you and your loved ones a wonderful Raksha Bandhan.",
  },
  {
    opening: "Raksha Bandhan reminds us that the strongest relationships are built on care and trust — something we value deeply with you.",
    closing: "Wishing you a joyful festival surrounded by family and good cheer.",
  },
];

export const RAKSHA_BANDHAN_TEMPLATES: MarketingTemplateDef[] = ARCHETYPES.map((archetype, i) =>
  festivalTemplate({
    idPrefix: "raksha_bandhan",
    category: "Raksha Bandhan",
    emoji: "🎗️",
    title: "Happy Raksha Bandhan",
    archetype,
    subject: "Happy Raksha Bandhan from {{company_name}}! 🎗️",
    opening: COPY[i].opening,
    closing: COPY[i].closing,
  })
);
