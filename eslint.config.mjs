import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/drizzle/**",
      "**/.tmp/**",
      "**/data/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Config must flow through src/config.ts — no direct env reads in business code.
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration from src/config.ts instead of process.env.",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Config, tests and tooling may read env directly.
    files: [
      "**/src/config.ts",
      "**/*.test.ts",
      "**/drizzle.config.ts",
      "**/scripts/**",
      "**/examples/**",
    ],
    rules: { "no-restricted-properties": "off" },
  },
);
