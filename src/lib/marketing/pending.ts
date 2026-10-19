/** A migration the owner has not run yet shows up as one of these codes.
 *  Marketing code treats all of them as "nothing there yet", never a crash. */
export function isSchemaPending(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205") return true;
  const msg = err.message ?? "";
  return /does not exist|schema cache|could not find the/i.test(msg);
}
