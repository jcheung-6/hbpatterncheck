import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { normalizeImage } from "../lib/image";

test("uploads are resized, re-encoded, and stripped of the original comment", async () => {
  const base = await sharp({
    create: { width: 1600, height: 40, channels: 3, background: { r: 240, g: 240, b: 240 } },
  })
    .jpeg()
    .toBuffer();
  const tagged = await sharp(base).withMetadata({ exif: { IFD0: { ImageDescription: "SECRET-PATIENT-NAME" } } }).toBuffer();
  assert.equal(tagged.includes(Buffer.from("SECRET-PATIENT-NAME")), true);
  const normalized = await normalizeImage(tagged);
  assert.equal(normalized.buffer.includes(Buffer.from("SECRET-PATIENT-NAME")), false);
  assert.match(normalized.dataUrl, /^data:image\/jpeg;base64,/);
  const meta = await sharp(normalized.buffer).metadata();
  assert.ok((meta.width ?? 0) <= 1280);
  assert.equal(meta.exif, undefined);
});

test("files over 4 MB are rejected before decoding", async () => {
  await assert.rejects(normalizeImage(Buffer.alloc(4 * 1024 * 1024 + 1, 7)), /file_too_large/);
});

test("non-images are rejected", async () => {
  await assert.rejects(normalizeImage(Buffer.from("this is not an image")), /bad_image/);
});
