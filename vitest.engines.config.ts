import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs the real Python (Pyodide) and C++ (clang) engines in Node.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["**/*.engine.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
