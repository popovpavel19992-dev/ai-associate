#!/usr/bin/env node
/**
 * Generates placeholder PWA icons as solid-color PNGs.
 *
 * These are stopgap icons so the manifest references valid assets and the PWA
 * passes installability checks. Replace public/icons/*.png with branded artwork
 * before launch. Color matches manifest theme: #0a0a0a (charcoal) with a white
 * "C" mark drawn pixel-by-pixel.
 *
 * Pure Node — no image dep — emits valid PNGs by hand-rolling IDAT + zlib.
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "..", "public", "icons");
mkdirSync(ICONS_DIR, { recursive: true });

const BG = [10, 10, 10]; // #0a0a0a
const FG = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size, drawC) {
  // RGBA raster
  const stride = size * 4;
  const raster = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raster[y * (stride + 1)] = 0; // filter byte: None
    for (let x = 0; x < size; x++) {
      const off = y * (stride + 1) + 1 + x * 4;
      let r = BG[0],
        g = BG[1],
        b = BG[2];
      if (drawC) {
        // Draw a thick "C": ring at radius ~0.36..0.46 of size, opening on the right
        const cx = size / 2;
        const cy = size / 2;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / size;
        const angle = Math.atan2(dy, dx); // right=0
        const inRing = dist > 0.32 && dist < 0.46;
        const opening = angle > -Math.PI / 5 && angle < Math.PI / 5;
        if (inRing && !opening) {
          r = FG[0];
          g = FG[1];
          b = FG[2];
        }
      }
      raster[off] = r;
      raster[off + 1] = g;
      raster[off + 2] = b;
      raster[off + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raster);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = [
  { name: "icon-192.png", size: 192, drawC: true },
  { name: "icon-512.png", size: 512, drawC: true },
  { name: "icon-maskable-192.png", size: 192, drawC: true },
  { name: "icon-maskable-512.png", size: 512, drawC: true },
];

for (const t of targets) {
  const png = makePng(t.size, t.drawC);
  const path = join(ICONS_DIR, t.name);
  writeFileSync(path, png);
  console.log(`Wrote ${path} (${png.length} bytes)`);
}
