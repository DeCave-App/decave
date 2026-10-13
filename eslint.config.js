// Lint rules for the web app, desktop shell, Worker and scripts. Formatting is
// Prettier's job (npm run format); these rules catch likely mistakes.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import i18next from "eslint-plugin-i18next";
import tseslint from "typescript-eslint";
import glossary from "./shared/i18n/glossary.json" with { type: "json" };

// Folders whose user-facing text must come from t(). Entries are folders
// ("src/foo/**") or file globs ending in .ts/.tsx; the whole web app and desktop
// shell are covered.
const I18N_LINT_DIRS = ["src/**", "electron/**"];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Text made only of kept-English terms (glossary.json), numbers and symbols needs no translation.
const keptEnglishOnly = new RegExp(
  `^(?:${[...glossary.keepEnglish]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|")}|[\\s\\p{N}\\p{P}\\p{S}])+$`,
  "u",
);

export default tseslint.config(
  {
    ignores: [
      ".tmp/**",
      ".claude/**",
      "decave/**",
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
      "src/audio/deepfilter/vendor/**",
      "vendor/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Other sessions' worktrees under .claude/ carry their own tsconfig; pin the root.
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
  },
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
  ...(I18N_LINT_DIRS.length
    ? [
        {
          // "Nothing left in English": JSX text, text attributes, and strings shown
          // through alert/confirm/prompt or toasts must be translated.
          // Entries are folders ("src/foo/**") or file globs ending in .ts/.tsx.
          files: I18N_LINT_DIRS.map((dir) =>
            /\.tsx?$/.test(dir) ? dir : `${dir.replace(/\/\*\*$/, "")}/**/*.{ts,tsx,cjs}`,
          ),
          plugins: { i18next },
          rules: {
            "i18next/no-literal-string": [
              "error",
              {
                mode: "jsx-only",
                "jsx-components": { exclude: ["Trans"] },
                "jsx-attributes": { include: ["aria-label", "title", "placeholder", "alt", "label"] },
                callees: { include: ["alert", "confirm", "prompt", "showToast", "toast"] },
                words: { exclude: ["[0-9!-/:-@[-`{-~]+", keptEnglishOnly, /^\p{Emoji}+$/u] },
                message: "Translate this text with t()",
              },
            ],
            "no-restricted-syntax": [
              "error",
              {
                selector:
                  "CallExpression[callee.name=/^(alert|confirm|prompt|showToast|toast)$/] > :matches(Literal[value=/[A-Za-z]/], TemplateLiteral)",
                message: "Translate this text with t()",
              },
              {
                selector:
                  "CallExpression[callee.property.name=/^(alert|confirm|prompt|showToast|toast)$/] > :matches(Literal[value=/[A-Za-z]/], TemplateLiteral)",
                message: "Translate this text with t()",
              },
            ],
          },
        },
      ]
    : []),
);
