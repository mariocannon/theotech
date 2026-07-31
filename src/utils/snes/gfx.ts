/** Conversions between editor-friendly pixel arrays and SNES hardware formats. */

/** Pack 8-bit RGB into a 15-bit BGR555 word. */
export function rgbToBgr555(r: number, g: number, b: number): number {
  const r5 = Math.round((clamp(r, 0, 255) / 255) * 31);
  const g5 = Math.round((clamp(g, 0, 255) / 255) * 31);
  const b5 = Math.round((clamp(b, 0, 255) / 255) * 31);
  return (b5 << 10) | (g5 << 5) | r5;
}

/** Unpack a 15-bit BGR555 word into 8-bit RGB. */
export function bgr555ToRgb(c: number): [number, number, number] {
  const r5 = c & 31;
  const g5 = (c >> 5) & 31;
  const b5 = (c >> 10) & 31;
  // Replicate the high bits into the low ones so 31 maps to 255.
  return [(r5 << 3) | (r5 >> 2), (g5 << 3) | (g5 >> 2), (b5 << 3) | (b5 >> 2)];
}

export function bgr555ToCss(c: number): string {
  const [r, g, b] = bgr555ToRgb(c);
  return `rgb(${r},${g},${b})`;
}

export function hexToBgr555(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  return rgbToBgr555((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
}

export function bgr555ToHex(c: number): string {
  const [r, g, b] = bgr555ToRgb(c);
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Encode one 8x8 tile of palette indices into the SNES 4bpp layout.
 *
 * Bytes 0-15 hold bitplanes 0/1 interleaved per row, bytes 16-31 hold
 * bitplanes 2/3 the same way. Within a row, bit 7 is the leftmost pixel.
 */
export function encodeTile4bpp(
  pixels: ArrayLike<number>,
  offset = 0,
  stride = 8
): Uint8Array {
  const out = new Uint8Array(32);
  for (let y = 0; y < 8; y++) {
    let p0 = 0;
    let p1 = 0;
    let p2 = 0;
    let p3 = 0;
    for (let x = 0; x < 8; x++) {
      const v = pixels[offset + y * stride + x] & 0x0f;
      const bit = 7 - x;
      p0 |= (v & 1) << bit;
      p1 |= ((v >> 1) & 1) << bit;
      p2 |= ((v >> 2) & 1) << bit;
      p3 |= ((v >> 3) & 1) << bit;
    }
    out[y * 2] = p0;
    out[y * 2 + 1] = p1;
    out[16 + y * 2] = p2;
    out[16 + y * 2 + 1] = p3;
  }
  return out;
}

/**
 * OBJ tile number for a 16x16 sprite slot.
 *
 * Sprite character memory is addressed as a 16-tile-wide sheet, and a 16x16
 * object occupies tiles N, N+1, N+16 and N+17. Laying eight slots per pair of
 * rows keeps every slot's four tiles contiguous within the sheet.
 */
export function slotToTileNumber(slot: number): number {
  return (slot >> 3) * 32 + (slot & 7) * 2;
}

/** Encode a 16x16 sprite into its four 8x8 tiles at the right sheet offsets. */
export function writeSprite4bpp(
  dest: Uint8Array,
  slot: number,
  pixels: ArrayLike<number>
): void {
  const base = slotToTileNumber(slot);
  const quadrants: Array<[number, number, number]> = [
    [base, 0, 0],
    [base + 1, 8, 0],
    [base + 16, 0, 8],
    [base + 17, 8, 8],
  ];
  for (const [tileNo, px, py] of quadrants) {
    const tile = encodeTile4bpp(pixels, py * 16 + px, 16);
    dest.set(tile, tileNo * 32);
  }
}

/**
 * Decode a 4bpp tile back into palette indices. Used by the importer so a
 * previously exported ROM can be read back into the editor.
 */
export function decodeTile4bpp(data: Uint8Array, offset: number): number[] {
  const out = new Array<number>(64);
  for (let y = 0; y < 8; y++) {
    const p0 = data[offset + y * 2];
    const p1 = data[offset + y * 2 + 1];
    const p2 = data[offset + 16 + y * 2];
    const p3 = data[offset + 16 + y * 2 + 1];
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      out[y * 8 + x] =
        ((p0 >> bit) & 1) |
        (((p1 >> bit) & 1) << 1) |
        (((p2 >> bit) & 1) << 2) |
        (((p3 >> bit) & 1) << 3);
    }
  }
  return out;
}
