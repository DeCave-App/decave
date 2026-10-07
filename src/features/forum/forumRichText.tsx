// Safe, dependency-free renderer for the forum markdown subset. Produces React
// elements only (never HTML strings). Supported:
//   # / ## / ### headings, > quotes, - / 1. lists, ``` fenced code,
//   **bold**, *italic*, ~~strike~~, `code`, ||spoiler||,
//   [text](https://…), bare https:// links, ![alt](image url), #room links.
import { useState, type ReactNode } from "react";

export type ResolveImageUrl = (url: string) => string | null;
/** Returns an opener for a room in the current Hub, or null when no room has that name. */
export type ResolveRoomLink = (name: string) => (() => void) | null;

const INLINE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\|\|[^|\n]+\|\||!\[[^\]\n]*\]\([^\s)]+\)|\[[^\]\n]+\]\(https:\/\/[^\s)]+\)|https:\/\/[^\s<]+|(?<![\w&/#])#[A-Za-z0-9][\w-]*|(?<![*\w])\*[^*\n]+\*(?!\*))/g;

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={`fx-spoiler${shown ? " shown" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={shown ? undefined : "Spoiler, activate to reveal"}
      onClick={(event) => {
        event.stopPropagation();
        setShown(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setShown(true);
        }
      }}
    >
      {children}
    </span>
  );
}

function inline(text: string, resolveImage: ResolveImageUrl, keyBase: string, roomLink?: ResolveRoomLink): ReactNode[] {
  return text
    .split(INLINE)
    .filter((part) => part !== "")
    .map((part, index) => {
      const key = `${keyBase}-${index}`;
      if (/^`[^`\n]+`$/.test(part)) return <code key={key}>{part.slice(1, -1)}</code>;
      if (/^\*\*[^*\n]+\*\*$/.test(part))
        return <strong key={key}>{inline(part.slice(2, -2), resolveImage, key, roomLink)}</strong>;
      if (/^~~[^~\n]+~~$/.test(part)) return <s key={key}>{inline(part.slice(2, -2), resolveImage, key, roomLink)}</s>;
      if (/^\|\|[^|\n]+\|\|$/.test(part))
        return <Spoiler key={key}>{inline(part.slice(2, -2), resolveImage, key, roomLink)}</Spoiler>;
      if (/^\*[^*\n]+\*$/.test(part))
        return <em key={key}>{inline(part.slice(1, -1), resolveImage, key, roomLink)}</em>;
      const image = /^!\[([^\]\n]*)\]\(([^\s)]+)\)$/.exec(part);
      if (image) {
        const src = resolveImage(image[2]);
        return src ? (
          <img key={key} className="fx-inline-img" src={src} alt={image[1] || "Image"} loading="lazy" />
        ) : (
          <span key={key} className="fx-muted">
            [image: {image[1] || "unavailable"}]
          </span>
        );
      }
      const link = /^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
      if (link)
        return (
          <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>
        );
      if (/^https:\/\/[^\s<]+$/.test(part))
        return (
          <a key={key} href={part} target="_blank" rel="noreferrer noopener">
            {part}
          </a>
        );
      const roomName = /^#([A-Za-z0-9][\w-]*)$/.exec(part)?.[1];
      const openRoom = roomName ? roomLink?.(roomName) : null;
      if (openRoom)
        return (
          <button key={key} type="button" className="room-link" onClick={openRoom}>
            {part}
          </button>
        );
      return part;
    });
}

export function renderForumMarkdown(
  body: string,
  resolveImage: ResolveImageUrl,
  roomLink?: ResolveRoomLink,
): ReactNode {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const key = `p${blocks.length}`;
    blocks.push(
      <p key={key}>
        {paragraph.flatMap((line, index) =>
          index
            ? [<br key={`${key}-br${index}`} />, ...inline(line, resolveImage, `${key}-${index}`, roomLink)]
            : inline(line, resolveImage, `${key}-${index}`, roomLink),
        )}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${blocks.length}`;
    const items = list.items.map((item, index) => (
      <li key={`${key}-${index}`}>{inline(item, resolveImage, `${key}-${index}`, roomLink)}</li>
    ));
    blocks.push(list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const key = `q${blocks.length}`;
    blocks.push(
      <blockquote key={key}>
        {quote.flatMap((line, index) =>
          index
            ? [<br key={`${key}-br${index}`} />, ...inline(line, resolveImage, `${key}-${index}`, roomLink)]
            : inline(line, resolveImage, `${key}-${index}`, roomLink),
        )}
      </blockquote>,
    );
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      flushAll();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <pre key={`c${blocks.length}`}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushAll();
      const key = `h${blocks.length}`;
      const content = inline(heading[2], resolveImage, key, roomLink);
      blocks.push(
        heading[1].length === 1 ? (
          <h3 key={key} className="fx-md-h1">
            {content}
          </h3>
        ) : heading[1].length === 2 ? (
          <h4 key={key} className="fx-md-h2">
            {content}
          </h4>
        ) : (
          <h5 key={key} className="fx-md-h3">
            {content}
          </h5>
        ),
      );
      continue;
    }
    const quoteLine = /^>\s?(.*)$/.exec(line);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line);
  }
  flushAll();
  return <div className="fx-md">{blocks}</div>;
}
