// Reading a PDF's page count and "is it locked" from the bytes alone, without a PDF library: the model service reads
// the pages, we only need a number to hold the 20-page cap. Page objects are normally plain text in the file; when a
// file hides them in compressed object streams the count is unknown (0) and the size cap applies instead.

const latin1 = (bytes: Uint8Array, max = bytes.byteLength): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, max)).toString("latin1");

/** Pages in the PDF, or 0 when the bytes do not say. */
export function countPdfPages(bytes: Uint8Array): number {
  const s = latin1(bytes);
  let objects = 0;
  for (const _m of s.matchAll(/\/Type\s*\/Page(?![A-Za-z])/g)) objects++;
  let counted = 0;
  for (const m of s.matchAll(/\/Type\s*\/Pages(?![A-Za-z])/g)) {
    const at = m.index ?? 0;
    const near = s.slice(Math.max(0, at - 400), at + 400);
    for (const c of near.matchAll(/\/Count\s+(\d{1,5})/g)) counted = Math.max(counted, Number(c[1]));
  }
  return Math.max(objects, counted);
}

export const looksLikePdf = (bytes: Uint8Array): boolean => latin1(bytes, 1024).includes("%PDF-");

/** A password-protected PDF names an /Encrypt dictionary in its trailer. */
export function isEncryptedPdf(bytes: Uint8Array): boolean {
  return /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(latin1(bytes));
}
