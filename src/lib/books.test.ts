import { describe, expect, it } from "vitest";
import {
  createSampleBook,
  decodeText,
  detectFormat,
  getChapterForPosition,
  getParagraphs,
  makeBook,
  parseChapters,
} from "./books";

const fromHex = (value: string) =>
  new Uint8Array(
    value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
const simplified =
  "第一章 风从窗边经过\n他看着远方的山，心里想起了那个春天。\n没有人知道，故事已经开始。";
const traditional =
  "第一章 風從窗邊經過\n他看著遠方的山，心裡想起了那個春天。\n沒有人知道，故事已經開始。";
// Fixtures encoded outside the implementation, using Python's gb18030 and big5 codecs.
const gb18030 = fromHex(
  "b5dad2bbd5c220b7e7b4d3b4b0b1dfbeadb9fd0acbfbbfb4d7c5d4b6b7bdb5c4c9bda3acd0c4c0efcfebc6f0c1cbc4c7b8f6b4bacceca1a30ac3bbd3d0c8cbd6aab5c0a3acb9cacac2d2d1beadbfaacabca1a3",
);
const big5 = fromHex(
  "b2c4a440b3b920adb7b171b5a1c3e4b867b94c0aa54cacddb5dbbbb7a4e8aabaa473a141a4dfb8ccb751b05fa446a8baadd3ac4ba4d1a1430aa853a6b3a448aabeb944a141ac47a8c6a477b867b67da96ca143",
);

describe("TXT decoding", () => {
  it("preserves Chinese, supplementary Unicode, and normalizes Windows newlines", () => {
    const decoded = decodeText(
      new TextEncoder().encode("\uFEFF第一章 春天\r\n你好，世界。𠮷🌿\r下一行"),
    );
    expect(decoded).toEqual({
      encoding: "utf-8",
      text: "第一章 春天\n你好，世界。𠮷🌿\n下一行",
    });
  });

  it("recognizes GB18030 novels without mistaking them for Big5", () => {
    expect(decodeText(gb18030)).toEqual({
      text: simplified,
      encoding: "gb18030",
    });
  });

  it("recognizes Big5 traditional Chinese novels", () => {
    expect(decodeText(big5)).toEqual({ text: traditional, encoding: "big5" });
  });

  it("honors the manual encoding even when automatic detection would differ", () => {
    expect(decodeText(gb18030, "big5").encoding).toBe("big5");
    expect(decodeText(gb18030, "big5").text).not.toBe(simplified);
  });

  it("decodes UTF-16 content in either byte order", () => {
    expect(decodeText(fromHex("fffe2c7b004ee07aa898"))).toEqual({
      encoding: "utf-16le",
      text: "第一章風",
    });
    expect(decodeText(fromHex("feff7b2c4e007ae098a8"))).toEqual({
      encoding: "utf-16be",
      text: "第一章風",
    });
  });

  it("keeps ASCII text and empty buffers as UTF-8", () => {
    expect(decodeText(new TextEncoder().encode("A little quiet."))).toEqual({
      text: "A little quiet.",
      encoding: "utf-8",
    });
    expect(decodeText(new Uint8Array())).toEqual({
      text: "",
      encoding: "utf-8",
    });
  });
});

describe("paragraphs and chapters", () => {
  it("removes only empty lines and surrounding whitespace", () => {
    expect(
      getParagraphs(
        "\uFEFF  第一章\r\n\r\n　　他慢慢地走。\r\n\t\r\nA  B\r下一页",
      ),
    ).toEqual(["第一章", "他慢慢地走。", "A  B", "下一页"]);
  });

  it("recognizes common Chinese headings and keeps preface text", () => {
    const paragraphs = [
      "书名与作者",
      "第一章 春风",
      "第一段。",
      "第二回 夜雨",
      "第二段。",
      "尾声",
      "最后一段。",
    ];
    const chapters = parseChapters(paragraphs);
    expect(
      chapters.map(({ title, start, end }) => ({ title, start, end })),
    ).toEqual([
      { title: "开篇", start: 0, end: 1 },
      { title: "第一章 春风", start: 1, end: 3 },
      { title: "第二回 夜雨", start: 3, end: 5 },
      { title: "尾声", start: 5, end: 7 },
    ]);
    expect(
      chapters.flatMap((chapter) =>
        paragraphs.slice(chapter.start, chapter.end),
      ),
    ).toEqual(paragraphs);
  });

  it("supports headings without spaces, full-width numbers, and English chapters", () => {
    const paragraphs = [
      "第１章风起",
      "一段正文。",
      "Chapter II: A Quiet Afternoon",
      "Some text.",
      "番外一",
      "最后一段。",
    ];
    expect(parseChapters(paragraphs).map((chapter) => chapter.title)).toEqual([
      "第１章风起",
      "Chapter II: A Quiet Afternoon",
      "番外一",
    ]);
  });

  it("does not confuse a narrative sentence with a chapter heading", () => {
    const paragraphs = [
      "这是他来到城里的第七天。",
      "第三章已经读完了，他决定去散步。",
      "没有人留意。",
    ];
    expect(parseChapters(paragraphs)).toEqual([
      { id: "chapter-0", title: "正文", start: 0, end: 3 },
    ]);
  });

  it("keeps all content in a novel without headings, including long paragraphs", () => {
    const longParagraph = "风经过窗边。".repeat(30_000);
    const paragraphs = getParagraphs(`开场\n${longParagraph}\n结尾`);
    expect(paragraphs[1]).toBe(longParagraph);
    expect(parseChapters(paragraphs)).toEqual([
      { id: "chapter-0", title: "正文", start: 0, end: 3 },
    ]);
  });

  it("finds the active chapter on exact boundaries and out-of-range positions", async () => {
    const book = await makeBook(
      "测试.TXT",
      new TextEncoder().encode("第一章\n开始。\n第二章\n结束。"),
    );
    expect(book.title).toBe("测试");
    expect(getChapterForPosition(book, -10).title).toBe("第一章");
    expect(getChapterForPosition(book, 1).title).toBe("第一章");
    expect(getChapterForPosition(book, 2).title).toBe("第二章");
    expect(getChapterForPosition(book, 100).title).toBe("第二章");
    expect(getChapterForPosition(book, Number.NaN).title).toBe("第一章");
  });

  it("rejects empty files with a useful message", async () => {
    await expect(
      makeBook("empty.txt", new TextEncoder().encode("\n\r\n　 ")),
    ).rejects.toThrow("没有可阅读的文字");
  });

  it("detects the format from names and EPUB content signatures", () => {
    const epubSignature = new Uint8Array([
      0x50,
      0x4b,
      0x03,
      0x04,
      ...new TextEncoder().encode("application/epub+zip"),
    ]);
    expect(detectFormat("小说.epub", new Uint8Array())).toBe("epub");
    expect(detectFormat("被改名的.txt", epubSignature)).toBe("epub");
    expect(detectFormat("页面.XHTML", new Uint8Array())).toBe("html");
    expect(detectFormat("散记.markdown", new Uint8Array())).toBe("md");
    expect(detectFormat("小说.TXT", new Uint8Array())).toBe("txt");
  });

  it("imports HTML using heading tags as chapters", async () => {
    const book = await makeBook(
      "闲页.html",
      new TextEncoder().encode(
        "<html><body><h2>第一章 春天</h2><p>甲。</p><script>x()</script><p>乙。</p></body></html>",
      ),
    );
    expect(book.format).toBe("html");
    expect(book.title).toBe("闲页");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 春天",
    ]);
    expect(getParagraphs(book.text)).toEqual(["第一章 春天", "甲。", "乙。"]);
  });

  it("imports Markdown with headings, emphasis, and lists", async () => {
    const book = await makeBook(
      "散记.markdown",
      new TextEncoder().encode(
        "# 第一章 春天\n\n**正文**开始，\n继续。\n\n> 引用行\n\n- 其一\n- 其二\n",
      ),
    );
    expect(book.format).toBe("md");
    expect(book.title).toBe("散记");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 春天",
    ]);
    expect(getParagraphs(book.text)).toEqual([
      "第一章 春天",
      "正文开始，继续。",
      "引用行",
      "其一",
      "其二",
    ]);
  });

  it("provides a readable original Chinese sample with multiple chapters", () => {
    const sample = createSampleBook();
    expect(sample.title).toBe("山海之间");
    expect(sample.chapters).toHaveLength(4);
    expect(getParagraphs(sample.text).length).toBeGreaterThanOrEqual(45);
    expect(sample.position).toBe(0);
    expect(sample.bookmarks).toEqual([]);
  });
});
