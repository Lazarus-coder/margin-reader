# Margin · 余白

**A little room to read. Even on a very busy-looking desktop.**

[简体中文](README.zh-CN.md) · [Download](https://github.com/Lazarus-coder/margin-reader/releases/latest) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

Margin is a small, offline desktop reader for Chinese novels — TXT, EPUB, HTML, and Markdown. It opens as a plain text workspace: a neutral `notes.txt` tab, line numbers, and quiet controls. Put it in a corner, pick up where you left off, and switch to your notes with one key.

![Margin in Desk view, showing the original Chinese sample story](docs/images/desk.png)

## Why Margin?

- **Fits between the windows.** A movable, resizable mini reader starts at 360 × 320 px, with optional always-on-top and window opacity.
- **Looks like a desk tool.** Desk view uses a neutral title and file tab. `Esc` opens a working notepad; optional covers activate when the window loses focus or your pointer leaves.
- **Made for Chinese novels.** TXT with UTF-8, GB18030/GBK, Big5, and UTF-16 detection plus a manual override for older files; EPUB books bring their own chapter outline; HTML and Markdown pages become clean text.
- **Keeps your place.** A local bookshelf, bookmarks, in-book search, chapter navigation, and automatically saved progress.
- **Comfort when you want it.** Switch to Reading view for roomier typography. Three themes, adjustable text size and line spacing, and serif/sans-serif reading fonts.
- **Stays on your computer.** No account, uploads, analytics, cloud service, or internet connection needed to read.

<p align="center">
  <img src="docs/images/mini.png" width="360" alt="Margin's compact Desk view at its default 360 by 320 pixel size">
</p>

## Download and install

Get an archive from the **Assets** section of the [latest release](https://github.com/Lazarus-coder/margin-reader/releases/latest). The app includes its runtime; **you do not need Node.js or npm**. GitHub's “Source code” archives are for developers.

| Your computer                        | Release file                    |
| ------------------------------------ | ------------------------------- |
| Mac with Apple Silicon (M1 or newer) | `Margin-1.2.0-macos-arm64.zip`  |
| Mac with an Intel processor          | `Margin-1.2.0-macos-x64.zip`    |
| Windows, Intel/AMD 64-bit            | `Margin-1.2.0-windows-x64.zip`  |
| Linux, Intel/AMD 64-bit              | `Margin-1.2.0-linux-x64.tar.gz` |

Use the matching versioned filename on the release page. Releases include SHA-256 checksums. macOS Apple Silicon is verified locally; builds for the other platforms run through GitHub Actions. Linux desktop behavior can vary; see [platform notes](#platform-notes).

**macOS:** Unzip, drag `Margin.app` to Applications, and open it. Builds are not Developer ID signed or notarized. If macOS blocks launch, after trying to open the app, go to **System Settings → Privacy & Security → Open Anyway** for Margin. See [Apple's instructions](https://support.apple.com/102445).

**Windows:** Extract the entire ZIP to a folder and run `Margin.exe` inside it. Keep the adjacent files together. The app is not code-signed, so Windows may show an unknown-publisher warning. No installer is required.

**Linux:** Extract the archive and launch `Margin` in the extracted folder. A graphical desktop with Electron's system dependencies and Chinese fonts is required. For example:

```sh
tar -xzf Margin-1.2.0-linux-x64.tar.gz
cd Margin-linux-x64
./Margin
```

On Ubuntu 24.04 and later, AppArmor's user-namespace restrictions may prevent the sandbox from starting. A per-app AppArmor profile allowing user namespaces for Margin may be needed; see [Ubuntu's documentation](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).

## Start reading

1. Click **Import book file**, press `⌘O` / `Ctrl+O`, or drop one or more book files (`.txt`, `.epub`, `.html`, `.md`) onto the window. Each file can be up to 100 MB.
2. Choose a chapter from the outline, search for a phrase, or use the progress slider. Your reading position saves automatically.
3. Press `M` for the mini reader. Drag its top bar to move it, or its edges to resize it. Open Preferences to pin the window, adjust opacity, or enable automatic covers.
4. Press `Esc` for quick notes and again to return. Press `⌘⇧X` / `Ctrl+Shift+X` to hide or restore the whole app from another application.

An original Chinese sample story is included so you can try everything before importing a book. The interface currently uses English labels; Chinese book text, filenames, search, and chapter headings are supported.

### Chinese text and encodings

Automatic detection recognizes Unicode byte-order marks and valid UTF-8, then uses a heuristic for GB18030 and Big5. If text looks garbled, choose **GBK** or **Big5** in the import dialog and import the original file again. The encoding choice applies to TXT and HTML files; EPUB files do not need it. This creates a new entry; you can remove the garbled copy afterward. Original files are never modified.

Chinese headings such as `第一章`, `第二回`, `楔子`, and `尾声`, plus English chapter headings, form the outline. Text without headings remains readable as one chapter. Very long chapters are shown in sections; **Next section** continues the same chapter.

### Small-window controls

The mini reader starts at 360 × 320 px and can shrink to 300 × 240 px. Normal and mini window positions and sizes are remembered separately. Opacity ranges from 35–100% where supported.

**Cover when unfocused** and **Cover on pointer leave** are off by default. After an automatic cover, press `Esc` or click **Return** to reveal the book; moving the pointer back does not reveal it. Quick notes are saved locally.

On macOS, **Hide Dock icon** leaves the menu bar controls available. The menu bar / system tray also provides **Show Margin**, **Hide reader**, and **Quit Margin**, including when the global shortcut is unavailable.

<details>
<summary>Prefer a book-like layout? See Reading view.</summary>

Select **Reading view** in Preferences. Both views share your reading position.

![Margin in Reading view with Chinese typography](docs/images/reading.png)

</details>

## Keyboard shortcuts

| Shortcut                             | Action                                                |
| ------------------------------------ | ----------------------------------------------------- |
| `Esc`                                | Open quick notes / return; close an open dialog first |
| `M`                                  | Mini reader / expand                                  |
| `B`                                  | Add or remove a bookmark at the current paragraph     |
| `→` / `←` or `Page Down` / `Page Up` | Next / previous page                                  |
| `Space`                              | Next page                                             |
| `↓` / `↑`                            | Scroll down / up                                      |
| `⌘O` / `Ctrl+O`                      | Import books                                          |
| `⌘F` / `Ctrl+F`                      | Search the current book                               |
| `⌘⇧X` / `Ctrl+Shift+X`               | Hide / restore the desktop app globally               |

Single-letter reading shortcuts are inactive while typing in a text field.

## Local data and updates

Books, bookmarks, and reading positions use IndexedDB. Preferences and notes use local storage; native window preferences use `window-preferences.json`. They live in Electron's application data directory, normally:

| Platform | Data directory                                   |
| -------- | ------------------------------------------------ |
| macOS    | `~/Library/Application Support/Margin`           |
| Windows  | `%APPDATA%\Margin`                               |
| Linux    | `$XDG_CONFIG_HOME/Margin`, or `~/.config/Margin` |

The packaged app blocks remote HTTP and WebSocket requests. Removing a book deletes its imported copy and progress, leaving your original TXT intact. Keep your original files; clearing app data removes the local library.

To update, quit Margin, download a newer release, and replace the application files. Keep the data directory to retain your library and settings. There is no automatic updater. Browser previews and development builds can use separate storage from the packaged app.

## Platform notes

- **macOS:** Dock hiding is macOS-only. Releases are not notarized.
- **Windows:** Keep the full extracted application folder together.
- **Linux:** Opacity, always-on-top, tray visibility, window positioning, and global shortcuts depend on the desktop environment. Wayland may limit window control or require a global-shortcuts portal; use the tray controls when available. See Electron's [window](https://www.electronjs.org/docs/latest/api/browser-window) and [global shortcut](https://www.electronjs.org/docs/latest/api/global-shortcut/) documentation. If Chinese characters appear as squares, install a Chinese font such as Noto Sans CJK through your distribution.
- **Browser preview:** Supports reading and a compact layout inside the tab. Native floating windows, window opacity, pinning, and global shortcuts require the desktop app.

## Build from source

Use **Node.js 24** and npm.

```sh
git clone https://github.com/Lazarus-coder/margin-reader.git
cd margin-reader
npm ci
npm run dev
```

```sh
npm run build          # Type-check and build the renderer
npm start              # Run the built desktop app
npm test               # Unit tests
npm run test:e2e        # Electron integration tests; build first
npm run package        # Package the app for your current platform
npm run release:local  # Package and create a distributable archive
```

`npm run dev:web` starts a browser-only preview. Development uses React, TypeScript, Vite, and Electron. Integration tests use disposable profiles, so they do not change your personal library.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout and release process. Issues and pull requests are welcome.

## License

[MIT](LICENSE). Bundled dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
