/**
 * Turns a GameProject into a bootable LoROM `.sfc` image.
 *
 *   file $000000-$007FFF  bank $00 ($8000-$FFFF): engine code, palettes,
 *                         entity tables, header and vectors
 *   file $008000-$00FFFF  bank $01 ($8000-$FFFF): tile and sprite graphics,
 *                         the collision map and the BG tilemap
 *
 * The remaining banks are padding so the image is a clean 256 KiB, which keeps
 * the header checksum calculation straightforward.
 */

import { buildEngine } from "./engine";
import {
  ADDR_BG_GFX,
  ADDR_BG_PAL,
  ADDR_COLMAP,
  ADDR_ENT_TYPE,
  ADDR_ENT_X,
  ADDR_ENT_Y,
  ADDR_OAM_MASK,
  ADDR_OBJ_GFX,
  ADDR_OBJ_PAL,
  ADDR_SLOT_ATTR,
  ADDR_SLOT_TILE,
  ADDR_TILEMAP,
  ADDR_TYPE_SLOT,
  LEVEL_H,
  LEVEL_W,
  MAX_ENTITIES,
  ROM_SIZE,
  SPRITE_COUNT,
  TILE_COUNT,
  TYPE_TO_SLOT,
} from "./constants";
import { encodeTile4bpp, slotToTileNumber, writeSprite4bpp } from "./gfx";
import { validateProject, type GameProject } from "./types";

const BANK_SIZE = 0x8000;
const HEADER_OFF = 0x7fc0; // within bank $00's file image

export interface BuildResult {
  rom: Uint8Array;
  /** Bytes of 65816 code, useful for showing how much room is left. */
  codeSize: number;
}

export function buildRom(project: GameProject): BuildResult {
  validateProject(project);

  const asm = buildEngine(project.settings);
  const code = asm.assemble();

  const bank0 = new Uint8Array(BANK_SIZE);
  const codeLimit = ADDR_BG_PAL - 0x8000;
  if (code.length > codeLimit) {
    throw new Error(
      `engine code is ${code.length} bytes, only ${codeLimit} fit before the data tables`
    );
  }
  bank0.set(code, 0);

  const at = (addr: number) => addr - 0x8000;

  writePalettes(bank0, at(ADDR_BG_PAL), project.bgPalettes);
  writePalettes(bank0, at(ADDR_OBJ_PAL), project.objPalettes);
  writeEntityTables(bank0, project);
  writeSpriteTables(bank0, project);

  const bank1 = new Uint8Array(BANK_SIZE);
  writeBgGraphics(bank1, at(ADDR_BG_GFX), project);
  writeObjGraphics(bank1, at(ADDR_OBJ_GFX), project);
  writeCollisionMap(bank1, at(ADDR_COLMAP), project);
  writeTilemap(bank1, at(ADDR_TILEMAP), project);

  writeHeader(bank0, project.title);
  writeVectors(bank0, {
    reset: asm.labelAddress("Reset"),
    nmi: asm.labelAddress("NMI"),
    irq: asm.labelAddress("IrqStub"),
  });

  const rom = new Uint8Array(ROM_SIZE);
  rom.set(bank0, 0);
  rom.set(bank1, BANK_SIZE);

  applyChecksum(rom);

  return { rom, codeSize: code.length };
}

// --------------------------------------------------------------------- data

function writePalettes(dest: Uint8Array, offset: number, palettes: number[][]) {
  for (let p = 0; p < palettes.length; p++) {
    for (let c = 0; c < 16; c++) {
      const color = (palettes[p][c] ?? 0) & 0x7fff;
      const i = offset + (p * 16 + c) * 2;
      dest[i] = color & 0xff;
      dest[i + 1] = (color >> 8) & 0xff;
    }
  }
}

function writeBgGraphics(dest: Uint8Array, offset: number, p: GameProject) {
  for (let t = 0; t < TILE_COUNT; t++) {
    dest.set(encodeTile4bpp(p.tiles[t].pixels), offset + t * 32);
  }
}

function writeObjGraphics(dest: Uint8Array, offset: number, p: GameProject) {
  const sheet = new Uint8Array(0x1000);
  for (let s = 0; s < SPRITE_COUNT; s++) {
    writeSprite4bpp(sheet, s, p.sprites[s].pixels);
  }
  dest.set(sheet, offset);
}

function writeCollisionMap(dest: Uint8Array, offset: number, p: GameProject) {
  for (let i = 0; i < LEVEL_W * LEVEL_H; i++) {
    const tile = p.level[i] & 0xff;
    dest[offset + i] = p.tiles[tile].collision & 0x03;
  }
}

/**
 * A 64x64 tilemap is stored in VRAM as four 32x32 screens in the order
 * top-left, top-right, bottom-left, bottom-right, so the ROM copy has to be
 * laid out the same way for the single DMA in LoadGfx to land correctly.
 */
function writeTilemap(dest: Uint8Array, offset: number, p: GameProject) {
  for (let ty = 0; ty < LEVEL_H; ty++) {
    for (let tx = 0; tx < LEVEL_W; tx++) {
      const tile = p.level[ty * LEVEL_W + tx] & 0xff;
      const palette = p.tiles[tile].palette & 0x07;
      const word = tile | (palette << 10);
      const screen = (tx >> 5) + (ty >> 5) * 2;
      const wordIndex = screen * 1024 + (ty & 31) * 32 + (tx & 31);
      dest[offset + wordIndex * 2] = word & 0xff;
      dest[offset + wordIndex * 2 + 1] = (word >> 8) & 0xff;
    }
  }
}

function writeEntityTables(dest: Uint8Array, p: GameProject) {
  const typeOff = ADDR_ENT_TYPE - 0x8000;
  const xOff = ADDR_ENT_X - 0x8000;
  const yOff = ADDR_ENT_Y - 0x8000;
  for (let i = 0; i < MAX_ENTITIES; i++) {
    const e = p.entities[i];
    const type = e ? e.type & 0xff : 0;
    // Positions are stored pre-shifted into 12.4 so the engine can copy them
    // straight into its working variables.
    const x = e ? (e.x << 4) & 0xffff : 0;
    const y = e ? (e.y << 4) & 0xffff : 0;
    dest[typeOff + i] = type;
    dest[xOff + i * 2] = x & 0xff;
    dest[xOff + i * 2 + 1] = (x >> 8) & 0xff;
    dest[yOff + i * 2] = y & 0xff;
    dest[yOff + i * 2 + 1] = (y >> 8) & 0xff;
  }
}

function writeSpriteTables(dest: Uint8Array, p: GameProject) {
  const typeSlotOff = ADDR_TYPE_SLOT - 0x8000;
  for (let t = 0; t < 8; t++) {
    dest[typeSlotOff + t] = TYPE_TO_SLOT[t] ?? 0;
  }

  const tileOff = ADDR_SLOT_TILE - 0x8000;
  const attrOff = ADDR_SLOT_ATTR - 0x8000;
  for (let s = 0; s < SPRITE_COUNT; s++) {
    dest[tileOff + s] = slotToTileNumber(s) & 0xff;
    // vhoopppN: priority 2, palette from the sprite, tile bit 8 always clear.
    dest[attrOff + s] = (2 << 4) | ((p.sprites[s].palette & 0x07) << 1);
  }

  const maskOff = ADDR_OAM_MASK - 0x8000;
  dest.set([0x01, 0x04, 0x10, 0x40], maskOff);
}

// ------------------------------------------------------------------- header

function writeHeader(bank0: Uint8Array, title: string) {
  const name = title
    .toUpperCase()
    .replace(/[^\x20-\x7e]/g, " ")
    .slice(0, 21)
    .padEnd(21, " ");
  for (let i = 0; i < 21; i++) {
    bank0[HEADER_OFF + i] = name.charCodeAt(i);
  }
  bank0[HEADER_OFF + 0x15] = 0x20; // LoROM, slow ROM
  bank0[HEADER_OFF + 0x16] = 0x00; // ROM only
  bank0[HEADER_OFF + 0x17] = 0x08; // 2^8 KiB = 256 KiB
  bank0[HEADER_OFF + 0x18] = 0x00; // no SRAM
  bank0[HEADER_OFF + 0x19] = 0x01; // NTSC
  bank0[HEADER_OFF + 0x1a] = 0x00; // developer id
  bank0[HEADER_OFF + 0x1b] = 0x00; // version
  bank0[HEADER_OFF + 0x1c] = 0xff; // checksum complement, filled in later
  bank0[HEADER_OFF + 0x1d] = 0xff;
  bank0[HEADER_OFF + 0x1e] = 0x00; // checksum, filled in later
  bank0[HEADER_OFF + 0x1f] = 0x00;
}

function writeVectors(
  bank0: Uint8Array,
  v: { reset: number; nmi: number; irq: number }
) {
  const put = (off: number, value: number) => {
    bank0[off] = value & 0xff;
    bank0[off + 1] = (value >> 8) & 0xff;
  };
  // Native mode.
  put(0x7fe4, v.irq); // COP
  put(0x7fe6, v.irq); // BRK
  put(0x7fe8, v.irq); // ABORT
  put(0x7fea, v.nmi); // NMI
  put(0x7fec, v.irq); // reserved
  put(0x7fee, v.irq); // IRQ
  // Emulation mode.
  put(0x7ff4, v.irq); // COP
  put(0x7ff8, v.irq); // ABORT
  put(0x7ffa, v.nmi); // NMI
  put(0x7ffc, v.reset); // RESET
  put(0x7ffe, v.irq); // IRQ
}

/**
 * The header checksum is the 16-bit sum of every byte in the image, computed
 * with the complement field reading $FFFF and the checksum field $0000.
 */
function applyChecksum(rom: Uint8Array) {
  rom[HEADER_OFF + 0x1c] = 0xff;
  rom[HEADER_OFF + 0x1d] = 0xff;
  rom[HEADER_OFF + 0x1e] = 0x00;
  rom[HEADER_OFF + 0x1f] = 0x00;

  let sum = 0;
  for (let i = 0; i < rom.length; i++) sum += rom[i];
  sum &= 0xffff;

  const complement = sum ^ 0xffff;
  rom[HEADER_OFF + 0x1c] = complement & 0xff;
  rom[HEADER_OFF + 0x1d] = (complement >> 8) & 0xff;
  rom[HEADER_OFF + 0x1e] = sum & 0xff;
  rom[HEADER_OFF + 0x1f] = (sum >> 8) & 0xff;
}

/** Suggest a filename for the downloaded ROM. */
export function romFilename(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "game";
  return `${base}.sfc`;
}
