import { makeBook, type Book, type Encoding } from "./books";
import { saveBook } from "./storage";

export type ImportProgress = {
  completed: number;
  total: number;
  fileName: string;
};
export type ImportFailure = { file: File; message: string };
export type ImportReport = {
  imported: number;
  existing: number;
  failures: ImportFailure[];
  lastBookId: string;
};

export async function importBookFiles(
  files: readonly File[],
  encoding: Encoding,
  existingBooks: readonly Book[],
  onProgress: (progress: ImportProgress) => void,
  onImported: (book: Book) => void,
): Promise<ImportReport> {
  const report: ImportReport = {
    imported: 0,
    existing: 0,
    failures: [],
    lastBookId: "",
  };
  const known = [...existingBooks];
  for (const [index, file] of files.entries()) {
    onProgress({ completed: index, total: files.length, fileName: file.name });
    try {
      if (!/\.(txt|epub|x?html?|md|markdown)$/i.test(file.name))
        throw new Error("unsupported file type");
      if (file.size > 100 * 1024 * 1024)
        throw new Error("maximum size is 100 MB");
      const next = await makeBook(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        encoding,
      );
      if (!next.text.trim()) throw new Error("This file is empty");
      const existing = known.find(
        (book) =>
          book.fileName === next.fileName &&
          book.title === next.title &&
          (book.format ?? "txt") === next.format &&
          book.text === next.text &&
          book.chapters.length === next.chapters.length &&
          book.chapters.every(
            (chapter, index) =>
              chapter.title === next.chapters[index].title &&
              chapter.start === next.chapters[index].start &&
              chapter.end === next.chapters[index].end,
          ),
      );
      if (existing) {
        report.existing++;
        report.lastBookId = existing.id;
        continue;
      }
      await saveBook(next);
      known.push(next);
      onImported(next);
      report.imported++;
      report.lastBookId = next.id;
    } catch (error) {
      report.failures.push({
        file,
        message: error instanceof Error ? error.message : "could not import",
      });
    }
  }
  onProgress({ completed: files.length, total: files.length, fileName: "" });
  return report;
}
