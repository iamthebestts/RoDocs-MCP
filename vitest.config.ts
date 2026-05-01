import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/search/**/*.ts",
        "src/scraper/**/*.ts",
        "src/devforum/**/*.ts",
        "src/fastflags/**/*.ts",
      ],
      exclude: [
        "src/search/__tests__/**",
        "src/scraper/__tests__/**",
        "src/devforum/__tests__/**",
        "src/fastflags/__tests__/**",
      ],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
    testTimeout: 10_000,
  },
});
