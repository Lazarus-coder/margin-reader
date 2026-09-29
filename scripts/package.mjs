import { packager } from "@electron/packager";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const releaseDirectory = path.join(root, "release");

export function targetOptions(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      platform: { type: "string", default: process.platform },
      arch: { type: "string", default: process.arch },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/package.mjs [--platform darwin|win32|linux] [--arch arm64|x64]",
    );
    console.log(
      "Defaults to the current computer. release.mjs accepts the same options and also archives the app.",
    );
    return null;
  }
  if (!["darwin", "win32", "linux"].includes(values.platform))
    throw new Error(`Unsupported platform: ${values.platform}`);
  if (!["arm64", "x64"].includes(values.arch))
    throw new Error(`Unsupported architecture: ${values.arch}`);
  return { platform: values.platform, arch: values.arch };
}

async function exists(filename) {
  try {
    return (await stat(filename)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function packageApplication({ platform, arch }) {
  const metadata = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const electron = JSON.parse(
    await readFile(
      path.join(root, "node_modules/electron/package.json"),
      "utf8",
    ),
  );
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      metadata.version,
    )
  )
    throw new Error("package.json must contain a valid release version.");
  if (!(await exists(path.join(root, "dist/index.html"))))
    throw new Error("Build the reader first: npm run build");

  const staging = await mkdtemp(path.join(tmpdir(), "margin-package-"));
  try {
    // Use a small allowlist instead of copying the workspace. Imported novels,
    // credentials, tests, and development dependencies never enter the package.
    await cp(path.join(root, "dist"), path.join(staging, "dist"), {
      recursive: true,
    });
    await mkdir(path.join(staging, "electron"));
    for (const filename of ["main.cjs", "preload.cjs"])
      await cp(
        path.join(root, "electron", filename),
        path.join(staging, "electron", filename),
      );
    await cp(path.join(root, "LICENSE"), path.join(staging, "LICENSE"));
    if (await exists(path.join(root, "THIRD_PARTY_NOTICES.md")))
      await cp(
        path.join(root, "THIRD_PARTY_NOTICES.md"),
        path.join(staging, "THIRD_PARTY_NOTICES.md"),
      );
    if (await exists(path.join(root, "assets/icon.png"))) {
      await mkdir(path.join(staging, "assets"));
      await cp(
        path.join(root, "assets/icon.png"),
        path.join(staging, "assets/icon.png"),
      );
    }
    // React and the other renderer dependencies are already bundled by Vite.
    const runtimePackage = Object.fromEntries(
      [
        "name",
        "productName",
        "version",
        "description",
        "main",
        "type",
        "license",
        "author",
        "homepage",
        "repository",
      ]
        .filter((key) => metadata[key] !== undefined)
        .map((key) => [key, metadata[key]]),
    );
    await writeFile(
      path.join(staging, "package.json"),
      `${JSON.stringify(runtimePackage, null, 2)}\n`,
    );

    const iconPath = path.join(
      root,
      "assets",
      platform === "darwin"
        ? "icon.icns"
        : platform === "win32"
          ? "icon.ico"
          : "icon.png",
    );
    const [output] = await packager({
      dir: staging,
      name: "Margin",
      executableName: "Margin",
      out: releaseDirectory,
      platform,
      arch,
      electronVersion: electron.version,
      appVersion: metadata.version,
      appBundleId: "local.margin.reader",
      appCategoryType: "public.app-category.books",
      ...((await exists(iconPath)) ? { icon: iconPath } : {}),
      asar: true,
      prune: false,
      overwrite: true,
    });
    if (!output)
      throw new Error("Electron Packager did not create an application.");
    // Keep our license visible next to Electron's own LICENSE and Chromium notices.
    await cp(path.join(root, "LICENSE"), path.join(output, "LICENSE.margin"));
    if (await exists(path.join(root, "THIRD_PARTY_NOTICES.md")))
      await cp(
        path.join(root, "THIRD_PARTY_NOTICES.md"),
        path.join(output, "THIRD_PARTY_NOTICES.md"),
      );
    console.log(`Packaged Margin ${metadata.version}: ${output}`);
    return { output, version: metadata.version, platform, arch };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const options = targetOptions();
    if (options) await packageApplication(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
