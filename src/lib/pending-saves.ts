import type { Book } from "./books";
import { deleteBook, saveBook } from "./storage";

export async function flushBookSaves(
  pending: Map<string, Book>,
  active: Set<Promise<void>>,
  onError: () => void,
): Promise<void> {
  for (const book of pending.values()) {
    const task = saveBook(book)
      .then(() => {
        if (pending.get(book.id) === book) pending.delete(book.id);
      })
      .catch(onError);
    active.add(task);
    void task.finally(() => active.delete(task));
  }
  await Promise.all([...active]);
}

export async function deleteBookWithPendingSave(
  id: string,
  pending: Map<string, Book>,
): Promise<void> {
  const unsaved = pending.get(id);
  pending.delete(id);
  try {
    await deleteBook(id);
  } catch (error) {
    if (unsaved && !pending.has(id)) pending.set(id, unsaved);
    throw error;
  }
}
