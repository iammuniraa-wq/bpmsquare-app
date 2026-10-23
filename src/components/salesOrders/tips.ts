// The explanations the Sales Order screens keep behind an "i" (bpmsquarecore 6b): at most two sentences, 160
// characters. One place, so a test holds every text to the InfoTip limit.

export const ORDER_TIPS = {
  path: "Delivered, Invoiced and Paid fill in when your ERP reports them. Until then they stay grey.",
  total: "The order total with tax. Prices come from the quote the order was made from, or from your price list.",
  expected: "The latest confirmed date across the lines. A master-data date is an estimate until the ERP confirms it.",
  customerPo: "The customer's own order number. Attach the PO file on the Documents and files tab.",
  availability: "Asked is what the customer wanted. Confirmed comes from the ERP when it replied, else from stock and lead times in master data.",
  printedText: "This text prints under the line on the order PDF. It is not used anywhere else.",
  erpId: "The order's number in your ERP, once the ERP has accepted it. It stays read-only here after that.",
  transfer: "Each time the order is checked with or sent to the ERP, the result is logged here.",
  deliveries: "Deliveries and invoices are read from the ERP and cannot be edited here. They fill the document flow and the path.",
  files: "Keep the customer's PO, drawings and other papers with the order. Files and links stay open after the order is confirmed.",
  fileKind: "Customer PO, Drawing or Other. The kind only helps you find a file again.",
  flow: "Each box is a document. A dashed box has not happened yet; click any other box to open it.",
  // create
  type: "The type decides the numbering, the PDF layout and how lines are priced. Leave it on Automatic to let your rules choose.",
  customer: "Search by name. The bill-to and ship-to start as this customer's details and can be changed.",
  shipTo: "Where the goods go, if not to the customer's main address. It prints on the order PDF.",
  requestedDate: "The date the customer asked for. Each line can ask for its own date.",
  // settings
  typesPage: "Order types decide the numbering, the PDF layout and how orders are priced. A new order uses the type whose rules match, else the default.",
  prefix: "Orders are numbered PREFIX-0001, counted per workspace and prefix. Changing it affects new orders only.",
  pricingMode: "Internal prices lines from your price list and pricing engine. External takes prices from the ERP and keeps them read-only.",
  rules: "The first matching rule picks this type for a new order. A type with no rules is only used when chosen or when it is the default.",
  design: "Choose which blocks print, their order and the accent colour. It works like the Standard Quote templates.",
  isDefault: "The default type is used when no rule matches. One type is always the default.",
} as const;

export const LOCK_REASONS = [
  "This order comes from your ERP, so it is changed there. Notes and files stay open only on orders made here.",
  "A cancelled order cannot be changed.",
  "The ERP accepted this order, so it is read-only here. Notes and files stay open.",
  "A confirmed order is locked. Reopen it to change lines; notes and files stay open.",
] as const;
