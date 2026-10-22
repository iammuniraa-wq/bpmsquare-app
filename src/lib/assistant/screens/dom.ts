// Finding the element a guide step points at. A component marks what a guide may point at with data-guide="<id>"
// (a stable id by convention, never a DOM path or a class); the studios' Tours also point at plain element ids.
// Client-side only: it reads the page.

/** The element for a data-guide id, or for an element id when no data-guide carries it. */
export function findGuideTarget(id: string, domId?: string): HTMLElement | null {
  if (typeof document === "undefined" || !id) return null;
  const marked = document.querySelector<HTMLElement>(`[data-guide="${CSS.escape(id)}"]`);
  if (marked) return marked;
  return document.getElementById(domId ?? id);
}
