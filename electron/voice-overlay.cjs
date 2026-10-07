// In-game voice overlay, design A "pill stack": a small tag per person in the
// top-left corner with their avatar and name; the person talking gets a green
// outline, muted and deafened people get an icon. Settings → System → Overlay
// size scales the whole thing (OVERLAY_SCALE_MIN–MAX percent).
//
// The page is static and loaded from a data: URL in an isolated, no-network
// partition; names and avatars arrive through decaveRender() and are written
// with textContent / img.src only.

const OVERLAY_SCALE_MIN = 60;
const OVERLAY_SCALE_MAX = 150;
const OVERLAY_SCALE_DEFAULT = 100;

// Base sizes at 100%, in CSS px. Kept in sync with the CSS below.
const BASE = { padding: 6, header: 16, row: 28, gap: 5, width: 230, inset: 16 };

function clampOverlayScale(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return OVERLAY_SCALE_DEFAULT;
  return Math.max(OVERLAY_SCALE_MIN, Math.min(OVERLAY_SCALE_MAX, number));
}

/** Window bounds for `count` people at `scalePercent`, in the top-left of `workArea`. */
function overlayBounds(workArea, count, scalePercent) {
  const s = clampOverlayScale(scalePercent) / 100;
  const rows = Math.max(1, Math.min(12, count));
  const height =
    Math.ceil((BASE.padding * 2 + BASE.header + BASE.gap + rows * BASE.row + (rows - 1) * BASE.gap) * s) + 4;
  const width = Math.ceil(BASE.width * s) + 4;
  return {
    x: workArea.x + Math.round(BASE.inset * s),
    y: workArea.y + Math.round(BASE.inset * s),
    width: Math.min(width, workArea.width),
    height: Math.min(height, workArea.height),
  };
}

function overlayHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
:root{--s:1;--accent:#3ddc97}
html,body{margin:0;background:transparent;overflow:hidden;color:#f2f5fa;font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif}
#root{display:flex;flex-direction:column;align-items:flex-start;gap:calc(5px*var(--s));padding:calc(6px*var(--s))}
.head{display:flex;align-items:center;gap:calc(5px*var(--s));height:calc(16px*var(--s));max-width:calc(218px*var(--s));padding:0 calc(3px*var(--s));font-size:calc(10px*var(--s));font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(242,245,250,.8);text-shadow:0 1px 3px rgba(0,0,0,.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dot{width:calc(6px*var(--s));height:calc(6px*var(--s));flex:0 0 auto;border-radius:50%;background:var(--accent)}
.pill{display:flex;align-items:center;gap:calc(7px*var(--s));height:calc(28px*var(--s));max-width:calc(218px*var(--s));box-sizing:border-box;padding:0 calc(10px*var(--s)) 0 calc(3px*var(--s));border-radius:999px;background:rgba(8,11,17,.72);border:1px solid rgba(255,255,255,.12);box-shadow:0 4px 14px rgba(0,0,0,.3)}
.pill.speaking{border-color:var(--accent);box-shadow:0 0 0 calc(2px*var(--s)) rgba(61,220,151,.22),0 4px 14px rgba(0,0,0,.35)}
.pill.deafened{opacity:.62}
.av{width:calc(22px*var(--s));height:calc(22px*var(--s));flex:0 0 auto;border-radius:50%;display:grid;place-items:center;overflow:hidden;font-size:calc(10px*var(--s));font-weight:700;color:#fff}
.pill.speaking .av{box-shadow:0 0 0 calc(2px*var(--s)) var(--accent)}
.av img{width:100%;height:100%;object-fit:cover}
.name{min-width:0;font-size:calc(12px*var(--s));font-weight:600;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ico{width:calc(13px*var(--s));height:calc(13px*var(--s));flex:0 0 auto;stroke:#ff8a8a;fill:none;stroke-width:2;stroke-linecap:round}
</style>
</head>
<body><div id="root"></div>
<script>
const COLORS=['#7c6cff','#2f9e8f','#e85d75','#d08a2e','#3b82c4','#9b5de5','#c2410c','#0f9d58'];
const MUTED='<path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11 5.7M12 18v3M4 4l16 16"/>';
const DEAF='<path d="M4 15v-3a8 8 0 0 1 13.7-5.6M20 12v3"/><rect x="3.5" y="14" width="4.5" height="6" rx="1.5"/><path d="M16 14h3a1.5 1.5 0 0 1 1.5 1.5V18M3 3l18 18"/>';
function color(name){let h=0;for(const c of String(name||''))h=(h*31+c.charCodeAt(0))>>>0;return COLORS[h%COLORS.length]}
function icon(paths,label){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','ico');svg.setAttribute('aria-label',label);svg.innerHTML=paths;return svg}
window.decaveRender=function(state){
  const scale=Math.max(0.6,Math.min(1.5,Number(state&&state.scale)||1));
  document.documentElement.style.setProperty('--s',String(scale));
  const root=document.getElementById('root');root.textContent='';
  const rows=Array.isArray(state&&state.participants)?state.participants:[];
  const head=document.createElement('div');head.className='head';
  const dot=document.createElement('span');dot.className='dot';
  const label=document.createElement('span');label.textContent=(state&&state.roomName?state.roomName:'Voice')+' \\u00b7 '+rows.length;
  head.append(dot,label);root.appendChild(head);
  for(const p of rows){
    const row=document.createElement('div');row.className='pill'+(p.speaking?' speaking':'')+(p.deafened?' deafened':'');
    const av=document.createElement('div');av.className='av';av.style.background=color(p.username);
    if(p.avatarUrl){const img=document.createElement('img');img.src=p.avatarUrl;img.alt='';av.appendChild(img)}
    else av.textContent=(p.username||'?').slice(0,1).toUpperCase();
    const name=document.createElement('div');name.className='name';name.textContent=p.username||'Unknown';
    row.append(av,name);
    if(p.deafened)row.appendChild(icon(DEAF,'Deafened'));
    else if(p.muted)row.appendChild(icon(MUTED,'Muted'));
    root.appendChild(row);
  }
};
</script></body></html>`;
}

module.exports = {
  OVERLAY_SCALE_MIN,
  OVERLAY_SCALE_MAX,
  OVERLAY_SCALE_DEFAULT,
  clampOverlayScale,
  overlayBounds,
  overlayHtml,
};
