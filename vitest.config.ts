import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "scripts/**/*.mjs"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "app/**/page.tsx",
        "app/**/layout.tsx",
        "lib/supabase/**",
      ],
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
