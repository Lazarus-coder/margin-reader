import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { randomBytes } from "node:crypto";

export default defineConfig(({ command }) => {
  const nonce =
    command === "serve" ? randomBytes(18).toString("base64") : undefined;
  return {
    base: "./",
    html: { cspNonce: nonce },
    plugins: [
      react(),
      {
        name: "local-development-csp",
        apply: "serve",
        transformIndexHtml(html) {
          return html.replace(
            "script-src 'self'",
            `script-src 'self' 'nonce-${nonce}'`,
          );
        },
      },
    ],
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    test: { include: ["src/**/*.test.ts"] },
  };
});
