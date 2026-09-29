# Contributing to Margin

Thanks for helping make a quiet reading tool better. Small fixes, clearer documentation, and Chinese text compatibility reports are welcome.

## Get started

Install Node.js 24 and npm, then:

```sh
npm ci
npm run dev
```

`npm run dev` starts the Vite renderer and Electron desktop app together. `npm run dev:web` starts only the browser preview, which cannot test native window features.

## Project layout

| Path                                        | Purpose                                                    |
| ------------------------------------------- | ---------------------------------------------------------- |
| `src/App.tsx`                               | Reading interface and controls                             |
| `src/styles.css`, `src/workspace.css`       | Reading and Desk view styles                               |
| `src/lib/books.ts`                          | TXT decoding, parsing, chapters, and original sample story |
| `src/lib/storage.ts`                        | Local library persistence                                  |
| `electron/main.cjs`, `electron/preload.cjs` | Native windows, tray, shortcuts, and validated IPC         |
| `tests/`                                    | Playwright tests running the real Electron app             |
| `scripts/`                                  | Development and packaging tools                            |
| `docs/images/`                              | Screenshots captured from a clean sample profile           |
| `.github/workflows/`                        | CI and release builds                                      |

## Before opening a pull request

Run the checks relevant to your change:

```sh
npm run build
npm test
npm run test:e2e
```

The Electron tests require a graphical desktop. On Linux CI, run them with `xvfb-run -a npm run test:e2e`. Tests use temporary profiles so the developer's library is not modified.

For reading changes, check at least one Chinese TXT file, a long chapter, and saved progress after restarting. For layout changes, check Desk view, Reading view, the 360 × 320 mini window, and quick notes. For native changes, state which operating system you verified.

Keep pull requests focused. Explain the user-visible change and how you checked it. Add regression coverage for parsing, persistence, and other behavior where a silent error could lose text or progress. Keep the English and Chinese READMEs aligned when changing user-facing behavior.

## Reporting bugs

Include your operating system, Margin version, exact steps, expected result, and actual result. For garbled text or chapter detection, include the selected encoding and a small, non-sensitive text sample you have permission to share. Do not upload your application data directory or a whole copyrighted novel.

## Packaging

```sh
npm run package
npm run release:local
```

`package` creates a standalone application under `release/`. `release:local` additionally creates a versioned archive and a SHA-256 checksum for the current platform. End users download these archives from GitHub Releases; this project is distributed as a desktop app rather than an npm library.

Release filenames follow `Margin-VERSION-PLATFORM-ARCH` with `.zip` for macOS and Windows, and `.tar.gz` for Linux. The application version comes from `package.json`.

For maintainers, update the version, lockfile, and changelog together, then push a matching `vVERSION` tag. The release workflow builds the configured platform matrix and publishes the archives and checksums. Keep the installation notes accurate: release builds currently have no Developer ID notarization or Windows code signing. A successful build does not replace interactive validation on that platform.

## Screenshots

Use the bundled original story in a fresh temporary Electron profile. Set `NODE_ENV=test` and `MARGIN_TEST_USER_DATA` to that temporary directory; never capture your everyday library. Playwright's Electron API and `page.screenshot({ scale: "css" })` produce the screenshots in this repository. Capture the application content only, inspect the results, and remove the temporary profile after closing the app.

## License

Contributions are provided under the project's [MIT license](LICENSE). Preserve third-party license notices and include only text or assets you have permission to distribute.
