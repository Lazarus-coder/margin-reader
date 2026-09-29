const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { deflateSync } = require("node:zlib");

app.setName("Margin");

// Integration tests use a disposable profile without touching anyone's books.
if (process.env.NODE_ENV === "test" && process.env.MARGIN_TEST_USER_DATA) {
  const testProfile = path.resolve(process.env.MARGIN_TEST_USER_DATA);
  fs.mkdirSync(testProfile, { recursive: true });
  app.setPath("userData", testProfile);
}

const HIDE_SHORTCUT = "CommandOrControl+Shift+X";
const MIN_WIDTH = 300;
const MIN_HEIGHT = 240;
const isMac = process.platform === "darwin";
const devURL =
  !app.isPackaged && process.env.MARGIN_DEV_URL === "http://127.0.0.1:5173"
    ? process.env.MARGIN_DEV_URL
    : null;
const appURL =
  devURL || pathToFileURL(path.join(__dirname, "../dist/index.html")).href;

let window;
let tray;
let saveTimer;
let shutdownTimer;
let shutdownRequested = false;
let shutdownAllowed = false;
let preferencesPath;
let preferences = {
  compact: false,
  alwaysOnTop: false,
  opacity: 1,
  hideDock: false,
};
let hideShortcutAvailable = false;
let dockVisibilityChange = Promise.resolve();
let lastDockHideAt = 0;

function state() {
  return {
    compact: preferences.compact,
    alwaysOnTop: preferences.alwaysOnTop,
    opacity: preferences.opacity,
    hideDock: preferences.hideDock,
    hideShortcutAvailable,
  };
}

function validBounds(value) {
  return (
    value &&
    ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key]))
  );
}

// Saved windows also remain reachable after unplugging an external monitor.
function visibleBounds(bounds, defaultWidth = 1140, defaultHeight = 800) {
  const area = validBounds(bounds)
    ? screen.getDisplayMatching(bounds).workArea
    : screen.getPrimaryDisplay().workArea;
  const width = Math.min(
    Math.max(MIN_WIDTH, Math.round(bounds?.width || defaultWidth)),
    area.width,
  );
  const height = Math.min(
    Math.max(MIN_HEIGHT, Math.round(bounds?.height || defaultHeight)),
    area.height,
  );
  const x = validBounds(bounds)
    ? Math.round(bounds.x)
    : area.x + Math.round((area.width - width) / 2);
  const y = validBounds(bounds)
    ? Math.round(bounds.y)
    : area.y + Math.round((area.height - height) / 2);
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - height)),
    width,
    height,
  };
}

function loadPreferences() {
  preferencesPath = path.join(
    app.getPath("userData"),
    "window-preferences.json",
  );
  try {
    const saved = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
    preferences = {
      compact: saved.compact === true,
      alwaysOnTop: saved.alwaysOnTop === true,
      hideDock: isMac && saved.hideDock === true,
      opacity: Number.isFinite(saved.opacity)
        ? Math.max(0.35, Math.min(1, saved.opacity))
        : 1,
      normalBounds: validBounds(saved.normalBounds)
        ? saved.normalBounds
        : undefined,
      compactBounds: validBounds(saved.compactBounds)
        ? saved.compactBounds
        : undefined,
    };
  } catch {
    // Missing or damaged preferences should never prevent reading a book.
  }
}

function savePreferences() {
  clearTimeout(saveTimer);
  if (!preferencesPath) return;
  try {
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    const temporaryPath = `${preferencesPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(preferences, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, preferencesPath);
  } catch (error) {
    console.warn("Could not save window preferences:", error.message);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePreferences, 180);
}

function rememberBounds() {
  if (
    !window ||
    window.isDestroyed() ||
    window.isMaximized() ||
    window.isMinimized()
  )
    return;
  preferences[preferences.compact ? "compactBounds" : "normalBounds"] =
    window.getBounds();
  scheduleSave();
}

function finishShutdown() {
  if (shutdownAllowed) return;
  shutdownAllowed = true;
  clearTimeout(shutdownTimer);
  rememberBounds();
  savePreferences();
  app.quit();
}

function requestShutdown(event) {
  if (
    shutdownAllowed ||
    !window ||
    window.isDestroyed() ||
    window.webContents.isDestroyed()
  ) {
    savePreferences();
    return;
  }
  event.preventDefault();
  if (shutdownRequested) return;
  shutdownRequested = true;
  // IndexedDB commits in the renderer must finish before its process is destroyed.
  shutdownTimer = setTimeout(finishShutdown, 3_000);
  window.webContents.send("reader:before-close");
}

function showReader() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.setBounds(visibleBounds(window.getBounds()));
  window.show();
  window.focus();
}

function toggleVisibility() {
  if (!window || window.isDestroyed()) return;
  if (window.isVisible() && !window.isMinimized()) window.hide();
  else showReader();
}

function broadcastState() {
  if (window && !window.isDestroyed())
    window.webContents.send("reader:state", state());
  updateTrayMenu();
  scheduleSave();
}

function setCompact(compact) {
  if (typeof compact !== "boolean")
    throw new TypeError("Compact mode must be a boolean.");
  if (preferences.compact === compact) return;
  rememberBounds();
  const currentBounds = window.getBounds();
  preferences.compact = compact;
  if (window.isMaximized()) window.unmaximize();
  const target = compact
    ? preferences.compactBounds || { ...currentBounds, width: 360, height: 320 }
    : preferences.normalBounds;
  window.setBounds(
    visibleBounds(target, compact ? 360 : 1140, compact ? 320 : 800),
  );
  rememberBounds();
  broadcastState();
}

function setAlwaysOnTop(alwaysOnTop) {
  if (typeof alwaysOnTop !== "boolean")
    throw new TypeError("Always on top must be a boolean.");
  preferences.alwaysOnTop = alwaysOnTop;
  window.setAlwaysOnTop(alwaysOnTop);
  broadcastState();
}

function setOpacity(opacity) {
  if (!Number.isFinite(opacity))
    throw new TypeError("Opacity must be a finite number.");
  preferences.opacity = Math.max(0.35, Math.min(1, opacity));
  window.setOpacity(preferences.opacity);
  broadcastState();
}

function setHideDock(hideDock) {
  if (typeof hideDock !== "boolean")
    throw new TypeError("Hide Dock icon must be a boolean.");
  // Dock changes are asynchronous on macOS; preserve the order of quick toggles.
  const change = dockVisibilityChange
    .catch(() => {})
    .then(async () => {
      // Keep a visible recovery entry even when the shortcut cannot be registered.
      const nextHideDock = Boolean(
        isMac && hideDock && tray && !tray.isDestroyed(),
      );
      if (isMac) {
        if (nextHideDock) {
          // Electron documents that repeated hides within one second can be ignored.
          // Verify the OS state before reporting success and allow one spaced retry.
          for (
            let attempt = 0;
            attempt < 2 && app.dock.isVisible();
            attempt += 1
          ) {
            const delay = Math.max(0, lastDockHideAt + 1100 - Date.now());
            if (delay)
              await new Promise((resolve) => setTimeout(resolve, delay));
            lastDockHideAt = Date.now();
            app.dock.hide();
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        } else if (!app.dock.isVisible()) {
          await app.dock.show();
        }
        preferences.hideDock = !app.dock.isVisible();
      } else {
        preferences.hideDock = false;
      }
      broadcastState();
      if (preferences.hideDock !== nextHideDock)
        throw new Error(
          "macOS could not change Dock visibility. Please try again.",
        );
    });
  dockVisibilityChange = change;
  return change;
}

// A tiny local PNG keeps the tray independent of downloaded assets or icon packages.
function trayIcon() {
  const size = 36;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const border =
        ((x === 7 || x === 8 || x === 27 || x === 28) && y >= 7 && y <= 28) ||
        ((y === 7 || y === 8 || y === 27 || y === 28) && x >= 7 && x <= 28);
      const spine = (x === 12 || x === 13) && y >= 7 && y <= 28;
      const textLine =
        (y === 13 ||
          y === 14 ||
          y === 18 ||
          y === 19 ||
          y === 23 ||
          y === 24) &&
        x >= 17 &&
        x <= 24;
      if (border || spine || textLine) {
        const index = y * (size * 4 + 1) + 1 + x * 4;
        pixels[index] = 45;
        pixels[index + 1] = 54;
        pixels[index + 2] = 47;
        pixels[index + 3] = 255;
      }
    }
  }
  function chunk(type, data) {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, payload, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const icon = nativeImage
    .createFromBuffer(png)
    .resize({ width: 18, height: 18 });
  icon.setTemplateImage(isMac);
  return icon;
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Margin · 余白", click: showReader },
      { label: "Hide reader", click: () => window?.hide() },
      { type: "separator" },
      {
        label: "Compact mode",
        type: "checkbox",
        checked: preferences.compact,
        click: (item) => setCompact(item.checked),
      },
      {
        label: "Always on top",
        type: "checkbox",
        checked: preferences.alwaysOnTop,
        click: (item) => setAlwaysOnTop(item.checked),
      },
      ...(isMac
        ? [
            {
              label: "Hide Dock icon",
              type: "checkbox",
              checked: preferences.hideDock,
              click: (item) => {
                void setHideDock(item.checked).catch((error) => {
                  console.warn(
                    "Could not change Dock visibility:",
                    error.message,
                  );
                });
              },
            },
          ]
        : []),
      { type: "separator" },
      { label: "Quit Margin", click: () => app.quit() },
    ]),
  );
}

function createTray() {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip("Margin — local workspace");
    tray.on("double-click", showReader);
    updateTrayMenu();
  } catch (error) {
    if (tray && !tray.isDestroyed()) tray.destroy();
    tray = undefined;
    console.warn("Tray is unavailable:", error.message);
  }
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac
        ? [
            {
              label: "Margin",
              submenu: [
                { role: "about" },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ]
        : []),
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          {
            label: "Toggle compact mode",
            accelerator: "CommandOrControl+Shift+M",
            click: () => setCompact(!preferences.compact),
          },
          ...(devURL
            ? [
                { type: "separator" },
                { role: "reload" },
                { role: "toggleDevTools" },
              ]
            : []),
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { label: "Show reader", click: showReader },
          ...(!isMac ? [{ type: "separator" }, { role: "quit" }] : []),
        ],
      },
    ]),
  );
}

function installIPC() {
  const handlers = {
    "reader:get-state": () => state(),
    "reader:set-compact": (_, value) => setCompact(value),
    "reader:set-always-on-top": (_, value) => setAlwaysOnTop(value),
    "reader:set-opacity": (_, value) => setOpacity(value),
    "reader:set-hide-dock": (_, value) => setHideDock(value),
    "reader:hide": () => window.hide(),
    "reader:minimize": () => window.minimize(),
    "reader:close": () => {
      setImmediate(() => app.quit());
    },
    "reader:ready-to-close": () => {
      if (shutdownRequested) setImmediate(finishShutdown);
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      ) {
        throw new Error("Untrusted window.");
      }
      return handler(event, ...args);
    });
  }
}

function createWindow() {
  const bounds = preferences.compact
    ? visibleBounds(preferences.compactBounds, 360, 320)
    : visibleBounds(preferences.normalBounds);
  window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: "Workspace",
    icon: path.join(__dirname, "../assets/icon.png"),
    frame: false,
    show: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#f4f3ee",
    alwaysOnTop: preferences.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      devTools: Boolean(devURL),
    },
  });
  window.setOpacity(preferences.opacity);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.session.setPermissionRequestHandler((_, __, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, callback) => {
      const allowed =
        devURL &&
        new URL(details.url).origin ===
          devURL.replace("http:", new URL(details.url).protocol);
      callback({ cancel: !allowed });
    },
  );
  window.once("ready-to-show", () => window.show());
  window.webContents.on("did-finish-load", broadcastState);
  window.on("move", rememberBounds);
  window.on("resize", rememberBounds);
  window.on("close", requestShutdown);
  window.on("closed", () => {
    window = undefined;
  });
  window.loadURL(appURL).catch((error) => {
    console.error("Could not load Margin:", error.message);
    app.quit();
  });
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on("second-instance", showReader);
  app
    .whenReady()
    .then(async () => {
      app.setAboutPanelOptions({
        applicationName: "Margin · 余白",
        applicationVersion: app.getVersion(),
        copyright: "A little room to read.",
      });
      loadPreferences();
      installIPC();
      createWindow();
      createMenu();
      createTray();
      await setHideDock(preferences.hideDock);
      hideShortcutAvailable = globalShortcut.register(
        HIDE_SHORTCUT,
        toggleVisibility,
      );
      broadcastState();
      app.on("activate", showReader);
      screen.on("display-removed", () => {
        if (window && !window.isDestroyed())
          window.setBounds(visibleBounds(window.getBounds()));
      });
    })
    .catch((error) => {
      console.error("Could not start Margin:", error);
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", requestShutdown);
  app.on("will-quit", () => {
    clearTimeout(shutdownTimer);
    globalShortcut.unregisterAll();
    if (tray && !tray.isDestroyed()) tray.destroy();
  });
}
