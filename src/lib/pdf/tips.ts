// The explanations Settings > PDF documents keeps behind an "i" (bpmsquarecore 6b). One place so a test holds every text to
// the InfoTip limit (two sentences, 160 characters). The screen never prints these as running text.

export const PDF_TIPS = {
  page: "How your PDF documents look: the header and footer on every page, margins, type and colours. A workspace that never chooses a frame keeps the standard look.",
  standard: "On, documents print exactly as they always did. Turn it off to design your own page frame.",
  paper: "The paper the PDF is made for. The preview and the file follow this one choice.",
  logo: "Where the company logo and name sit in the header. The logo is never scaled above its own size.",
  headerLines: "Lines printed at the right of the header. Company details come from Settings > Company, never typed here.",
  footerLines: "Two columns at the foot of every page. Each line is read from the legal entity that issues the document.",
  extraIds: "Extra ids, such as a vendor number, are set on the legal entity. An id marked for selected customers prints only for the accounts that tick it.",
  colours: "The header band, the section bands, the table heading and the lines. Each is a six-digit colour.",
  pageNumbers: "Prints Page X of Y at the foot of every page.",
  margins: "Distance from the paper edge, in millimetres. The header and footer always get the room they need.",
  baseSize: "The size of body text. Headings and the header scale from it.",
  font: "Arial-like is a free look-alike with the same letter widths. Print sans is the font the standard documents use.",
  tableStyle: "Grid draws a line around every cell. Rows draws only the line under each row.",
  layouts: "A layout is the order of sections a document prints: front block, clauses, scope matrix, price table and closing. Each quotation picks one.",
  layoutsFrame: "Layouts print inside the page frame. A section marked edit per document can be changed on each quotation.",
} as const;
