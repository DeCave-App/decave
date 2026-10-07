import { BrandLogo, hasBrandLogo } from "../../features/home/brandIcons";
import type { HomeQuickLink } from "../home-dashboard";

export function HomeQuickLinkLogo({ link }: { link: HomeQuickLink }) {
  if (hasBrandLogo(link.id)) return <BrandLogo id={link.id} />;
  const svgProps = {
    className: "hdx-link-svg",
    viewBox: "0 0 32 32",
    "aria-hidden": true,
  } as const;

  switch (link.id) {
    case "reddit":
      return (
        <svg {...svgProps}>
          <circle cx="16" cy="18" r="10" fill="#ff681f" />
          <path
            d="M10 17.5c1.6 2 3.6 3 6 3s4.4-1 6-3"
            fill="none"
            stroke="#fff"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="12.5" cy="16" r="1.5" fill="#fff" />
          <circle cx="19.5" cy="16" r="1.5" fill="#fff" />
          <path
            d="M16 8.5 17.5 5l3 1"
            fill="none"
            stroke="#ff681f"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="22.5" cy="11.5" r="2.3" fill="#ff681f" />
        </svg>
      );
    case "spotify":
      return (
        <svg {...svgProps}>
          <circle cx="16" cy="16" r="13" fill="#1ed760" />
          <path d="M9 12.5c4.8-1.3 9.8-.9 14 1" fill="none" stroke="#07130a" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M10.3 17c4-1 8-.7 11.8.7" fill="none" stroke="#07130a" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M11.8 21c3-.7 6-.5 8.8.5" fill="none" stroke="#07130a" strokeWidth="2.1" strokeLinecap="round" />
        </svg>
      );
    case "netflix":
      return (
        <svg {...svgProps}>
          <rect x="5" y="3" width="22" height="26" rx="3" fill="#e50914" />
          <path d="M9 6h4l6 12V6h4v20h-4l-6-12v12H9V6Z" fill="#fff" />
        </svg>
      );
    case "steam":
      return (
        <svg {...svgProps}>
          <circle cx="16" cy="16" r="13" fill="#1b9fff" />
          <circle cx="21" cy="11" r="4" fill="none" stroke="#fff" strokeWidth="2" />
          <circle cx="21" cy="11" r="1.2" fill="#fff" />
          <path
            d="m7 18 7 2.8 4-5.2"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="18" r="2.5" fill="none" stroke="#fff" strokeWidth="1.7" />
        </svg>
      );
    case "discord":
      return (
        <svg {...svgProps}>
          <path
            d="M6.2 7.2A22 22 0 0 1 11.7 5l.8 1.5a17.2 17.2 0 0 1 7 0l.8-1.5a22 22 0 0 1 5.5 2.2c1.1 4.1 1.1 8.2.2 12.1a21 21 0 0 1-6.2 3.1l-1.5-2.1c.8-.3 1.5-.7 2.2-1.2-3.8 1.7-7.7 1.7-11.5 0 .7.5 1.4.9 2.2 1.2l-1.5 2.1a21 21 0 0 1-6.2-3.1c-.9-3.9-.9-8 .2-12.1Z"
            fill="#5865f2"
          />
          <circle cx="12.3" cy="14.2" r="1.5" fill="#fff" />
          <circle cx="19.7" cy="14.2" r="1.5" fill="#fff" />
        </svg>
      );
    case "x":
      return (
        <svg {...svgProps}>
          <path
            d="M7 6h5.2l4.1 5.5L21 6h3l-6.3 7.2L25 26h-5.2l-4.8-6.4L9 26H6l6.8-7.8L7 6Zm4.3 2.4H10l9.9 15.2h1.4L11.3 8.4Z"
            fill="#111820"
          />
        </svg>
      );
    case "github":
      return (
        <svg {...svgProps}>
          <circle cx="16" cy="16" r="13" fill="#24292f" />
          <path
            d="M11 24v-2.4c-2.1.5-2.8-1-3.5-1.7-.6-.4-1.6-.6-.1-1.5 1.4-.1 2.1 1.3 2.5 1.6 1.4.8 2.4.2 3-.1.1-.9.5-1.5.9-1.8-3.9-.4-7.9-1.8-7.9-8 0-1.8.6-3.2 1.6-4.3-.2-.4-.7-2 .2-4.2 1.3-.4 4.4 1.7 4.4 1.7a15 15 0 0 1 7.9 0s3.1-2.1 4.4-1.7c.9 2.2.4 3.8.2 4.2 1 1.1 1.6 2.5 1.6 4.3 0 6.2-4 7.6-7.9 8 .6.5 1.1 1.5 1.1 3v2.9"
            fill="#fff"
          />
        </svg>
      );
    case "wikipedia":
      return (
        <svg {...svgProps}>
          <circle cx="16" cy="16" r="13" fill="#4b8bc8" />
          <path d="m6.5 10 3.5 12 3-8.3 3 8.3 4.5-12h-2.7l-2 6.4-2.1-6.4h-2.2l-2 6.4L9.3 10H6.5Z" fill="#fff" />
        </svg>
      );
    case "prime-video":
      return (
        <svg {...svgProps}>
          <rect x="3" y="3" width="26" height="26" rx="7" fill="#00a8e1" />
          <path
            d="M11 22V10h4.8c3.4 0 5.5 1.7 5.5 4.6s-2.1 4.6-5.5 4.6H14V22h-3Zm3-5.4h1.5c1.8 0 2.8-.6 2.8-2s-1-2-2.8-2H14v4Z"
            fill="#fff"
          />
          <path d="M9 24c4.8 2.1 10.2 2.1 15 0" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "crunchyroll":
      return (
        <svg {...svgProps}>
          <circle cx="16" cy="16" r="13" fill="#f47521" />
          <path d="M20.8 10.2a7.7 7.7 0 1 0 1 10.8A8.9 8.9 0 1 1 20.8 10.2Z" fill="#fff" />
          <path d="m22 7 .8 2.2L25 10l-2.2.8L22 13l-.8-2.2L19 10l2.2-.8L22 7Z" fill="#fff" />
        </svg>
      );
    default:
      return (
        <span className="hdx-link-fallback" aria-hidden="true">
          {link.icon}
        </span>
      );
  }
}
