// GIF picker search: query, results and loading state.

import { useState } from "react";
import type { GiphyGif } from "../types";

export function useGifSearchState() {
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<GiphyGif[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState("");

  return {
    gifQuery,
    setGifQuery,
    gifResults,
    setGifResults,
    gifLoading,
    setGifLoading,
    gifError,
    setGifError,
  };
}

export type GifSearchState = ReturnType<typeof useGifSearchState>;
