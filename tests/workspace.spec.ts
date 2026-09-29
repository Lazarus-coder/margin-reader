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

test("Desk view keeps Chinese text readable and its cover controls persistent", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(path.join(tmpdir(), "margin-workspace-test-"));
  let application: ElectronApplication | undefined;
  try {
    application = await launchReader(profile);
    let page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const paragraphs = [
      "第一章 雨后",
      ...Array.from(
        { length: 20 },
        (_, index) =>
          `第${index + 1}段：午后的雨停了，林舟走过河边的旧书店，翻开那些写着遥远故事的书页。`,
      ),
    ];

    await test.step("opens as a neutral workspace and imports all Chinese lines", async () => {
      await expect(page.locator(".app")).toHaveClass(/is-workspace/);
      await expect(page).toHaveTitle("notes.txt — Workspace");
      await expect(page.locator(".titlebar")).toContainText("Workspace");
      await expect(page.locator(".workspace-tab-name")).toHaveText("notes.txt");
      await expect(page.locator(".document-meta")).toBeVisible();
      await expect(
        page.getByRole("switch", {
          name: "Cover on pointer leave",
          exact: true,
        }),
      ).toHaveAttribute("aria-checked", "false");
      await page.locator('input[type="file"]').setInputFiles({
        name: "雨后小说.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(paragraphs.join("\n\n"), "utf8"),
      });
      await expect(page.locator(".novel-text .line-content")).toHaveText(
        paragraphs,
      );
      await expect(page.locator(".novel-text .line-number")).toHaveCount(
        paragraphs.length,
      );
      await expect(page.locator(".titlebar")).not.toContainText("雨后小说");
      await expect(page.locator(".workspace-tab-name")).toHaveText("notes.txt");
      await expect(page).toHaveTitle("notes.txt — Workspace");
      await expect(page.locator(".toast")).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath("desk-workspace.png"),
      });
    });

    await test.step("changes layouts without moving the selected paragraph", async () => {
      const progress = page.getByRole("slider", {
        name: "Reading progress",
        exact: true,
      });
      await progress.focus();
      await page.keyboard.press("Home");
      for (let index = 0; index < 6; index++)
        await page.keyboard.press("ArrowRight");
      await expect(progress).toHaveValue("6");
      await page
        .getByRole("button", { name: "Reading view", exact: true })
        .click();
      await expect(page.locator(".app")).not.toHaveClass(/is-workspace/);
      await expect(progress).toHaveValue("6");
      await expect(page.locator('[data-paragraph="6"]')).toBeVisible();
      await page
        .getByRole("button", { name: "Desk view", exact: true })
        .click();
      await expect(page.locator(".app")).toHaveClass(/is-workspace/);
      await expect(progress).toHaveValue("6");
      await expect(
        page.locator('[data-paragraph="6"] .line-content'),
      ).toHaveText(paragraphs[6]);
      await expect(page.locator('[data-paragraph="6"]')).toBeVisible();
    });

    await test.step("fits in a compact native window with the same neutral chrome", async () => {
      await page.keyboard.press("m");
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
      await expect(page.locator(".novel-text")).toBeVisible();
      await expect(page.locator(".titlebar")).not.toContainText("雨后小说");
      await expect(
        page.getByRole("slider", { name: "Reading progress", exact: true }),
      ).toHaveValue("6");
      await page.screenshot({ path: testInfo.outputPath("desk-compact.png") });
      await page.keyboard.press("m");
      await expect(page.locator(".app")).not.toHaveClass(/is-compact/);
      await expect(
        page.getByRole("slider", { name: "Reading progress", exact: true }),
      ).toHaveValue("6");
    });

    await test.step("pointer leave covers the text until an explicit return", async () => {
      const pointerCover = page.getByRole("switch", {
        name: "Cover on pointer leave",
        exact: true,
      });
      await pointerCover.click();
      await expect(pointerCover).toHaveAttribute("aria-checked", "true");
      // React synthesizes onMouseLeave from the bubbling mouseout event.
      await page
        .locator(".app")
        .dispatchEvent("mouseout", { relatedTarget: null });
      const notes = page.getByRole("textbox", {
        name: "Quick notes",
        exact: true,
      });
      await expect(notes).toBeVisible();
      await expect(page.locator(".novel-text")).toHaveCount(0);
      await notes.fill("下周计划：整理项目文档");
      await page
        .locator(".app")
        .dispatchEvent("mouseover", { relatedTarget: null });
      await expect(notes).toBeVisible();
      await expect(page.locator(".novel-text")).toHaveCount(0);
      await page.getByRole("button", { name: "Return", exact: true }).click();
      await expect(page.locator(".novel-text")).toBeVisible();
      await expect(
        page.getByRole("slider", { name: "Reading progress", exact: true }),
      ).toHaveValue("6");
      await page
        .getByRole("button", { name: "Reading view", exact: true })
        .click();
      await page.reload();
      await expect(page.locator(".app")).not.toHaveClass(/is-workspace/);
      await expect(pointerCover).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await expect(notes).toHaveValue("下周计划：整理项目文档");
      await page.keyboard.press("Escape");
      await pointerCover.click();
      await page
        .getByRole("button", { name: "Desk view", exact: true })
        .click();
    });

    await test.step("upgrades old preferences without changing the imported book", async () => {
      // Existing profiles have neither view nor pointer-cover preferences.
      await page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem("margin-preferences") || "{}",
        );
        delete saved.workspaceMode;
        delete saved.deskFontSize;
        delete saved.deskLineHeight;
        delete saved.coverOnLeave;
        saved.fontSize = 21;
        saved.lineHeight = 2.5;
        localStorage.setItem("margin-preferences", JSON.stringify(saved));
      });
      await page.reload();
      await expect(page.locator(".app")).toHaveClass(/is-workspace/);
      await expect(page.locator(".novel-text .line-content")).toHaveText(
        paragraphs,
      );
      await expect(
        page.getByRole("slider", { name: "Reading progress", exact: true }),
      ).toHaveValue("6");
      await page
        .getByRole("button", { name: "Reading view", exact: true })
        .click();
      await expect(page.locator(".app")).toHaveCSS("--reading-size", "21px");
      await expect(page.locator(".app")).toHaveCSS("--reading-line", "2.5");
      await page
        .getByRole("button", { name: "Desk view", exact: true })
        .click();
    });

    if (process.platform === "darwin") {
      await test.step("can hide and restore the Dock icon, including after restart", async () => {
        const hideDock = page.getByRole("switch", {
          name: "Hide Dock icon",
          exact: true,
        });
        await expect(hideDock).toHaveAttribute("aria-checked", "false");
        await hideDock.click();
        await expect(hideDock).toHaveAttribute("aria-checked", "true");
        await expect
          .poll(() => application!.evaluate(({ app }) => app.dock!.isVisible()))
          .toBe(false);
        expect(
          await page.evaluate(() => window.readerNative!.getState()),
        ).toMatchObject({ hideDock: true });
        await application!.close();
        application = undefined;
        application = await launchReader(profile);
        page = await application.firstWindow();
        page.on("pageerror", (error) => errors.push(error.message));
        await expect(page.locator(".app")).toHaveClass(/is-workspace/);
        await expect(
          page.getByRole("switch", { name: "Hide Dock icon", exact: true }),
        ).toHaveAttribute("aria-checked", "true");
        await expect
          .poll(() => application!.evaluate(({ app }) => app.dock!.isVisible()))
          .toBe(false);
        await expect(page.locator(".novel-text .line-content")).toHaveText(
          paragraphs,
        );
        await page
          .getByRole("switch", { name: "Hide Dock icon", exact: true })
          .click();
        await expect
          .poll(() => application!.evaluate(({ app }) => app.dock!.isVisible()))
          .toBe(true);
        expect(
          await page.evaluate(() => window.readerNative!.getState()),
        ).toMatchObject({ hideDock: false });
      });
    }

    expect(errors).toEqual([]);
  } finally {
    if (application) await application.close();
    await rm(profile, { recursive: true, force: true });
  }
});
