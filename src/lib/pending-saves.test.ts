import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTxtBook, type Book } from "./books";
import { deleteBookWithPendingSave, flushBookSaves } from "./pending-saves";
import * as storage from "./storage";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const book = makeTxtBook("临时.txt", new TextEncoder().encode("甲\n乙\n丙"));
  const pending = new Map<string, Book>();
  const active = new Set<Promise<void>>();
  const onError = vi.fn();
  return {
    book,
    pending,
    active,
    onError,
    flush: () => flushBookSaves(pending, active, onError),
  };
}

describe("pending book saves", () => {
  it("retries failed progress on the next flush", async () => {
    const { book, pending, flush, onError } = fixture();
    await storage.saveBook(book);
    const updated = { ...book, position: 1 };
    pending.set(book.id, updated);
    vi.spyOn(storage, "saveBook").mockRejectedValueOnce(new Error("quota"));

    await flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(pending.get(book.id)).toBe(updated);
    expect((await storage.loadBooks())[0].position).toBe(0);

    await flush();
    expect(pending.size).toBe(0);
    expect((await storage.loadBooks())[0].position).toBe(1);
  });

  it("keeps a newer snapshot when an older save completes", async () => {
    const { book, pending, flush } = fixture();
    const saved = Promise.withResolvers<void>();
    vi.spyOn(storage, "saveBook").mockReturnValueOnce(saved.promise);
    pending.set(book.id, book);
    const firstFlush = flush();
    const updated = { ...book, position: 2 };
    pending.set(book.id, updated);

    saved.resolve();
    await firstFlush;
    expect(pending.get(book.id)).toBe(updated);
    await flush();
    expect((await storage.loadBooks())[0].position).toBe(2);
  });

  it("waits for an active save when another flush has no pending books", async () => {
    const { book, pending, active, flush } = fixture();
    const saved = Promise.withResolvers<void>();
    vi.spyOn(storage, "saveBook").mockReturnValueOnce(saved.promise);
    pending.set(book.id, book);
    const firstFlush = flush();
    pending.delete(book.id);
    let secondFinished = false;
    const secondFlush = flush().then(() => {
      secondFinished = true;
    });

    await Promise.resolve();
    expect(secondFinished).toBe(false);
    saved.resolve();
    await Promise.all([firstFlush, secondFlush]);
    expect(secondFinished).toBe(true);
    expect(active.size).toBe(0);
  });

  it("preserves the latest progress across overlapping flushes", async () => {
    const { book, pending, active, flush } = fixture();
    pending.set(book.id, book);
    const firstFlush = flush();
    const repeatedFlush = flush();
    pending.set(book.id, { ...book, position: 2 });
    const latestFlush = flush();

    await Promise.all([firstFlush, repeatedFlush, latestFlush]);
    expect((await storage.loadBooks())[0].position).toBe(2);
    expect(pending.size).toBe(0);
    expect(active.size).toBe(0);
  });

  it("restores unsaved progress when deletion fails", async () => {
    const { book, pending, flush } = fixture();
    await storage.saveBook(book);
    const updated = { ...book, position: 1 };
    pending.set(book.id, updated);
    vi.spyOn(storage, "deleteBook").mockRejectedValueOnce(new Error("quota"));

    await expect(deleteBookWithPendingSave(book.id, pending)).rejects.toThrow(
      "quota",
    );
    expect(pending.get(book.id)).toBe(updated);
    await flush();
    expect((await storage.loadBooks())[0].position).toBe(1);
  });

  it("does not replace a newer update after a failed deletion", async () => {
    const { book, pending } = fixture();
    const deleted = Promise.withResolvers<void>();
    vi.spyOn(storage, "deleteBook").mockReturnValueOnce(deleted.promise);
    pending.set(book.id, book);
    const removing = deleteBookWithPendingSave(book.id, pending);
    const updated = { ...book, position: 2 };
    pending.set(book.id, updated);

    deleted.reject(new Error("quota"));
    await expect(removing).rejects.toThrow("quota");
    expect(pending.get(book.id)).toBe(updated);
  });

  it("does not requeue a deleted book when an earlier save fails", async () => {
    const { book, pending, flush } = fixture();
    await storage.saveBook(book);
    const saved = Promise.withResolvers<void>();
    const write = vi
      .spyOn(storage, "saveBook")
      .mockReturnValueOnce(saved.promise);
    pending.set(book.id, { ...book, position: 1 });
    const saving = flush();

    await deleteBookWithPendingSave(book.id, pending);
    saved.reject(new Error("quota"));
    await saving;
    await flush();
    expect(pending.size).toBe(0);
    expect(write).toHaveBeenCalledOnce();
    expect(await storage.loadBooks()).toEqual([]);
  });

  it("keeps deletion after an already started IndexedDB save", async () => {
    const { book, pending, flush } = fixture();
    pending.set(book.id, book);
    const saving = flush();
    await deleteBookWithPendingSave(book.id, pending);
    await saving;
    await flush();
    expect(await storage.loadBooks()).toEqual([]);
  });
});
