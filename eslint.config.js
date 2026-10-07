// Lint rules for the web app, desktop shell, Worker and scripts. Formatting is
// Prettier's job (npm run format); these rules catch likely mistakes.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".wrangler/**",
      ".tools/**",
      ".venv-clearvoice/**",
      ".clearvoice-training/**",
      "release/**",
      "build/**",
      "docs/**",
      "scripts/.*.tmp.*",
      "mobile/**",
      "website/**",
      "ml/**",
      "**/node_modules/**",
      "worker/worker-configuration.d.ts",
      "src/audio/clearvoice/legacy-onnxruntime/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Empty catch blocks are used on purpose for best-effort browser APIs.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Several sanitizers strip control characters with regexes on purpose.
      "no-control-regex": "off",
      "@typescript-eslint/no-explicit-any": "error",
      // Defensive defaults that a try block then overwrites, and secrets wiped in
      // finally blocks, are intentional.
      "no-useless-assignment": "off",
      // Leading underscores mark values left out on purpose, e.g. { secret: _secret, ...rest }.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    // TypeScript already reports undefined names.
    files: ["**/*.{ts,tsx}"],
    rules: { "no-undef": "off" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Effects list the values they react to on purpose: grouped state objects
      // (preferences, hubPanels, ...) are new each render, and timer refs must be
      // read at cleanup time, so this rule's suggestions would change behaviour.
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: ["worker/**/*.ts", "shared/**/*.ts"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["electron/**/*.cjs", "scripts/**/*.{js,cjs,mjs}", "*.{js,cjs,mjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Preload scripts run next to the page; browser tests evaluate code in the page.
    files: ["electron/*preload*.cjs", "scripts/acceptance/**", "scripts/e2e/**"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
