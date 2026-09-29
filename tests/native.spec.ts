import {
  test,
  expect,
  _electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

test("native reader keeps Chinese books private, compact, and persistent", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const profile = await mkdtemp(path.join(tmpdir(), "margin-native-test-"));
  let application: ElectronApplication | undefined;
  try {
    application = await launchReader(profile);
    const page = await application.firstWindow();
    await page
      .getByRole("button", { name: "Reading view", exact: true })
      .click();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await test.step("loads the production build with a Chinese sample and isolated preload", async () => {
      await expect(
        page.getByRole("heading", { name: "第一章 风从书页间经过" }),
      ).toBeVisible();
      await expect(page.locator(".novel-text")).toContainText(
        "下午三点，城里的雨停了",
      );
      await expect(
        page.getByRole("button", { name: "Minimize window", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Close app", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => ({
          native: window.readerNative?.isNative,
          platform: window.readerNative?.platform,
          hasRequire: "require" in window,
          hasProcess: "process" in window,
        })),
      ).toEqual({
        native: true,
        platform: process.platform,
        hasRequire: false,
        hasProcess: false,
      });
      const details = await application!.evaluate(
        ({ app, globalShortcut }) => ({
          userData: app.getPath("userData"),
          shortcut: globalShortcut.isRegistered("CommandOrControl+Shift+X"),
        }),
      );
      expect(details.userData).toBe(profile);
      // Other apps may own this system shortcut; the UI must report the real registration state.
      expect(
        (await page.evaluate(() => window.readerNative!.getState()))
          .hideShortcutAvailable,
      ).toBe(details.shortcut);
      await page.screenshot({
        path: testInfo.outputPath("desktop-reader.png"),
      });
    });

    await test.step("native resizing and main-process state reach the renderer", async () => {
      const initialBounds = await application!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBounds(),
      );
      await page
        .getByRole("button", { name: "Mini reader (M)", exact: true })
        .click();
      await expect(page.locator(".app")).toHaveClass(/is-compact/);
      await expect
        .poll(() =>
          application!.evaluate(({ BrowserWindow }) => {
            const { width, height } =
              BrowserWindow.getAllWindows()[0].getBounds();
            return { width, height };
          }),
        )
        .toEqual({ width: 360, height: 320 });
      await expect(
        page.getByRole("heading", { name: "第一章 风从书页间经过" }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("compact-reader.png"),
      });
      await page
        .getByRole("button", { name: "Expand reader (M)", exact: true })
        .click();
      await expect(page.locator(".app")).not.toHaveClass(/is-compact/);
      await expect
        .poll(() =>
          application!.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].getBounds(),
          ),
        )
        .toEqual(initialBounds);
      await page
        .getByRole("switch", { name: "Always on top", exact: true })
        .click();
      await expect(
        page.getByRole("switch", { name: "Always on top", exact: true }),
      ).toHaveAttribute("aria-checked", "true");
      expect(
        await application!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
        ),
      ).toBe(true);
      await page.evaluate(() => window.readerNative!.setOpacity(0.68));
      await expect(
        page.getByRole("slider", { name: "Window opacity", exact: true }),
      ).toHaveValue("68");
      if (process.platform === "darwin" || process.platform === "win32") {
        expect(
          await application!.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].getOpacity(),
          ),
        ).toBeCloseTo(0.68, 2);
      }
      await page.evaluate(() => window.readerNative!.setOpacity(1));
    });

    await test.step("Escape covers the story and restores it without losing notes", async () => {
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("textbox", { name: "Quick notes", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".novel-text")).toHaveCount(0);
      await expect(page).toHaveTitle("Quick notes");
      await page
        .getByRole("textbox", { name: "Quick notes", exact: true })
        .fill("周会记录：下一步计划");
      await expect(
        page.getByRole("textbox", { name: "Quick notes", exact: true }),
      ).toHaveValue("周会记录：下一步计划");
      await page.screenshot({ path: testInfo.outputPath("quick-cover.png") });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("heading", { name: "第一章 风从书页间经过" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("textbox", { name: "Quick notes", exact: true }),
      ).toHaveValue("周会记录：下一步计划");
      await page.getByRole("button", { name: "Return", exact: true }).click();
    });

    await test.step("hide and minimize can be restored through the native app", async () => {
      await page.evaluate(() => window.readerNative!.hide());
      expect(
        await application!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible(),
        ),
      ).toBe(false);
      await application!.evaluate(({ app }) => {
        app.emit("activate");
      });
      await expect
        .poll(() =>
          application!.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].isVisible(),
          ),
        )
        .toBe(true);
      await page
        .getByRole("button", { name: "Minimize window", exact: true })
        .click();
      await expect
        .poll(() =>
          application!.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].isMinimized(),
          ),
        )
        .toBe(true);
      await application!.evaluate(({ app }) => {
        app.emit("activate");
      });
      await expect
        .poll(() =>
          application!.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].isMinimized(),
          ),
        )
        .toBe(false);
    });

    await test.step("window preferences and local notes survive a real restart", async () => {
      await page.evaluate(async () => {
        await window.readerNative!.setOpacity(0.75);
        await window.readerNative!.setCompact(true);
      });
      await page
        .getByRole("button", { name: "Next chapter", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "第二章 河岸上的旧书店" }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Bookmark this paragraph (B)",
          exact: true,
        })
        .click();
      expect(errors).toEqual([]);
      // Quit immediately, while the renderer's debounced book save is still pending.
      await application!.close();
      application = undefined;
      const persisted = JSON.parse(
        await readFile(path.join(profile, "window-preferences.json"), "utf8"),
      );
      expect(persisted).toMatchObject({
        compact: true,
        alwaysOnTop: true,
        opacity: 0.75,
      });
      application = await launchReader(profile);
      const restoredPage = await application.firstWindow();
      await expect(
        restoredPage.getByRole("heading", { name: "第二章 河岸上的旧书店" }),
      ).toBeVisible();
      await expect(restoredPage.locator(".app")).toHaveClass(/is-compact/);
      await expect(
        restoredPage.getByRole("button", {
          name: "Bookmark this paragraph (B)",
          exact: true,
        }),
      ).toHaveClass(/active/);
      expect(
        await restoredPage.evaluate(() => window.readerNative!.getState()),
      ).toMatchObject({ compact: true, alwaysOnTop: true, opacity: 0.75 });
      await restoredPage.keyboard.press("Escape");
      await expect(
        restoredPage.getByRole("textbox", { name: "Quick notes", exact: true }),
      ).toHaveValue("周会记录：下一步计划");
    });
  } finally {
    if (application) await application.close();
    await rm(profile, { recursive: true, force: true });
  }
});
