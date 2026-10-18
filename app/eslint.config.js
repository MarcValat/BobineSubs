// What tsc doesn't catch: the hooks' rules (a dependency missing from an
// effect, a hook called conditionally) and the usual JS slips. Formatting is
// Prettier's, not ESLint's.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules", "e2e/report", "e2e/results"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    // The two classic rules: the recommended set also has the React
    // Compiler's, for code it compiles (this app isn't).
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    files: ["e2e/**/*.ts", "scripts/**/*.mjs", "*.js", "*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
