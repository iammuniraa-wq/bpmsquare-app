# sales_orders
status: live
plain: Sales orders made from an accepted quote or a won deal, with an order type per workspace, availability from stock and lead times, a PDF to send, and files.
rules:
- An order is made from an accepted standard quote, a won quotation or a won deal; the lines and prices are copied, never retyped.
- Each order has a type; the type sets the numbering prefix, the pricing mode and the PDF design.
- A draft can be changed freely; a confirmed order stays open only for notes, customer PO and files.
- Sending the order to an ERP and checking it there are not part of this module yet.
