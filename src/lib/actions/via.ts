import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// "Who pressed the button": the assistant's act route runs a create route's own handler inside runVia("assistant"),
// and logChange() reads it, so Change History shows "via assistant" without any route being edited.
// It is an in-process context on purpose, not a request header: a header can be set by anyone calling the route
// from outside, and an audit mark that can be forged is not an audit mark. Kept on globalThis so every bundle that
// imports this file shares one store.

export type Via = "assistant";

const KEY = Symbol.for("bpmsquare.actions.via");
type G = typeof globalThis & { [KEY]?: AsyncLocalStorage<Via> };
const g = globalThis as G;
const store: AsyncLocalStorage<Via> = (g[KEY] ??= new AsyncLocalStorage<Via>());

export function runVia<T>(via: Via, fn: () => Promise<T>): Promise<T> {
  return store.run(via, fn);
}

/** The surface the current mutation came through, or null for a person using a screen. */
export function currentVia(): Via | null {
  return store.getStore() ?? null;
}
