import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTxtBook, type Book } from "./books";
import { seedClassics } from "./classics";
import { deleteBook, loadBooks, loadSeededClassics, saveBook } from "./storage";

const ids = ["sanguo", "shuihu", "xiyouji", "hongloumeng"];
const text = "第一回 春風\n書頁中的故事。\n下一段。";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("bundled classic initialization", () => {
  it("retries only a failed native read on the next launch", async () => {
    const readClassic = vi.fn(async (id: string) => {
      if (id === "shuihu") throw new Error("read interrupted");
      return text;
    });
    await seedClassics(await loadBooks(), readClassic);
    expect(await loadBooks()).toHaveLength(3);

    readClassic.mockReset().mockResolvedValue(text);
    const restarted = await seedClassics(await loadBooks(), readClassic);
    expect(readClassic.mock.calls.map(([id]) => id)).toEqual(["shuihu"]);
    expect(restarted).toHaveLength(4);
    expect(await loadBooks()).toHaveLength(4);
  });

  it("retries a transaction aborted after its write request succeeded", async () => {
    const put = IDBObjectStore.prototype.put;
    const failCommit = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        const request = put.call(this, value, key);
        if (value.id === "classic-xiyouji")
          request.addEventListener("success", () => this.transaction.abort());
        return request;
      });
    const readClassic = vi.fn(async () => text);
    await seedClassics(await loadBooks(), readClassic);
    expect(await loadBooks()).toHaveLength(3);
    expect(await loadSeededClassics()).not.toContain("classic-xiyouji");
    failCommit.mockRestore();

    readClassic.mockClear();
    const restarted = await seedClassics(await loadBooks(), readClassic);
    expect(readClassic.mock.calls).toEqual([["xiyouji"]]);
    expect(restarted.map((book) => book.id).sort()).toEqual(
      ids.map((id) => `classic-${id}`).sort(),
    );
  });

  it("fills a partial shelf without overwriting existing progress", async () => {
    const existing: Book = {
      ...makeTxtBook("三國演義.txt", new TextEncoder().encode(text)),
      id: "classic-sanguo",
      position: 2,
      bookmarks: [1, 2],
      updatedAt: 123,
    };
    await saveBook(existing);
    const readClassic = vi.fn(async () => text);
    await seedClassics(await loadBooks(), readClassic);
    expect(readClassic.mock.calls).toEqual([
      ["shuihu"],
      ["xiyouji"],
      ["hongloumeng"],
    ]);
    expect((await loadBooks()).find((book) => book.id === existing.id)).toEqual(
      existing,
    );
  });

  it("does not restore deleted books while retrying another failed book", async () => {
    const readClassic = vi.fn(async (id: string) => {
      if (id === "shuihu") throw new Error("read failed");
      return text;
    });
    await seedClassics(await loadBooks(), readClassic);
    await deleteBook("classic-sanguo");
    readClassic.mockReset().mockResolvedValue(text);

    await seedClassics(await loadBooks(), readClassic);
    expect(readClassic.mock.calls).toEqual([["shuihu"]]);
    expect((await loadBooks()).map((book) => book.id)).not.toContain(
      "classic-sanguo",
    );
    readClassic.mockClear();
    await seedClassics(await loadBooks(), readClassic);
    expect(readClassic).not.toHaveBeenCalled();
  });

  it("does not restore a shelf after all four classics are deleted", async () => {
    const readClassic = vi.fn(async () => text);
    await seedClassics(await loadBooks(), readClassic);
    for (const id of ids) await deleteBook(`classic-${id}`);

    readClassic.mockClear();
    expect(await seedClassics(await loadBooks(), readClassic)).toEqual([]);
    expect(readClassic).not.toHaveBeenCalled();
  });

  it("resumes an interrupted launch and ignores late writes after deletion", async () => {
    let resume!: (text: string) => void;
    let interrupted!: () => void;
    const waiting = new Promise<void>((resolve) => (interrupted = resolve));
    const readClassic = vi.fn(async (id: string) => {
      if (id === "shuihu") {
        interrupted();
        return new Promise<string>((resolve) => (resume = resolve));
      }
      return text;
    });
    const firstLaunch = seedClassics(await loadBooks(), readClassic);
    await waiting;
    expect((await loadBooks()).map((book) => book.id)).toEqual([
      "classic-sanguo",
    ]);

    const restartRead = vi.fn(async () => text);
    await seedClassics(await loadBooks(), restartRead);
    expect(restartRead.mock.calls).toEqual([
      ["shuihu"],
      ["xiyouji"],
      ["hongloumeng"],
    ]);
    const updated = {
      ...(await loadBooks()).find((book) => book.id === "classic-xiyouji")!,
      position: 2,
      bookmarks: [2],
      updatedAt: 456,
    };
    await saveBook(updated);
    await deleteBook("classic-shuihu");
    resume(text);
    await firstLaunch;

    expect(await loadBooks()).toHaveLength(3);
    expect((await loadBooks()).find((book) => book.id === updated.id)).toEqual(
      updated,
    );
    expect(await loadSeededClassics()).toHaveLength(4);
  });

  it.each([false, true])(
    "preserves legacy deletion choices (with existing book: %s)",
    async (hasBook) => {
      const existing = {
        ...makeTxtBook("三國演義.txt", new TextEncoder().encode(text)),
        id: "classic-sanguo",
      };
      if (hasBook) await saveBook(existing);
      localStorage.setItem("margin-classics-ready", "true");
      const readClassic = vi.fn(async () => text);

      expect(await seedClassics(await loadBooks(), readClassic)).toEqual(
        hasBook ? [existing] : [],
      );
      expect(readClassic).not.toHaveBeenCalled();
    },
  );

  it("leaves seeding available for a later native launch after a web preview", async () => {
    expect(await seedClassics(await loadBooks())).toEqual([]);
    expect(await loadSeededClassics()).toEqual([]);
    expect(
      await seedClassics(await loadBooks(), async () => text),
    ).toHaveLength(4);
  });

  it("upgrades the version 1 database without changing its books", async () => {
    const existing = {
      ...makeTxtBook("旧书.txt", new TextEncoder().encode(text)),
      position: 2,
      bookmarks: [1],
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("margin-reader", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("books", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("books", "readwrite");
        transaction.objectStore("books").put(existing);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
      };
    });
    expect(await loadBooks()).toEqual([existing]);
    await seedClassics(await loadBooks(), async () => text);
    expect(await loadBooks()).toContainEqual(existing);
    expect(await loadSeededClassics()).toHaveLength(4);
  });
});
