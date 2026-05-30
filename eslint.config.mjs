// Plugin-author ESLint config — extends the gui-chat-protocol preset
// to ban node:fs / node:path / console / direct fetch so any platform
// bypass shows up at lint time.
//
// The preset is parser-agnostic; pair it with a TypeScript parser
// (and a Vue parser if your plugin has SFCs) here in your own config
// so the plugin doesn't have to ship a parser dep.

import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";
import pluginPreset from "gui-chat-protocol/eslint-preset";

export default [
  // TypeScript parsing for .ts files.
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
  },
  // Vue SFC parsing for .vue files.
  {
    files: ["src/**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module" },
    },
  },
  // Apply the gui-chat-protocol restrictions to all plugin source.
  ...pluginPreset.map((entry) => ({ ...entry, files: ["src/**/*.{ts,vue}"] })),
];
