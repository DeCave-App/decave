// Procedural SVG art for the screenshot fixture: profile pictures, Hub logos and
// Hub banners. Everything is generated here so no third-party images are used.

const esc = (value) => String(value).replace(/[<>&"]/g, "");

function hashOf(text) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

const skins = ["#f2c7a5", "#e0a77f", "#c68642", "#8d5524", "#f6d7c3", "#a86b4a"];
const hairs = ["#1d1a2b", "#3b2417", "#7a4a26", "#d9a441", "#e8e3f0", "#6b2fd6", "#1f7ae0", "#d6336c"];

// A stylized gamer bust: gradient background, shoulders, head, hair and a headset.
export function avatarSvg(seed, accent = "#7c5cff") {
  const h = hashOf(seed);
  const skin = skins[h % skins.length];
  const hair = hairs[(h >> 3) % hairs.length];
  const shirt = ["#26304f", "#1b2a3d", "#3a1f4f", "#173b3a", "#40261a"][(h >> 6) % 5];
  const style = (h >> 9) % 4;
  const headset = (h >> 11) % 3 !== 0;
  const hairPath = [
    "M38 50c0-18 12-28 26-28s26 10 26 28c-4-8-12-13-26-13s-22 5-26 13z",
    "M36 56c-2-22 10-34 28-34s30 12 28 34c-3-10-6-15-9-17-6 4-30 4-38 0-3 2-6 7-9 17z",
    "M37 52c0-20 12-30 27-30 16 0 27 11 27 30l-6-10-8 6-6-9-8 7-7-8-8 7-5-6z",
    "M40 46c4-16 14-24 24-24 13 0 23 9 25 24-8-6-15-7-25-7s-17 1-24 7zM84 44c6 6 8 18 6 30l-6-4z",
  ][style];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${esc(accent)}"/><stop offset="1" stop-color="#0b1020"/></linearGradient></defs>
  <rect width="128" height="128" fill="url(#g)"/>
  <circle cx="104" cy="22" r="30" fill="#fff" opacity="0.07"/>
  <path d="M22 128c2-26 18-40 42-40s40 14 42 40z" fill="${shirt}"/>
  <path d="M54 82h20v12c-3 4-17 4-20 0z" fill="${skin}" opacity="0.9"/>
  <ellipse cx="64" cy="58" rx="22" ry="25" fill="${skin}"/>
  <path d="${hairPath}" fill="${hair}"/>
  <circle cx="56" cy="60" r="2.6" fill="#1b1b2a"/><circle cx="72" cy="60" r="2.6" fill="#1b1b2a"/>
  <path d="M58 71c4 3 8 3 12 0" stroke="#7a3b2e" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  ${
    headset
      ? `<path d="M38 60c0-20 12-32 26-32s26 12 26 32" stroke="#0e1222" stroke-width="5" fill="none"/>
  <rect x="33" y="54" width="10" height="16" rx="4" fill="${esc(accent)}"/><rect x="85" y="54" width="10" height="16" rx="4" fill="${esc(accent)}"/>
  <path d="M38 68c2 10 8 14 16 14" stroke="#0e1222" stroke-width="3" fill="none"/>`
      : ""
  }
</svg>`;
}

const emblems = {
  moon: (c) =>
    `<path d="M72 28a34 34 0 1 0 28 54A28 28 0 1 1 72 28z" fill="${c}"/><circle cx="88" cy="40" r="4" fill="#fff"/><circle cx="98" cy="58" r="2.5" fill="#fff" opacity="0.8"/>`,
  code: (c) =>
    `<path d="M50 40 26 64l24 24M78 40l24 24-24 24" stroke="${c}" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M70 34 58 94" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity="0.85"/>`,
  bolt: (c) =>
    `<path d="M70 22 38 70h22l-6 36 36-50H66z" fill="${c}"/><circle cx="64" cy="64" r="40" stroke="#fff" stroke-width="4" fill="none" opacity="0.25"/>`,
  cave: (c) =>
    `<path d="M24 98c6-34 22-58 40-58s34 24 40 58z" fill="${c}"/><path d="M50 98c2-16 7-26 14-26s12 10 14 26z" fill="#0b1020"/><circle cx="64" cy="30" r="6" fill="#fff"/>`,
};

export function hubIconSvg(kind, from, to) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${esc(from)}"/><stop offset="1" stop-color="${esc(to)}"/></linearGradient></defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  ${emblems[kind]("#ffffff")}
</svg>`;
}

// A wide banner: gradient sky, stars, glow and layered ridges.
export function hubBannerSvg(seed, from, to) {
  const h = hashOf(seed);
  const stars = Array.from({ length: 40 }, (_, i) => {
    const x = (Math.imul(h ^ (i * 2654435761), 1597334677) >>> 0) % 1200;
    const y = (Math.imul(h + i * 40503, 2246822519) >>> 0) % 180;
    const r = 0.6 + ((h >> (i % 16)) & 3) * 0.4;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.35 + (i % 5) * 0.12}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${esc(from)}"/><stop offset="1" stop-color="${esc(to)}"/></linearGradient>
    <radialGradient id="glow" cx="0.7" cy="0.35" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="400" fill="url(#sky)"/>
  <rect width="1200" height="400" fill="url(#glow)"/>
  ${stars}
  <path d="M0 300 140 210l120 70 160-130 170 120 140-90 170 110 120-70 180 100v80H0z" fill="#0b1020" opacity="0.45"/>
  <path d="M0 340 180 260l150 60 170-90 160 100 170-70 170 80 200-60v180H0z" fill="#0b1020" opacity="0.8"/>
</svg>`;
}
