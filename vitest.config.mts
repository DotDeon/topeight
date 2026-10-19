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
          include: ["convex/**/*.test.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        resolve: { alias: { "@": root } },
        test: {
          name: "lib",
          include: ["tests/**/*.test.ts"],
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
