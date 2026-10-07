import { readImageDimensions } from "../../../shared/hub-media-specs";

/** Reads an image file's pixel size: header sniffing first, browser decode as fallback. */
export async function measureImageFile(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const sniffed = readImageDimensions(new Uint8Array(await file.arrayBuffer()));
    if (sniffed && sniffed.width > 0 && sniffed.height > 0) return sniffed;
  } catch {
    /* fall through to decode */
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}
