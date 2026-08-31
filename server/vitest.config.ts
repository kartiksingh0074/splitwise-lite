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
    },
  },
});
