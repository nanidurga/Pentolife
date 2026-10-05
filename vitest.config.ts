import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Engine tests download nothing but take minutes; run them with `npm run test:engines`.
    exclude: ["node_modules/**", ".next/**", "supabase/functions/**", "**/*.engine.test.ts"],
  },
});
