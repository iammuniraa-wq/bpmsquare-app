# sales_orders
status: live
plain: Sales orders made from an accepted quote or a won deal, with an order type per workspace, availability from stock and lead times, a PDF to send, and files. Where Dynamics 365 or SAP S/4HANA is connected, an order can be checked with the ERP and sent to it, and the ERP's orders, deliveries and invoices come back here.
rules:
- An order is made from an accepted standard quote, a won quotation or a won deal; the lines and prices are copied, never retyped.
- Each order has a type; the type sets the numbering prefix, the pricing mode and the PDF design.
- A draft can be changed freely; a confirmed order stays open only for notes, customer PO and files.
- Check with ERP asks the connected ERP for credit, price and stock and saves nothing in it; Send to ERP is a separate step, and a send never makes a second order in the ERP.
- With SAP S/4HANA the check is SAP's own order simulation, every line must be a catalogue product that exists in SAP, and the customer's coverage must have a sales area on the Mapping tab.
- An order read from the ERP, or accepted by it, is read-only here; its status, deliveries and invoices follow the ERP.
