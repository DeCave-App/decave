/* Shared stroke icon set (24px grid, 1.8 stroke, currentColor). Sized by the
   design-system classes: ds-icon (18px), ds-icon-sm (16), ds-icon-lg (20),
   ds-icon-xl (24). Use instead of emoji / unicode glyph icons. */

export type IconName =
  | "search"
  | "plus"
  | "close"
  | "check"
  | "more"
  | "more-vertical"
  | "message"
  | "message-plus"
  | "user-plus"
  | "users"
  | "user"
  | "copy"
  | "star"
  | "phone"
  | "video"
  | "archive"
  | "unarchive"
  | "chevron-right"
  | "chevron-down"
  | "chevron-up"
  | "mail"
  | "upload"
  | "poll"
  | "send"
  | "smile"
  | "paperclip"
  | "calendar"
  | "gif"
  | "hash"
  | "volume"
  | "bell"
  | "settings"
  | "shield"
  | "zap"
  | "image"
  | "log-out"
  | "chevron-left"
  | "lock"
  | "globe"
  | "crown"
  | "pin"
  | "forum"
  | "home"
  | "compass"
  | "bulb"
  | "mic"
  | "mic-off"
  | "headphones"
  | "headphones-off"
  | "screen"
  | "phone-off"
  | "flag"
  | "link"
  | "refresh"
  | "trash"
  | "edit"
  | "external"
  | "at"
  | "camera"
  | "camera-off"
  | "maximize"
  | "minimize"
  | "gamepad"
  | "bar-chart"
  | "castle"
  | "note"
  | "id-card"
  | "clock"
  | "layout-dashboard"
  | "calendar-days"
  | "sliders"
  | "download"
  | "keyboard"
  | "moon";

const PATHS: Record<IconName, JSX.Element> = {
  download: <path d="M12 4v12m-5-5 5 5 5-5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 14h.01M18 14h.01M9 14h6" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  "bar-chart": (
    <>
      <path d="M4 20h16" />
      <rect x="5.5" y="11" width="3" height="6.5" rx="1" />
      <rect x="10.5" y="6" width="3" height="11.5" rx="1" />
      <rect x="15.5" y="13" width="3" height="4.5" rx="1" />
    </>
  ),
  castle: (
    <>
      <path d="M4 20V9h3V6h2.5v3h5V6H17v3h3v11Z" />
      <path d="M10 20v-4a2 2 0 0 1 4 0v4M4 12.5h16" />
    </>
  ),
  note: (
    <>
      <path d="M6 3.5h9l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5Z" />
      <path d="M14.5 3.5V8h4.5M8.5 12.5h7M8.5 16h5" />
    </>
  ),
  "id-card": (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.8 16c.5-1.6 1.6-2.4 3.2-2.4s2.7.8 3.2 2.4M14.5 10h4M14.5 13.5h3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  "layout-dashboard": (
    <>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
    </>
  ),
  "calendar-days": (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01M16 17h.01" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  "more-vertical": (
    <>
      <circle cx="12" cy="5" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="12" cy="19" r="1.2" />
    </>
  ),
  message: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12Z" />,
  "message-plus": (
    <>
      <path d="M12 20H5a1 1 0 0 1-1-1v-7a7 7 0 1 1 7 7" />
      <path d="M15 5v6m-3-3h6" />
    </>
  ),
  "user-plus": (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 19.5c.6-3.3 2.8-5 6-5s5.4 1.7 6 5" />
      <path d="M18 8v6M15 11h6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c.6-3 2.7-4.6 6-4.6s5.4 1.6 6 4.6" />
      <circle cx="16.5" cy="9" r="2.6" />
      <path d="M16 14.3c2.6-.3 4.4 1.2 5 4.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M5 20c.7-3.6 3.2-5.5 7-5.5s6.3 1.9 7 5.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  star: <path d="m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9L12 3Z" />,
  phone: (
    <path d="M6.6 2.8 9 2.25a1.5 1.5 0 0 1 1.72.93l1.2 3.03a1.5 1.5 0 0 1-.38 1.65L9.8 9.47a14.2 14.2 0 0 0 4.73 4.73l1.61-1.74a1.5 1.5 0 0 1 1.65-.38l3.03 1.2A1.5 1.5 0 0 1 21.75 15l-.55 2.4a3 3 0 0 1-2.92 2.33C10.52 19.73 4.27 13.48 4.27 5.72A3 3 0 0 1 6.6 2.8Z" />
  ),
  video: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 10.5 5-3v9l-5-3" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1.2" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
    </>
  ),
  unarchive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1.2" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M12 18v-6m-2.5 2.5L12 12l2.5 2.5" />
    </>
  ),
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-up": <path d="m6 15 6-6 6 6" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  poll: <path d="M5 20V11M12 20V4M19 20v-6" />,
  send: <path d="m4 4 16 8-16 8 2.5-8L4 4Zm2.5 8H12" />,
  paperclip: (
    <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  gif: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M10 10H8.2a1.2 1.2 0 0 0-1.2 1.2v1.6A1.2 1.2 0 0 0 8.2 14H10v-1.6H9M12.5 10v4M15.5 14v-4h2.5M15.5 12h2" />
    </>
  ),
  hash: <path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16" />,
  volume: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  shield: <path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z" />,
  zap: <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="9.5" r="1.8" />
      <path d="m4 18 5.5-5 4 3.5 2.5-2 4 3.5" />
    </>
  ),
  "log-out": (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5Z" />
    </>
  ),
  crown: <path d="M4 17.5 3 7.5l5 4 4-6 4 6 5-4-1 10Z" />,
  pin: (
    <>
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" />
      <path d="M12 14v6" />
    </>
  ),
  forum: (
    <>
      <path d="M4 5h11a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 15 14H9l-4 3v-3H4a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 4 5Z" />
      <path d="M19.5 9.5h.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-.5V21l-3.5-2.5H12" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14a4 4 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9v10a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1V9" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  "mic-off": (
    <>
      <path d="M15 9.5V6a3 3 0 0 0-5.8-1.1M9 9v2a3 3 0 0 0 4.6 2.5" />
      <path d="M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11c0 .8-.1 1.5-.4 2.2M12 17.5V21M4 4l16 16" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3.5" y="14" width="4.5" height="6" rx="1.5" />
      <rect x="16" y="14" width="4.5" height="6" rx="1.5" />
    </>
  ),
  "headphones-off": (
    <>
      <path d="M4 15v-3a8 8 0 0 1 13.4-5.9M20 12v3" />
      <rect x="3.5" y="14" width="4.5" height="6" rx="1.5" />
      <path d="M16 16.5V20h3a1.5 1.5 0 0 0 1.5-1.5M4 4l16 16" />
    </>
  ),
  screen: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  "phone-off": (
    <path d="M4.5 14.5c4.2-4 10.8-4 15 0l-1.6 2.4a1.4 1.4 0 0 1-1.8.4l-2.3-1.2a1.4 1.4 0 0 1-.7-1.4l.2-1.5a10 10 0 0 0-2.6 0l.2 1.5a1.4 1.4 0 0 1-.7 1.4l-2.3 1.2a1.4 1.4 0 0 1-1.8-.4L4.5 14.5Z" />
  ),
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5" />
      <path d="M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5" />
      <path d="M20 20v-4.5h-4.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.5h5V7" />
      <path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M10 11v6M14 11v6" />
    </>
  ),
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  at: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M15.8 12v1.5a2.5 2.5 0 0 0 5 0V12A8.8 8.8 0 1 0 17 19.2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.8-2.5h6.4L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.2" r="3.5" />
    </>
  ),
  "camera-off": (
    <>
      <path d="M9 5.5h6.2L17 8h3a1 1 0 0 1 1 1v8.5M18 19.5H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2" />
      <path d="M10 10.5a3.5 3.5 0 0 0 4.8 4.8M4 4l16 16" />
    </>
  ),
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minimize: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  gamepad: (
    <>
      <path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 5.4l-.8 4a2.5 2.5 0 0 1-4.3 1.2L14 15.5h-4l-1.8 2.1a2.5 2.5 0 0 1-4.3-1.2l-.8-4A4.5 4.5 0 0 1 7.5 7Z" />
      <path d="M8 10v3M6.5 11.5h3M15.5 11h.01M17 12.5h.01" />
    </>
  ),
};

export function Icon({
  name,
  size,
  filled,
  className,
  title,
}: {
  name: IconName;
  size?: "sm" | "md" | "lg" | "xl";
  filled?: boolean;
  className?: string;
  title?: string;
}) {
  const sizeClass = size && size !== "md" ? ` ds-icon-${size}` : "";
  return (
    <svg
      className={`ds-icon${sizeClass}${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      style={filled ? { fill: "currentColor" } : undefined}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
