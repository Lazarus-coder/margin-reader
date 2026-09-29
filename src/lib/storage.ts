import type { Book } from "./books";

const DATABASE_NAME = "margin-reader";
const STORE_NAME = "books";
let databasePromise: Promise<IDBDatabase> | undefined;
let databaseFactory: IDBFactory | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new Error("当前环境无法保存本地书架，请使用支持 IndexedDB 的浏览器。"),
    );
  if (databasePromise && databaseFactory === globalThis.indexedDB)
    return databasePromise;
  databaseFactory = globalThis.indexedDB;
  databasePromise = new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error ?? new Error("无法打开本地书架。"));
    };
  });
  return databasePromise;
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    // Wait for the transaction, not only the request, so quota/commit failures are surfaced.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () =>
      reject(
        transaction.error ?? request.error ?? new Error("本地书架保存失败。"),
      );
    transaction.onerror = () =>
      reject(
        transaction.error ?? request.error ?? new Error("无法访问本地书架。"),
      );
  });
}

export async function loadBooks(): Promise<Book[]> {
  const books = await transact<Book[]>("readonly", (store) => store.getAll());
  return books.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function saveBook(book: Book): Promise<void> {
  await transact("readwrite", (store) => store.put(book));
}

export async function deleteBook(id: string): Promise<void> {
  await transact("readwrite", (store) => store.delete(id));
}
