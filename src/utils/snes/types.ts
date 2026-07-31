import {
  LEVEL_H,
  LEVEL_W,
  MAX_ENTITIES,
  PALETTE_COUNT,
  SPRITE_COUNT,
  TILE_COUNT,
} from "./constants";

/** One 8x8 background tile: 64 palette indices (0-15) plus its metadata. */
export interface TileDef {
  /** 64 entries, row-major, values 0-15. */
  pixels: number[];
  /** Which of the 8 background palettes to draw this tile with. */
  palette: number;
  /** COL_EMPTY | COL_SOLID | COL_HAZARD | COL_ONEWAY */
  collision: number;
}

/** One 16x16 object: 256 palette indices (0-15). */
export interface SpriteDef {
  name: string;
  /** 256 entries, row-major, values 0-15 (0 is transparent). */
  pixels: number[];
  /** Which of the 8 object palettes to draw this sprite with. */
  palette: number;
}

export interface EntityInst {
  type: number;
  /** Pixel position of the sprite's top-left corner within the level. */
  x: number;
  y: number;
}

export interface GameSettings {
  /** All speeds are in 12.4 fixed point: 16 units == 1 pixel per frame. */
  walkSpeed: number;
  jumpPower: number;
  gravity: number;
  maxFall: number;
  enemySpeed: number;
}

export interface GameProject {
  version: 1;
  title: string;
  /** 8 palettes of 16 BGR555 colors, used by background tiles. */
  bgPalettes: number[][];
  /** 8 palettes of 16 BGR555 colors, used by sprites (index 0 transparent). */
  objPalettes: number[][];
  tiles: TileDef[];
  sprites: SpriteDef[];
  /** LEVEL_W * LEVEL_H tile indices, row-major. */
  level: number[];
  entities: EntityInst[];
  settings: GameSettings;
}

/** Throws if `project` is not a shape the ROM builder can handle. */
export function validateProject(project: GameProject): void {
  const problems: string[] = [];
  if (project.tiles.length !== TILE_COUNT) {
    problems.push(`expected ${TILE_COUNT} tiles, got ${project.tiles.length}`);
  }
  if (project.sprites.length !== SPRITE_COUNT) {
    problems.push(
      `expected ${SPRITE_COUNT} sprites, got ${project.sprites.length}`
    );
  }
  if (project.level.length !== LEVEL_W * LEVEL_H) {
    problems.push(
      `expected ${LEVEL_W * LEVEL_H} level cells, got ${project.level.length}`
    );
  }
  if (project.entities.length > MAX_ENTITIES) {
    problems.push(`at most ${MAX_ENTITIES} entities are supported`);
  }
  if (project.bgPalettes.length !== PALETTE_COUNT) {
    problems.push(`expected ${PALETTE_COUNT} background palettes`);
  }
  if (project.objPalettes.length !== PALETTE_COUNT) {
    problems.push(`expected ${PALETTE_COUNT} object palettes`);
  }
  if (problems.length) {
    throw new Error(`Invalid project: ${problems.join("; ")}`);
  }
}
