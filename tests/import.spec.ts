import {
  test,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
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

async function savedBooks(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("margin-reader");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<
        { fileName: string; position: number; bookmarks: number[] }[]
      >((resolve, reject) => {
        const request = database
          .transaction("books")
          .objectStore("books")
          .getAll();
        request.onsuccess = () =>
          resolve(
            request.result.map(
              (book: {
                fileName: string;
                position: number;
                bookmarks: number[];
              }) => ({
                fileName: book.fileName,
                position: book.position,
                bookmarks: book.bookmarks,
              }),
            ),
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

test("batch imports retain progress, explain failures, and safely retry local saves", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(path.join(tmpdir(), "margin-import-test-"));
  let application: ElectronApplication | undefined;
  try {
    application = await launchReader(profile);
    let page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install();
    await page.reload();
    await page
      .getByRole("button", { name: "Reading view", exact: true })
      .click();
    await expect(page.locator(".book-item")).toHaveCount(5);
    const source = {
      name: "雨后重读.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        [
          "第一章 雨后",
          "午后的雨停了，林舟翻开窗边的旧书。",
          "河水静静流过城里的桥。",
          "他把这一页折起，留待明天重读。",
          "远处的灯光渐渐亮了起来。",
        ].join("\n\n"),
      ),
    };

    await test.step("reimporting a book keeps its one shelf entry, place, and bookmark", async () => {
      await page.locator('input[type="file"]').setInputFiles(source);
      const progress = page.getByRole("slider", {
        name: "Reading progress",
        exact: true,
      });
      await expect(progress).toHaveAttribute("max", "4");
      await progress.focus();
      await page.keyboard.press("Home");
      for (let index = 0; index < 3; index++)
        await page.keyboard.press("ArrowRight");
      await page
        .getByRole("button", {
          name: "Bookmark this paragraph (B)",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => {
          const books = await savedBooks(page);
          const book = books.find((item) => item.fileName === source.name);
          return book && { position: book.position, bookmarks: book.bookmarks };
        })
        .toEqual({ position: 3, bookmarks: [3] });
      await page.locator(".import-dashed").click();
      await page.locator('input[type="file"]').setInputFiles(source);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Remove 雨后重读", exact: true }),
      ).toHaveCount(1);
      await expect(progress).toHaveValue("3");
      await expect(page.locator('[data-paragraph="3"]')).toHaveClass(
        /has-bookmark/,
      );
    });

    await test.step("shows progress and keeps mixed-file failures available in a small window", async () => {
      await page.evaluate(() => {
        const original = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = async function () {
          if (this.name === "海边新书.txt") {
            File.prototype.arrayBuffer = original;
            await new Promise<void>((resolve) => {
              (
                window as unknown as { releaseImportRead: () => void }
              ).releaseImportRead = resolve;
            });
          }
          return original.call(this);
        };
      });
      await page.locator(".import-dashed").click();
      await page.locator('input[type="file"]').setInputFiles([
        {
          name: "海边新书.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("第一章 海风\n\n海风送来一封蓝色的信。"),
        },
        source,
        {
          name: "空白.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("\r\n\r\n"),
        },
        {
          name: "不支持.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4"),
        },
      ]);
      const dialog = page.getByRole("dialog");
      const importProgress = dialog.getByRole("progressbar", {
        name: "Import progress",
      });
      await expect(importProgress).toBeVisible();
      await expect(importProgress).toHaveAttribute("value", "0");
      await expect(importProgress).toHaveAttribute("max", "4");
      await expect(dialog).toContainText("海边新书.txt");
      await expect(
        dialog.getByRole("button", { name: "Close import", exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("combobox", { name: "Text encoding", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      for (const key of ["Tab", "Shift+Tab", "Control+f"]) {
        await page.keyboard.press(key);
        expect(
          await page.evaluate(() =>
            Boolean(document.activeElement?.closest('[role="dialog"]')),
          ),
          `${key} keeps focus inside the import dialog`,
        ).toBe(true);
      }
      await page.evaluate(() =>
        (
          window as unknown as { releaseImportRead: () => void }
        ).releaseImportRead(),
      );
      const results = dialog.getByRole("status", { name: "Import results" });
      await expect(results).toContainText(
        "1 imported · 1 already on shelf · 2 failed",
      );
      await expect(results).toContainText("空白.txt");
      await expect(results).toContainText("没有可阅读的文字");
      await expect(results.getByRole("listitem")).toHaveCount(2);
      await expect(
        results.getByRole("listitem").filter({ hasText: "不支持.pdf" }),
      ).toContainText("unsupported file type");
      await expect(
        dialog.getByRole("button", { name: "Retry failed files", exact: true }),
      ).toBeEnabled();
      await page.clock.fastForward(5_000);
      await expect(results).toBeVisible();
      await expect(results).toContainText("空白.txt");
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(
        page.getByRole("slider", { name: "Reading progress", exact: true }),
      ).toHaveValue("3");
      await page.locator(".reading-scroll").dispatchEvent("scroll");
      await expect(
        page.getByRole("slider", { name: "Reading progress", exact: true }),
      ).toHaveValue("3");
      await page.screenshot({
        path: testInfo.outputPath("import-results.png"),
        animations: "disabled",
      });
      await page.evaluate(() => window.readerNative!.setCompact(true));
      await expect(page.locator(".app")).toHaveClass(/is-compact/);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
          })),
        )
        .toEqual({ width: 360, height: 320 });
      await expect(
        dialog.getByRole("button", { name: "Retry failed files", exact: true }),
      ).toBeInViewport();
      await expect(
        dialog.getByRole("button", { name: "Continue reading", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath("import-results-compact.png"),
        animations: "disabled",
      });
      await dialog
        .getByRole("button", { name: "Continue reading", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await page.evaluate(() => window.readerNative!.setCompact(false));
      await expect(page.locator(".app")).not.toHaveClass(/is-compact/);
      await expect(
        page.getByRole("button", { name: "Remove 海边新书", exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Remove 雨后重读", exact: true }),
      ).toHaveCount(1);
    });

    await test.step("retries only a failed save after the transaction aborts", async () => {
      await page
        .getByRole("button", { name: "Desk view", exact: true })
        .click();
      await page.evaluate(() => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
          const request = original.call(this, value, ...args);
          if (this.name === "books" && value.fileName === "保存后重试.txt") {
            IDBObjectStore.prototype.put = original;
            request.addEventListener("success", () => this.transaction.abort());
          }
          return request;
        };
      });
      await page.locator(".import-dashed").click();
      await page.locator('input[type="file"]').setInputFiles([
        source,
        {
          name: "保存后重试.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("第一章 重试\n\n失败后，这本书仍能安心保存。"),
        },
      ]);
      const dialog = page.getByRole("dialog");
      const results = dialog.getByRole("status", { name: "Import results" });
      await expect(results).toContainText(
        "0 imported · 1 already on shelf · 1 failed",
      );
      await expect(results).toContainText("保存后重试.txt");
      await page.screenshot({
        path: testInfo.outputPath("import-results-desk.png"),
        animations: "disabled",
      });
      expect(
        (await savedBooks(page)).filter(
          (book) => book.fileName === "保存后重试.txt",
        ),
      ).toHaveLength(0);
      await dialog
        .getByRole("combobox", { name: "Text encoding", exact: true })
        .selectOption("utf-8");
      await dialog
        .getByRole("button", { name: "Retry failed files", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Remove 保存后重试", exact: true }),
      ).toHaveCount(1);
      await expect
        .poll(
          async () =>
            (await savedBooks(page)).filter(
              (book) => book.fileName === "保存后重试.txt",
            ).length,
        )
        .toBe(1);
      await page
        .getByRole("button", { name: "Reading view", exact: true })
        .click();
    });

    await test.step("replaces another dialog when importing by shortcut or drop", async () => {
      await page
        .getByRole("button", { name: "Keyboard shortcuts", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }),
      ).toBeVisible();
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+o" : "Control+o",
      );
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Close import", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Close import", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Remove 雨后重读", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Remove this book?", exact: true }),
      ).toBeVisible();
      await page.locator(".app").evaluate((element) => {
        const files = new DataTransfer();
        files.items.add(
          new File(["\r\n"], "drop-empty.txt", { type: "text/plain" }),
        );
        element.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: files }),
        );
      });
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(
        page.getByRole("status", { name: "Import results" }),
      ).toContainText("drop-empty.txt");
      await page
        .getByRole("button", { name: "Continue reading", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Remove 雨后重读", exact: true }),
      ).toHaveCount(1);
    });

    await test.step("retains successful imports and original reading state after restart", async () => {
      await expect
        .poll(async () => {
          const books = await savedBooks(page);
          const book = books.find((item) => item.fileName === source.name);
          return book && { position: book.position, bookmarks: book.bookmarks };
        })
        .toEqual({ position: 3, bookmarks: [3] });
      await application!.close();
      application = undefined;
      application = await launchReader(profile);
      page = await application.firstWindow();
      page.on("pageerror", (error) => errors.push(error.message));
      await expect(
        page.getByRole("button", { name: "Remove 保存后重试", exact: true }),
      ).toHaveCount(1);
      await expect(page.locator(".book-item")).toHaveCount(8);
      await page.locator(".book-item").filter({ hasText: "雨后重读" }).click();
      await expect(
        page.getByRole("slider", { name: "Reading progress", exact: true }),
      ).toHaveValue("3");
      await expect(page.locator('[data-paragraph="3"]')).toHaveClass(
        /has-bookmark/,
      );
      const imported = (await savedBooks(page)).filter((book) =>
        [source.name, "海边新书.txt", "保存后重试.txt"].includes(book.fileName),
      );
      expect(imported).toHaveLength(3);
    });

    expect(errors).toEqual([]);
  } finally {
    if (application) await application.close();
    await rm(profile, { recursive: true, force: true });
  }
});
