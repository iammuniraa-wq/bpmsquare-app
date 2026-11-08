// Pure helpers for the "Rich" look (docs/design/rich-ui.md). Kept free of React so the rules are unit-testable.

type Root = Pick<Element, "setAttribute" | "removeAttribute">;

/**
 * Toasts, confirm dialogs and the InfoTip popover render outside Shell's wrapper div, so they cannot see data-rich. Shell mirrors
 * the two facts they need onto <html> while Rich is on, and removes them again when it turns off or unmounts.
 */
export function applyRichRoot(root: Root, rich: boolean, dark: boolean): void {
  if (!rich) {
    root.removeAttribute("data-rich-root");
    root.removeAttribute("data-rich-dark");
    return;
  }
  root.setAttribute("data-rich-root", "true");
  if (dark) root.setAttribute("data-rich-dark", "true");
  else root.removeAttribute("data-rich-dark");
}
