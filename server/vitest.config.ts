import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "postgresql://splitwise:splitwise@localhost:5432/splitwise?schema=public",
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
  },
});
