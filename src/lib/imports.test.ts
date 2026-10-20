import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBook, type Book } from "./books";
import { importBookFiles } from "./imports";
import * as storage from "./storage";

const text = "第一章 春天\n风从窗边经过。\n故事继续。";
const file = (name = "春天.txt", content = text) => new File([content], name);
const noop = () => {};

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("book imports", () => {
  it("reuses an existing book without replacing unsaved progress or bookmarks", async () => {
    const original = await makeBook("春天.txt", new TextEncoder().encode(text));
    await storage.saveBook(original);
    const current: Book = {
      ...original,
      format: undefined,
      encoding: "utf-16le",
      position: 2,
      bookmarks: [1, 2],
      chapters: original.chapters.map((chapter) => ({
        ...chapter,
        id: "older-chapter-id",
      })),
    };
    const save = vi.spyOn(storage, "saveBook");
    const onImported = vi.fn();
    const report = await importBookFiles(
      [file()],
      "auto",
      [current],
      noop,
      onImported,
    );

    expect(report).toEqual({
      imported: 0,
      existing: 1,
      failures: [],
      lastBookId: current.id,
    });
    expect(current.position).toBe(2);
    expect(current.bookmarks).toEqual([1, 2]);
    expect(save).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(await storage.loadBooks()).toEqual([original]);
  });

  it("imports a repeated file once per batch and reports progress", async () => {
    const onImported = vi.fn();
    const onProgress = vi.fn();
    const report = await importBookFiles(
      [file(), file()],
      "auto",
      [],
      onProgress,
      onImported,
    );
    const stored = await storage.loadBooks();

    expect(stored).toHaveLength(1);
    expect(onImported).toHaveBeenCalledExactlyOnceWith(stored[0]);
    expect(report).toEqual({
      imported: 1,
      existing: 1,
      failures: [],
      lastBookId: stored[0].id,
    });
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { completed: 0, total: 2, fileName: "春天.txt" },
      { completed: 1, total: 2, fileName: "春天.txt" },
      { completed: 2, total: 2, fileName: "" },
    ]);
  });

  it("imports changed content under the same filename as a separate book", async () => {
    const report = await importBookFiles(
      [file(), file("春天.txt", `${text}\n新的结尾。`)],
      "auto",
      [],
      noop,
      noop,
    );
    expect(report.imported).toBe(2);
    expect(report.existing).toBe(0);
    expect(await storage.loadBooks()).toHaveLength(2);
  });

  it("imports identical text under a different filename as a separate book", async () => {
    const report = await importBookFiles(
      [file(), file("备份.txt")],
      "auto",
      [],
      noop,
      noop,
    );
    expect(report.imported).toBe(2);
    expect(report.existing).toBe(0);
    expect(await storage.loadBooks()).toHaveLength(2);
  });

  it.each([
    ["title", (book: Book) => ({ ...book, title: "另一个书名" })],
    ["format", (book: Book) => ({ ...book, format: "md" as const })],
    [
      "chapter title",
      (book: Book) => ({
        ...book,
        chapters: [{ ...book.chapters[0], title: "自定义目录" }],
      }),
    ],
    [
      "chapter start",
      (book: Book) => ({
        ...book,
        chapters: [{ ...book.chapters[0], start: 1 }],
      }),
    ],
    [
      "chapter end",
      (book: Book) => ({
        ...book,
        chapters: [{ ...book.chapters[0], end: 2 }],
      }),
    ],
  ])("retains a distinct book when %s differs", async (_, change) => {
    const previous = change(
      await makeBook("春天.txt", new TextEncoder().encode(text)),
    );
    await storage.saveBook(previous);
    const report = await importBookFiles(
      [file()],
      "auto",
      [previous],
      noop,
      noop,
    );
    expect(report.imported).toBe(1);
    expect(report.existing).toBe(0);
    expect(await storage.loadBooks()).toHaveLength(2);
  });

  it("allows a corrected encoding to create readable text", async () => {
    const gbkFile = new File(
      [new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7])],
      "旧书.txt",
    );
    await importBookFiles([gbkFile], "utf-8", [], noop, noop);
    const before = await storage.loadBooks();
    const report = await importBookFiles(
      [gbkFile],
      "gb18030",
      before,
      noop,
      noop,
    );
    expect(report.imported).toBe(1);
    expect(report.existing).toBe(0);
    expect(before[0].text).not.toBe("你好世界");
    expect((await storage.loadBooks()).map((book) => book.text)).toContain(
      "你好世界",
    );
    expect(await storage.loadBooks()).toHaveLength(2);
  });

  it("reports every failed file while keeping successful imports", async () => {
    const unsupported = file("图片.png");
    const oversized = file("超大.txt");
    Object.defineProperty(oversized, "size", { value: 100 * 1024 * 1024 + 1 });
    const empty = file("空白.txt", "\r\n　 ");
    const unreadable = file("无法读取.txt");
    vi.spyOn(unreadable, "arrayBuffer").mockRejectedValue(
      new Error("file could not be read"),
    );
    const onImported = vi.fn();
    const report = await importBookFiles(
      [unsupported, file(), oversized, empty, unreadable],
      "auto",
      [],
      noop,
      onImported,
    );
    const stored = await storage.loadBooks();
    expect(report.imported).toBe(1);
    expect(report.existing).toBe(0);
    expect(report.lastBookId).toBe(stored[0].id);
    expect(stored).toHaveLength(1);
    expect(onImported).toHaveBeenCalledExactlyOnceWith(stored[0]);
    expect(report.failures).toEqual([
      { file: unsupported, message: "unsupported file type" },
      { file: oversized, message: "maximum size is 100 MB" },
      { file: empty, message: expect.stringContaining("没有可阅读的文字") },
      { file: unreadable, message: "file could not be read" },
    ]);
  });

  it("does not remember a failed save as imported and can retry it", async () => {
    const failed = file();
    vi.spyOn(storage, "saveBook").mockRejectedValueOnce(new Error("disk full"));
    const onImported = vi.fn();
    const report = await importBookFiles(
      [failed, file()],
      "auto",
      [],
      noop,
      onImported,
    );
    const stored = await storage.loadBooks();
    expect(report).toEqual({
      imported: 1,
      existing: 0,
      failures: [{ file: failed, message: "disk full" }],
      lastBookId: stored[0].id,
    });
    expect(stored).toHaveLength(1);
    expect(onImported).toHaveBeenCalledExactlyOnceWith(stored[0]);

    const retried = await importBookFiles(
      report.failures.map((failure) => failure.file),
      "auto",
      stored,
      noop,
      onImported,
    );
    expect(retried).toEqual({
      imported: 0,
      existing: 1,
      failures: [],
      lastBookId: stored[0].id,
    });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(await storage.loadBooks()).toEqual(stored);
  });
});
