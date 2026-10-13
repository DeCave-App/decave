// Message pieces that follow Settings → Chat: animated GIFs and emotes that
// play always or only on hover, and large emoji for emoji-only messages.

import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { useChatPrefs } from "./chatPrefs";
import "./chatMedia.css";

/** First frame of an image as a data URL, or null when it can't be read (another site's image). */
function useStillFrame(src: string | undefined, wanted: boolean): string | null {
  const [still, setStill] = useState<{ src: string; frame: string | null } | null>(null);
  useEffect(() => {
    if (!wanted || !src || still?.src === src) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        setStill({ src, frame: canvas.toDataURL("image/png") });
      } catch {
        setStill({ src, frame: null });
      }
    };
    image.onerror = () => !cancelled && setStill({ src, frame: null });
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, wanted]);
  return still && still.src === src ? still.frame : null;
}

/** An image that may animate (GIF, animated emote). In "play on hover" mode it shows its first frame until hovered or focused. */
export function ChatAnimatedImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const { animate } = useChatPrefs();
  const [active, setActive] = useState(false);
  const hoverMode = animate === "hover";
  const still = useStillFrame(typeof props.src === "string" ? props.src : undefined, hoverMode);
  if (!hoverMode) return <img {...props} />;
  const showStill = !active && still;
  return (
    <img
      {...props}
      src={showStill ? still : props.src}
      data-animation={showStill ? "paused" : "playing"}
      onMouseEnter={(event) => {
        setActive(true);
        props.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setActive(false);
        props.onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        setActive(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setActive(false);
        props.onBlur?.(event);
      }}
    />
  );
}

/** Wraps an emoji-only message so it renders large, when Settings → Chat allows it. */
export function LargeEmoji({ children }: { children: ReactNode }) {
  const { largeEmoji } = useChatPrefs();
  return largeEmoji ? <span className="dc-emoji-only">{children}</span> : <>{children}</>;
}
