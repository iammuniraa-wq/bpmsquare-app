// The explanations the estimate picture keeps behind an "i" (bpmsquarecore 6b). One place, so a test holds every text to the InfoTip
// limit: two sentences, 160 characters. The screens never print these as running text.

export const VISUAL_TIPS = {
  strip: "Each bar is one group of the estimate as a share of its cost. The stripe under it splits the same cost into materials, labour and the rest.",
  picture: "Choose how the estimate is drawn. A built-in model suits a trade that has one; otherwise the picture is drawn to scale from your sizes.",
  mapping: "Say which number is the length, width, height, run, count or area. Left as suggested, the picture follows the names and units of your inputs.",
} as const;

export type VisualTipKey = keyof typeof VISUAL_TIPS;
