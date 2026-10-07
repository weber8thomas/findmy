/** Side of the uploaded photo, in pixels: sharp at 72 px on a 3× screen, a few tens of KB. */
export const PHOTO_SIZE = 256;

/** The centred square of a w×h image. */
export function centerSquare(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

/** The picked image cropped to its centre and scaled down, as a JPEG ready to upload. */
export async function squarePhoto(file: Blob, size = PHOTO_SIZE): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    // Decoding through <img> applies the EXIF orientation of phone photos.
    await img.decode();
    const { sx, sy, side } = centerSquare(img.naturalWidth, img.naturalHeight);
    const out = Math.min(size, side);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx || !out) throw new Error("cannot draw the image");
    // JPEG has no transparency: white rather than black behind a transparent PNG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, out, out);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("cannot encode the image"))), "image/jpeg", 0.85),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
