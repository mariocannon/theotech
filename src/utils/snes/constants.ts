/**
 * Memory map and gameplay constants shared by the ROM engine, the ROM builder
 * and the browser preview simulator.
 *
 * Positions and velocities use 12.4 fixed point: one pixel is 16 units. That
 * keeps everything inside a signed 16-bit word for a 512x512 pixel level while
 * still giving sub-pixel movement.
 */

// ------------------------------------------------------------------ project

export const LEVEL_W = 64;
export const LEVEL_H = 64;
export const LEVEL_PX_W = LEVEL_W * 8; // 512
export const LEVEL_PX_H = LEVEL_H * 8; // 512

export const SCREEN_W = 256;
export const SCREEN_H = 224;

export const TILE_COUNT = 256;
export const SPRITE_COUNT = 32;
export const MAX_ENTITIES = 32;
export const PALETTE_COUNT = 8;

/** Collision behaviour of a background tile. */
export const COL_EMPTY = 0;
export const COL_SOLID = 1;
export const COL_HAZARD = 2;
export const COL_ONEWAY = 3;

export const COLLISION_NAMES = ["Empty", "Solid", "Hazard", "One-way"] as const;

/** Entity kinds that can be placed in a level. */
export const ENT_NONE = 0;
export const ENT_PLAYER = 1;
export const ENT_COIN = 2;
export const ENT_ENEMY = 3;
export const ENT_GOAL = 4;

export const ENTITY_NAMES: Record<number, string> = {
  [ENT_PLAYER]: "Player start",
  [ENT_COIN]: "Coin",
  [ENT_ENEMY]: "Enemy",
  [ENT_GOAL]: "Goal",
};

/** Sprite slot used to draw each entity type (index = entity type). */
export const TYPE_TO_SLOT = [0, 0, 4, 5, 7];

/** Fixed sprite slots the engine references by number. */
export const SLOT_PLAYER_IDLE = 0;
export const SLOT_PLAYER_WALK_A = 1;
export const SLOT_PLAYER_WALK_B = 2;
export const SLOT_PLAYER_JUMP = 3;
export const SLOT_COIN = 4;
export const SLOT_ENEMY = 5;
export const SLOT_GOAL = 7;

// ----------------------------------------------------------------- hitboxes

export const HITX = 2; // player hitbox inset from the left of the 16x16 sprite
export const HITW = 12;
export const HITH = 16;

export const EHITX = 2; // entity hitbox inset
export const EHITY = 2;
export const EHITW = 12;
export const EHITH = 12;

// -------------------------------------------------------------- game states

export const STATE_PLAY = 0;
export const STATE_DEAD = 1;
export const STATE_WIN = 2;

export const DEAD_FRAMES = 90;
export const WIN_FRAMES = 240;

// ---------------------------------------------------------- direct page vars

export const DP = {
  frame: 0x00,
  joy: 0x02,
  joyNew: 0x04,
  joyOld: 0x06,
  plX: 0x08,
  plY: 0x0a,
  plVX: 0x0c,
  plVY: 0x0e,
  plOnGround: 0x10,
  plFacing: 0x12,
  camX: 0x14,
  camY: 0x16,
  state: 0x18,
  stateTimer: 0x1a,
  tmpA: 0x1c,
  tmpB: 0x1e,
  tmpC: 0x20,
  tmpD: 0x22,
  oamIdx: 0x24,
  score: 0x26,
  entIdx: 0x28,
  entIdx2: 0x2a,
  vblankDone: 0x2c,
  tmpE: 0x2e,
  tmpF: 0x30,
  tmpG: 0x32,
} as const;

// --------------------------------------------------------------- WRAM (bank 0 mirror)

export const RAM_ENT_TYPE = 0x0100; // 32 bytes
export const RAM_ENT_STATE = 0x0120; // 32 bytes
export const RAM_ENT_X = 0x0140; // 32 words
export const RAM_ENT_Y = 0x0180; // 32 words
export const RAM_ENT_VX = 0x01c0; // 32 words
export const RAM_OAM_LO = 0x0200; // 512 bytes
export const RAM_OAM_HI = 0x0400; // 32 bytes

// ---------------------------------------------------------------- ROM layout

export const ROM_SIZE = 0x40000; // 256 KiB

/** Bank $00 holds the engine plus small tables. */
export const CODE_BANK = 0x00;
export const CODE_ORIGIN = 0x8000;

export const ADDR_BG_PAL = 0xf000; // bank $00, 256 bytes
export const ADDR_OBJ_PAL = 0xf100; // bank $00, 256 bytes
export const ADDR_ENT_TYPE = 0xf200; // bank $00, 32 bytes
export const ADDR_ENT_X = 0xf220; // bank $00, 32 words (12.4)
export const ADDR_ENT_Y = 0xf260; // bank $00, 32 words (12.4)
export const ADDR_TYPE_SLOT = 0xf2a0; // bank $00, 8 bytes
export const ADDR_SLOT_TILE = 0xf2b0; // bank $00, 32 bytes
export const ADDR_SLOT_ATTR = 0xf2d0; // bank $00, 32 bytes
export const ADDR_OAM_MASK = 0xf2f0; // bank $00, 4 bytes

/** Bank $01 holds bulk data, addressed as $01:8000-$FFFF. */
export const DATA_BANK = 0x01;
export const ADDR_BG_GFX = 0x8000; // 8192 bytes (256 tiles, 4bpp)
export const ADDR_OBJ_GFX = 0xa000; // 4096 bytes (128 tiles, 4bpp)
export const ADDR_COLMAP = 0xb000; // 4096 bytes (one per level cell)
export const ADDR_TILEMAP = 0xc000; // 8192 bytes (64x64 tilemap words)

/** VRAM word addresses. */
export const VRAM_TILEMAP = 0x0000;
export const VRAM_BG_CHR = 0x1000;
export const VRAM_OBJ_CHR = 0x2000;

// ------------------------------------------------------------------ joypad

export const JOY_B = 0x8000;
export const JOY_Y = 0x4000;
export const JOY_SELECT = 0x2000;
export const JOY_START = 0x1000;
export const JOY_UP = 0x0800;
export const JOY_DOWN = 0x0400;
export const JOY_LEFT = 0x0200;
export const JOY_RIGHT = 0x0100;
export const JOY_A = 0x0080;
export const JOY_X = 0x0040;
export const JOY_L = 0x0020;
export const JOY_R = 0x0010;
