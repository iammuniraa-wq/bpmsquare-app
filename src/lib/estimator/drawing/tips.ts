// The explanations behind the "i" on the drawing screens (two short sentences at most, 160 characters; tips.test.ts holds
// them to it, as the inbox and marketing screens do).

export const DRAWING_TIPS = {
  section: "Tells a DXF drawing which layers to measure into which number. Rows you leave out are filled from the email or by hand.",
  input: "The number on the estimate that receives the measurement.",
  measure: "Length adds up lines, polylines and arcs; area uses closed shapes; count counts block inserts such as gates.",
  layers: "Layer names as the drawing spells them, separated by commas. Upper and lower case do not matter.",
  blocks: "Count only these blocks (for example GATE). Leave empty to count every block on the layers.",
  scale: "Only if the drawing's units are missing or wrong: metres per drawing unit, for example 0.001 for millimetres.",
  viewer: "Drag to move, scroll or use the buttons to zoom. Switch layers on and off to see what each one holds.",
  units: "Measured lengths depend on the drawing's units. Check them before using the numbers.",
} as const;
