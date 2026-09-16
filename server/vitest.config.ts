import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      // tests/setup.ts wipes every table before each test -- set TEST_DATABASE_URL to point the
      // suite at a separate database so running it doesn't erase local dev/seed data.
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://splitwise:splitwise@localhost:5432/splitwise?schema=public",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PORT: "4000",
      WEB_ORIGIN: "http://localhost:5173",
      JWT_ACCESS_SECRET: "test-only-secret-not-for-real-use-32chars-min",
    },
    setupFiles: ["./tests/setup.ts"],
    // Test files share one live Postgres DB with no per-file isolation; each file's
    // beforeEach does a full-table cleanup, which races with other files' in-flight
    // transactions under the default file-level parallelism. Run files sequentially.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**"],
      exclude: ["src/config/**", "src/db/**"],
      // project.md §8: domain/ at 100% branches, overall backend >= 80%.
      thresholds: {
        branches: 80,
        lines: 80,
        functions: 80,
        statements: 80,
        "src/domain/**": {
          branches: 100,
          lines: 100,
          functions: 100,
          statements: 100,
        },
      },
    },
  },
});
