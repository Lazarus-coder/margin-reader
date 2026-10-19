import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  packageApplication,
  releaseDirectory,
  root,
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

async function sha256(filename) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest("hex");
}

async function writeChecksum(filename) {
  const name = path.basename(filename);
  await writeFile(`${filename}.sha256`, `${await sha256(filename)}  ${name}\n`);
}

async function buildPortableArchive({ output, platform, extension, target }) {
  const temporary = `${target}.tmp.${extension}`;
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
    await rm(target, { force: true });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

// A drag-to-install disk image: Margin.app next to an Applications shortcut.
async function buildDmg({ output, version, target }) {
  const stage = `${target}.stage`;
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    await run("ditto", [
      path.join(output, "Margin.app"),
      path.join(stage, "Margin.app"),
    ]);
    await symlink("/Applications", path.join(stage, "Applications"));
    await run("hdiutil", [
      "create",
      "-volname",
      `Margin ${version}`,
      "-srcfolder",
      stage,
      "-ov",
      "-format",
      "ULFO",
      target,
    ]);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function findInnoSetupCompiler() {
  const candidates = [
    process.env.MARGIN_ISCC,
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next known location.
    }
  }
  // Fall back to PATH; spawn surfaces a clear error when it is missing.
  return "ISCC.exe";
}

async function buildWindowsInstaller({ output, version, target }) {
  const compiler = await findInnoSetupCompiler();
  await run(compiler, [
    `/DAppVersion=${version}`,
    `/DStageDir=${output}`,
    `/DIconFile=${path.join(root, "assets", "icon.ico")}`,
    `/O${path.dirname(target)}`,
    `/F${path.basename(target, ".exe")}`,
    path.join(root, "scripts", "installer", "margin.iss"),
  ]);
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
    const downloads = path.join(releaseDirectory, "downloads");
    await mkdir(downloads, { recursive: true });

    const artifacts = [];
    const extension = platform === "linux" ? "tar.gz" : "zip";
    const portable = path.join(
      downloads,
      `Margin-${version}-${platformName}-${arch}.${extension}`,
    );
    await buildPortableArchive({
      output,
      platform,
      extension,
      target: portable,
    });
    artifacts.push(portable);

    if (platform === "darwin") {
      const dmg = path.join(downloads, `Margin-${version}-macos-${arch}.dmg`);
      await buildDmg({ output, version, target: dmg });
      artifacts.push(dmg);
    } else if (platform === "win32") {
      const setup = path.join(
        downloads,
        `Margin-${version}-windows-${arch}-setup.exe`,
      );
      await buildWindowsInstaller({ output, version, target: setup });
      artifacts.push(setup);
    }

    for (const artifact of artifacts) {
      await writeChecksum(artifact);
      console.log(`Release artifact: ${artifact}`);
      console.log(`Checksum: ${artifact}.sha256`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
