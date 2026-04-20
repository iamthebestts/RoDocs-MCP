import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/scraper/index.ts",
    cli: "src/cli/index.ts",
  },
  outDir: "dist",
  format: ["esm", "cjs"],
  target: "node20",
  platform: "node",

  clean: true,
  sourcemap: true,
  dts: true,
  splitting: false,
  bundle: true,
  minify: false,
  treeshake: true,
  shims: true,

  define: {
    "process.env.NODE_ENV": '"production"',
  },

  external: ["@modelcontextprotocol/sdk", "axios", "cheerio", "zod"],

  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },

  banner: {
    js: "#!/usr/bin/env node",
  },

  esbuildOptions(options) {
    options.packages = "external";
    options.drop = ["debugger"];
    options.keepNames = true;
    options.supported = {
      "dynamic-import": true,
      "import-meta": true,
    };
  },
});
