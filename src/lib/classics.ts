import { makeTxtBook, type Book } from "./books";
import { loadSeededClassics, saveClassic } from "./storage";

const CLASSIC_BOOKS = [
  { id: "sanguo", title: "三國演義" },
  { id: "shuihu", title: "水滸傳" },
  { id: "xiyouji", title: "西遊記" },
  { id: "hongloumeng", title: "紅樓夢" },
] as const;

export async function seedClassics(
  stored: Book[],
  readClassic?: (id: string) => Promise<string>,
): Promise<Book[]> {
  if (!readClassic) return stored;
  // Old profiles cannot distinguish failed imports from intentional deletions.
  if (localStorage.getItem("margin-classics-ready")) return stored;
  const handled = new Set(await loadSeededClassics());
  const result = [...stored];
  for (const classic of CLASSIC_BOOKS) {
    const id = `classic-${classic.id}`;
    if (handled.has(id)) continue;
    try {
      let next = stored.find((book) => book.id === id);
      if (!next) {
        const text = await readClassic(classic.id);
        next = {
          ...makeTxtBook(
            `${classic.title}.txt`,
            new TextEncoder().encode(text),
          ),
          id,
        };
      }
      const saved = await saveClassic(next);
      if (saved && !result.some((book) => book.id === id)) result.push(saved);
    } catch (error) {
      console.warn(`Classic book ${classic.id} is unavailable.`, error);
    }
  }
  return result;
}
