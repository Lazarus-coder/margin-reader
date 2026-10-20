import {
  test,
  expect,
  _electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function launchReader(profile: string) {
  const electronPath = (await import("electron")).default;
  const environment: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    NODE_ENV: "test",
    MARGIN_DEV_URL: "",
    MARGIN_TEST_USER_DATA: profile,
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  return _electron.launch({
    executablePath: electronPath as unknown as string,
    args: [root],
    cwd: root,
    env: environment,
    timeout: 30_000,
  });
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

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data)
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function buildEpubFixture(): Buffer {
  const files: [string, string][] = [
    ["mimetype", "application/epub+zip"],
    [
      "META-INF/container.xml",
      '<?xml version="1.0"?><container><rootfiles>' +
        '<rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    ],
    [
      "OEBPS/content.opf",
      '<?xml version="1.0"?><package><metadata>' +
        "<dc:title>窗边的余白</dc:title></metadata><manifest>" +
        '<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>' +
        '</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    ],
    [
      "OEBPS/ch1.xhtml",
      "<html><body><h1>第一章 书页之间</h1><p>下午三点，城里的雨停了。</p></body></html>",
    ],
    [
      "OEBPS/ch2.xhtml",
      "<html><body><h1>第二章 旧书店</h1><p>河水比地图上画的宽一些。</p></body></html>",
    ],
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    data.copy(local, 30 + nameBytes.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

test("Chinese novels keep their chapters, bookmarks, appearance, and complete text", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(path.join(tmpdir(), "margin-reading-test-"));
  let application: ElectronApplication | undefined;
  try {
    application = await launchReader(profile);
    const page = await application.firstWindow();
    await page
      .getByRole("button", { name: "Reading view", exact: true })
      .click();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fileInput = page.locator('input[type="file"]');
    const progress = page.getByRole("slider", {
      name: "Reading progress",
      exact: true,
    });
    const chapterOne = [
      "第一章 夜雨",
      ...Array.from(
        { length: 15 },
        (_, index) =>
          `窗边第${index + 1}段：雨水沿着窗沿慢慢落下，林舟翻开一本旧书，静静读着那些关于远方的故事。`,
      ),
    ];
    const chapterTwo = [
      "第二章 海风",
      "海风把一封蓝色的信送到了码头。",
      ...Array.from(
        { length: 15 },
        (_, index) =>
          `海边第${index + 1}段：他听见潮水退去，远处的灯塔还亮着，一艘小船正驶向清晨。`,
      ),
    ];
    const novel = [...chapterOne, ...chapterTwo].join("\r\n\r\n");

    await test.step("imports a Chinese UTF-8 novel and detects chapter boundaries", async () => {
      await expect(
        page.getByRole("heading", {
          name: "第一章 风从书页间经过",
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("initial-bookshelf.png"),
      });
      await fileInput.setInputFiles({
        name: "夜雨与海风.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(novel, "utf8"),
      });
      await expect(
        page.getByRole("heading", { name: "第一章 夜雨", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".novel-text")).toContainText("窗边第1段");
      await expect(page.locator(".chapter-list button")).toHaveCount(2);
      await expect(progress).toHaveAttribute("max", "32");
      await page.screenshot({
        path: testInfo.outputPath("imported-chinese-novel.png"),
      });
    });

    await test.step("navigates chapters and finds a Chinese phrase", async () => {
      await page
        .locator(".chapter-list")
        .getByRole("button", { name: "02 第二章 海风", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "第二章 海风", exact: true }),
      ).toBeVisible();
      await expect(progress).toHaveValue("16");
      await page
        .getByRole("button", { name: "Find in book", exact: false })
        .click();
      await page.getByPlaceholder("Search words or phrases…").fill("蓝色的信");
      await expect(page.locator(".saved-list button")).toHaveCount(1);
      await page.locator(".saved-list button").click();
      await expect(progress).toHaveValue("17");
      await expect(page.locator('[data-paragraph="17"]')).toBeVisible();
    });

    await test.step("bookmarks a selected paragraph and persists reading preferences", async () => {
      await page
        .getByRole("button", {
          name: "Bookmark this paragraph (B)",
          exact: true,
        })
        .click();
      await expect(page.locator('[data-paragraph="17"]')).toHaveClass(
        /has-bookmark/,
      );
      await page
        .getByRole("button", { name: "Bookmarks", exact: false })
        .click();
      await expect(page.locator(".saved-list button")).toContainText(
        "海风把一封蓝色的信",
      );
      await page
        .getByRole("button", { name: "night theme", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Increase text size", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Airy line spacing", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
      await expect(page.locator(".app")).toHaveCSS("--reading-size", "19px");
      await expect(page.locator(".app")).toHaveCSS("--reading-line", "2.5");
      // Poll the actual committed record so reload checks durable storage rather than timer timing.
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const database = await new Promise<IDBDatabase>(
              (resolve, reject) => {
                const request = indexedDB.open("margin-reader");
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              },
            );
            const books = await new Promise<
              { fileName: string; position: number; bookmarks: number[] }[]
            >((resolve, reject) => {
              const request = database
                .transaction("books")
                .objectStore("books")
                .getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            database.close();
            const book = books.find(
              (item) => item.fileName === "夜雨与海风.txt",
            );
            return (
              book && { position: book.position, bookmarks: book.bookmarks }
            );
          }),
        )
        .toEqual({ position: 17, bookmarks: [17] });
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "第二章 海风", exact: true }),
      ).toBeVisible();
      await expect(progress).toHaveValue("17");
      await expect(page.locator('[data-paragraph="17"]')).toHaveClass(
        /has-bookmark/,
      );
      await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
      await expect(page.locator(".app")).toHaveCSS("--reading-size", "19px");
      await expect(page.locator(".app")).toHaveCSS("--reading-line", "2.5");
      await page
        .getByRole("button", { name: "paper theme", exact: true })
        .click();
    });

    await test.step("honors a manual GBK override and reports empty imports", async () => {
      await page.locator(".import-dashed").click();
      await page
        .getByRole("combobox", { name: "Text encoding", exact: true })
        .selectOption("gb18030");
      await fileInput.setInputFiles({
        name: "旧书编码.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("c4e3bac3cac0bde7", "hex"),
      });
      await expect(page.locator(".novel-text")).toHaveText("你好世界");
      await expect(page.locator(".chapter-foot-label")).toContainText(
        "GB18030",
      );
      await page.locator(".import-dashed").click();
      await page
        .getByRole("combobox", { name: "Text encoding", exact: true })
        .selectOption("auto");
      await fileInput.setInputFiles({
        name: "空白.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("\r\n\r\n"),
      });
      await expect(
        page
          .getByRole("dialog")
          .getByRole("status", { name: "Import results" }),
      ).toContainText("没有可阅读的文字");
      await expect(page.locator(".book-list")).not.toContainText("空白");
      await page
        .getByRole("button", { name: "Close import", exact: true })
        .click();
    });

    await test.step("removes imported books without deleting the sample", async () => {
      for (const title of ["旧书编码", "夜雨与海风"]) {
        await page
          .getByRole("button", { name: `Remove ${title}`, exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "Remove this book?", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Remove book", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: `Remove ${title}`, exact: true }),
        ).toHaveCount(0);
      }
      // The sample stays on the shelf; the reader falls back to the most
      // recently read remaining book, which is 紅樓夢 after the reload.
      await expect(
        page.locator(".book-item").filter({ hasText: "山海之间" }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "第一回 甄士隱夢幻識通靈 賈雨村風塵懷閨秀",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator(".book-item")).toHaveCount(5);
    });

    await test.step("retains all 350 paragraphs across bounded reading sections", async () => {
      const allParagraphs = Array.from(
        { length: 350 },
        (_, index) =>
          `段落${String(index).padStart(3, "0")}：这是没有章节标题的长篇故事，风从山海之间经过。`,
      );
      await fileInput.setInputFiles({
        name: "长篇完整性.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(allParagraphs.join("\n"), "utf8"),
      });
      await expect(
        page.getByRole("heading", { name: "正文", exact: true }),
      ).toBeVisible();
      await expect(progress).toHaveAttribute("max", "349");
      const rendered = page.locator(".novel-text p");
      await expect(rendered).toHaveCount(160);
      const seen = await rendered.allTextContents();
      await page
        .getByRole("button", { name: "Next chapter", exact: true })
        .click();
      await expect(progress).toHaveValue("160");
      await expect(rendered).toHaveCount(160);
      seen.push(...(await rendered.allTextContents()));
      await page
        .getByRole("button", { name: "Next chapter", exact: true })
        .click();
      await expect(progress).toHaveValue("320");
      await expect(rendered).toHaveCount(30);
      seen.push(...(await rendered.allTextContents()));
      expect(seen).toEqual(allParagraphs);
      await expect(
        page.getByRole("button", { name: "Next chapter", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Previous chapter", exact: true })
        .click();
      await expect(progress).toHaveValue("160");
      await expect(rendered.first()).toHaveText(allParagraphs[160]);
    });

    await test.step("ships the four classic novels with complete outlines", async () => {
      for (const title of ["三國演義", "水滸傳", "西遊記", "紅樓夢"]) {
        await expect(
          page.locator(".book-item").filter({ hasText: title }).first(),
        ).toBeVisible();
      }
      await page
        .locator(".book-item")
        .filter({ hasText: "三國演義" })
        .first()
        .click();
      await expect(
        page.getByRole("heading", {
          name: "第一回 宴桃園豪傑三結義 斬黃巾英雄首立功",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator(".chapter-list button")).toHaveCount(120);
    });

    await test.step("imports an EPUB with its own chapter outline", async () => {
      await page.locator(".import-dashed").click();
      await fileInput.setInputFiles({
        name: "余白小样.epub",
        mimeType: "application/epub+zip",
        buffer: buildEpubFixture(),
      });
      await expect(
        page.getByRole("heading", { name: "第一章 书页之间", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".chapter-list button")).toHaveCount(2);
      await expect(
        page.getByRole("button", { name: "Remove 窗边的余白", exact: true }),
      ).toHaveCount(1);
      await expect(page.locator(".book-item").first()).toContainText("EPUB");
    });

    expect(errors).toEqual([]);
  } finally {
    if (application) await application.close();
    await rm(profile, { recursive: true, force: true });
  }
});
