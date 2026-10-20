import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { "@": root } },
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts", "tests/convex/**/*.test.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
          // Dummy R2 config: signing is local, and tests never reach the network.
          env: {
            R2_BUCKET: "test-bucket",
            R2_AUDIO_BUCKET: "test-audio-bucket",
            R2_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
            R2_ACCESS_KEY_ID: "test-access-key",
            R2_SECRET_ACCESS_KEY: "test-secret-key",
          },
        },
      },
      {
        resolve: { alias: { "@": root } },
        test: {
          name: "lib",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/convex/**"],
          environment: "node",
          env: {
            NEXT_PUBLIC_MAIN_ORIGIN: "http://localhost:3000",
            NEXT_PUBLIC_USERCONTENT_ORIGIN: "http://127.0.0.1:3000",
          },
        },
      },
    ],
  },
});
