// Minimal PNG reading and writing for the fork's icon tools and checks: 8-bit RGB or
// RGBA, non-interlaced, which is what Chrome screenshots and sips produce.
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width, height, color type (2 = RGB, 6 = RGBA) and RGBA pixels of a PNG file or buffer. */
export function readPng(fileOrBuffer) {
  const data = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : readFileSync(fileOrBuffer);
  const file = Buffer.isBuffer(fileOrBuffer) ? "PNG data" : fileOrBuffer;
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    }
    if (type === "IDAT") idat.push(body);
    offset += 12 + length;
  }
  if (
    !header ||
    header.depth !== 8 ||
    header.interlace !== 0 ||
    ![2, 6].includes(header.colorType)
  ) {
    throw new Error(`${file}: only 8-bit, non-interlaced RGB or RGBA PNGs are supported`);
  }
  const channels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(header.width * header.height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + left) & 255;
      else if (filter === 2) line[x] = (line[x] + up) & 255;
      else if (filter === 3) line[x] = (line[x] + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const byLeft = Math.abs(estimate - left);
        const byUp = Math.abs(estimate - up);
        const byUpLeft = Math.abs(estimate - upLeft);
        line[x] =
          (line[x] +
            (byLeft <= byUp && byLeft <= byUpLeft ? left : byUp <= byUpLeft ? up : upLeft)) &
          255;
      }
    }
    previous = line;
    for (let x = 0; x < header.width; x += 1) {
      const target = (y * header.width + x) * 4;
      rgba[target] = line[x * channels];
      rgba[target + 1] = line[x * channels + 1];
      rgba[target + 2] = line[x * channels + 2];
      rgba[target + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
  }
  return { width: header.width, height: header.height, colorType: header.colorType, rgba };
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** An RGB PNG (no alpha channel) of the image composited over white. */
export function encodeOpaquePng({ width, height, rgba }) {
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const alpha = rgba[source + 3] / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        rows[row + 1 + x * 3 + channel] = Math.round(
          rgba[source + channel] * alpha + 255 * (1 - alpha),
        );
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
