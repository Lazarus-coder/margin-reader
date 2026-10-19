# Changelog

## Unreleased

### Distribution

- Add a macOS disk image (.dmg): open it, drag Margin into Applications, and launch.
- Add a Windows installer: a per-user setup wizard with Start menu and optional desktop shortcuts.
- Keep portable .zip / .tar.gz archives for every platform; all downloads ship with SHA-256 checksums.

## 1.3.0 — 2026-10-19

### Reading

- Bundle the four classic novels — 三國演義, 水滸傳, 西遊記, and 紅樓夢 — in Traditional Chinese; they join the shelf on first launch (Wikisource transcriptions; 水滸傳 from the Project Gutenberg 70-chapter edition).

### Desktop

- New vermilion-seal app icon with a matching menu bar / tray mark.

## 1.2.0 — 2026-10-19

### Reading

- Import EPUB, HTML, and Markdown books alongside TXT files.
- Build EPUB chapter outlines from heading tags, navigation documents, and in-text chapter headings such as 第一回.
- Keep encoding detection and the manual override for TXT and HTML; EPUB files read as UTF-8.
- Join CJK lines wrapped in source files without stray spaces.
- Reject damaged, encrypted, or DRM-protected EPUB files with clear messages.

## 1.1.1 — 2026-09-29

First public release of Margin · 余白.

### Reading

- Import local TXT books with UTF-8, GB18030/GBK, Big5, and UTF-16 decoding.
- Detect Chinese and English chapters; read long chapters in sections.
- Save books, reading progress, bookmarks, and notes locally.
- Search within books and navigate by chapter, page, paragraph, or progress slider.
- Choose three themes, text size, line spacing, and reading fonts.
- Try the bundled original Chinese story, 山海之间.

### Desktop

- Open in Desk view with a neutral file tab, line numbers, and compact controls.
- Switch to Reading view while keeping the same reading position.
- Use a movable mini window with saved position and size.
- Set always-on-top and window opacity where supported.
- Switch to quick notes with Escape; optionally cover on focus loss or pointer leave.
- Hide or restore the app with a global shortcut or menu bar / tray controls.
- Hide the Dock icon on macOS while retaining a menu bar entry.

### Distribution

- Add English and Simplified Chinese documentation with real application screenshots.
- Add reproducible packaging and GitHub Actions releases for macOS arm64/x64, Windows x64, and Linux x64.
- Include SHA-256 checksums with release archives.

Platform limitations and unsigned-build installation instructions are documented in the README.
