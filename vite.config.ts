import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

// Two bundles, two externals strategies (mirrors the in-tree
// bookmarks-plugin reference):
//
// - dist/index.js (server) — self-contained. The mulmoclaude
//   runtime loader extracts the package into
//   ~/mulmoclaude/plugins/.cache/<pkg>/<ver>/ and dynamic-imports
//   it. There's no node_modules underneath, so any bare import left
//   external would fail to resolve at load time. Inline
//   gui-chat-protocol (just the identity definePlugin function) and
//   zod so the server module is self-contained.
//
// - dist/vue.js (browser) — vue and gui-chat-protocol/vue stay
//   external; the host provides Vue via the importmap and the
//   useRuntime() composable resolves to the host's instance through
//   gui-chat-protocol/vue (also via importmap).
// No `rollupTypes: true`: that would route declaration emit through
// @microsoft/api-extractor, whose bundled tsc lags behind real
// TypeScript releases and silently emits empty d.ts when the
// workspace is on a newer major. `compilerOptions.rootDir: "src"`
// keeps the per-file emit at `dist/<file>.d.ts` (matching the
// package.json exports map).
export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ["src/**/*.{ts,vue}"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts", vue: "src/vue.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["vue", "gui-chat-protocol/vue"],
      output: {
        // The host runtime loader injects a stylesheet from
        // `${assetBase}/dist/style.css`. Vite's default would name
        // the CSS after the package; pin it to style.css.
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "style.css";
          return assetInfo.name ?? "[name]";
        },
      },
    },
    minify: false,
    sourcemap: true,
  },
});
