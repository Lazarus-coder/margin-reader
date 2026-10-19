import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FileText,
  Code2,
  Pin,
  Keyboard,
  Leaf,
  Library,
  Maximize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  createSampleBook,
  deleteBook,
  getChapterForPosition,
  getParagraphs,
  loadBooks,
  makeBook,
  saveBook,
  type Book,
  type Encoding,
} from "./lib";

type Preferences = {
  workspaceMode: boolean;
  deskFontSize: number;
  deskLineHeight: number;
  coverOnLeave: boolean;
  theme: "paper" | "sage" | "night";
  fontSize: number;
  lineHeight: number;
  font: "serif" | "sans";
  hideOnBlur: boolean;
  opacity: number;
  pinned: boolean;
};
const defaults: Preferences = {
  workspaceMode: true,
  deskFontSize: 14,
  deskLineHeight: 1.8,
  coverOnLeave: false,
  theme: "paper",
  fontSize: 18,
  lineHeight: 2.15,
  font: "serif",
  hideOnBlur: false,
  opacity: 1,
  pinned: false,
};
const CHUNK = 160;
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem("margin-preferences") || "{}",
    );
    return {
      workspaceMode: value.workspaceMode !== false,
      deskFontSize: Number.isFinite(value.deskFontSize)
        ? Math.max(10, Math.min(22, value.deskFontSize))
        : 14,
      deskLineHeight: [1.5, 1.8, 2.1].includes(value.deskLineHeight)
        ? value.deskLineHeight
        : 1.8,
      coverOnLeave: value.coverOnLeave === true,
      theme: ["paper", "sage", "night"].includes(value.theme)
        ? value.theme
        : defaults.theme,
      fontSize: Number.isFinite(value.fontSize)
        ? Math.max(12, Math.min(28, value.fontSize))
        : defaults.fontSize,
      lineHeight: [1.8, 2.15, 2.5].includes(value.lineHeight)
        ? value.lineHeight
        : defaults.lineHeight,
      font: value.font === "sans" ? "sans" : "serif",
      hideOnBlur: value.hideOnBlur === true,
      opacity: Number.isFinite(value.opacity)
        ? Math.max(0.35, Math.min(1, value.opacity))
        : 1,
      pinned: value.pinned === true,
    };
  } catch {
    return defaults;
  }
}
const paragraphCounts = new Map<string, { text: string; count: number }>();
const pct = (book: Book) => {
  let cached = paragraphCounts.get(book.id);
  if (!cached || cached.text !== book.text) {
    cached = { text: book.text, count: getParagraphs(book.text).length };
    paragraphCounts.set(book.id, cached);
  }
  return Math.round((book.position / Math.max(1, cached.count - 1)) * 100);
};
const bookFormatTag = (book: Book) => {
  if (book.format === "epub") return "EPUB";
  if (book.format === "html") return "HTML";
  if (book.format === "md") return "MD";
  return book.encoding.toUpperCase();
};
const Icon = ({
  children,
  label,
  onClick,
  active = false,
  disabled = false,
  className = "",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) => (
  <button
    type="button"
    className={`icon-button ${active ? "active" : ""} ${className}`}
    title={label}
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
);

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [activeId, setActiveId] = useState("");
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState(readPreferences);
  const [sidebar, setSidebar] = useState(true);
  const [settings, setSettings] = useState(() => window.innerWidth >= 1050);
  const [compact, setCompact] = useState(false);
  const [covered, setCovered] = useState(false);
  const [tab, setTab] = useState<"shelf" | "bookmarks" | "search">("shelf");
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [encoding, setEncoding] = useState<Encoding>("auto");
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem("margin-notes") || "";
    } catch {
      return "";
    }
  });
  const [shortcutAvailable, setShortcutAvailable] = useState(true);
  const [hideDock, setHideDock] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const pendingSaves = useRef(new Map<string, Book>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const restoring = useRef(false);
  const restoreUntil = useRef(0);
  const readingPosition = useRef(0);
  const native = window.readerNative;
  const primaryKey =
    (native?.platform || navigator.platform).toLowerCase().includes("mac") ||
    native?.platform === "darwin"
      ? "⌘"
      : "Ctrl";
  const book = books.find((b) => b.id === activeId);
  readingPosition.current = book?.position || 0;
  const paragraphs = useMemo(
    () => (book ? getParagraphs(book.text) : []),
    [book?.id, book?.text],
  );
  const chapter = book ? getChapterForPosition(book, book.position) : undefined;
  const chapterIndex =
    book && chapter ? book.chapters.findIndex((c) => c.id === chapter.id) : 0;
  const chunkIndex =
    chapter && book ? Math.floor((book.position - chapter.start) / CHUNK) : 0;
  const chunkStart = (chapter?.start || 0) + chunkIndex * CHUNK;
  const chunkEnd = Math.min(chapter?.end ?? 0, chunkStart + CHUNK);
  const bookmarked = !!book?.bookmarks.includes(book.position);
  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const term = query.trim().toLocaleLowerCase();
    return paragraphs
      .flatMap((text, index) =>
        text.toLocaleLowerCase().includes(term) ? [{ text, index }] : [],
      )
      .slice(0, 100);
  }, [paragraphs, query]);

  const notify = useCallback((message: string) => setToast(message), []);
  const activeSaves = useRef(new Set<Promise<void>>());
  const flushSaves = useCallback(async () => {
    for (const item of pendingSaves.current.values()) {
      const task = saveBook(item).catch(() =>
        notify("Could not save locally. Check available disk space."),
      );
      activeSaves.current.add(task);
      void task.finally(() => activeSaves.current.delete(task));
    }
    pendingSaves.current.clear();
    await Promise.all([...activeSaves.current]);
  }, [notify]);
  const updateBook = useCallback(
    (id: string, transform: (b: Book) => Book) => {
      setBooks((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          const next = { ...transform(item), updatedAt: Date.now() };
          pendingSaves.current.set(id, next);
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(flushSaves, 250);
          return next;
        }),
      );
    },
    [flushSaves],
  );
  const changePref = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => setPrefs((p) => ({ ...p, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    loadBooks()
      .then(async (stored) => {
        if (cancelled) return;
        if (!stored.length && !localStorage.getItem("margin-initialized")) {
          stored = [createSampleBook()];
          await saveBook(stored[0]);
        }
        if (cancelled) return;
        localStorage.setItem("margin-initialized", "true");
        const last = localStorage.getItem("margin-active");
        setBooks(stored);
        setActiveId(
          stored.find((b) => b.id === last)?.id || stored[0]?.id || "",
        );
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setReady(true);
          notify("Local storage is unavailable. Please restart the app.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  useEffect(() => {
    try {
      localStorage.setItem("margin-preferences", JSON.stringify(prefs));
    } catch {
      notify("Reading settings could not be saved.");
    }
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs, notify]);
  useEffect(() => {
    if (activeId)
      try {
        localStorage.setItem("margin-active", activeId);
      } catch {
        /* books still stored in IndexedDB */
      }
  }, [activeId]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSaves();
    };
    window.addEventListener("pagehide", flushSaves);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      flushSaves();
      window.removeEventListener("pagehide", flushSaves);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushSaves]);
  useEffect(() => native?.onBeforeClose(flushSaves), [native, flushSaves]);
  useEffect(() => {
    if (!importOpen && !helpOpen && !removeId) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not([type="file"]), select, textarea, [tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const targets = focusable();
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [importOpen, helpOpen, removeId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!native) return;
    const sync = (state: Awaited<ReturnType<typeof native.getState>>) => {
      setCompact(state.compact);
      setHideDock(state.hideDock);
      setPrefs((p) => ({
        ...p,
        pinned: state.alwaysOnTop,
        opacity: state.opacity,
      }));
      setShortcutAvailable(state.hideShortcutAvailable);
    };
    native
      .getState()
      .then(sync)
      .catch(() => notify("Desktop controls are unavailable."));
    return native.onState(sync);
  }, []);
  useEffect(() => {
    const blur = () => {
      if (prefs.hideOnBlur && !importOpen) setCovered(true);
    };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [prefs.hideOnBlur, importOpen]);
  useEffect(() => {
    if (covered) document.title = "Quick notes";
    else if (prefs.workspaceMode) document.title = "notes.txt — Workspace";
    else
      document.title = compact
        ? "Notes"
        : `${book?.title ? `${book.title} · ` : ""}Margin`;
  }, [covered, compact, book?.title, prefs.workspaceMode]);

  useEffect(() => {
    const container = reader.current;
    if (!container || !book) return;
    let frame = 0;
    let settled = 0;
    const restore = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settled);
      restoring.current = true;
      // Native resizing can deliver scroll events after the React layout settles.
      // Those events must not overwrite the paragraph the user selected.
      restoreUntil.current = performance.now() + 250;
      frame = requestAnimationFrame(() => {
        const position = readingPosition.current;
        const target = container.querySelector<HTMLElement>(
          `[data-paragraph="${position}"]`,
        );
        if (target)
          container.scrollTop =
            position === chunkStart
              ? 0
              : target.getBoundingClientRect().top -
                container.getBoundingClientRect().top +
                container.scrollTop -
                28;
        settled = requestAnimationFrame(() => {
          restoring.current = false;
        });
      });
    };
    restore();
    const observer = new ResizeObserver(restore);
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settled);
    };
  }, [
    book?.id,
    chapter?.id,
    chunkIndex,
    compact,
    covered,
    ready,
    prefs.workspaceMode,
    prefs.fontSize,
    prefs.deskFontSize,
    prefs.lineHeight,
    prefs.deskLineHeight,
  ]);

  const goTo = useCallback(
    (position: number) => {
      if (!book) return;
      const safe = Math.max(0, Math.min(paragraphs.length - 1, position));
      updateBook(book.id, (b) => ({ ...b, position: safe }));
      restoring.current = true;
      restoreUntil.current = performance.now() + 250;
      requestAnimationFrame(() => {
        const container = reader.current;
        const target = container?.querySelector<HTMLElement>(
          `[data-paragraph="${safe}"]`,
        );
        if (container && target)
          container.scrollTop =
            safe === chapter?.start
              ? 0
              : target.getBoundingClientRect().top -
                container.getBoundingClientRect().top +
                container.scrollTop -
                28;
        requestAnimationFrame(() => {
          restoring.current = false;
        });
      });
      if (window.innerWidth < 750) setSidebar(false);
    },
    [book, paragraphs.length, chapter?.start, updateBook],
  );

  const toggleCompact = useCallback(async () => {
    const next = !compact;
    restoring.current = true;
    restoreUntil.current = performance.now() + 350;
    if (native) {
      try {
        await native.setCompact(next);
      } catch {
        restoring.current = false;
        notify("Could not resize the reader.");
        return;
      }
    }
    setCompact(next);
    setCovered(false);
  }, [compact, native, notify]);
  const toggleBookmark = useCallback(() => {
    if (!book) return;
    const exists = book.bookmarks.includes(book.position);
    updateBook(book.id, (b) => ({
      ...b,
      bookmarks: exists
        ? b.bookmarks.filter((p) => p !== b.position)
        : [...b.bookmarks, b.position].sort((a, b) => a - b),
    }));
    notify(exists ? "Bookmark removed" : "Bookmark saved");
  }, [book, updateBook, notify]);
  const turnPage = useCallback(
    (direction: number) => {
      const container = reader.current;
      if (!container || !book) return;
      restoring.current = false;
      restoreUntil.current = 0;
      const atBottom =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 4;
      if (direction > 0 && atBottom && chunkEnd < paragraphs.length)
        goTo(chunkEnd);
      else if (direction < 0 && container.scrollTop <= 1 && chunkStart > 0)
        goTo(Math.max(0, chunkStart - 1));
      else
        container.scrollBy({
          top: direction * container.clientHeight * 0.83,
          behavior: "smooth",
        });
    },
    [book, chunkEnd, chunkStart, goTo, paragraphs.length],
  );

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement).matches(
        "input, textarea, select, [contenteditable]",
      );
      if (event.key === "Escape") {
        event.preventDefault();
        if (importOpen) setImportOpen(false);
        else if (helpOpen) setHelpOpen(false);
        else if (removeId) setRemoveId(null);
        else setCovered((v) => !v);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setImportOpen(true);
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "f" &&
        !covered
      ) {
        event.preventDefault();
        if (compact) void toggleCompact();
        setTab("search");
        setSidebar(true);
        setTimeout(() => searchInput.current?.focus(), 50);
        return;
      }
      if (typing || covered || importOpen || helpOpen || removeId) return;
      if (
        event.key === "ArrowRight" ||
        event.key === "PageDown" ||
        event.key === " "
      ) {
        event.preventDefault();
        turnPage(1);
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        turnPage(-1);
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        restoring.current = false;
        restoreUntil.current = 0;
        reader.current?.scrollBy({
          top: event.key === "ArrowDown" ? 64 : -64,
          behavior: "smooth",
        });
      }
      if (event.key.toLowerCase() === "b" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        toggleBookmark();
      }
      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        void toggleCompact();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [
    covered,
    importOpen,
    helpOpen,
    removeId,
    turnPage,
    toggleBookmark,
    toggleCompact,
  ]);

  const importFiles = async (files: FileList | File[]) => {
    if (importing) return;
    setImporting(true);
    let lastId = "";
    let count = 0;
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      if (!/\.(txt|epub|x?html?|md|markdown)$/i.test(file.name)) {
        errors.push(`${file.name}: unsupported file type`);
        continue;
      }
      if (file.size > 100 * 1024 * 1024) {
        errors.push(`${file.name}: maximum size is 100 MB`);
        continue;
      }
      try {
        const next = await makeBook(
          file.name,
          new Uint8Array(await file.arrayBuffer()),
          encoding,
        );
        if (!next.text.trim()) throw new Error("This file is empty");
        await saveBook(next);
        setBooks((items) => [next, ...items.filter((b) => b.id !== next.id)]);
        lastId = next.id;
        count++;
      } catch (error) {
        errors.push(
          `${file.name}: ${error instanceof Error ? error.message : "could not import"}`,
        );
      }
    }
    if (count) {
      setActiveId(lastId);
      setTab("shelf");
      setImportOpen(false);
      setCovered(false);
    }
    notify(
      errors.length
        ? errors.join(" · ")
        : prefs.workspaceMode
          ? `${count} ${count === 1 ? "file" : "files"} imported. Saved locally.`
          : `${count === 1 ? "Your book is" : `${count} books are`} ready. Happy reading.`,
    );
    setImporting(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const onScroll = () => {
    if (
      restoring.current ||
      performance.now() < restoreUntil.current ||
      !book ||
      !reader.current ||
      !reader.current.clientHeight
    )
      return;
    const container = reader.current;
    const threshold = container.getBoundingClientRect().top + 56;
    const elements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-paragraph]"),
    );
    let index = chunkStart;
    for (const element of elements) {
      if (element.getBoundingClientRect().top <= threshold)
        index = Number(element.dataset.paragraph);
      else break;
    }
    if (
      container.scrollHeight > container.clientHeight &&
      container.scrollTop + container.clientHeight >= container.scrollHeight - 3
    )
      index = chunkEnd - 1;
    if (index !== book.position)
      updateBook(book.id, (b) => ({ ...b, position: index }));
  };

  const removeBook = async () => {
    if (!removeId) return;
    try {
      pendingSaves.current.delete(removeId);
      await deleteBook(removeId);
      const rest = books.filter((b) => b.id !== removeId);
      paragraphCounts.delete(removeId);
      setBooks(rest);
      if (activeId === removeId) setActiveId(rest[0]?.id || "");
      setRemoveId(null);
      notify("Book removed from this device.");
    } catch {
      notify("Could not remove the book. Please try again.");
    }
  };

  const nativeControl = async (
    kind: "pin" | "opacity",
    value: boolean | number,
  ) => {
    if (!native) {
      notify(
        "Pinning and window transparency are available in the desktop app.",
      );
      return;
    }
    try {
      if (kind === "pin") {
        await native.setAlwaysOnTop(value as boolean);
        changePref("pinned", value as boolean);
      } else {
        await native.setOpacity(value as number);
        changePref("opacity", value as number);
      }
    } catch {
      notify("Could not update the window setting.");
    }
  };

  const readingSize = prefs.workspaceMode ? prefs.deskFontSize : prefs.fontSize;
  const readingLine = prefs.workspaceMode
    ? prefs.deskLineHeight
    : prefs.lineHeight;
  const style = {
    "--reading-size": `${readingSize}px`,
    "--reading-line": readingLine,
  } as CSSProperties;
  const progress = book
    ? Math.round((book.position / Math.max(1, paragraphs.length - 1)) * 100)
    : 0;

  return (
    <div
      className={`app ${prefs.workspaceMode ? "is-workspace" : ""} ${compact ? "is-compact" : ""} ${covered ? "is-covered" : ""} ${native ? "is-native" : "is-web"}`}
      style={style}
      onMouseLeave={() => {
        if (
          prefs.coverOnLeave &&
          !importOpen &&
          !helpOpen &&
          !removeId &&
          !importing
        )
          setCovered(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length)
          void importFiles(event.dataTransfer.files);
      }}
    >
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">
            {prefs.workspaceMode ? (
              <Code2 size={17} strokeWidth={1.5} />
            ) : (
              <BookOpen size={18} strokeWidth={1.5} />
            )}
          </span>
          <span>
            {covered ? "Notes" : prefs.workspaceMode ? "Workspace" : "margin"}
            <span className="brand-cn">
              {covered || prefs.workspaceMode ? "" : "余白"}
            </span>
          </span>
        </div>
        <div className="titlebar-center">
          {covered
            ? "notes.md"
            : prefs.workspaceMode
              ? "notes.txt"
              : compact
                ? book?.title || "A little room to read."
                : "A little room to read."}
        </div>
        <div className="window-actions">
          {compact && !covered && (
            <>
              <Icon
                label="Bookmark this paragraph (B)"
                onClick={toggleBookmark}
                active={bookmarked}
              >
                <Bookmark size={14} />
              </Icon>
              <Icon
                label="Expand reader (M)"
                onClick={() => void toggleCompact()}
              >
                <Maximize2 size={14} />
              </Icon>
              <Icon label="Quick cover (Esc)" onClick={() => setCovered(true)}>
                <EyeOff size={14} />
              </Icon>
            </>
          )}
          {native && (
            <>
              <Icon
                label="Minimize window"
                onClick={() => void native.minimize()}
              >
                <Minus size={14} />
              </Icon>
              <Icon
                label="Close app"
                onClick={() => {
                  void flushSaves().then(() => native.close());
                }}
                className="close-window"
              >
                <X size={14} />
              </Icon>
            </>
          )}
          {!native && (
            <span className="local-badge">
              <span />
              {prefs.workspaceMode ? "LOCAL" : "LOCAL READER"}
            </span>
          )}
        </div>
      </header>

      {covered ? (
        <main className="notes-view">
          <div className="notes-heading">
            <FileText size={18} />
            <span>Quick notes</span>
            <button
              className="text-button restore-button"
              onClick={() => setCovered(false)}
              title="Return to reader (Esc)"
            >
              <ArrowLeft size={14} /> Return
            </button>
          </div>
          <textarea
            aria-label="Quick notes"
            placeholder="Write something down…"
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              try {
                localStorage.setItem("margin-notes", event.target.value);
              } catch {
                notify("Notes could not be saved.");
              }
            }}
          />
          <span className="notes-footer">Saved on this device</span>
        </main>
      ) : (
        <>
          <div className="workspace">
            {sidebar && !compact && (
              <aside className="sidebar">
                <div className="sidebar-top">
                  <span className="eyebrow">
                    {prefs.workspaceMode ? "EXPLORER" : "YOUR LITTLE ESCAPE"}
                  </span>
                  <Icon
                    label="Collapse bookshelf"
                    onClick={() => setSidebar(false)}
                  >
                    <PanelLeftClose size={16} />
                  </Icon>
                </div>
                <nav className="library-nav" aria-label="Library">
                  <button
                    className={tab === "shelf" ? "selected" : ""}
                    onClick={() => setTab("shelf")}
                  >
                    <Library size={17} />
                    <span>{prefs.workspaceMode ? "Files" : "Bookshelf"}</span>
                    <span className="count">{books.length}</span>
                  </button>
                  <button
                    className={tab === "bookmarks" ? "selected" : ""}
                    onClick={() => setTab("bookmarks")}
                  >
                    <Bookmark size={17} />
                    <span>Bookmarks</span>
                    <span className="count">{book?.bookmarks.length || 0}</span>
                  </button>
                  <button
                    className={tab === "search" ? "selected" : ""}
                    onClick={() => {
                      setTab("search");
                      setTimeout(() => searchInput.current?.focus(), 0);
                    }}
                  >
                    <Search size={17} />
                    <span>
                      {prefs.workspaceMode ? "Search text" : "Find in book"}
                    </span>
                    <kbd>{primaryKey} F</kbd>
                  </button>
                </nav>
                <div className="sidebar-content">
                  {tab === "shelf" && (
                    <>
                      <div className="section-label">
                        <span>
                          {prefs.workspaceMode
                            ? "LOCAL FILES"
                            : "ON YOUR SHELF"}
                        </span>
                        <button
                          aria-label="Import a book"
                          onClick={() => setImportOpen(true)}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                      <div className="book-list">
                        {books.map((item, index) => (
                          <div
                            key={item.id}
                            className={`book-item ${item.id === activeId ? "selected" : ""}`}
                          >
                            <button
                              className="book-select"
                              onClick={() => {
                                setActiveId(item.id);
                                setQuery("");
                              }}
                            >
                              <span className={`book-cover cover-${index % 3}`}>
                                {prefs.workspaceMode && (
                                  <FileText
                                    className="file-thumbnail"
                                    size={20}
                                    strokeWidth={1.4}
                                  />
                                )}
                                <span className="cover-orbit" />
                                <span className="cover-name">
                                  {Array.from(item.title).slice(0, 5).join("")}
                                </span>
                                <span className="cover-small">
                                  MARGIN LIBRARY
                                </span>
                              </span>
                              <span className="book-meta">
                                <strong>{item.title}</strong>
                                <span>
                                  {item.fileName === "sample.txt" ||
                                  item.id.startsWith("sample")
                                    ? prefs.workspaceMode
                                      ? "UTF-8 · Sample file"
                                      : "A little story to start"
                                    : item.format && item.format !== "txt"
                                      ? bookFormatTag(item)
                                      : item.encoding.toUpperCase() + " · TXT"}
                                </span>
                                <span className="book-progress">
                                  <i style={{ width: `${pct(item)}%` }} />
                                </span>
                                <small>{pct(item)}% read</small>
                              </span>
                            </button>
                            <button
                              className="remove-book"
                              title={`Remove ${item.title}`}
                              aria-label={`Remove ${item.title}`}
                              onClick={() => setRemoveId(item.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        className="import-dashed"
                        onClick={() => setImportOpen(true)}
                      >
                        <Plus size={16} />{" "}
                        {prefs.workspaceMode
                          ? "Import book file"
                          : "Import a book"}
                      </button>
                      {book && (
                        <>
                          <div className="section-label chapter-label">
                            <span>
                              {prefs.workspaceMode ? "OUTLINE" : "CONTENTS"}
                            </span>
                            <span>{book.chapters.length} chapters</span>
                          </div>
                          <div className="chapter-list">
                            {book.chapters.map((item, index) => (
                              <button
                                key={item.id}
                                className={
                                  item.id === chapter?.id ? "selected" : ""
                                }
                                onClick={() => goTo(item.start)}
                              >
                                <span className="chapter-number">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <span>{item.title}</span>
                                {item.id === chapter?.id && (
                                  <span className="chapter-dot" />
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                  {tab === "bookmarks" && (
                    <>
                      <div className="section-label">SAVED POSITIONS</div>
                      {book?.bookmarks.length ? (
                        <div className="saved-list">
                          {book.bookmarks.map((position) => (
                            <button
                              key={position}
                              onClick={() => goTo(position)}
                            >
                              <Bookmark size={13} />
                              <span>
                                <strong>
                                  {getChapterForPosition(book, position).title}
                                </strong>
                                <span>
                                  {paragraphs[position]?.slice(0, 60)}
                                </span>
                                <small>
                                  {Math.round(
                                    (position /
                                      Math.max(1, paragraphs.length - 1)) *
                                      100,
                                  )}
                                  % through the book
                                </small>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="sidebar-empty">
                          <Bookmark size={24} strokeWidth={1.3} />
                          <p>No bookmarks yet.</p>
                          <span>Press B while reading to save your place.</span>
                        </div>
                      )}
                    </>
                  )}
                  {tab === "search" && (
                    <>
                      <label className="search-box">
                        <Search size={15} />
                        <input
                          ref={searchInput}
                          placeholder="Search words or phrases…"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </label>
                      <div className="section-label">
                        {query
                          ? `${searchResults.length}${searchResults.length === 100 ? "+" : ""} MATCHES`
                          : "FIND YOUR PLACE"}
                      </div>
                      <div className="saved-list">
                        {searchResults.map((result) => (
                          <button
                            key={result.index}
                            onClick={() => goTo(result.index)}
                          >
                            <Search size={13} />
                            <span>
                              <strong>
                                {book &&
                                  getChapterForPosition(book, result.index)
                                    .title}
                              </strong>
                              <span>
                                {result.text.slice(
                                  Math.max(
                                    0,
                                    result.text
                                      .toLocaleLowerCase()
                                      .indexOf(
                                        query.trim().toLocaleLowerCase(),
                                      ) - 16,
                                  ),
                                  Math.max(
                                    0,
                                    result.text
                                      .toLocaleLowerCase()
                                      .indexOf(
                                        query.trim().toLocaleLowerCase(),
                                      ) - 16,
                                  ) + 90,
                                )}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                      {!searchResults.length && (
                        <div className="sidebar-empty">
                          <p>{query ? "No results." : "Search this file."}</p>
                          <span>
                            {query
                              ? "Try another word or phrase."
                              : "Search in Chinese or English."}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="sidebar-bottom">
                  <span>
                    <ShieldCheck size={14} />{" "}
                    {prefs.workspaceMode
                      ? "Local storage"
                      : "Just you and your books."}
                  </span>
                  <small>
                    {prefs.workspaceMode
                      ? "No network connections required"
                      : "Stored locally. No account. No uploads."}
                  </small>
                </div>
              </aside>
            )}

            <main className="reader-panel">
              {!compact && (
                <div className="reader-toolbar">
                  <div className="reader-breadcrumb">
                    {!sidebar && (
                      <Icon
                        label="Show bookshelf"
                        onClick={() => setSidebar(true)}
                      >
                        <PanelLeftOpen size={17} />
                      </Icon>
                    )}
                    {prefs.workspaceMode ? (
                      <Code2 size={15} />
                    ) : (
                      <BookOpen size={15} />
                    )}
                    <span>
                      {prefs.workspaceMode
                        ? "workspace"
                        : book?.title || "Your next chapter"}
                    </span>
                    <ChevronRight size={13} />
                    <span className="muted">
                      {prefs.workspaceMode ? "notes.txt" : "Reading"}
                    </span>
                  </div>
                  <div className="reader-tools">
                    <Icon
                      label="Bookmark this paragraph (B)"
                      onClick={toggleBookmark}
                      active={bookmarked}
                      disabled={!book}
                    >
                      <Bookmark
                        size={17}
                        fill={bookmarked ? "currentColor" : "none"}
                      />
                    </Icon>
                    <span className="tool-divider" />
                    <Icon
                      label="Mini reader (M)"
                      onClick={() => void toggleCompact()}
                    >
                      <Square size={16} />
                    </Icon>
                    <Icon
                      label="Quick cover (Esc)"
                      onClick={() => setCovered(true)}
                    >
                      <EyeOff size={17} />
                    </Icon>
                    <Icon
                      label="Reading settings"
                      onClick={() => setSettings((v) => !v)}
                      active={settings}
                    >
                      <Settings2 size={17} />
                    </Icon>
                  </div>
                </div>
              )}
              {prefs.workspaceMode && !compact && (
                <div className="workspace-tabs">
                  <div className="workspace-tab">
                    <FileText size={13} />
                    <span className="workspace-tab-name">notes.txt</span>
                    <span
                      className="workspace-tab-status"
                      title="Stored locally"
                    />
                  </div>
                  <span className="workspace-context">
                    Plain text<span>LOCAL</span>
                  </span>
                </div>
              )}
              {book && chapter ? (
                <>
                  <div
                    className={`reading-scroll font-${prefs.font}`}
                    ref={reader}
                    onScroll={onScroll}
                    onWheel={() => {
                      restoring.current = false;
                      restoreUntil.current = 0;
                    }}
                    onTouchMove={() => {
                      restoring.current = false;
                      restoreUntil.current = 0;
                    }}
                    onPointerDown={() => {
                      restoring.current = false;
                      restoreUntil.current = 0;
                    }}
                    tabIndex={0}
                    aria-label="Novel text"
                  >
                    <article className="reading-article">
                      {prefs.workspaceMode ? (
                        <div className="document-meta">
                          // section {String(chapterIndex + 1).padStart(2, "0")}{" "}
                          of {String(book.chapters.length).padStart(2, "0")} ·
                          position saved locally
                        </div>
                      ) : (
                        <div className="chapter-heading">
                          <span className="eyebrow">
                            CHAPTER {String(chapterIndex + 1).padStart(2, "0")}{" "}
                            <span>
                              / {String(book.chapters.length).padStart(2, "0")}
                            </span>
                          </span>
                          <h1>{chapter.title}</h1>
                          <div className="chapter-ornament">
                            <span />
                            <Leaf size={16} strokeWidth={1.3} />
                            <span />
                          </div>
                        </div>
                      )}
                      {chunkIndex > 0 && (
                        <button
                          className="segment-button"
                          onClick={() => goTo(chunkStart - CHUNK)}
                        >
                          <ChevronLeft size={14} /> Earlier in this chapter
                        </button>
                      )}
                      <div className="novel-text">
                        {paragraphs
                          .slice(chunkStart, chunkEnd)
                          .map((paragraph, offset) => {
                            const index = chunkStart + offset;
                            if (
                              !prefs.workspaceMode &&
                              index === chapter.start &&
                              paragraph.trim() === chapter.title.trim()
                            )
                              return (
                                <div
                                  key={index}
                                  data-paragraph={index}
                                  className="chapter-anchor"
                                />
                              );
                            return (
                              <p
                                key={index}
                                data-paragraph={index}
                                className={
                                  book.bookmarks.includes(index)
                                    ? "has-bookmark"
                                    : ""
                                }
                              >
                                {prefs.workspaceMode ? (
                                  <>
                                    <span
                                      className="line-number"
                                      aria-hidden="true"
                                    >
                                      {index + 1}
                                    </span>
                                    <span className="line-content">
                                      {paragraph}
                                    </span>
                                  </>
                                ) : (
                                  paragraph
                                )}
                              </p>
                            );
                          })}
                      </div>
                      <div className="chapter-end">
                        <span className="end-dots">· · ·</span>
                        {chunkEnd < paragraphs.length ? (
                          <button onClick={() => goTo(chunkEnd)}>
                            {prefs.workspaceMode
                              ? "Next section"
                              : chunkEnd < chapter.end
                                ? "Continue this chapter"
                                : "A new chapter awaits"}
                            <ArrowRight size={16} />
                          </button>
                        ) : (
                          <>
                            <p>
                              {prefs.workspaceMode
                                ? "End of file"
                                : "合上书，故事仍在。"}
                            </p>
                            <span>
                              {prefs.workspaceMode
                                ? `${paragraphs.length} lines · ${bookFormatTag(book)}`
                                : "You’ve reached the end. Stay a little longer."}
                            </span>
                          </>
                        )}
                      </div>
                    </article>
                  </div>
                  <footer className="reading-footer">
                    <div className="footer-top">
                      <span className="chapter-foot-label">
                        {prefs.workspaceMode ? (
                          <span className="workspace-status">
                            Ln {book.position + 1}
                            <span>{bookFormatTag(book)}</span>
                            {prefs.pinned && <Pin size={10} />}
                          </span>
                        ) : compact ? (
                          chapter.title
                        ) : (
                          <>
                            <span className="status-dot" />
                            {bookFormatTag(book)}
                            <span className="footer-separator">·</span>Progress
                            saved
                          </>
                        )}
                      </span>
                      <div className="page-controls">
                        <Icon
                          label="Previous chapter"
                          disabled={chapterIndex === 0 && chunkIndex === 0}
                          onClick={() =>
                            goTo(
                              chunkIndex > 0
                                ? chunkStart - CHUNK
                                : book.chapters[chapterIndex - 1]?.start || 0,
                            )
                          }
                        >
                          <ChevronLeft size={15} />
                        </Icon>
                        <span>{progress}%</span>
                        <Icon
                          label="Next chapter"
                          disabled={chunkEnd >= paragraphs.length}
                          onClick={() =>
                            goTo(
                              chunkEnd < chapter.end
                                ? chunkEnd
                                : book.chapters[chapterIndex + 1]?.start ||
                                    chunkEnd,
                            )
                          }
                        >
                          <ChevronRight size={15} />
                        </Icon>
                      </div>
                    </div>
                    <input
                      className="reading-progress"
                      aria-label="Reading progress"
                      type="range"
                      min="0"
                      max={Math.max(0, paragraphs.length - 1)}
                      value={book.position}
                      onChange={(event) => goTo(Number(event.target.value))}
                      style={{ "--progress": `${progress}%` } as CSSProperties}
                    />
                  </footer>
                </>
              ) : (
                <div className="empty-reader">
                  <div className="empty-illustration">
                    {prefs.workspaceMode ? (
                      <FileText size={36} strokeWidth={1.2} />
                    ) : (
                      <>
                        <BookOpen size={40} strokeWidth={1} />
                        <Leaf size={22} strokeWidth={1.3} />
                      </>
                    )}
                  </div>
                  <span className="eyebrow">
                    {prefs.workspaceMode
                      ? "LOCAL WORKSPACE"
                      : "A LITTLE ROOM FOR YOURSELF"}
                  </span>
                  <h1>
                    {ready
                      ? prefs.workspaceMode
                        ? "Open a text file."
                        : "Your next escape starts here."
                      : "Loading files…"}
                  </h1>
                  <p>
                    {prefs.workspaceMode ? (
                      <>
                        Drop a book file here or choose one below.
                        <br />
                        Your position is saved on this device.
                      </>
                    ) : (
                      <>
                        Bring a story. Find a quiet corner.
                        <br />
                        We’ll keep your place.
                      </>
                    )}
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => setImportOpen(true)}
                  >
                    <Plus size={16} />{" "}
                    {prefs.workspaceMode ? "Import book file" : "Import a book"}
                  </button>
                  <small>
                    中文小说，安心阅读 · TXT / EPUB / HTML / Markdown
                  </small>
                </div>
              )}
            </main>

            {settings && !compact && (
              <aside className="settings-panel">
                <div className="settings-heading">
                  <span>
                    {prefs.workspaceMode ? "Preferences" : "Make it yours"}
                  </span>
                  <Icon
                    label="Close settings"
                    onClick={() => setSettings(false)}
                  >
                    <X size={16} />
                  </Icon>
                </div>
                <p className="settings-intro">
                  {prefs.workspaceMode
                    ? "Window & reading controls"
                    : "Settle into your kind of quiet."}
                </p>
                <div className="setting-group">
                  <label className="setting-label">INTERFACE</label>
                  <div className="segmented view-picker">
                    <button
                      className={prefs.workspaceMode ? "selected" : ""}
                      aria-pressed={prefs.workspaceMode}
                      onClick={() => changePref("workspaceMode", true)}
                    >
                      <Code2 size={14} />
                      Desk view
                    </button>
                    <button
                      className={!prefs.workspaceMode ? "selected" : ""}
                      aria-pressed={!prefs.workspaceMode}
                      onClick={() => changePref("workspaceMode", false)}
                    >
                      <BookOpen size={14} />
                      Reading view
                    </button>
                  </div>
                </div>
                <div className="setting-group">
                  <label className="setting-label">APPEARANCE</label>
                  <div className="theme-picker">
                    {(["paper", "sage", "night"] as const).map((theme) => (
                      <button
                        key={theme}
                        className={`${theme} ${prefs.theme === theme ? "selected" : ""}`}
                        onClick={() => changePref("theme", theme)}
                        aria-label={`${theme} theme`}
                        aria-pressed={prefs.theme === theme}
                      >
                        <span>
                          {prefs.theme === theme ? <Check size={17} /> : "Aa"}
                        </span>
                        <small>
                          {theme === "paper"
                            ? prefs.workspaceMode
                              ? "Light"
                              : "Paper"
                            : theme === "sage"
                              ? prefs.workspaceMode
                                ? "Dim"
                                : "Sage"
                              : prefs.workspaceMode
                                ? "Dark"
                                : "Night"}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-group">
                  <label className="setting-label">
                    {prefs.workspaceMode ? "TEXT" : "TYPEFACE"}
                  </label>
                  {!prefs.workspaceMode && (
                    <div className="segmented font-picker">
                      <button
                        className={prefs.font === "serif" ? "selected" : ""}
                        onClick={() => changePref("font", "serif")}
                      >
                        <span className="serif-example">宋</span>Serif
                      </button>
                      <button
                        className={prefs.font === "sans" ? "selected" : ""}
                        onClick={() => changePref("font", "sans")}
                      >
                        <span>黑</span>Sans
                      </button>
                    </div>
                  )}
                  <div className="setting-row">
                    <span>Text size</span>
                    <div className="stepper">
                      <button
                        aria-label="Decrease text size"
                        disabled={
                          readingSize <= (prefs.workspaceMode ? 10 : 12)
                        }
                        onClick={() =>
                          changePref(
                            prefs.workspaceMode ? "deskFontSize" : "fontSize",
                            readingSize - 1,
                          )
                        }
                      >
                        <Minus size={14} />
                      </button>
                      <span>
                        {readingSize}
                        <small>px</small>
                      </span>
                      <button
                        aria-label="Increase text size"
                        disabled={
                          readingSize >= (prefs.workspaceMode ? 22 : 28)
                        }
                        onClick={() =>
                          changePref(
                            prefs.workspaceMode ? "deskFontSize" : "fontSize",
                            readingSize + 1,
                          )
                        }
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="setting-row line-setting">
                    <span>Line spacing</span>
                    <div className="segmented spacing-picker">
                      {(prefs.workspaceMode
                        ? [1.5, 1.8, 2.1]
                        : [1.8, 2.15, 2.5]
                      ).map((line, index) => (
                        <button
                          key={line}
                          aria-label={
                            [
                              "Compact line spacing",
                              "Relaxed line spacing",
                              "Airy line spacing",
                            ][index]
                          }
                          onClick={() =>
                            changePref(
                              prefs.workspaceMode
                                ? "deskLineHeight"
                                : "lineHeight",
                              line,
                            )
                          }
                          className={readingLine === line ? "selected" : ""}
                        >
                          <span style={{ gap: `${2 + index * 2}px` }}>
                            <i />
                            <i />
                            <i />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="setting-group quiet-settings">
                  <label className="setting-label">
                    WINDOW & PRIVACY <EyeOff size={12} />
                  </label>
                  <button
                    className="mini-card"
                    onClick={() => void toggleCompact()}
                  >
                    <span className="mini-card-icon">
                      <Square size={23} strokeWidth={1.3} />
                      <span />
                    </span>
                    <span>
                      <strong>Mini reader</strong>
                      <small>
                        {prefs.workspaceMode
                          ? "Compact floating window"
                          : "A story-sized little window"}
                      </small>
                    </span>
                    <kbd>M</kbd>
                  </button>
                  <div className="setting-row">
                    <span>Always on top</span>
                    <button
                      role="switch"
                      aria-label="Always on top"
                      aria-checked={prefs.pinned}
                      className={`switch ${prefs.pinned ? "on" : ""}`}
                      onClick={() => void nativeControl("pin", !prefs.pinned)}
                    >
                      <span />
                    </button>
                  </div>
                  <div className="setting-row">
                    <span>Cover when unfocused</span>
                    <button
                      role="switch"
                      aria-label="Cover when unfocused"
                      aria-checked={prefs.hideOnBlur}
                      className={`switch ${prefs.hideOnBlur ? "on" : ""}`}
                      onClick={() =>
                        changePref("hideOnBlur", !prefs.hideOnBlur)
                      }
                    >
                      <span />
                    </button>
                  </div>
                  <div className="setting-row">
                    <span>Cover on pointer leave</span>
                    <button
                      role="switch"
                      aria-label="Cover on pointer leave"
                      aria-checked={prefs.coverOnLeave}
                      className={`switch ${prefs.coverOnLeave ? "on" : ""}`}
                      onClick={() =>
                        changePref("coverOnLeave", !prefs.coverOnLeave)
                      }
                    >
                      <span />
                    </button>
                  </div>
                  {native?.platform === "darwin" && (
                    <div className="setting-row">
                      <span>Hide Dock icon</span>
                      <button
                        role="switch"
                        aria-label="Hide Dock icon"
                        aria-checked={hideDock}
                        className={`switch ${hideDock ? "on" : ""}`}
                        onClick={() =>
                          void native
                            .setHideDock(!hideDock)
                            .catch(() =>
                              notify(
                                "Keep the menu bar icon available before hiding the Dock icon.",
                              ),
                            )
                        }
                      >
                        <span />
                      </button>
                    </div>
                  )}
                  <div className="opacity-control">
                    <div className="setting-row">
                      <label htmlFor="opacity">Window opacity</label>
                      <span className="setting-value">
                        {Math.round(prefs.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      id="opacity"
                      aria-label="Window opacity"
                      type="range"
                      min="35"
                      max="100"
                      value={Math.round(prefs.opacity * 100)}
                      onChange={(event) =>
                        void nativeControl(
                          "opacity",
                          Number(event.target.value) / 100,
                        )
                      }
                      disabled={!native}
                    />
                    <div className="range-labels">
                      <span>Discreet</span>
                      <span>Clear</span>
                    </div>
                  </div>
                  {!native && (
                    <p className="native-hint">
                      Open the desktop app for window pinning and transparency.
                    </p>
                  )}
                </div>
                <div className="escape-tip">
                  <span className="escape-key">esc</span>
                  <p>
                    <strong>Quick switch</strong>
                    <span>Esc → notes. Esc again → return.</span>
                  </p>
                </div>
                <button
                  className="keyboard-button"
                  onClick={() => setHelpOpen(true)}
                >
                  <Keyboard size={15} /> Keyboard shortcuts
                  <ArrowRight size={13} />
                </button>
              </aside>
            )}
          </div>
          {!compact && (
            <div className="app-bottom">
              <span>
                {prefs.workspaceMode ? (
                  <>
                    <Code2 size={13} />
                    Workspace · local
                  </>
                ) : (
                  <>
                    <Leaf size={13} /> Less noise. More story.
                  </>
                )}
              </span>
              <button onClick={() => setImportOpen(true)}>
                <ArrowDownToLine size={13} /> Import book{" "}
                <kbd>{primaryKey} O</kbd>
              </button>
              <button onClick={() => setHelpOpen(true)}>
                <Keyboard size={14} />
                <span>Shortcuts</span>
              </button>
            </div>
          )}
        </>
      )}

      {dragging && (
        <div className="drop-overlay">
          <Upload size={38} strokeWidth={1.4} />
          <h2>Import your books</h2>
          <p>Drop TXT, EPUB, HTML, or Markdown files anywhere.</p>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {importOpen && (
        <div
          className="modal-backdrop"
          onClick={() => !importing && setImportOpen(false)}
        >
          <section
            className="modal import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-top">
              <span className="modal-icon">
                <BookOpen size={22} strokeWidth={1.4} />
              </span>
              <Icon label="Close import" onClick={() => setImportOpen(false)}>
                <X size={18} />
              </Icon>
            </div>
            <h2 id="import-title">
              {prefs.workspaceMode
                ? "Import book file"
                : "Make room for a new story."}
            </h2>
            <p>
              Open a local TXT, EPUB, HTML, or Markdown file. Progress is saved
              automatically.
            </p>
            <button
              className="file-drop"
              disabled={importing}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={25} strokeWidth={1.3} />
              <strong>
                {importing ? "Opening file…" : "Choose a book file"}
              </strong>
              <span>or drag and drop it here · up to 100 MB</span>
            </button>
            <label className="encoding-label">
              Text encoding · TXT / HTML
              <select
                aria-label="Text encoding"
                value={encoding}
                onChange={(event) =>
                  setEncoding(event.target.value as Encoding)
                }
              >
                <option value="auto">Auto-detect (recommended)</option>
                <option value="utf-8">UTF-8</option>
                <option value="gb18030">GBK / GB18030 · 简体中文</option>
                <option value="big5">Big5 · 繁體中文</option>
                <option value="utf-16le">UTF-16 LE</option>
                <option value="utf-16be">UTF-16 BE</option>
              </select>
            </label>
            <p className="encoding-help">
              乱码？Choose GBK or Big5 and import again. Old Chinese novels
              sometimes need a little help. EPUB files don’t need this setting.
            </p>
            <div className="modal-privacy">
              <ShieldCheck size={14} /> Your books stay on this device. Always.
            </div>
          </section>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".txt,.epub,.html,.htm,.xhtml,.md,.markdown,text/plain,application/epub+zip,text/html,text/markdown"
        multiple
        className="hidden-file"
        aria-label="Import book files"
        onChange={(event) => {
          if (event.target.files) void importFiles(event.target.files);
        }}
      />
      {helpOpen && (
        <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
          <section
            className="modal shortcuts-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-top">
              <Keyboard size={24} strokeWidth={1.4} />
              <Icon label="Close shortcuts" onClick={() => setHelpOpen(false)}>
                <X size={18} />
              </Icon>
            </div>
            <h2 id="shortcuts-title">Keyboard shortcuts</h2>
            <div className="shortcut-list">
              {[
                ["Quick cover / return", "Esc"],
                ["Mini reader / expand", "M"],
                ["Save / remove bookmark", "B"],
                ["Next / previous page", "→ / ←"],
                ["Scroll down / up", "↓ / ↑"],
                ["Import a book", "⌘ / Ctrl + O"],
                ["Find in book", "⌘ / Ctrl + F"],
                ...(native
                  ? [["Hide / restore app, anywhere", "⌘ / Ctrl + Shift + X"]]
                  : []),
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
            {native && !shortcutAvailable && (
              <p className="encoding-help">
                The global hide shortcut is in use by another app. Use the menu
                bar icon to hide and restore Margin.
              </p>
            )}
            <p className="shortcut-note">
              Your reading position is saved automatically.
            </p>
          </section>
        </div>
      )}
      {removeId && (
        <div className="modal-backdrop" onClick={() => setRemoveId(null)}>
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="remove-title">Remove this book?</h2>
            <p>
              “{books.find((b) => b.id === removeId)?.title}” and its reading
              progress will be removed from this app. Your original file stays
              untouched.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setRemoveId(null)}
              >
                Keep book
              </button>
              <button
                className="primary-button"
                onClick={() => void removeBook()}
              >
                Remove book
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
