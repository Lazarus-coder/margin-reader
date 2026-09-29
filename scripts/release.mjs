import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  packageApplication,
  releaseDirectory,
  targetOptions,
} from "./package.mjs";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed with exit code ${code}`)),
    );
  });
}

try {
  const options = targetOptions();
  if (options) {
    if (options.platform !== process.platform)
      throw new Error(
        "Create release archives on the matching operating system. Use npm run package for cross-platform bundles, or the GitHub release workflow for every platform.",
      );
    const { output, version, platform, arch } =
      await packageApplication(options);
    const platformName = { darwin: "macos", win32: "windows", linux: "linux" }[
      platform
    ];
    const extension = platform === "linux" ? "tar.gz" : "zip";
    const filename = `Margin-${version}-${platformName}-${arch}.${extension}`;
    const downloads = path.join(releaseDirectory, "downloads");
    await mkdir(downloads, { recursive: true });
    const archive = path.join(downloads, filename);
    const temporary = path.join(downloads, `.${filename}.tmp.${extension}`);
    await rm(temporary, { force: true });
    try {
      if (platform === "darwin") {
        // ditto preserves the framework symlinks and executable modes in .app bundles.
        // Archive the whole output so Electron and Chromium licenses are included.
        await run("ditto", ["-c", "-k", "--sequesterRsrc", output, temporary]);
      } else if (platform === "win32") {
        await run(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Compress-Archive -LiteralPath $env:MARGIN_ARCHIVE_SOURCE -DestinationPath $env:MARGIN_ARCHIVE_DESTINATION -CompressionLevel Optimal",
          ],
          {
            env: {
              ...process.env,
              MARGIN_ARCHIVE_SOURCE: output,
              MARGIN_ARCHIVE_DESTINATION: temporary,
            },
          },
        );
      } else {
        await run("tar", [
          "-czf",
          temporary,
          "-C",
          path.dirname(output),
          path.basename(output),
        ]);
      }
      await rm(archive, { force: true });
      await rename(temporary, archive);
    } finally {
      await rm(temporary, { force: true });
    }
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(archive)) digest.update(chunk);
    await writeFile(
      `${archive}.sha256`,
      `${digest.digest("hex")}  ${filename}\n`,
    );
    console.log(`Release archive: ${archive}`);
    console.log(`Checksum: ${archive}.sha256`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
