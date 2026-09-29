import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const tag = `v${version}`;
if (
  process.env.GITHUB_REF_TYPE !== "tag" ||
  process.env.GITHUB_REF_NAME !== tag
)
  throw new Error(`Expected a GitHub Actions run from ${tag}.`);

const directory = path.join(root, "release/downloads");
const filenames = [
  `Margin-${version}-linux-x64.tar.gz`,
  `Margin-${version}-macos-arm64.zip`,
  `Margin-${version}-macos-x64.zip`,
  `Margin-${version}-windows-x64.zip`,
];
const checksums = [];
for (const filename of filenames) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path.join(directory, filename)))
    digest.update(chunk);
  const actual = `${digest.digest("hex")}  ${filename}\n`;
  const expected = await readFile(
    path.join(directory, `${filename}.sha256`),
    "utf8",
  );
  if (actual !== expected) throw new Error(`Checksum mismatch: ${filename}`);
  checksums.push(actual);
}
await writeFile(path.join(directory, "SHA256SUMS"), checksums.join(""));

function gh(args, capture = false) {
  return execFileSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

// The GitHub API distinguishes a missing release from authentication/network errors.
// Do not risk overwriting an already-published release when a workflow is rerun.
let existing;
try {
  existing = JSON.parse(
    gh(["release", "view", tag, "--json", "isDraft"], true),
  );
} catch (error) {
  const detail = String(error.stderr || error.message);
  if (!/release not found|HTTP 404/i.test(detail)) throw error;
}
if (existing && !existing.isDraft)
  throw new Error(
    `${tag} is already public. Create a new version instead of replacing released files.`,
  );

const notes = path.join(directory, "release-notes.md");
await writeFile(
  notes,
  `Margin · 余白 ${version}\n\nA quiet, local reader for Chinese TXT novels, with a compact desk view, quick cover, bookmarks, and saved reading progress.\n\nDownload the archive for your operating system below. Node.js is not required. These portable builds are not signed with a developer certificate or notarized; consult the README for installation and platform limitations.\n\nmacOS: unzip and drag Margin.app into Applications. Windows: extract the whole folder and open Margin.exe. Linux: extract the tar.gz and run ./Margin from its folder. SHA256SUMS contains checksums for all four archives.\n`,
);
if (!existing)
  gh([
    "release",
    "create",
    tag,
    "--verify-tag",
    "--draft",
    "--title",
    `Margin ${version}`,
    "--notes-file",
    notes,
    ...(version.includes("-") ? ["--prerelease"] : []),
  ]);
gh([
  "release",
  "upload",
  tag,
  ...filenames.map((filename) => path.join(directory, filename)),
  path.join(directory, "SHA256SUMS"),
  "--clobber",
]);
gh(["release", "edit", tag, "--draft=false"]);
