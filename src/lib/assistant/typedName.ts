// A name the person typed is kept as typed. The model tends to drop a bracketed suffix ("Delta Contracting [qa]" becomes
// "Delta Contracting"), so the brackets that follow the name in the person's own message are put back. Pure.

const SUFFIX = /^(?:\s*(?:\[[^[\]\n]{1,40}\]|\([^()\n]{1,40}\)))+/;

export function keepTypedName(name: string, userTurns: readonly string[]): string {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return name;
  for (let i = userTurns.length - 1; i >= 0; i--) {
    const turn = userTurns[i];
    const at = turn.toLowerCase().indexOf(wanted);
    if (at < 0) continue;
    const suffix = SUFFIX.exec(turn.slice(at + wanted.length));
    return suffix ? turn.slice(at, at + wanted.length + suffix[0].length) : name;
  }
  return name;
}
