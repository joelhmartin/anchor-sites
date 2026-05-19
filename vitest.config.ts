import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
  },
});
