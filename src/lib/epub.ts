import { decodeEntities, htmlToBlocks, normalizeBlockText } from "./markup";

export interface ExtractedEpub {
  title: string;
  paragraphs: string[];
  headingStarts: { title: string; start: number }[];
  fileRanges: { title: string; start: number; end: number }[];
}

interface ZipEntry {
  method: number;
  flags: number;
  checksum: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

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

function inlineLabel(text: string): string {
  return normalizeBlockText(
    decodeEntities(
      text.replace(/<br\b[^>]*?\/?>/gi, " ").replace(/<[^>]*>/g, ""),
    ),
  );
}

const utf8 = new TextDecoder("utf-8");

export function looksLikeEpub(bytes: Uint8Array): boolean {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  )
    return false;
  const sample = bytes.subarray(0, Math.min(1024, bytes.length));
  return indexOfAscii(sample, "application/epub+zip") !== -1;
}

function indexOfAscii(haystack: Uint8Array, needle: string): number {
  outer: for (
    let start = 0;
    start + needle.length <= haystack.length;
    start++
  ) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[start + offset] !== needle.charCodeAt(offset))
        continue outer;
    }
    return start;
  }
  return -1;
}

function attrValue(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  ).exec(tag);
  if (!match) return undefined;
  return (match[1] ?? match[2])?.trim();
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function resolvePath(directory: string, href: string): string {
  const clean = href.split("#")[0];
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // Keep the raw reference when the URL encoding is malformed.
  }
  return normalizePath(directory ? `${directory}/${decoded}` : decoded);
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function findEndOfCentralDirectory(view: DataView, length: number): number {
  const earliest = Math.max(0, length - (0xffff + 22));
  for (let offset = length - 22; offset >= earliest; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

function readCentralDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view, bytes.length);
  if (eocd < 0) throw new Error("无法读取这个 EPUB 文件，请确认文件完整。");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index++) {
    if (
      cursor + 46 > bytes.length ||
      view.getUint32(cursor, true) !== 0x02014b50
    )
      break;
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = utf8.decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    const path = normalizePath(name);
    if (path)
      entries.set(path, {
        method,
        flags,
        checksum,
        compressedSize,
        uncompressedSize,
        localOffset,
      });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!entries.size)
    throw new Error("无法读取这个 EPUB 文件，请确认文件完整。");
  return entries;
}

const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 384 * 1024 * 1024;

// Decompression is capped so a crafted EPUB cannot expand into gigabytes of memory.
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const writing = writer
    .write(new Uint8Array(data))
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_ENTRY_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    await writing;
    throw new Error("这个 EPUB 文件已损坏，无法解压。");
  }
  await writing;
  if (total > MAX_ENTRY_BYTES)
    throw new Error("这个 EPUB 文件异常，已停止读取。");
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

async function readEntry(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
  path: string,
): Promise<Uint8Array | undefined> {
  const entry = entries.get(path);
  if (!entry) return undefined;
  if (entry.flags & 0x1) throw new Error("这个 EPUB 文件已加密，无法打开。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    entry.localOffset + 30 > bytes.length ||
    view.getUint32(entry.localOffset, true) !== 0x04034b50
  )
    return undefined;
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  if (start + entry.compressedSize > bytes.length) return undefined;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) {
    verifyContents(entry, data);
    return data;
  }
  if (entry.method === 8) {
    const output = await inflateRaw(data);
    if (
      entry.uncompressedSize !== 0xffffffff &&
      output.length !== entry.uncompressedSize
    )
      throw new Error("这个 EPUB 文件已损坏，无法完整读取。");
    verifyContents(entry, output);
    return output;
  }
  return undefined;
}

function verifyContents(entry: ZipEntry, data: Uint8Array): void {
  if (crc32(data) !== entry.checksum)
    throw new Error("这个 EPUB 文件已损坏，无法完整读取。");
}

async function readToc(
  readText: (path: string) => Promise<string | undefined>,
  opfDirectory: string,
  navHref: string | undefined,
  ncxHref: string | undefined,
): Promise<Map<string, string>> {
  const toc = new Map<string, string>();
  if (navHref) {
    const navPath = resolvePath(opfDirectory, navHref);
    const nav = await readText(navPath);
    if (nav) {
      const directory = directoryOf(navPath);
      for (const anchor of nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
        const href = attrValue(anchor[1], "href");
        const label = inlineLabel(anchor[2]);
        if (href && label) toc.set(resolvePath(directory, href), label);
      }
    }
  }
  if (!toc.size && ncxHref) {
    const ncxPath = resolvePath(opfDirectory, ncxHref);
    const ncx = await readText(ncxPath);
    if (ncx) {
      const directory = directoryOf(ncxPath);
      let pendingLabel = "";
      const events = ncx.matchAll(
        /<text\b[^>]*>([\s\S]*?)<\/text\s*>|<content\b([^>]*?)\/?>/gi,
      );
      for (const event of events) {
        if (event[1] !== undefined) {
          pendingLabel = inlineLabel(event[1]);
          continue;
        }
        const src = attrValue(event[2] ?? "", "src");
        const path = src ? resolvePath(directory, src) : "";
        if (path && pendingLabel && !toc.has(path)) toc.set(path, pendingLabel);
        pendingLabel = "";
      }
    }
  }
  return toc;
}

export async function extractEpub(bytes: Uint8Array): Promise<ExtractedEpub> {
  const entries = readCentralDirectory(bytes);
  let totalBytes = 0;
  const read = async (path: string) => {
    const data = await readEntry(bytes, entries, path);
    if (data) {
      totalBytes += data.length;
      if (totalBytes > MAX_TOTAL_BYTES)
        throw new Error("这个 EPUB 文件过大，已停止读取。");
    }
    return data;
  };
  const readText = async (path: string) => {
    const data = await read(path);
    return data ? utf8.decode(data) : undefined;
  };

  const encryption = await readText("META-INF/encryption.xml");
  if (encryption && /\.x?html?\b/i.test(encryption))
    throw new Error("这个 EPUB 受 DRM 保护，暂时无法打开。");

  const container = await readText("META-INF/container.xml");
  const rootfile = container ? /<rootfile\b[^>]*>/i.exec(container)?.[0] : "";
  const opfReference = rootfile ? attrValue(rootfile, "full-path") : undefined;
  if (!opfReference)
    throw new Error("无法读取这个 EPUB 文件：缺少 container.xml。");

  const opfPath = resolvePath("", opfReference);
  const opf = await readText(opfPath);
  if (!opf) throw new Error("无法读取这个 EPUB 文件：缺少内容清单。");
  const opfDirectory = directoryOf(opfPath);

  const titleTag =
    /<(?:[\w-]+:)?title\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?title\s*>/i.exec(opf);
  const title = titleTag ? inlineLabel(titleTag[1]) : "";

  interface ManifestItem {
    href: string;
    type: string;
    properties: string;
  }
  const manifest = new Map<string, ManifestItem>();
  for (const match of opf.matchAll(/<item\b([^>]*?)\/?>/gi)) {
    const attrs = match[1];
    const id = attrValue(attrs, "id");
    const href = attrValue(attrs, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      type: attrValue(attrs, "media-type") ?? "",
      properties: attrValue(attrs, "properties") ?? "",
    });
  }

  const spineAttributes = /<spine\b([^>]*)>/i.exec(opf)?.[1] ?? "";
  const spineBody =
    /<spine\b[^>]*>([\s\S]*?)<\/spine\s*>/i.exec(opf)?.[1] ?? "";
  const spineIds = [...spineBody.matchAll(/<itemref\b([^>]*?)\/?>/gi)]
    .map((match) => attrValue(match[1], "idref"))
    .filter((value): value is string => Boolean(value));
  if (!spineIds.length)
    throw new Error("无法读取这个 EPUB 文件：没有可阅读的章节。");

  const tocId = attrValue(spineAttributes, "toc");
  const navItem = [...manifest.values()].find((item) =>
    item.properties.split(/\s+/).includes("nav"),
  );
  const ncxItem = [...manifest.entries()].find(
    ([id, item]) => id === tocId || item.type === "application/x-dtbncx+xml",
  )?.[1];
  const toc = await readToc(
    readText,
    opfDirectory,
    navItem?.href,
    ncxItem?.href,
  );

  const paragraphs: string[] = [];
  const headingStarts: { title: string; start: number }[] = [];
  const fileRanges: { title: string; start: number; end: number }[] = [];
  for (const idref of spineIds) {
    const item = manifest.get(idref);
    if (!item) continue;
    if (!/xhtml|html/i.test(item.type) && !/\.x?html?$/i.test(item.href))
      continue;
    const path = resolvePath(opfDirectory, item.href);
    const data = await read(path);
    if (!data) continue;
    const blocks = htmlToBlocks(utf8.decode(data));
    if (!blocks.length) continue;
    const start = paragraphs.length;
    for (const block of blocks) {
      if (block.heading)
        headingStarts.push({ title: block.text, start: paragraphs.length });
      paragraphs.push(block.text);
    }
    fileRanges.push({
      title: toc.get(path) ?? "",
      start,
      end: paragraphs.length,
    });
  }

  if (!paragraphs.length)
    throw new Error("这个 EPUB 没有可阅读的文字，请换一个文件。");

  return { title, paragraphs, headingStarts, fileRanges };
}
