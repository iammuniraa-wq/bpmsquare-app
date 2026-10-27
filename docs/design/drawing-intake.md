# Drawing intake: read PDF, Word, Excel, photos and DXF into estimate inputs (2026-10-24)

> Owner decisions (2026-10-24): customers send **DXF or PDF**; Word and Excel also read; DWG is not accepted (save as DXF). Order: (1) PDF, Word, Excel,
> photos with a source review; (2) DXF reader with measuring and an in-browser viewer. A scale-and-trace tool for plans without dimensions is later.
> This is not a new object: it extends "Read the email" (`aiIntake.ts`) and the Inbox attachments. No new feature flag; it needs the Estimates and Inbox
> modules and the AI key, and counts against the AI allowance (`estimate_intake`).

## What is already there

Inbox attachments (`inbound_email_attachments`, private bucket, signed links, quality labels, `files.ts`), "Read the email" with Found / Likely / Missing and the
email's own words (`aiIntake.ts`, `aiRun.ts`, `EmailIntake.tsx`), the shared piece viewer, `mammoth` (Word) and `exceljs` (Excel) already installed.
Create-from-email copies the files onto the record. No PDF or CAD reader exists.

## 1. Drawing and document reading (PDF, Word, Excel, photos)

- Open an estimate from an email with files: the intake box lists the readable attachments (PDF, DOCX, XLSX, PNG, JPG; DXF goes to part 2), each ticked by
  default, size and page caps shown ("up to 20 pages, 10 MB"). "Read the email" then reads the text and the ticked files together.
- PDFs and photos go to the model as document and image blocks (it reads text, tables and scanned or drawn plans); Word becomes text with mammoth, Excel
  becomes rows of text with exceljs. Everything read is treated as untrusted data (the email rule applies to files too).
- The answer list gains where each value came from: `file`, `page`, and the quoted words. The review table shows "from boundary-plan.pdf, page 2: ..." and an
  "Open page" link (signed URL with `#page=N`, opens the browser's PDF viewer at the page); a value the files contradict the email on is marked and explained.
- Quality: a file that cannot be read (scanned too poorly, password protected, too large) says so by name; the rest still reads. Nothing is saved.
- Tenant safety: attachment ids come from the opened email only, each checked with `tenant_id` and the viewer's channel access (`loadEmailForViewer`).

## 2. DXF drawings

- A DXF attachment is parsed on the server (open-source `dxf-parser`) into measurable entities: lines, polylines, arcs, circles, block inserts, text.
- The **template** maps layers to inputs (`drawing_map`: input, measure length_m / area_m2 / count, layers, blocks, optional scale), edited in Settings >
  Estimate templates next to the inputs (one place per setting). The unit comes from the drawing ($INSUNITS) and is always shown with a confirm.
- Measured values arrive in the same review table as Found, with the layer and the measured number as their source, and clicking a value highlights the
  lines it came from in an in-browser DXF viewer (pan, zoom, layers on and off).
- A DXF with no mapped layers lists the layers it has with their lengths, areas and counts, so the person (or an admin) can see what to map.

## Not in this build

Scale-and-trace for plans without dimensions; DWG; highlighting on the PDF page itself (needs a PDF renderer; the page link is the first version).
