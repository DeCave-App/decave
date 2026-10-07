// Official brand logos from Simple Icons (CC0, bundled locally — the desktop app blocks favicon requests).
import {
  siReddit,
  siSpotify,
  siNetflix,
  siSteam,
  siDiscord,
  siX,
  siGithub,
  siWikipedia,
  siCrunchyroll,
} from "simple-icons";

type BrandIcon = { path: string; hex: string };

const BRAND_ICONS: Record<string, BrandIcon> = {
  reddit: siReddit,
  spotify: siSpotify,
  netflix: siNetflix,
  steam: siSteam,
  discord: siDiscord,
  x: siX,
  github: siGithub,
  wikipedia: siWikipedia,
  crunchyroll: siCrunchyroll,
};

// Brands whose official color is black render white so they stay visible on dark skins.
function brandFill(hex: string): string {
  return hex === "000000" || hex === "181717" ? "currentColor" : `#${hex}`;
}

export function BrandLogo({ id }: { id: string }) {
  const icon = BRAND_ICONS[id];
  if (!icon) return null;
  return (
    <svg className="hdx-link-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d={icon.path} fill={brandFill(icon.hex)} />
    </svg>
  );
}

export function hasBrandLogo(id: string): boolean {
  return id in BRAND_ICONS;
}
