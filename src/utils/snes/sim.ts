/**
 * A JavaScript re-implementation of the ROM engine, used for the in-browser
 * preview. It mirrors the 65816 code in `engine.ts` step for step — same
 * 12.4 fixed point, same probe positions, same order of operations — so what
 * you play in the editor is what the exported ROM does.
 *
 * Also here: a renderer that composites the level and sprites the way the PPU
 * would, via pre-rendered tile and sprite atlases.
 */

import {
  COL_HAZARD,
  COL_ONEWAY,
  COL_SOLID,
  DEAD_FRAMES,
  EHITH,
  EHITW,
  EHITX,
  EHITY,
  ENT_COIN,
  ENT_ENEMY,
  ENT_GOAL,
  ENT_PLAYER,
  HITH,
  HITW,
  HITX,
  JOY_A,
  JOY_B,
  JOY_LEFT,
  JOY_RIGHT,
  LEVEL_H,
  LEVEL_PX_H,
  LEVEL_PX_W,
  LEVEL_W,
  MAX_ENTITIES,
  SCREEN_H,
  SCREEN_W,
  SLOT_PLAYER_IDLE,
  SLOT_PLAYER_JUMP,
  SPRITE_COUNT,
  STATE_DEAD,
  STATE_PLAY,
  STATE_WIN,
  TILE_COUNT,
  TYPE_TO_SLOT,
  WIN_FRAMES,
} from "./constants";
import { bgr555ToRgb } from "./gfx";
import type { GameProject } from "./types";

const CAM_MAX_X = LEVEL_PX_W - SCREEN_W;
const CAM_MAX_Y = LEVEL_PX_H - SCREEN_H;

/** Match the engine's logical shift on a 16-bit word. */
const px = (v: number) => (v & 0xffff) >>> 4;

interface SimEntity {
  type: number;
  x: number;
  y: number;
  vx: number;
  dead: boolean;
}

export interface SimSnapshot {
  playerX: number;
  playerY: number;
  playerSlot: number;
  facingLeft: boolean;
  camX: number;
  camY: number;
  score: number;
  state: number;
  entities: SimEntity[];
}

export class GameSim {
  private project: GameProject;
  private colmap: Uint8Array;

  plX = 0;
  plY = 0;
  plVX = 0;
  plVY = 0;
  onGround = false;
  facingLeft = false;
  camX = 0;
  camY = 0;
  state = STATE_PLAY;
  stateTimer = 0;
  score = 0;
  frame = 0;
  entities: SimEntity[] = [];

  private joy = 0;
  private joyNew = 0;

  constructor(project: GameProject) {
    this.project = project;
    this.colmap = new Uint8Array(LEVEL_W * LEVEL_H);
    this.rebuildCollision();
    this.reset();
  }

  /** Call after tiles or the level change so collision stays in sync. */
  rebuildCollision(): void {
    const { level, tiles } = this.project;
    for (let i = 0; i < this.colmap.length; i++) {
      this.colmap[i] = tiles[level[i] & 0xff]?.collision ?? 0;
    }
  }

  setProject(project: GameProject): void {
    this.project = project;
    this.rebuildCollision();
  }

  reset(): void {
    const p = this.project;
    this.plVX = 0;
    this.plVY = 0;
    this.onGround = false;
    this.facingLeft = false;
    this.state = STATE_PLAY;
    this.stateTimer = 0;
    this.score = 0;
    this.plX = 32 << 4;
    this.plY = 32 << 4;

    this.entities = [];
    for (let i = 0; i < MAX_ENTITIES; i++) {
      const e = p.entities[i];
      const type = e ? e.type : 0;
      const ent: SimEntity = {
        type,
        x: e ? e.x << 4 : 0,
        y: e ? e.y << 4 : 0,
        vx: type === ENT_ENEMY ? p.settings.enemySpeed : 0,
        dead: false,
      };
      if (type === ENT_PLAYER) {
        this.plX = ent.x;
        this.plY = ent.y;
        ent.dead = true; // the marker itself is never drawn
      }
      this.entities.push(ent);
    }
    this.updateCamera();
  }

  step(buttons: number): void {
    const prev = this.joy;
    this.joy = buttons;
    this.joyNew = (buttons ^ prev) & buttons;

    if (this.state === STATE_PLAY) {
      this.updatePlayer();
      this.updateEntities();
    } else {
      this.updateState();
    }
    this.updateCamera();
    this.frame++;
  }

  // ------------------------------------------------------------- collision

  collisionAt(x: number, y: number): number {
    if ((x & 0xffff) >= LEVEL_PX_W) return COL_SOLID;
    if ((y & 0xffff) >= LEVEL_PX_H) return 0;
    return this.colmap[(y >> 3) * LEVEL_W + (x >> 3)];
  }

  // ---------------------------------------------------------------- player

  private updatePlayer(): void {
    const s = this.project.settings;

    this.plVX = 0;
    if (this.joy & JOY_LEFT) {
      this.plVX = -s.walkSpeed;
      this.facingLeft = true;
    }
    if (this.joy & JOY_RIGHT) {
      this.plVX = s.walkSpeed;
      this.facingLeft = false;
    }

    if (this.onGround && this.joyNew & (JOY_A | JOY_B)) {
      this.plVY = -s.jumpPower;
      this.onGround = false;
    }

    if (this.onGround) {
      this.plVY = 0;
    } else {
      this.plVY += s.gravity;
      if (this.plVY > s.maxFall) this.plVY = s.maxFall;
    }

    this.moveX();
    this.moveY();
    this.checkGround();
    this.checkHazard();
  }

  private moveX(): void {
    if (this.plVX === 0) return;
    this.plX += this.plVX;
    const y0 = px(this.plY);
    const offsets = [0, HITH >> 1, HITH - 1];

    if (this.plVX > 0) {
      const edge = px(this.plX) + HITX + HITW - 1;
      for (const dy of offsets) {
        if (this.collisionAt(edge, y0 + dy) === COL_SOLID) {
          this.plX = ((edge & ~7) - (HITX + HITW)) << 4;
          this.plVX = 0;
          return;
        }
      }
    } else {
      const edge = px(this.plX) + HITX;
      for (const dy of offsets) {
        if (this.collisionAt(edge, y0 + dy) === COL_SOLID) {
          this.plX = ((edge & ~7) + 8 - HITX) << 4;
          this.plVX = 0;
          return;
        }
      }
    }
  }

  private moveY(): void {
    if (this.plVY === 0) return;
    const before = this.plY;
    this.plY += this.plVY;
    const x0 = px(this.plX);
    const offsets = [HITX, HITX + HITW - 1];

    if (this.plVY > 0) {
      const feet = px(this.plY) + HITH - 1;
      const prevFeet = px(before) + HITH - 1;
      for (const dx of offsets) {
        const type = this.collisionAt(x0 + dx, feet);
        const blocks =
          type === COL_SOLID || (type === COL_ONEWAY && (feet & ~7) > prevFeet);
        if (blocks) {
          this.plY = ((feet & ~7) - HITH) << 4;
          this.plVY = 0;
          this.onGround = true;
          return;
        }
      }
    } else {
      const head = px(this.plY);
      for (const dx of offsets) {
        if (this.collisionAt(x0 + dx, head) === COL_SOLID) {
          this.plY = ((head & ~7) + 8) << 4;
          this.plVY = 0;
          return;
        }
      }
    }
  }

  private checkGround(): void {
    this.onGround = false;
    if (this.plVY < 0) return;
    const below = px(this.plY) + HITH;
    const x0 = px(this.plX);
    for (const dx of [HITX, HITX + HITW - 1]) {
      const type = this.collisionAt(x0 + dx, below);
      if (type === COL_SOLID || (type === COL_ONEWAY && (below & 7) === 0)) {
        this.onGround = true;
        return;
      }
    }
  }

  private checkHazard(): void {
    if (px(this.plY) >= LEVEL_PX_H + 8) {
      this.die();
      return;
    }
    const cx = px(this.plX) + HITX + (HITW >> 1);
    // Head, waist and feet, so hazards kill from any direction.
    for (const dy of [1, HITH >> 1, HITH - 1]) {
      if (this.collisionAt(cx, px(this.plY) + dy) === COL_HAZARD) {
        this.die();
        return;
      }
    }
  }

  private die(): void {
    if (this.state !== STATE_PLAY) return;
    this.state = STATE_DEAD;
    this.stateTimer = 0;
    this.plVX = 0;
    this.plVY = -this.project.settings.jumpPower;
    this.onGround = false;
  }

  // -------------------------------------------------------------- entities

  private updateEntities(): void {
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.dead) continue;
      if (e.type === ENT_COIN) {
        if (this.overlaps(e)) {
          e.dead = true;
          this.score++;
        }
      } else if (e.type === ENT_ENEMY) {
        this.updateEnemy(e);
      } else if (e.type === ENT_GOAL) {
        if (this.overlaps(e) && this.state === STATE_PLAY) {
          this.state = STATE_WIN;
          this.stateTimer = 0;
        }
      }
    }
  }

  private updateEnemy(e: SimEntity): void {
    e.x += e.vx;
    const ahead = e.vx >= 0 ? px(e.x) + EHITX + EHITW : px(e.x) + EHITX - 1;
    const midY = px(e.y) + EHITY + EHITH - 2;
    const wall = this.collisionAt(ahead, midY) === COL_SOLID;
    const floor =
      this.collisionAt(ahead, px(e.y) + EHITY + EHITH + 2) === COL_SOLID;
    if (wall || !floor) {
      e.vx = -e.vx;
      e.x += e.vx;
    }

    if (!this.overlaps(e)) return;
    if (this.plVY < 0) {
      this.die();
      return;
    }
    const prevFeet = px(this.plY - this.plVY) + HITH;
    if (px(e.y) + 8 >= prevFeet) {
      e.dead = true;
      this.plVY = -this.project.settings.jumpPower;
      this.onGround = false;
    } else {
      this.die();
    }
  }

  private overlaps(e: SimEntity): boolean {
    const ex = px(e.x) + EHITX;
    const ey = px(e.y) + EHITY;
    const pxx = px(this.plX) + HITX;
    const pyy = px(this.plY);
    return (
      pxx < ex + EHITW && ex < pxx + HITW && pyy < ey + EHITH && ey < pyy + HITH
    );
  }

  // ----------------------------------------------------------------- state

  private updateState(): void {
    this.stateTimer++;
    if (this.state === STATE_DEAD) {
      this.plVY += this.project.settings.gravity;
      this.plY += this.plVY;
      if (this.stateTimer >= DEAD_FRAMES) this.reset();
    } else if (this.stateTimer >= WIN_FRAMES) {
      this.reset();
    }
  }

  private updateCamera(): void {
    let x = px(this.plX) - (SCREEN_W / 2 - 8);
    if (x < 0) x = 0;
    if (x > CAM_MAX_X) x = CAM_MAX_X;
    this.camX = x;
    let y = px(this.plY) - (SCREEN_H / 2 - 8);
    if (y < 0) y = 0;
    if (y > CAM_MAX_Y) y = CAM_MAX_Y;
    this.camY = y;
  }

  playerSlot(): number {
    if (!this.onGround) return SLOT_PLAYER_JUMP;
    if (this.plVX !== 0) return ((this.frame >> 3) & 1) + 1;
    return SLOT_PLAYER_IDLE;
  }

  snapshot(): SimSnapshot {
    return {
      playerX: px(this.plX),
      playerY: px(this.plY),
      playerSlot: this.playerSlot(),
      facingLeft: this.facingLeft,
      camX: this.camX,
      camY: this.camY,
      score: this.score,
      state: this.state,
      entities: this.entities,
    };
  }
}

// ------------------------------------------------------------------ drawing

/**
 * Pre-rendered tile and sprite sheets. Rebuilt whenever graphics or palettes
 * change, then blitted per frame, which keeps preview rendering cheap.
 */
export class Atlas {
  tiles: HTMLCanvasElement;
  sprites: HTMLCanvasElement;
  backdrop = "#000";

  constructor() {
    this.tiles = document.createElement("canvas");
    this.tiles.width = 16 * 8;
    this.tiles.height = 16 * 8;
    this.sprites = document.createElement("canvas");
    this.sprites.width = 8 * 16;
    this.sprites.height = 4 * 16;
  }

  rebuild(project: GameProject): void {
    const [br, bg, bb] = bgr555ToRgb(project.bgPalettes[0][0]);
    this.backdrop = `rgb(${br},${bg},${bb})`;

    const tctx = this.tiles.getContext("2d")!;
    tctx.clearRect(0, 0, this.tiles.width, this.tiles.height);
    const timg = tctx.createImageData(16 * 8, 16 * 8);
    for (let t = 0; t < TILE_COUNT; t++) {
      const def = project.tiles[t];
      const palette = project.bgPalettes[def.palette & 7];
      const ox = (t % 16) * 8;
      const oy = ((t / 16) | 0) * 8;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const index = def.pixels[y * 8 + x] & 0x0f;
          const o = ((oy + y) * 128 + ox + x) * 4;
          if (index === 0) {
            timg.data[o + 3] = 0;
            continue;
          }
          const [r, g, b] = bgr555ToRgb(palette[index]);
          timg.data[o] = r;
          timg.data[o + 1] = g;
          timg.data[o + 2] = b;
          timg.data[o + 3] = 255;
        }
      }
    }
    tctx.putImageData(timg, 0, 0);

    const sctx = this.sprites.getContext("2d")!;
    sctx.clearRect(0, 0, this.sprites.width, this.sprites.height);
    const simg = sctx.createImageData(8 * 16, 4 * 16);
    for (let s = 0; s < SPRITE_COUNT; s++) {
      const def = project.sprites[s];
      const palette = project.objPalettes[def.palette & 7];
      const ox = (s % 8) * 16;
      const oy = ((s / 8) | 0) * 16;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const index = def.pixels[y * 16 + x] & 0x0f;
          const o = ((oy + y) * 128 + ox + x) * 4;
          if (index === 0) {
            simg.data[o + 3] = 0;
            continue;
          }
          const [r, g, b] = bgr555ToRgb(palette[index]);
          simg.data[o] = r;
          simg.data[o + 1] = g;
          simg.data[o + 2] = b;
          simg.data[o + 3] = 255;
        }
      }
    }
    sctx.putImageData(simg, 0, 0);
  }

  drawTile(
    ctx: CanvasRenderingContext2D,
    tile: number,
    dx: number,
    dy: number,
    size = 8
  ): void {
    const sx = (tile % 16) * 8;
    const sy = ((tile / 16) | 0) * 8;
    ctx.drawImage(this.tiles, sx, sy, 8, 8, dx, dy, size, size);
  }

  drawSprite(
    ctx: CanvasRenderingContext2D,
    slot: number,
    dx: number,
    dy: number,
    flip = false,
    size = 16
  ): void {
    const sx = (slot % 8) * 16;
    const sy = ((slot / 8) | 0) * 16;
    if (flip) {
      ctx.save();
      ctx.translate(dx + size, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(this.sprites, sx, sy, 16, 16, 0, 0, size, size);
      ctx.restore();
    } else {
      ctx.drawImage(this.sprites, sx, sy, 16, 16, dx, dy, size, size);
    }
  }
}

/** Draw one frame of the game exactly as the SNES would compose it. */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  project: GameProject,
  sim: GameSim
): void {
  const snap = sim.snapshot();
  ctx.fillStyle = atlas.backdrop;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const startX = snap.camX >> 3;
  const startY = snap.camY >> 3;
  const offX = snap.camX & 7;
  const offY = snap.camY & 7;
  for (let ty = 0; ty <= SCREEN_H / 8; ty++) {
    const my = startY + ty;
    if (my < 0 || my >= LEVEL_H) continue;
    for (let tx = 0; tx <= SCREEN_W / 8; tx++) {
      const mx = startX + tx;
      if (mx < 0 || mx >= LEVEL_W) continue;
      const tile = project.level[my * LEVEL_W + mx] & 0xff;
      if (tile === 0) continue;
      atlas.drawTile(ctx, tile, tx * 8 - offX, ty * 8 - offY);
    }
  }

  for (const e of snap.entities) {
    if (e.dead || e.type === 0) continue;
    const slot = TYPE_TO_SLOT[e.type] ?? 0;
    atlas.drawSprite(
      ctx,
      slot,
      ((e.x & 0xffff) >>> 4) - snap.camX,
      ((e.y & 0xffff) >>> 4) - snap.camY
    );
  }

  atlas.drawSprite(
    ctx,
    snap.playerSlot,
    snap.playerX - snap.camX,
    snap.playerY - snap.camY,
    snap.facingLeft
  );
}
