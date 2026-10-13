// Lint rules for the mobile app (npm run lint in mobile/). The repository's root
// config skips mobile/, so this file carries the mobile translation gate:
// "nothing left in English" for screen text, accessibility labels and alerts.
import i18next from "eslint-plugin-i18next";
import tseslint from "typescript-eslint";
import glossary from "../shared/i18n/glossary.json" with { type: "json" };

// Folders whose user-facing text must come from t(). The translation rollout
// adds each area as it is converted; at release this becomes ["app/**", "src/**"].
const I18N_LINT_DIRS = ["app/**", "src/**"];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Text made only of kept-English terms (glossary.json), numbers and symbols needs no translation.
const keptEnglishOnly = new RegExp(
  `^(?:${[...glossary.keepEnglish]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|")}|[\\s\\p{N}\\p{P}\\p{S}])+$`,
  "u",
);

// Calls whose text arguments reach the user: Alert.alert(title, message) and web-style dialogs.
const DIALOG_CALLEES = "/^(alert|confirm|prompt|showToast|toast)$/";
const UNTRANSLATED = "Translate this text with t()";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "ios/**", "android/**", "targets/**", "modules/**", "plugins/**", "scripts/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
  },
  {
    files: I18N_LINT_DIRS.map((dir) => (/\.tsx?$/.test(dir) ? dir : `${dir.replace(/\/\*\*$/, "")}/**/*.{ts,tsx}`)),
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-components": { exclude: ["Trans"] },
          "jsx-attributes": {
            include: ["accessibilityLabel", "accessibilityHint", "aria-label", "title", "placeholder", "alt", "label"],
          },
          callees: { include: ["alert", "confirm", "prompt", "showToast", "toast"] },
          words: { exclude: ["[0-9!-/:-@[-`{-~]+", keptEnglishOnly, /^\p{Emoji}+$/u] },
          message: UNTRANSLATED,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: `CallExpression[callee.name=${DIALOG_CALLEES}] > :matches(Literal[value=/[A-Za-z]/], TemplateLiteral)`,
          message: UNTRANSLATED,
        },
        {
          selector: `CallExpression[callee.property.name=${DIALOG_CALLEES}] > :matches(Literal[value=/[A-Za-z]/], TemplateLiteral)`,
          message: UNTRANSLATED,
        },
        {
          // Alert.alert(title, message, [{ text: "Cancel" }]): button labels too.
          selector: `CallExpression[callee.property.name=${DIALOG_CALLEES}] Property[key.name="text"] > :matches(Literal[value=/[A-Za-z]/], TemplateLiteral)`,
          message: UNTRANSLATED,
        },
      ],
    },
  },
);
