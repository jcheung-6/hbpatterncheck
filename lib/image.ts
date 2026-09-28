import sharp from "sharp";

const MAX_BYTES = 4 * 1024 * 1024;

export class ImagePrepError extends Error {
  code: "file_too_large" | "bad_image";

  constructor(code: ImagePrepError["code"]) {
    super(code);
    this.code = code;
  }
}

export async function normalizeImage(input: Buffer): Promise<{ buffer: Buffer; dataUrl: string }> {
  if (input.length > MAX_BYTES) throw new ImagePrepError("file_too_large");
  try {
    const buffer = await sharp(input, { failOn: "none", limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { buffer, dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}` };
  } catch {
    throw new ImagePrepError("bad_image");
  }
}
