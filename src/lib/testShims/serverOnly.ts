// Vitest shim for Next.js's "server-only" sentinel package (which throws if
// imported from client code, and has no meaningful behavior under Node/
// vitest anyway). Aliased in vitest.config.ts so unit tests can import a
// module that starts with `import "server-only"` without pulling in Next's
// bundler-only enforcement.
export {};
