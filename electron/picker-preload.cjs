const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("decaveDesktopPicker", {
  choose(sourceId) {
    ipcRenderer.send("decave:desktop-picker-result", String(sourceId || ""));
  },
  cancel() {
    ipcRenderer.send("decave:desktop-picker-result", "");
  },
});
