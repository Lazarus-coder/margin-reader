import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBook } from "./books";
import { deleteBook, loadBooks, saveBook } from "./storage";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local library persistence", () => {
  it("starts empty and round-trips Chinese text, progress, and bookmarks", async () => {
    expect(await loadBooks()).toEqual([]);
    const book = await makeBook(
      "故乡.txt",
      new TextEncoder().encode("第一章 春\n風從書頁間經過。\n下一段。"),
    );
    book.position = 2;
    book.bookmarks = [1, 2];
    await saveBook(book);
    expect(await loadBooks()).toEqual([book]);
  });

  it("updates the existing record and lists recently read books first", async () => {
    const first = await makeBook(
      "甲.txt",
      new TextEncoder().encode("第一本书"),
    );
    const second = await makeBook(
      "乙.txt",
      new TextEncoder().encode("第二本书"),
    );
    first.updatedAt = 10;
    second.updatedAt = 20;
    await saveBook(first);
    await saveBook(second);
    expect((await loadBooks()).map((book) => book.id)).toEqual([
      second.id,
      first.id,
    ]);
    await saveBook({ ...first, position: 5, updatedAt: 30 });
    const books = await loadBooks();
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({
      id: first.id,
      position: 5,
      updatedAt: 30,
    });
  });

  it("deletes one book without touching the others", async () => {
    const first = await makeBook("甲.txt", new TextEncoder().encode("甲"));
    const second = await makeBook("乙.txt", new TextEncoder().encode("乙"));
    await saveBook(first);
    await saveBook(second);
    await deleteBook(first.id);
    await deleteBook("not-present");
    expect(await loadBooks()).toEqual([second]);
  });

  it("reports unavailable local storage instead of claiming a save succeeded", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const book = await makeBook("甲.txt", new TextEncoder().encode("甲"));
    await expect(saveBook(book)).rejects.toThrow("无法保存本地书架");
  });
});
