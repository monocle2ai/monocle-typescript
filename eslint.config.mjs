import globals from "globals";
import pluginJs from "@eslint/js";


/** @type {import('eslint').Linter.Config[]} */
export default [
  {files: ["**/*.ts"], languageOptions: {sourceType: "module"}},
  {languageOptions: { globals: globals.node}},
  pluginJs.configs.recommended,
];