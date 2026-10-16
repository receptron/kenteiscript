// Builds the presentKentei chat plugin (src/plugin/) into dist/, the layout gui-chat-protocol hosts
// load: dist/index.js (server entry: the definePlugin factory and the core), dist/vue.js (the View
// and Preview), dist/style.css. ESM + CJS like @mulmoclaude/form-plugin.
//
// Externals differ by side. The browser entry keeps `vue` and `gui-chat-protocol/vue` external so
// the View shares the host's instances (the runtime injection key must match); hosts map both
// (MulmoClaude's importmap, MulmoTerminal's bundler). The server entry must have NO bare imports:
// MulmoClaude's runtime loader import()s dist/index.js from its plugin cache with no node_modules
// around it. So gui-chat-protocol's core (`definePlugin`, the identity function) and Zod are
// bundled; test/plugin-standalone.test.mjs loads dist/index.{js,cjs} from an empty directory.
//
// Unrelated to the MulmoKentei Worker, which wrangler builds from src/index.ts without Vue or Zod.
import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // public/ is MulmoKentei's page, not part of the plugin.
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, "src/plugin/server.ts"),
        vue: resolve(import.meta.dirname, "src/plugin/vue/index.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      // Only the browser-side modules; the core "gui-chat-protocol" is bundled (see above). Nothing
      // in the browser entry imports a runtime value from the core.
      external: ["vue", "gui-chat-protocol/vue"],
      output: { exports: "named", assetFileNames: "style.[ext]" },
    },
    cssCodeSplit: false,
    minify: false,
    sourcemap: true,
  },
});
