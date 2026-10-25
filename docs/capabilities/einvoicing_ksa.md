# einvoicing_ksa
status: live
plain: Saudi e-invoicing readiness. An invoice gets the seller and buyer tax identity, a VAT category per line, a document type, credit notes, a per-seller counter and a bilingual Arabic and English print, and says exactly what is still missing.
rules:
- Nothing is sent to ZATCA yet; this only makes an invoice ready, and a draft that is not ready cannot be sent.
- A buyer with a VAT number gets a Standard invoice, anyone else a Simplified one; a credit note corrects an issued invoice in full and keeps every amount positive.
- The invoice counter is taken when the invoice is sent, one gap-free sequence per seller unit (a legal entity in Company settings).
- The flag is set by a platform admin; a workspace without it sees no new field, screen, API key or printed change.
