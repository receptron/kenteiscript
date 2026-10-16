// Builds the presentKentei chat plugin (src/plugin/) into dist/, the layout gui-chat-protocol hosts
// load: dist/index.js (server entry: the definePlugin factory and the core), dist/vue.js (the View
// and Preview), dist/style.css. ESM + CJS like @mulmoclaude/form-plugin. vue and gui-chat-protocol
// stay external so the plugin shares the host's instances (the runtime injection key must match);
// Zod is bundled, so the package needs no runtime dependencies.
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
      external: ["vue", "gui-chat-protocol", "gui-chat-protocol/vue"],
      output: { exports: "named", assetFileNames: "style.[ext]" },
    },
    cssCodeSplit: false,
    minify: false,
    sourcemap: true,
  },
});
