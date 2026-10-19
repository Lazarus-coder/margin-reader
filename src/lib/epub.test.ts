import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { makeBook } from "./books";
import { extractEpub, looksLikeEpub } from "./epub";

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of data)
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(deflateRawSync(data, { level: 1 }));
}

interface ZipFixtureEntry {
  name: string;
  content: string | Uint8Array;
  compress?: boolean;
  truncate?: number;
  corrupt?: boolean;
  encrypted?: boolean;
}

async function buildZip(entries: ZipFixtureEntry[]): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data =
      typeof entry.content === "string"
        ? encoder.encode(entry.content)
        : entry.content;
    const method = entry.compress ? 8 : 0;
    let stored = entry.compress ? await deflateRaw(data) : data;
    if (entry.truncate)
      stored = stored.subarray(0, stored.length - entry.truncate);
    if (entry.corrupt) {
      stored = Uint8Array.from(stored);
      stored[Math.floor(stored.length / 2)] ^= 0xff;
    }
    const checksum = crc32(data);
    const flags = entry.encrypted ? 0x1 : 0;

    const local = new Uint8Array(30 + nameBytes.length + stored.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(stored, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const zip = new Uint8Array(offset + centralSize + eocd.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  return zip;
}

function epubFiles(): ZipFixtureEntry[] {
  return [
    { name: "mimetype", content: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      content:
        '<?xml version="1.0"?><container version="1.0" ' +
        'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
        '<rootfiles><rootfile full-path="OEBPS/content.opf" ' +
        'media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: "OEBPS/content.opf",
      content:
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">' +
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>余白测试书</dc:title></metadata>' +
        '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
        '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest>' +
        '<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    },
    {
      name: "OEBPS/nav.xhtml",
      content:
        '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">' +
        '<body><nav epub:type="toc"><ol>' +
        '<li><a href="chapter1.xhtml">第一章 风</a></li>' +
        '<li><a href="chapter2.xhtml#top">第二章 雨</a></li>' +
        "</ol></nav></body></html>",
    },
    {
      name: "OEBPS/chapter1.xhtml",
      content:
        '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">' +
        "<head><title>一</title><style>.x{color:red}</style></head>" +
        "<body><h1>第一章 风从书页间经过</h1><p>下午三点，城里的雨停了。</p>" +
        "<p>林舟把信 &amp; 咖啡<em>放在</em>桌上。</p></body></html>",
    },
    {
      name: "OEBPS/chapter2.xhtml",
      content:
        '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">' +
        "<body><h1>第二章 河岸上的旧书店</h1><p>河水比地图上画的宽一些。</p></body></html>",
    },
  ];
}

describe("EPUB extraction", () => {
  it("reads the title, spine order, chapters, and entities", async () => {
    const extracted = await extractEpub(await buildZip(epubFiles()));
    expect(extracted.title).toBe("余白测试书");
    expect(extracted.paragraphs).toEqual([
      "第一章 风从书页间经过",
      "下午三点，城里的雨停了。",
      "林舟把信 & 咖啡放在桌上。",
      "第二章 河岸上的旧书店",
      "河水比地图上画的宽一些。",
    ]);
    expect(extracted.headingStarts).toEqual([
      { title: "第一章 风从书页间经过", start: 0 },
      { title: "第二章 河岸上的旧书店", start: 3 },
    ]);
    expect(extracted.fileRanges).toEqual([
      { title: "第一章 风", start: 0, end: 3 },
      { title: "第二章 雨", start: 3, end: 5 },
    ]);
  });

  it("falls back to the navigation document when files carry no headings", async () => {
    const files = epubFiles().map((entry) => {
      if (entry.name === "OEBPS/chapter1.xhtml")
        return {
          ...entry,
          content: "<html><body><p>甲</p><p>乙</p></body></html>",
        };
      if (entry.name === "OEBPS/chapter2.xhtml")
        return { ...entry, content: "<html><body><p>丙</p></body></html>" };
      return entry;
    });
    const zip = await buildZip(files);
    const extracted = await extractEpub(zip);
    expect(extracted.headingStarts).toEqual([]);
    expect(extracted.fileRanges).toEqual([
      { title: "第一章 风", start: 0, end: 2 },
      { title: "第二章 雨", start: 2, end: 3 },
    ]);
    const book = await makeBook("分章.epub", zip);
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 风",
      "第二章 雨",
    ]);
  });

  it("keeps navigation labels intact across inline markup", async () => {
    const files = epubFiles().map((entry) => {
      if (entry.name === "OEBPS/nav.xhtml")
        return {
          ...entry,
          content:
            '<html><body><nav epub:type="toc"><ol>' +
            '<li><a href="chapter1.xhtml">第<span>一</span>章 风</a></li>' +
            '<li><a href="chapter2.xhtml">第二章 <em>雨</em></a></li>' +
            "</ol></nav></body></html>",
        };
      if (entry.name === "OEBPS/chapter1.xhtml")
        return { ...entry, content: "<html><body><p>甲</p></body></html>" };
      if (entry.name === "OEBPS/chapter2.xhtml")
        return { ...entry, content: "<html><body><p>乙</p></body></html>" };
      return entry;
    });
    const book = await makeBook("标签.epub", await buildZip(files));
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 风",
      "第二章 雨",
    ]);
  });

  it("merges chapter headings found in the text with file segments", async () => {
    const files = epubFiles().map((entry) => {
      if (entry.name === "OEBPS/chapter1.xhtml")
        return {
          ...entry,
          content:
            "<html><body><p>第一回 灵根育孕</p><p>诗曰：混沌未分。</p></body></html>",
        };
      if (entry.name === "OEBPS/chapter2.xhtml")
        return {
          ...entry,
          content:
            "<html><body><p>第二回 悟彻菩提</p><p>正文。</p></body></html>",
        };
      return entry;
    });
    const book = await makeBook("回目.epub", await buildZip(files));
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "第一回 灵根育孕",
      "第二回 悟彻菩提",
    ]);
  });

  it("reads deflated entries", async () => {
    const files = epubFiles().map((entry) => ({ ...entry, compress: true }));
    const extracted = await extractEpub(await buildZip(files));
    expect(extracted.title).toBe("余白测试书");
    expect(extracted.paragraphs).toHaveLength(5);
  });

  it("resolves references relative to the package document", async () => {
    const files: ZipFixtureEntry[] = [
      { name: "mimetype", content: "application/epub+zip" },
      {
        name: "META-INF/container.xml",
        content:
          '<container><rootfiles><rootfile full-path="OPS/ops/content.opf"/></rootfiles></container>',
      },
      {
        name: "OPS/ops/content.opf",
        content:
          "<package><metadata><dc:title>深目录</dc:title></metadata>" +
          '<manifest><item id="c1" href="../text/ch%201.xhtml" media-type="application/xhtml+xml"/></manifest>' +
          '<spine><itemref idref="c1"/></spine></package>',
      },
      {
        name: "OPS/text/ch 1.xhtml",
        content: "<html><body><h1>第一章</h1><p>正文。</p></body></html>",
      },
    ];
    const extracted = await extractEpub(await buildZip(files));
    expect(extracted.paragraphs).toEqual(["第一章", "正文。"]);
  });

  it("rejects damaged or non-EPUB input", async () => {
    await expect(extractEpub(encoder.encode("not a zip"))).rejects.toThrow(
      "无法读取这个 EPUB",
    );
    const noContainer = await buildZip([{ name: "hello.txt", content: "hi" }]);
    await expect(extractEpub(noContainer)).rejects.toThrow("container.xml");
  });

  it("rejects truncated or corrupted compressed payloads", async () => {
    const files = epubFiles().map((entry) =>
      entry.name === "OEBPS/chapter1.xhtml"
        ? { ...entry, compress: true, truncate: 12 }
        : entry,
    );
    await expect(extractEpub(await buildZip(files))).rejects.toThrow("已损坏");
  });

  it("rejects corruption that preserves the compressed length", async () => {
    const files = epubFiles().map((entry) =>
      entry.name === "OEBPS/chapter1.xhtml"
        ? { ...entry, compress: true, corrupt: true }
        : { ...entry, compress: true },
    );
    await expect(extractEpub(await buildZip(files))).rejects.toThrow("已损坏");
  });

  it("rejects encrypted entries with a clear message", async () => {
    const files = epubFiles().map((entry) =>
      entry.name === "OEBPS/chapter1.xhtml"
        ? { ...entry, encrypted: true }
        : entry,
    );
    await expect(extractEpub(await buildZip(files))).rejects.toThrow("已加密");
  });

  it("stops reading decompressed content that exceeds the safety cap", async () => {
    const bomb = new Uint8Array(129 * 1024 * 1024);
    const files = epubFiles().map((entry) =>
      entry.name === "OEBPS/chapter1.xhtml"
        ? { ...entry, content: bomb, compress: true }
        : entry,
    );
    await expect(extractEpub(await buildZip(files))).rejects.toThrow(
      "已停止读取",
    );
  }, 60_000);

  it("rejects DRM-protected content but allows font obfuscation", async () => {
    const drm = epubFiles().concat({
      name: "META-INF/encryption.xml",
      content:
        "<encryption><EncryptedData><CipherData>" +
        '<CipherReference URI="OEBPS/chapter1.xhtml"/></CipherData></EncryptedData></encryption>',
    });
    await expect(extractEpub(await buildZip(drm))).rejects.toThrow("DRM");

    const fonts = epubFiles().concat({
      name: "META-INF/encryption.xml",
      content:
        "<encryption><EncryptedData><CipherData>" +
        '<CipherReference URI="OEBPS/fonts/serif.otf"/></CipherData></EncryptedData></encryption>',
    });
    await expect(extractEpub(await buildZip(fonts))).resolves.toBeTruthy();
  });

  it("integrates with makeBook and the format detector", async () => {
    const zip = await buildZip(epubFiles());
    expect(looksLikeEpub(zip)).toBe(true);
    const book = await makeBook("余白测试书.epub", zip);
    expect(book.format).toBe("epub");
    expect(book.title).toBe("余白测试书");
    expect(book.encoding).toBe("utf-8");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 风从书页间经过",
      "第二章 河岸上的旧书店",
    ]);
    expect(book.text.startsWith("第一章 风从书页间经过\n\n下午三点")).toBe(
      true,
    );
  });
});
