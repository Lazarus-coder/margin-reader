import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";
import electron from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let server;
let child;
let closing = false;

async function close(code = 0) {
  if (closing) return;
  closing = true;
  if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
  if (server) await server.close();
  process.exitCode = code;
}

process.once("SIGINT", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});

try {
  server = await createServer({
    root,
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  });
  await server.listen();
  server.printUrls();
  // Codex and other Node hosts may set this; the GUI must launch as Electron.
  const environment = {
    ...process.env,
    MARGIN_DEV_URL: "http://127.0.0.1:5173",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, [root], {
    cwd: root,
    stdio: "inherit",
    env: environment,
  });
  child.once("error", (error) => {
    console.error("Could not launch Electron:", error.message);
    void close(1);
  });
  child.once("exit", (code) => {
    void close(code ?? 0);
  });
} catch (error) {
  console.error("Could not start Margin:", error.message);
  await close(1);
}
