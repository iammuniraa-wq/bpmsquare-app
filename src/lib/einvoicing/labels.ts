import type { EinvoiceDocType, VatCategory } from "./rules";

// Every English / Arabic string of the Saudi e-invoice, in ONE table: the printed bilingual invoice, the chips and the
// readiness messages all read from here, so a wording change is one edit and no Arabic is scattered through components.

export type Bilingual = { en: string; ar: string };

export const DOC_TITLE: Record<EinvoiceDocType, Bilingual> = {
  standard: { en: "Tax Invoice", ar: "فاتورة ضريبية" },
  simplified: { en: "Simplified Tax Invoice", ar: "فاتورة ضريبية مبسطة" },
  credit_note: { en: "Credit Note", ar: "إشعار دائن" },
  debit_note: { en: "Debit Note", ar: "إشعار مدين" },
};

/** Short, one-language label for chips and filters (the chip stays compact; the printed title uses both languages). */
export const DOC_CHIP: Record<EinvoiceDocType, string> = {
  standard: "Standard",
  simplified: "Simplified",
  credit_note: "Credit note",
  debit_note: "Debit note",
};

export const VAT_CATEGORY_LABEL: Record<VatCategory, Bilingual> = {
  S: { en: "Standard rate", ar: "الفئة الأساسية" },
  Z: { en: "Zero rated", ar: "نسبة الصفر" },
  E: { en: "Exempt", ar: "معفاة" },
  O: { en: "Out of scope", ar: "خارج النطاق" },
};

/** Printed labels. Keys are what the print component asks for. */
export const PRINT_LABELS = {
  invoiceNumber: { en: "Invoice No", ar: "رقم الفاتورة" },
  issueDate: { en: "Issue date", ar: "تاريخ الإصدار" },
  issueTime: { en: "Time", ar: "الوقت" },
  supplyDate: { en: "Supply date", ar: "تاريخ التوريد" },
  dueDate: { en: "Due date", ar: "تاريخ الاستحقاق" },
  seller: { en: "Seller", ar: "البائع" },
  buyer: { en: "Buyer", ar: "المشتري" },
  vatNumber: { en: "VAT number", ar: "الرقم الضريبي" },
  crn: { en: "Commercial registration", ar: "السجل التجاري" },
  address: { en: "Address", ar: "العنوان" },
  originalInvoice: { en: "Original invoice", ar: "الفاتورة الأصلية" },
  reason: { en: "Reason", ar: "السبب" },
  lineNo: { en: "#", ar: "#" },
  description: { en: "Description", ar: "الوصف" },
  uom: { en: "Unit", ar: "الوحدة" },
  qty: { en: "Qty", ar: "الكمية" },
  rate: { en: "Unit price", ar: "سعر الوحدة" },
  taxRate: { en: "VAT %", ar: "نسبة الضريبة" },
  taxable: { en: "Taxable amount", ar: "المبلغ الخاضع للضريبة" },
  vat: { en: "VAT", ar: "ضريبة القيمة المضافة" },
  amount: { en: "Amount", ar: "المبلغ" },
  vatBreakdown: { en: "VAT by rate", ar: "الضريبة حسب النسبة" },
  category: { en: "Category", ar: "الفئة" },
  subtotal: { en: "Total (excluding VAT)", ar: "الإجمالي (غير شامل الضريبة)" },
  discount: { en: "Discount", ar: "الخصم" },
  taxableTotal: { en: "Total taxable amount", ar: "إجمالي المبلغ الخاضع للضريبة" },
  vatTotal: { en: "Total VAT", ar: "إجمالي ضريبة القيمة المضافة" },
  grandTotal: { en: "Total amount due", ar: "إجمالي المبلغ المستحق" },
  paid: { en: "Paid to date", ar: "المدفوع" },
  balance: { en: "Balance due", ar: "المتبقي" },
  notes: { en: "Notes", ar: "ملاحظات" },
  terms: { en: "Terms & conditions", ar: "الشروط والأحكام" },
  qrPlaceholder: { en: "QR code appears here once the invoice is cleared", ar: "يظهر رمز الاستجابة السريعة هنا بعد اعتماد الفاتورة" },
  qrNotice: { en: "Not yet issued to ZATCA", ar: "لم تُرسل بعد إلى هيئة الزكاة والضريبة والجمارك" },
  uuid: { en: "UUID", ar: "المعرّف الفريد" },
  counter: { en: "Invoice counter", ar: "عداد الفواتير" },
  notSet: { en: "Not set", ar: "غير محدد" },
} as const satisfies Record<string, Bilingual>;

export type PrintLabelKey = keyof typeof PRINT_LABELS;
