/**
 * The project a new user starts from: a small tileset, a handful of 16x16
 * sprites and a playable demo level. Everything here is ordinary project data,
 * so it can be edited or thrown away entirely.
 */

import {
  COL_EMPTY,
  COL_HAZARD,
  COL_ONEWAY,
  COL_SOLID,
  ENT_COIN,
  ENT_ENEMY,
  ENT_GOAL,
  ENT_PLAYER,
  LEVEL_H,
  LEVEL_W,
  PALETTE_COUNT,
  SPRITE_COUNT,
  TILE_COUNT,
} from "./constants";
import { rgbToBgr555 } from "./gfx";
import type { GameProject, SpriteDef, TileDef } from "./types";

/** Parse rows of hex digits into a flat array of palette indices. */
function art(rows: string[], size: number): number[] {
  const out = new Array<number>(size * size).fill(0);
  for (let y = 0; y < Math.min(rows.length, size); y++) {
    const row = rows[y];
    for (let x = 0; x < Math.min(row.length, size); x++) {
      const v = parseInt(row[x], 16);
      out[y * size + x] = Number.isNaN(v) ? 0 : v;
    }
  }
  return out;
}

const tile = (rows: string[]) => art(rows, 8);
const sprite = (rows: string[]) => art(rows, 16);

const rgb = (hex: number) =>
  rgbToBgr555((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff);

// ------------------------------------------------------------------ palettes

const BG_PALETTE_0 = [
  0x5c94fc, // 0 sky (also the backdrop colour)
  0x101820, // 1 outline
  0x58d854, // 2 grass light
  0x2c7a30, // 3 grass dark
  0xa0632c, // 4 dirt
  0x6b3d18, // 5 dirt dark
  0xc84c0c, // 6 brick
  0x7c2800, // 7 brick dark
  0x9c9c9c, // 8 stone
  0x5c5c5c, // 9 stone dark
  0xfcfcfc, // A white
  0xbcdcfc, // B pale blue
  0xfcd800, // C gold
  0xfc9838, // D orange
  0x000000, // E black
  0xd8d8d8, // F silver
].map(rgb);

const OBJ_PALETTE_PLAYER = [
  0x000000, // 0 transparent
  0x101820, // 1 outline
  0xfcbc84, // 2 skin
  0xd82800, // 3 shirt
  0x0058f8, // 4 trousers
  0x6b3d18, // 5 shoes
  0x8b4513, // 6 hair
  0xfcfcfc, // 7 eye white
  0x00a800, // 8
  0xfcd800, // 9
  0xfc9838, // A
  0xbcbcbc, // B
  0x7c7c7c, // C
  0x503000, // D
  0xf8b8f8, // E
  0x000000, // F
].map(rgb);

const OBJ_PALETTE_COIN = [
  0x000000, 0x101820, 0xfcd800, 0xfc9838, 0xa06000, 0xfcfcfc, 0xfff4b0,
  0x7c5000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000,
  0x000000, 0x000000,
].map(rgb);

const OBJ_PALETTE_ENEMY = [
  0x000000,
  0x101820,
  0x8c2ca8, // body
  0x5c1070, // body dark
  0xfcfcfc, // eye
  0xd82800, // tongue
  0xfcbc84,
  0x584000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
].map(rgb);

const OBJ_PALETTE_GOAL = [
  0x000000,
  0x101820,
  0x00a800, // flag
  0x006800,
  0xfcfcfc, // pole
  0x9c9c9c,
  0xfcd800,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
  0x000000,
].map(rgb);

const GREY_RAMP = [
  0x000000, 0x101820, 0x303030, 0x505050, 0x707070, 0x909090, 0xb0b0b0,
  0xd0d0d0, 0xf0f0f0, 0xfcfcfc, 0x882020, 0xd84040, 0x204088, 0x4070d8,
  0x208820, 0x40d840,
].map(rgb);

// --------------------------------------------------------------------- tiles

interface TileSeed {
  rows: string[];
  palette?: number;
  collision?: number;
}

const TILE_SEEDS: TileSeed[] = [
  // 0 - empty sky
  { rows: [], collision: COL_EMPTY },
  // 1 - grass topped ground
  {
    rows: [
      "22222222",
      "22322232",
      "23333323",
      "33344333",
      "34444443",
      "44454444",
      "44444544",
      "45444444",
    ],
    collision: COL_SOLID,
  },
  // 2 - dirt
  {
    rows: [
      "44444444",
      "45444454",
      "44444444",
      "44454444",
      "44444445",
      "45444444",
      "44444544",
      "44444444",
    ],
    collision: COL_SOLID,
  },
  // 3 - brick
  {
    rows: [
      "77777777",
      "76666667",
      "76666667",
      "77777777",
      "66677666",
      "66677666",
      "66677666",
      "77777777",
    ],
    collision: COL_SOLID,
  },
  // 4 - spikes
  {
    rows: [
      "00000000",
      "000FF000",
      "000FF000",
      "00FFFF00",
      "00FFFF00",
      "0FFFFFF0",
      "FFFFFFFF",
      "11111111",
    ],
    collision: COL_HAZARD,
  },
  // 5 - one-way platform
  {
    rows: [
      "88888888",
      "89999998",
      "81111118",
      "00000000",
      "00000000",
      "00000000",
      "00000000",
      "00000000",
    ],
    collision: COL_ONEWAY,
  },
  // 6 - bush
  {
    rows: [
      "00000000",
      "00033000",
      "00333300",
      "03323330",
      "33333333",
      "32333233",
      "33333333",
      "00000000",
    ],
    collision: COL_EMPTY,
  },
  // 7 - cloud
  {
    rows: [
      "00000000",
      "000AA000",
      "00AAAA00",
      "0AAAAAA0",
      "AAAAAAAA",
      "AAAAAAAA",
      "0AAAAAA0",
      "00000000",
    ],
    collision: COL_EMPTY,
  },
  // 8 - stone block
  {
    rows: [
      "88888888",
      "8FFFFFF9",
      "8F8888F9",
      "8F8888F9",
      "8F8888F9",
      "8F8888F9",
      "89999999",
      "99999999",
    ],
    collision: COL_SOLID,
  },
  // 9 - background brick (decorative)
  {
    rows: [
      "99999999",
      "98888889",
      "98888889",
      "99999999",
      "88899888",
      "88899888",
      "88899888",
      "99999999",
    ],
    collision: COL_EMPTY,
  },
];

// ------------------------------------------------------------------- sprites

interface SpriteSeed {
  name: string;
  rows: string[];
  palette: number;
}

const SPRITE_SEEDS: SpriteSeed[] = [
  {
    name: "Player idle",
    palette: 0,
    rows: [
      "0000111111110000",
      "0001666666661000",
      "0001666666661000",
      "0001222222221000",
      "0001212222121000",
      "0001222222221000",
      "0001221111221000",
      "0000122222210000",
      "0001333333331000",
      "0012333333332100",
      "0012333333332100",
      "0001333333331000",
      "0001444444441000",
      "0001441001441000",
      "0001441001441000",
      "0001551001551000",
    ],
  },
  {
    name: "Player walk A",
    palette: 0,
    rows: [
      "0000111111110000",
      "0001666666661000",
      "0001666666661000",
      "0001222222221000",
      "0001212222121000",
      "0001222222221000",
      "0001221111221000",
      "0000122222210000",
      "0001333333331000",
      "0012333333332100",
      "0001333333332100",
      "0001333333331000",
      "0001444444441000",
      "0014410001441000",
      "0144100001441000",
      "1551000001551000",
    ],
  },
  {
    name: "Player walk B",
    palette: 0,
    rows: [
      "0000000000000000",
      "0000111111110000",
      "0001666666661000",
      "0001666666661000",
      "0001222222221000",
      "0001212222121000",
      "0001222222221000",
      "0001221111221000",
      "0000122222210000",
      "0001333333331000",
      "0012333333332100",
      "0012333333331000",
      "0001444444441000",
      "0001441441000000",
      "0001441144100000",
      "0015511551000000",
    ],
  },
  {
    name: "Player jump",
    palette: 0,
    rows: [
      "0120000000002100",
      "0120111111102100",
      "0121666666612100",
      "0121666666612100",
      "0011222222221100",
      "0001212222121000",
      "0001222222221000",
      "0001221111221000",
      "0000122222210000",
      "0001333333331000",
      "0001333333331000",
      "0001444444441000",
      "0001444444441000",
      "0011441001441100",
      "0155100001551000",
      "0000000000000000",
    ],
  },
  {
    name: "Coin",
    palette: 1,
    rows: [
      "0000000000000000",
      "0000011111000000",
      "0000122222100000",
      "0001222552210000",
      "0012225552221000",
      "0012235522321000",
      "0012235522321000",
      "0012235522321000",
      "0012235522321000",
      "0012235522321000",
      "0012235522321000",
      "0012234422321000",
      "0001223322210000",
      "0000122222100000",
      "0000011111000000",
      "0000000000000000",
    ],
  },
  {
    name: "Enemy",
    palette: 2,
    rows: [
      "0000000000000000",
      "0000011111100000",
      "0001222222221000",
      "0012222222222100",
      "0122224422422210",
      "0122224422422210",
      "0122222222222210",
      "0122222222222210",
      "0123333333333210",
      "0122333333332210",
      "0122222222222210",
      "0012255552222100",
      "0001222222221000",
      "0011100000011100",
      "0111000000001110",
      "0000000000000000",
    ],
  },
  {
    name: "Sprite 6",
    palette: 3,
    rows: [],
  },
  {
    name: "Goal flag",
    palette: 3,
    rows: [
      "0004400000000000",
      "0045522222100000",
      "0045222222221000",
      "0045222222222100",
      "0045322222222100",
      "0045332222221000",
      "0045333222210000",
      "0045333221000000",
      "0045333100000000",
      "0045500000000000",
      "0045500000000000",
      "0045500000000000",
      "0045500000000000",
      "0045500000000000",
      "0045500000000000",
      "0145510000000000",
    ],
  },
];

// --------------------------------------------------------------------- level

function buildDemoLevel(): {
  level: number[];
  entities: GameProject["entities"];
} {
  const level = new Array<number>(LEVEL_W * LEVEL_H).fill(0);
  const set = (x: number, y: number, t: number) => {
    if (x < 0 || x >= LEVEL_W || y < 0 || y >= LEVEL_H) return;
    level[y * LEVEL_W + x] = t;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t);
  };

  /**
   * Sit the ground low in the 64-tile-tall level. The camera clamps 288
   * pixels down, so a ground row here keeps the horizon around two thirds of
   * the way down the screen instead of filling it with dirt.
   */
  const GROUND = 55;
  /** Rows are written relative to the ground so the layout moves as one. */
  const up = (rows: number) => GROUND - rows;

  // Ground, with two gaps to jump over.
  for (let x = 0; x < LEVEL_W; x++) {
    const inGap = (x >= 22 && x <= 25) || (x >= 44 && x <= 46);
    if (inGap) continue;
    set(x, GROUND, 1);
    fill(x, GROUND + 1, x, LEVEL_H - 1, 2);
  }

  // Decoration.
  for (const [x, rows] of [
    [5, 7],
    [12, 10],
    [27, 8],
    [38, 11],
    [52, 9],
  ]) {
    fill(x, up(rows), x + 2, up(rows), 7);
  }
  for (const x of [8, 17, 34, 51]) set(x, up(1), 6);

  // Floating brick platforms.
  fill(9, up(5), 12, up(5), 3);
  fill(15, up(8), 17, up(8), 3);
  fill(28, up(6), 32, up(6), 3);
  fill(36, up(9), 38, up(9), 3);
  fill(49, up(5), 52, up(5), 3);

  // One-way platforms you can jump up through.
  fill(20, up(4), 22, up(4), 5);
  fill(41, up(7), 43, up(7), 5);
  fill(56, up(6), 58, up(6), 5);

  // Hazards.
  fill(33, up(1), 34, up(1), 4);
  fill(53, up(1), 53, up(1), 4);

  // A short stone staircase up to the goal.
  fill(59, up(1), 63, up(1), 8);
  fill(60, up(2), 63, up(2), 8);
  fill(61, up(3), 63, up(3), 8);

  const px = (tx: number) => tx * 8;
  const py = (ty: number) => ty * 8;

  const entities: GameProject["entities"] = [
    { type: ENT_PLAYER, x: px(3), y: py(up(2)) },
    { type: ENT_GOAL, x: px(62), y: py(up(5)) },
    { type: ENT_COIN, x: px(10), y: py(up(7)) },
    { type: ENT_COIN, x: px(11), y: py(up(7)) },
    { type: ENT_COIN, x: px(16), y: py(up(10)) },
    { type: ENT_COIN, x: px(23), y: py(up(3)) },
    { type: ENT_COIN, x: px(24), y: py(up(3)) },
    { type: ENT_COIN, x: px(30), y: py(up(8)) },
    { type: ENT_COIN, x: px(37), y: py(up(11)) },
    { type: ENT_COIN, x: px(45), y: py(up(3)) },
    { type: ENT_COIN, x: px(50), y: py(up(7)) },
    { type: ENT_COIN, x: px(57), y: py(up(8)) },
    { type: ENT_ENEMY, x: px(14), y: py(up(2)) },
    { type: ENT_ENEMY, x: px(30), y: py(up(2)) },
    { type: ENT_ENEMY, x: px(39), y: py(up(2)) },
    { type: ENT_ENEMY, x: px(50), y: py(up(2)) },
  ];

  return { level, entities };
}

// ------------------------------------------------------------------- export

export function createDefaultProject(): GameProject {
  const tiles: TileDef[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    const seed = TILE_SEEDS[i];
    tiles.push({
      pixels: tile(seed?.rows ?? []),
      palette: seed?.palette ?? 0,
      collision: seed?.collision ?? COL_EMPTY,
    });
  }

  const sprites: SpriteDef[] = [];
  for (let i = 0; i < SPRITE_COUNT; i++) {
    const seed = SPRITE_SEEDS[i];
    sprites.push({
      name: seed?.name ?? `Sprite ${i}`,
      pixels: sprite(seed?.rows ?? []),
      palette: seed?.palette ?? 0,
    });
  }

  const bgPalettes: number[][] = [];
  const objPalettes: number[][] = [];
  for (let i = 0; i < PALETTE_COUNT; i++) {
    bgPalettes.push([...(i === 0 ? BG_PALETTE_0 : GREY_RAMP)]);
  }
  objPalettes.push([...OBJ_PALETTE_PLAYER]);
  objPalettes.push([...OBJ_PALETTE_COIN]);
  objPalettes.push([...OBJ_PALETTE_ENEMY]);
  objPalettes.push([...OBJ_PALETTE_GOAL]);
  while (objPalettes.length < PALETTE_COUNT) objPalettes.push([...GREY_RAMP]);

  const { level, entities } = buildDemoLevel();

  return {
    version: 1,
    title: "MY SNES GAME",
    bgPalettes,
    objPalettes,
    tiles,
    sprites,
    level,
    entities,
    settings: {
      walkSpeed: 24, // 1.5 px/frame
      jumpPower: 72, // 4.5 px/frame
      gravity: 4, // 0.25 px/frame^2
      maxFall: 80, // 5 px/frame
      enemySpeed: 8, // 0.5 px/frame
    },
  };
}
