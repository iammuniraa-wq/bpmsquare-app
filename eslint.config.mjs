import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // PricingEngine core (docs/pricing-engine-architecture.md §11.3): a pure
    // TS package with ZERO framework/persistence imports. One convenient
    // import must break the build, not the platform thesis.
    files: ["src/lib/pricing-core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@supabase/*"], message: "pricing-core is persistence-free — adapters live outside the core (spec §11.3)." },
            { group: ["next", "next/*"], message: "pricing-core is framework-free (spec §11.3)." },
            { group: ["react", "react-dom", "react/*"], message: "pricing-core is framework-free (spec §11.3)." },
            { group: ["@/lib/*", "@/app/*", "@/components/*", "@/extensions/*"], message: "pricing-core must not depend on app internals — pass plain data in (spec §11.3)." },
            { group: ["server-only"], message: "pricing-core is environment-agnostic (spec §11.3)." },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
