// Price list and currency are picked one right after the other. Each pick adds to
// what is pending (never replaces it) and saves are made one after another, each
// carrying everything chosen so far, so the second pick cannot undo the first.

export type PickPatch = { price_list_id?: string; currency_id?: string };

export function createPickSaver(save: (chosenSoFar: PickPatch) => Promise<void>) {
  let pending: PickPatch = {};
  let chain: Promise<void> = Promise.resolve();
  return {
    choose(patch: PickPatch): Promise<void> {
      pending = { ...pending, ...patch };
      const snapshot = { ...pending };
      chain = chain.then(() => save(snapshot), () => save(snapshot));
      return chain;
    },
    chosen: (): PickPatch => ({ ...pending }),
    /** Forget what was chosen, once the stored connection shows it. */
    clear() { pending = {}; },
  };
}
