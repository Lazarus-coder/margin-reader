const { contextBridge, ipcRenderer } = require("electron");

const beforeCloseCallbacks = new Set();
ipcRenderer.on("reader:before-close", async () => {
  await Promise.allSettled(
    Array.from(beforeCloseCallbacks, (callback) =>
      Promise.resolve().then(callback),
    ),
  );
  await ipcRenderer.invoke("reader:ready-to-close");
});

contextBridge.exposeInMainWorld(
  "readerNative",
  Object.freeze({
    isNative: true,
    platform: process.platform,
    setCompact: (compact) => ipcRenderer.invoke("reader:set-compact", compact),
    setAlwaysOnTop: (alwaysOnTop) =>
      ipcRenderer.invoke("reader:set-always-on-top", alwaysOnTop),
    setOpacity: (opacity) => ipcRenderer.invoke("reader:set-opacity", opacity),
    setHideDock: (hideDock) =>
      ipcRenderer.invoke("reader:set-hide-dock", hideDock),
    hide: () => ipcRenderer.invoke("reader:hide"),
    minimize: () => ipcRenderer.invoke("reader:minimize"),
    close: () => ipcRenderer.invoke("reader:close"),
    getState: () => ipcRenderer.invoke("reader:get-state"),
    onState: (callback) => {
      if (typeof callback !== "function")
        throw new TypeError("A state callback is required.");
      // Never expose Electron's event object to the renderer.
      const listener = (_, value) => callback(value);
      ipcRenderer.on("reader:state", listener);
      return () => ipcRenderer.removeListener("reader:state", listener);
    },
    onBeforeClose: (callback) => {
      if (typeof callback !== "function")
        throw new TypeError("A shutdown callback is required.");
      beforeCloseCallbacks.add(callback);
      return () => beforeCloseCallbacks.delete(callback);
    },
  }),
);
