// The screen-share source picker window: lists screens and windows and returns
// the one the user chose.

const { desktopCapturer, BrowserWindow, ipcMain } = require("electron");
const { resolveAppIconPath } = require("./app-icon.cjs");
const path = require("node:path");

const PICKER_CHANNEL = "decave:desktop-picker-result";

let pickerWindow = null;

let pendingPickerResolve = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function chooseDesktopSource(parentWindow) {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });

  if (!sources.length) return null;

  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.close();
  }

  return new Promise((resolve) => {
    pendingPickerResolve = resolve;

    pickerWindow = new BrowserWindow({
      parent: parentWindow ?? undefined,
      modal: Boolean(parentWindow),
      width: 900,
      height: 650,
      minWidth: 700,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#070b14",
      title: "Choose what to share · DeCave",
      icon: resolveAppIconPath(),
      webPreferences: {
        preload: path.join(__dirname, "picker-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });

    const cards = sources
      .map((source) => {
        const thumbnail = source.thumbnail?.isEmpty() ? "" : source.thumbnail.toDataURL();
        const kind = source.id.startsWith("screen:") ? "screen" : "window";

        return `
        <button class="source" data-kind="${kind}" data-id="${escapeHtml(source.id)}" type="button"${kind === "screen" ? "" : " hidden"}>
          <div class="thumb">
            ${thumbnail ? `<img src="${thumbnail}" alt="">` : `<div class="empty">No preview</div>`}
          </div>
          <div class="name" title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</div>
        </button>
      `;
      })
      .join("");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Choose what to share</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: #070b14; color: #eef4ff; font-family: Inter, Segoe UI, sans-serif; }
  body { padding: 22px; }
  .top { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:14px; }
  h1 { margin:0; font-size:22px; }
  p { margin:6px 0 0; color:#8e9bb2; font-size:13px; }
  .cancel { border:1px solid rgba(147,164,195,.24); border-radius:10px; padding:9px 14px; background:#11192a; color:#cbd6e8; font-weight:700; cursor:pointer; }
  .tabs { display:flex; gap:4px; border-bottom:1px solid rgba(147,164,195,.20); margin-bottom:16px; }
  .tab { padding:10px 18px; border:0; border-bottom:2px solid transparent; background:transparent; color:#9cabc3; font-weight:800; cursor:pointer; }
  .tab.active { color:#fff; border-bottom-color:#6fe4ff; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; }
  .source { min-width:0; padding:9px; border:1px solid rgba(105,126,169,.22); border-radius:13px; background:linear-gradient(180deg,#10182a,#0a1020); color:#eaf2ff; text-align:left; cursor:pointer; transition:.15s ease; }
  .source:hover, .source:focus-visible { outline:none; border-color:rgba(111,228,255,.52); transform:translateY(-1px); box-shadow:0 8px 30px rgba(0,0,0,.28),0 0 20px rgba(111,228,255,.08); }
  .thumb { aspect-ratio:16/9; overflow:hidden; border-radius:9px; background:#030710; display:grid; place-items:center; }
  .thumb img { width:100%; height:100%; object-fit:cover; display:block; }
  .empty { color:#5f6d84; font-size:12px; }
  .name { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding:9px 4px 2px; font-size:12px; font-weight:700; }
  .source[hidden] { display:none; }
</style>
</head>
<body>
  <div class="top">
    <div>
      <h1>Choose what to share</h1>
      <p>Select a screen or application window for DeCave screen sharing.</p>
    </div>
    <button id="cancel" class="cancel" type="button">Cancel</button>
  </div>
  <div class="tabs" role="tablist"><button class="tab active" data-filter="screen" type="button">Entire Screen</button><button class="tab" data-filter="window" type="button">Window</button></div>
  <div class="grid">${cards}</div>
<script>
  document.querySelectorAll(".source").forEach((button) => {
    button.addEventListener("click", () => window.decaveDesktopPicker.choose(button.dataset.id));
  });
  document.getElementById("cancel").addEventListener("click", () => window.decaveDesktopPicker.cancel());
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
      document.querySelectorAll(".source").forEach((source) => { source.hidden = source.dataset.kind !== tab.dataset.filter; });
    });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") window.decaveDesktopPicker.cancel();
  });
</script>
</body>
</html>`;

    pickerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    pickerWindow.once("ready-to-show", () => {
      if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.show();
    });

    pickerWindow.on("closed", () => {
      pickerWindow = null;
      if (pendingPickerResolve) {
        const finish = pendingPickerResolve;
        pendingPickerResolve = null;
        finish(null);
      }
    });
  }).then((sourceId) => {
    if (!sourceId) return null;
    return sources.find((source) => source.id === sourceId) ?? null;
  });
}

ipcMain.on(PICKER_CHANNEL, (event, sourceId) => {
  if (
    !pendingPickerResolve ||
    !pickerWindow ||
    pickerWindow.isDestroyed() ||
    event.sender !== pickerWindow.webContents
  ) {
    return;
  }
  const finish = pendingPickerResolve;
  pendingPickerResolve = null;

  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.close();
  }

  finish(typeof sourceId === "string" && sourceId ? sourceId : null);
});

module.exports = { chooseDesktopSource };
