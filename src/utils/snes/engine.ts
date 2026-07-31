/**
 * The SNES side of the builder: a platformer engine emitted as 65816 machine
 * code. Everything the user edits (graphics, palettes, the level, entity
 * placement) is baked into data tables the engine reads; the tuning values in
 * `settings` are baked in as immediates.
 *
 * Video setup is BG mode 1 with a single 64x64 background layer plus 16x16
 * objects:
 *   VRAM word $0000  tilemap   (4 screens, 8 KiB)
 *   VRAM word $1000  BG chars  (256 tiles, 4bpp)
 *   VRAM word $2000  OBJ chars (128 tiles, 4bpp)
 */

import { Asm } from "./asm65816";
import {
  ADDR_BG_GFX,
  ADDR_BG_PAL,
  ADDR_COLMAP,
  ADDR_ENT_TYPE,
  ADDR_ENT_X,
  ADDR_ENT_Y,
  ADDR_OAM_MASK,
  ADDR_OBJ_GFX,
  ADDR_SLOT_ATTR,
  ADDR_SLOT_TILE,
  ADDR_TILEMAP,
  ADDR_TYPE_SLOT,
  CODE_BANK,
  CODE_ORIGIN,
  COL_ONEWAY,
  COL_SOLID,
  COL_HAZARD,
  DATA_BANK,
  DEAD_FRAMES,
  DP,
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
  LEVEL_PX_H,
  LEVEL_PX_W,
  MAX_ENTITIES,
  RAM_ENT_STATE,
  RAM_ENT_TYPE,
  RAM_ENT_VX,
  RAM_ENT_X,
  RAM_ENT_Y,
  RAM_OAM_HI,
  RAM_OAM_LO,
  SCREEN_H,
  SCREEN_W,
  SLOT_PLAYER_IDLE,
  SLOT_PLAYER_JUMP,
  STATE_DEAD,
  STATE_WIN,
  VRAM_BG_CHR,
  VRAM_OBJ_CHR,
  VRAM_TILEMAP,
  WIN_FRAMES,
} from "./constants";
import type { GameSettings } from "./types";

const CAM_MAX_X = LEVEL_PX_W - SCREEN_W; // 256
const CAM_MAX_Y = LEVEL_PX_H - SCREEN_H; // 288

/** Assemble the engine for `settings` into bank $00. */
export function buildEngine(settings: GameSettings): Asm {
  const a = new Asm(CODE_BANK, CODE_ORIGIN);

  const WALK = settings.walkSpeed;
  const JUMP = settings.jumpPower;
  const GRAV = settings.gravity;
  const MAXFALL = settings.maxFall;
  const ESPEED = settings.enemySpeed;

  const neg = (v: number) => (0x10000 - v) & 0xffff;

  // Convert a 12.4 direct-page word into whole pixels in A.
  const toPixels = (v: number) => a.ldaDp(v).lsrA(4);

  reset();
  nmi();
  irqStub();
  mainLoop();
  readInput();
  initRegs();
  clearVram();
  loadGfx();
  initGame();
  updateCamera();
  updateState();
  updatePlayer();
  moveX();
  moveY();
  checkGround();
  checkHazard();
  die();
  isSolid();
  solidDownMove();
  solidDownGround();
  updateEntities();
  entCoin();
  entGoal();
  entEnemy();
  entOverlap();
  buildOam();
  drawSprite();
  playerSlot();

  a.l("ZeroSrc").db(0x00, 0x00);

  return a;

  // ------------------------------------------------------------------ boot

  function reset() {
    a.l("Reset");
    a.assume({ a: 8, i: 8 });
    a.sei().cld();
    a.clc().xce(); // leave emulation mode
    a.rep(0x38); // 16-bit A/X/Y, decimal off
    a.ldaImm(0x1fff).tcs();
    a.ldaImm(0x0000).tcd(); // direct page at $0000
    a.a8();
    a.ldaImm(0x00).pha().plb(); // data bank $00

    a.jsr("InitRegs").assume({ a: 8, i: 16 });

    // Clear all 128 KiB of WRAM. This wipes the stack, so it has to run
    // outside of any subroutine call.
    a.a8();
    a.stzAbs(0x2181).stzAbs(0x2182).stzAbs(0x2183);
    a.ldaImm(0x08).staAbs(0x4300); // A->B, fixed source, one register
    a.ldaImm(0x80).staAbs(0x4301); // WMDATA
    a.i16().ldxImm("ZeroSrc").stxAbs(0x4302);
    a.ldaImm(CODE_BANK).staAbs(0x4304);
    a.ldxImm(0x0000).stxAbs(0x4305); // 0 means 65536 bytes
    a.ldaImm(0x01).staAbs(0x420b);
    a.ldaImm(0x01).staAbs(0x420b); // second 64 KiB

    a.jsr("ClearVRAM").assume({ a: 8, i: 16 });
    a.jsr("LoadGfx").assume({ a: 8, i: 16 });
    a.jsr("InitGame").assume({ a: 16, i: 16 });
    a.jsr("BuildOAM").assume({ a: 16, i: 16 });

    a.a8();
    a.ldaImm(0x0f).staAbs(0x2100); // screen on, full brightness
    a.ldaImm(0x81).staAbs(0x4200); // NMI + auto joypad read
    a.cli();
    a.jmp("MainLoop");
  }

  function nmi() {
    a.l("NMI");
    a.assume({ a: 16, i: 16 });
    a.rep(0x30);
    a.pha().phx().phy();
    a.phb().phd();
    a.a8();
    a.ldaImm(0x00).pha().plb();
    a.a16().ldaImm(0x0000).tcd();
    a.a8();
    a.ldaAbs(0x4210); // acknowledge the NMI

    // Scroll registers are write-twice, low byte first.
    a.a16().ldaDp(DP.camX);
    a.a8().staAbs(0x210d).xba().staAbs(0x210d);
    // BGnVOFS displays scanline VOFS+1, so the camera row needs a -1 bias.
    a.a16().ldaDp(DP.camY).decA();
    a.a8().staAbs(0x210e).xba().staAbs(0x210e);

    // Copy the OAM shadow buffer into the PPU.
    a.stzAbs(0x2102).stzAbs(0x2103);
    a.ldaImm(0x00).staAbs(0x4300); // A->B, increment, one register
    a.ldaImm(0x04).staAbs(0x4301); // OAMDATA
    a.i16().ldxImm(RAM_OAM_LO).stxAbs(0x4302);
    a.ldaImm(0x00).staAbs(0x4304);
    a.ldxImm(0x0220).stxAbs(0x4305); // 512 + 32 bytes
    a.ldaImm(0x01).staAbs(0x420b);

    a.ldaImm(0x01).staDp(DP.vblankDone);

    a.rep(0x30);
    a.pld().plb();
    a.ply().plx().pla();
    a.rti();
  }

  function irqStub() {
    a.l("IrqStub");
    a.rti();
  }

  // ------------------------------------------------------------- main loop

  function mainLoop() {
    a.l("MainLoop");
    a.assume({ a: 8, i: 16 });
    a.a8();
    a.l(".wait");
    a.ldaDp(DP.vblankDone).beq(".wait");
    a.stzDp(DP.vblankDone);

    a.jsr("ReadInput").assume({ a: 16, i: 16 });
    a.a16();
    a.ldaDp(DP.state).bne(".paused");
    a.jsr("UpdatePlayer").assume({ a: 16, i: 16 });
    a.jsr("UpdateEntities").assume({ a: 16, i: 16 });
    a.bra(".camera");
    a.l(".paused");
    a.jsr("UpdateState").assume({ a: 16, i: 16 });
    a.l(".camera");
    a.jsr("UpdateCamera").assume({ a: 16, i: 16 });
    a.jsr("BuildOAM").assume({ a: 16, i: 16 });
    a.a16().incDp(DP.frame);
    a.jmp("MainLoop");
  }

  function readInput() {
    a.l("ReadInput");
    a.assume({ a: 8, i: 16 });
    a.a8();
    a.l(".busy");
    a.ldaAbs(0x4212).andImm(0x01).bne(".busy"); // wait for auto-read to finish
    a.a16();
    a.ldaDp(DP.joy).staDp(DP.joyOld);
    a.ldaAbs(0x4218).staDp(DP.joy);
    a.eorDp(DP.joyOld).andDp(DP.joy).staDp(DP.joyNew);
    a.rts();
  }

  // ------------------------------------------------------------ ppu set-up

  function initRegs() {
    a.l("InitRegs");
    a.assume({ a: 8, i: 16 });
    a.a8();
    a.ldaImm(0x8f).staAbs(0x2100); // forced blank

    a.i16();
    a.ldxImm(0x2101);
    a.l(".ppu");
    a.stzAbsX(0x0000);
    a.inx();
    a.cpxImm(0x2134).bne(".ppu");

    a.stzAbs(0x4200);
    a.ldaImm(0xff).staAbs(0x4201);
    a.ldxImm(0x4202);
    a.l(".cpu");
    a.stzAbsX(0x0000);
    a.inx();
    a.cpxImm(0x420e).bne(".cpu");

    // Our own configuration.
    a.ldaImm(0x01).staAbs(0x2105); // BG mode 1
    a.ldaImm(0x03).staAbs(0x2107); // BG1 map at word $0000, 64x64
    a.ldaImm(VRAM_BG_CHR >> 12).staAbs(0x210b); // BG1 chars at word $1000
    a.ldaImm(VRAM_OBJ_CHR >> 13).staAbs(0x2101); // OBJ 8x8/16x16, chars $2000
    a.ldaImm(0x11).staAbs(0x212c); // main screen: BG1 + OBJ
    a.stzAbs(0x212d);
    a.rts();
  }

  function clearVram() {
    a.l("ClearVRAM");
    a.assume({ a: 8, i: 16 });
    a.a8();
    a.ldaImm(0x80).staAbs(0x2115); // increment after $2119, one word
    a.i16().ldxImm(0x0000).stxAbs(0x2116);
    a.ldaImm(0x09).staAbs(0x4300); // A->B, fixed source, two registers
    a.ldaImm(0x18).staAbs(0x4301); // VMDATAL
    a.ldxImm("ZeroSrc").stxAbs(0x4302);
    a.ldaImm(CODE_BANK).staAbs(0x4304);
    a.ldxImm(0x0000).stxAbs(0x4305); // all 64 KiB
    a.ldaImm(0x01).staAbs(0x420b);
    a.rts();
  }

  function loadGfx() {
    a.l("LoadGfx");
    a.assume({ a: 8, i: 16 });
    a.a8();

    // Palettes: 8 background then 8 object palettes fill CGRAM in one go.
    a.stzAbs(0x2121);
    a.ldaImm(0x00).staAbs(0x4300); // A->B, increment, one register
    a.ldaImm(0x22).staAbs(0x4301); // CGDATA
    a.i16().ldxImm(ADDR_BG_PAL).stxAbs(0x4302);
    a.ldaImm(CODE_BANK).staAbs(0x4304);
    a.ldxImm(0x0200).stxAbs(0x4305);
    a.ldaImm(0x01).staAbs(0x420b);

    a.ldaImm(0x80).staAbs(0x2115);
    a.ldaImm(0x01).staAbs(0x4300); // A->B, increment, two registers
    a.ldaImm(0x18).staAbs(0x4301); // VMDATAL
    a.ldaImm(DATA_BANK).staAbs(0x4304);

    const dma = (vramWord: number, source: number, bytes: number) => {
      a.ldxImm(vramWord).stxAbs(0x2116);
      a.ldxImm(source).stxAbs(0x4302);
      a.ldxImm(bytes).stxAbs(0x4305);
      a.ldaImm(0x01).staAbs(0x420b);
    };
    dma(VRAM_BG_CHR, ADDR_BG_GFX, 0x2000);
    dma(VRAM_OBJ_CHR, ADDR_OBJ_GFX, 0x1000);
    dma(VRAM_TILEMAP, ADDR_TILEMAP, 0x2000);
    a.rts();
  }

  // ------------------------------------------------------------ level set-up

  function initGame() {
    a.l("InitGame");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.stzDp(DP.plVX).stzDp(DP.plVY).stzDp(DP.state).stzDp(DP.stateTimer);
    a.stzDp(DP.plOnGround).stzDp(DP.plFacing).stzDp(DP.score);
    a.stzDp(DP.camX).stzDp(DP.camY);
    // Fallback spawn if the level has no player-start entity.
    a.ldaImm(32 << 4)
      .staDp(DP.plX)
      .staDp(DP.plY);

    a.ldxImm(0x0000); // entity index
    a.ldyImm(0x0000); // entity index * 2
    a.l(".loop");
    a.a8();
    a.ldaAbsX(ADDR_ENT_TYPE);
    a.staAbsX(RAM_ENT_TYPE);
    a.stzAbsX(RAM_ENT_STATE);
    a.cmpImm(ENT_PLAYER).bne(".notPlayer");
    a.a16();
    a.ldaAbsY(ADDR_ENT_X).staDp(DP.plX);
    a.ldaAbsY(ADDR_ENT_Y).staDp(DP.plY);
    a.a8();
    a.ldaImm(0x01).staAbsX(RAM_ENT_STATE); // the marker itself is not drawn
    a.l(".notPlayer");
    a.a16();
    a.ldaAbsY(ADDR_ENT_X).staAbsY(RAM_ENT_X);
    a.ldaAbsY(ADDR_ENT_Y).staAbsY(RAM_ENT_Y);
    a.ldaImm(0x0000).staAbsY(RAM_ENT_VX); // STZ has no abs,Y mode
    a.a8();
    a.ldaAbsX(RAM_ENT_TYPE).cmpImm(ENT_ENEMY).bne(".noVel");
    a.a16();
    a.ldaImm(ESPEED).staAbsY(RAM_ENT_VX);
    a.l(".noVel");
    a.a16();
    a.inx();
    a.iny().iny();
    a.cpxImm(MAX_ENTITIES).bne(".loop");

    a.jsr("UpdateCamera").assume({ a: 16, i: 16 });
    a.rts();
  }

  function updateCamera() {
    a.l("UpdateCamera");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    toPixels(DP.plX);
    a.sec()
      .sbcImm(SCREEN_W / 2 - 8)
      .bpl(".xlo");
    a.ldaImm(0x0000);
    a.l(".xlo");
    a.cmpImm(CAM_MAX_X + 1).bcc(".xhi");
    a.ldaImm(CAM_MAX_X);
    a.l(".xhi");
    a.staDp(DP.camX);

    toPixels(DP.plY);
    a.sec()
      .sbcImm(SCREEN_H / 2 - 8)
      .bpl(".ylo");
    a.ldaImm(0x0000);
    a.l(".ylo");
    a.cmpImm(CAM_MAX_Y + 1).bcc(".yhi");
    a.ldaImm(CAM_MAX_Y);
    a.l(".yhi");
    a.staDp(DP.camY);
    a.rts();
  }

  function updateState() {
    a.l("UpdateState");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.incDp(DP.stateTimer);
    a.ldaDp(DP.state).cmpImm(STATE_DEAD).bne(".win");
    // Let the corpse keep falling so death reads as a real event.
    a.ldaDp(DP.plVY).clc().adcImm(GRAV).staDp(DP.plVY);
    a.ldaDp(DP.plY).clc().adcDp(DP.plVY).staDp(DP.plY);
    a.ldaDp(DP.stateTimer).cmpImm(DEAD_FRAMES).bcc(".done");
    a.bra(".restart");
    a.l(".win");
    a.ldaDp(DP.stateTimer).cmpImm(WIN_FRAMES).bcc(".done");
    a.l(".restart");
    a.jsr("InitGame").assume({ a: 16, i: 16 });
    a.l(".done");
    a.rts();
  }

  // --------------------------------------------------------------- player

  function updatePlayer() {
    a.l("UpdatePlayer");
    a.assume({ a: 16, i: 16 });
    a.ai16();

    a.stzDp(DP.plVX);
    a.ldaDp(DP.joy).andImm(JOY_LEFT).beq(".noLeft");
    a.ldaImm(neg(WALK)).staDp(DP.plVX);
    a.ldaImm(0x0001).staDp(DP.plFacing);
    a.l(".noLeft");
    a.ldaDp(DP.joy).andImm(JOY_RIGHT).beq(".noRight");
    a.ldaImm(WALK).staDp(DP.plVX);
    a.stzDp(DP.plFacing);
    a.l(".noRight");

    a.ldaDp(DP.plOnGround).beq(".noJump");
    a.ldaDp(DP.joyNew)
      .andImm(JOY_A | JOY_B)
      .beq(".noJump");
    a.ldaImm(neg(JUMP)).staDp(DP.plVY);
    a.stzDp(DP.plOnGround);
    a.l(".noJump");

    // Gravity only accumulates in the air. Letting it build up while standing
    // would push the player a pixel into the floor and snap them back out
    // every few frames, which reads as a visible jitter.
    a.ldaDp(DP.plOnGround).beq(".gravity");
    a.stzDp(DP.plVY);
    a.bra(".noClamp");
    a.l(".gravity");
    a.ldaDp(DP.plVY).clc().adcImm(GRAV).staDp(DP.plVY);
    a.bmi(".noClamp"); // still moving upwards
    a.cmpImm(MAXFALL + 1).bcc(".noClamp");
    a.ldaImm(MAXFALL).staDp(DP.plVY);
    a.l(".noClamp");

    a.jsr("MoveX").assume({ a: 16, i: 16 });
    a.jsr("MoveY").assume({ a: 16, i: 16 });
    a.jsr("CheckGround").assume({ a: 16, i: 16 });
    a.jsr("CheckHazard").assume({ a: 16, i: 16 });
    a.rts();
  }

  function moveX() {
    a.l("MoveX");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.ldaDp(DP.plVX).bne(".move");
    a.rts(); // not moving horizontally, nothing to resolve
    a.l(".move");
    a.clc().adcDp(DP.plX).staDp(DP.plX);
    a.ldaDp(DP.plVX).bmi(".left");

    // Moving right: probe the leading edge at three heights.
    toPixels(DP.plX);
    a.clc()
      .adcImm(HITX + HITW - 1)
      .staDp(DP.tmpA);
    toPixels(DP.plY);
    a.staDp(DP.tmpE);
    for (const yoff of [0, HITH >> 1, HITH - 1]) {
      a.ldaDp(DP.tmpE);
      if (yoff) a.clc().adcImm(yoff);
      a.staDp(DP.tmpB);
      a.jsr("IsSolid").assume({ a: 16, i: 16 });
      a.cmpImm(COL_SOLID).beq(".hitR");
    }
    a.rts();
    a.l(".hitR");
    a.ldaDp(DP.tmpA)
      .andImm(0xfff8)
      .sec()
      .sbcImm(HITX + HITW)
      .aslA(4);
    a.staDp(DP.plX);
    a.stzDp(DP.plVX);
    a.rts();

    a.l(".left");
    toPixels(DP.plX);
    a.clc().adcImm(HITX).staDp(DP.tmpA);
    toPixels(DP.plY);
    a.staDp(DP.tmpE);
    for (const yoff of [0, HITH >> 1, HITH - 1]) {
      a.ldaDp(DP.tmpE);
      if (yoff) a.clc().adcImm(yoff);
      a.staDp(DP.tmpB);
      a.jsr("IsSolid").assume({ a: 16, i: 16 });
      a.cmpImm(COL_SOLID).beq(".hitL");
    }
    a.rts();
    a.l(".hitL");
    a.ldaDp(DP.tmpA)
      .andImm(0xfff8)
      .clc()
      .adcImm(8 - HITX)
      .aslA(4);
    a.staDp(DP.plX);
    a.stzDp(DP.plVX);
    a.rts();
  }

  function moveY() {
    a.l("MoveY");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.ldaDp(DP.plVY).bne(".move");
    a.rts(); // not moving vertically, nothing to resolve
    a.l(".move");
    a.clc().adcDp(DP.plY).staDp(DP.plY);
    a.ldaDp(DP.plVY).bmi(".up");

    // Falling: probe both bottom corners.
    toPixels(DP.plY);
    a.clc()
      .adcImm(HITH - 1)
      .staDp(DP.tmpB);
    toPixels(DP.plX);
    a.staDp(DP.tmpE);
    for (const xoff of [HITX, HITX + HITW - 1]) {
      a.ldaDp(DP.tmpE).clc().adcImm(xoff).staDp(DP.tmpA);
      a.jsr("IsSolid").assume({ a: 16, i: 16 });
      a.jsr("SolidDownMove").assume({ a: 16, i: 16 });
      a.bcs(".hitD");
    }
    a.rts();
    a.l(".hitD");
    a.ldaDp(DP.tmpB).andImm(0xfff8).sec().sbcImm(HITH).aslA(4);
    a.staDp(DP.plY);
    a.stzDp(DP.plVY);
    a.ldaImm(0x0001).staDp(DP.plOnGround);
    a.rts();

    a.l(".up");
    toPixels(DP.plY);
    a.staDp(DP.tmpB);
    toPixels(DP.plX);
    a.staDp(DP.tmpE);
    for (const xoff of [HITX, HITX + HITW - 1]) {
      a.ldaDp(DP.tmpE).clc().adcImm(xoff).staDp(DP.tmpA);
      a.jsr("IsSolid").assume({ a: 16, i: 16 });
      a.cmpImm(COL_SOLID).beq(".hitU");
    }
    a.rts();
    a.l(".hitU");
    a.ldaDp(DP.tmpB).andImm(0xfff8).clc().adcImm(8).aslA(4);
    a.staDp(DP.plY);
    a.stzDp(DP.plVY);
    a.rts();
  }

  /**
   * Ground detection is deliberately separate from movement collision: it
   * probes one pixel *below* the feet, so resting on a floor stays stable
   * instead of flickering as gravity nudges the sub-pixel position.
   */
  function checkGround() {
    a.l("CheckGround");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.stzDp(DP.plOnGround);
    a.ldaDp(DP.plVY).bmi(".done");
    toPixels(DP.plY);
    a.clc().adcImm(HITH).staDp(DP.tmpB);
    toPixels(DP.plX);
    a.staDp(DP.tmpE);
    for (const xoff of [HITX, HITX + HITW - 1]) {
      a.ldaDp(DP.tmpE).clc().adcImm(xoff).staDp(DP.tmpA);
      a.jsr("IsSolid").assume({ a: 16, i: 16 });
      a.jsr("SolidDownGround").assume({ a: 16, i: 16 });
      a.bcs(".yes");
    }
    a.bra(".done");
    a.l(".yes");
    a.ldaImm(0x0001).staDp(DP.plOnGround);
    a.l(".done");
    a.rts();
  }

  function checkHazard() {
    a.l("CheckHazard");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    toPixels(DP.plY);
    a.cmpImm(LEVEL_PX_H + 8).bcs(".die"); // fell out of the level
    toPixels(DP.plX);
    a.clc()
      .adcImm(HITX + (HITW >> 1))
      .staDp(DP.tmpA);
    // Head, waist and feet, so hazards kill from any direction.
    for (const yoff of [1, HITH >> 1, HITH - 1]) {
      toPixels(DP.plY);
      a.clc().adcImm(yoff).staDp(DP.tmpB);
      a.jsr("IsSolid").assume({ a: 16, i: 16 });
      a.cmpImm(COL_HAZARD).beq(".die");
    }
    a.rts();
    a.l(".die");
    a.jmp("Die");
  }

  function die() {
    a.l("Die");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.ldaDp(DP.state).bne(".done"); // already dead or already won
    a.ldaImm(STATE_DEAD).staDp(DP.state);
    a.stzDp(DP.stateTimer);
    a.stzDp(DP.plVX);
    a.ldaImm(neg(JUMP)).staDp(DP.plVY);
    a.stzDp(DP.plOnGround);
    a.l(".done");
    a.rts();
  }

  /**
   * Look up the collision class of the level cell containing a pixel.
   * In: tmpA = x, tmpB = y. Out: A = collision class.
   * Outside the level horizontally counts as solid so the player cannot walk
   * off the sides; outside vertically is empty so falling works.
   */
  function isSolid() {
    a.l("IsSolid");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.ldaDp(DP.tmpA).cmpImm(LEVEL_PX_W).bcc(".inX");
    a.ldaImm(COL_SOLID);
    a.rts();
    a.l(".inX");
    a.ldaDp(DP.tmpB).cmpImm(LEVEL_PX_H).bcc(".inY");
    a.ldaImm(0x0000);
    a.rts();
    a.l(".inY");
    // index = (y >> 3) * 64 + (x >> 3)
    a.ldaDp(DP.tmpB).andImm(0xfff8).aslA(3).staDp(DP.tmpC);
    a.ldaDp(DP.tmpA).lsrA(3).clc().adcDp(DP.tmpC).tax();
    a.a8();
    a.ldaLongX((DATA_BANK << 16) | ADDR_COLMAP);
    a.a16();
    a.andImm(0x00ff);
    a.rts();
  }

  /**
   * Does the tile class in A stop downward movement?
   * One-way platforms only stop the player when the feet crossed the tile's
   * top edge during this frame, so you can jump up through them.
   */
  function solidDownMove() {
    a.l("SolidDownMove");
    a.assume({ a: 16, i: 16 });
    a.cmpImm(COL_SOLID).beq(".yes");
    a.cmpImm(COL_ONEWAY).bne(".no");
    a.ldaDp(DP.plY).sec().sbcDp(DP.plVY).lsrA(4);
    a.clc()
      .adcImm(HITH - 1)
      .staDp(DP.tmpF); // feet before the move
    a.ldaDp(DP.tmpB).andImm(0xfff8).cmpDp(DP.tmpF);
    a.beq(".no");
    a.bcc(".no");
    a.l(".yes");
    a.sec();
    a.rts();
    a.l(".no");
    a.clc();
    a.rts();
  }

  /** Same question for the standing check, where the probe is the tile's top row. */
  function solidDownGround() {
    a.l("SolidDownGround");
    a.assume({ a: 16, i: 16 });
    a.cmpImm(COL_SOLID).beq(".yes");
    a.cmpImm(COL_ONEWAY).bne(".no");
    a.ldaDp(DP.tmpB).andImm(0x0007).bne(".no");
    a.l(".yes");
    a.sec();
    a.rts();
    a.l(".no");
    a.clc();
    a.rts();
  }

  // -------------------------------------------------------------- entities

  function updateEntities() {
    a.l("UpdateEntities");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.stzDp(DP.entIdx).stzDp(DP.entIdx2);
    a.l(".loop");
    a.ldxDp(DP.entIdx);
    a.a8();
    a.ldaAbsX(RAM_ENT_STATE);
    a.a16();
    a.andImm(0x00ff).bne(".next");
    a.a8();
    a.ldaAbsX(RAM_ENT_TYPE);
    a.a16();
    a.andImm(0x00ff);
    a.cmpImm(ENT_COIN).bne(".notCoin");
    a.jsr("EntCoin").assume({ a: 16, i: 16 });
    a.bra(".next");
    a.l(".notCoin");
    a.cmpImm(ENT_ENEMY).bne(".notEnemy");
    a.jsr("EntEnemy").assume({ a: 16, i: 16 });
    a.bra(".next");
    a.l(".notEnemy");
    a.cmpImm(ENT_GOAL).bne(".next");
    a.jsr("EntGoal").assume({ a: 16, i: 16 });
    a.l(".next");
    a.a16();
    a.incDp(DP.entIdx);
    a.incDp(DP.entIdx2).incDp(DP.entIdx2);
    a.ldaDp(DP.entIdx).cmpImm(MAX_ENTITIES).bne(".loop");
    a.rts();
  }

  function entCoin() {
    a.l("EntCoin");
    a.assume({ a: 16, i: 16 });
    a.jsr("EntOverlap").assume({ a: 16, i: 16 });
    a.bcc(".done");
    a.ldxDp(DP.entIdx);
    a.a8();
    a.ldaImm(0x01).staAbsX(RAM_ENT_STATE);
    a.a16();
    a.incDp(DP.score);
    a.l(".done");
    a.rts();
  }

  function entGoal() {
    a.l("EntGoal");
    a.assume({ a: 16, i: 16 });
    a.jsr("EntOverlap").assume({ a: 16, i: 16 });
    a.bcc(".done");
    a.ldaDp(DP.state).bne(".done");
    a.ldaImm(STATE_WIN).staDp(DP.state);
    a.stzDp(DP.stateTimer);
    a.l(".done");
    a.rts();
  }

  function entEnemy() {
    a.l("EntEnemy");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.ldyDp(DP.entIdx2);
    a.ldaAbsY(RAM_ENT_X).clc().adcAbsY(RAM_ENT_VX).staAbsY(RAM_ENT_X);

    // Probe the tile the enemy is walking into.
    a.ldaAbsY(RAM_ENT_VX).bmi(".goingLeft");
    a.ldaAbsY(RAM_ENT_X)
      .lsrA(4)
      .clc()
      .adcImm(EHITX + EHITW)
      .staDp(DP.tmpA);
    a.bra(".probe");
    a.l(".goingLeft");
    a.ldaAbsY(RAM_ENT_X)
      .lsrA(4)
      .clc()
      .adcImm(EHITX - 1)
      .staDp(DP.tmpA);
    a.l(".probe");
    a.ldaAbsY(RAM_ENT_Y)
      .lsrA(4)
      .clc()
      .adcImm(EHITY + EHITH - 2)
      .staDp(DP.tmpB);
    a.jsr("IsSolid").assume({ a: 16, i: 16 });
    a.cmpImm(COL_SOLID).beq(".flip");
    // Nothing to walk on ahead? Turn around rather than stepping off.
    a.ldyDp(DP.entIdx2);
    a.ldaAbsY(RAM_ENT_Y)
      .lsrA(4)
      .clc()
      .adcImm(EHITY + EHITH + 2)
      .staDp(DP.tmpB);
    a.jsr("IsSolid").assume({ a: 16, i: 16 });
    a.cmpImm(COL_SOLID).beq(".touch");
    a.l(".flip");
    a.ldyDp(DP.entIdx2);
    a.ldaImm(0x0000).sec().sbcAbsY(RAM_ENT_VX).staAbsY(RAM_ENT_VX);
    a.ldaAbsY(RAM_ENT_X).clc().adcAbsY(RAM_ENT_VX).staAbsY(RAM_ENT_X);

    a.l(".touch");
    a.jsr("EntOverlap").assume({ a: 16, i: 16 });
    a.bcc(".done");
    a.ldaDp(DP.plVY).bmi(".kill"); // rising into it never counts as a stomp
    // Compare the feet from *before* this frame's movement: falling fast can
    // carry the player well past the enemy's centre in a single step.
    a.ldaDp(DP.plY).sec().sbcDp(DP.plVY).lsrA(4);
    a.clc().adcImm(HITH).staDp(DP.tmpA);
    a.ldyDp(DP.entIdx2);
    a.ldaAbsY(RAM_ENT_Y).lsrA(4).clc().adcImm(8).cmpDp(DP.tmpA);
    a.bcc(".kill");
    // Stomped: remove the enemy and give the player a bounce.
    a.ldxDp(DP.entIdx);
    a.a8();
    a.ldaImm(0x01).staAbsX(RAM_ENT_STATE);
    a.a16();
    a.ldaImm(neg(JUMP)).staDp(DP.plVY);
    a.stzDp(DP.plOnGround);
    a.bra(".done");
    a.l(".kill");
    a.jsr("Die").assume({ a: 16, i: 16 });
    a.l(".done");
    a.rts();
  }

  /** Carry set if entity `entIdx2` overlaps the player's hitbox. */
  function entOverlap() {
    a.l("EntOverlap");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.ldyDp(DP.entIdx2);
    a.ldaAbsY(RAM_ENT_X).lsrA(4).clc().adcImm(EHITX).staDp(DP.tmpA);
    a.ldaAbsY(RAM_ENT_Y).lsrA(4).clc().adcImm(EHITY).staDp(DP.tmpB);
    toPixels(DP.plX);
    a.clc().adcImm(HITX).staDp(DP.tmpC);
    toPixels(DP.plY);
    a.staDp(DP.tmpD);

    a.ldaDp(DP.tmpA).clc().adcImm(EHITW).staDp(DP.tmpE);
    a.ldaDp(DP.tmpC).cmpDp(DP.tmpE).bcs(".no");
    a.ldaDp(DP.tmpC).clc().adcImm(HITW).staDp(DP.tmpE);
    a.ldaDp(DP.tmpA).cmpDp(DP.tmpE).bcs(".no");
    a.ldaDp(DP.tmpB).clc().adcImm(EHITH).staDp(DP.tmpE);
    a.ldaDp(DP.tmpD).cmpDp(DP.tmpE).bcs(".no");
    a.ldaDp(DP.tmpD).clc().adcImm(HITH).staDp(DP.tmpE);
    a.ldaDp(DP.tmpB).cmpDp(DP.tmpE).bcs(".no");
    a.sec();
    a.rts();
    a.l(".no");
    a.clc();
    a.rts();
  }

  // ------------------------------------------------------------------- oam

  function buildOam() {
    a.l("BuildOAM");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    // Park every sprite off the bottom of the screen, then draw over it.
    a.ldxImm(0x0000);
    a.l(".clr");
    a.ldaImm(0xf000); // X = $00, Y = $F0
    a.staAbsX(RAM_OAM_LO);
    a.inx().inx().inx().inx();
    a.cpxImm(0x0200).bne(".clr");
    a.ldxImm(0x0000);
    a.l(".clr2");
    a.ldaImm(0xaaaa); // every sprite large, X sign clear
    a.staAbsX(RAM_OAM_HI);
    a.inx().inx();
    a.cpxImm(0x0020).bne(".clr2");

    a.stzDp(DP.oamIdx);

    toPixels(DP.plX);
    a.staDp(DP.tmpA);
    toPixels(DP.plY);
    a.staDp(DP.tmpB);
    a.jsr("PlayerSlot").assume({ a: 16, i: 16 });
    a.ldaDp(DP.plFacing).beq(".faceRight");
    a.ldaImm(0x0040).staDp(DP.tmpD); // horizontal flip
    a.bra(".drawPlayer");
    a.l(".faceRight");
    a.stzDp(DP.tmpD);
    a.l(".drawPlayer");
    a.jsr("DrawSprite").assume({ a: 16, i: 16 });

    a.stzDp(DP.entIdx).stzDp(DP.entIdx2);
    a.l(".eloop");
    a.ldxDp(DP.entIdx);
    a.a8();
    a.ldaAbsX(RAM_ENT_STATE);
    a.a16();
    a.andImm(0x00ff).bne(".enext");
    a.ldxDp(DP.entIdx);
    a.a8();
    a.ldaAbsX(RAM_ENT_TYPE);
    a.a16();
    a.andImm(0x00ff).beq(".enext");
    a.tax();
    a.a8();
    a.ldaAbsX(ADDR_TYPE_SLOT);
    a.a16();
    a.andImm(0x00ff).staDp(DP.tmpC);
    a.ldyDp(DP.entIdx2);
    a.ldaAbsY(RAM_ENT_X).lsrA(4).staDp(DP.tmpA);
    a.ldaAbsY(RAM_ENT_Y).lsrA(4).staDp(DP.tmpB);
    a.stzDp(DP.tmpD);
    a.jsr("DrawSprite").assume({ a: 16, i: 16 });
    a.l(".enext");
    a.a16();
    a.incDp(DP.entIdx);
    a.incDp(DP.entIdx2).incDp(DP.entIdx2);
    a.ldaDp(DP.entIdx).cmpImm(MAX_ENTITIES).bne(".eloop");
    a.rts();
  }

  /**
   * Append one 16x16 sprite to the OAM shadow.
   * In: tmpA/tmpB = world pixel position, tmpC = sprite slot, tmpD = extra
   * attribute bits (flip). Off-screen sprites are skipped without consuming
   * an OAM slot.
   */
  function drawSprite() {
    a.l("DrawSprite");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.ldaDp(DP.tmpA).sec().sbcDp(DP.camX).staDp(DP.tmpE);
    a.clc()
      .adcImm(16)
      .cmpImm(SCREEN_W + 17)
      .bcs(".skip");
    a.ldaDp(DP.tmpB).sec().sbcDp(DP.camY).staDp(DP.tmpF);
    a.clc()
      .adcImm(16)
      .cmpImm(SCREEN_H + 17)
      .bcs(".skip");

    a.ldaDp(DP.oamIdx).aslA(2).tax();
    a.ldyDp(DP.tmpC);
    a.a8();
    a.ldaDp(DP.tmpE).staAbsX(RAM_OAM_LO);
    a.ldaDp(DP.tmpF).staAbsX(RAM_OAM_LO + 1);
    a.ldaAbsY(ADDR_SLOT_TILE).staAbsX(RAM_OAM_LO + 2);
    a.ldaAbsY(ADDR_SLOT_ATTR)
      .oraDp(DP.tmpD)
      .staAbsX(RAM_OAM_LO + 3);
    a.a16();

    // Sprites straddling the left edge need the 9th X bit in the high table.
    a.ldaDp(DP.tmpE).andImm(0x0100).beq(".noHigh");
    a.ldaDp(DP.oamIdx).andImm(0x0003).tax();
    a.a8();
    a.ldaAbsX(ADDR_OAM_MASK).staDp(DP.tmpG);
    a.a16();
    a.ldaDp(DP.oamIdx).lsrA(2).tax();
    a.a8();
    a.ldaAbsX(RAM_OAM_HI).oraDp(DP.tmpG).staAbsX(RAM_OAM_HI);
    a.a16();
    a.l(".noHigh");
    a.incDp(DP.oamIdx);
    a.l(".skip");
    a.rts();
  }

  /** Pick the player's sprite slot from its motion, leaving it in tmpC. */
  function playerSlot() {
    a.l("PlayerSlot");
    a.assume({ a: 16, i: 16 });
    a.ai16();
    a.ldaDp(DP.plOnGround).bne(".grounded");
    a.ldaImm(SLOT_PLAYER_JUMP).staDp(DP.tmpC);
    a.rts();
    a.l(".grounded");
    a.ldaDp(DP.plVX).beq(".idle");
    a.ldaDp(DP.frame).lsrA(3).andImm(0x0001).clc().adcImm(1).staDp(DP.tmpC);
    a.rts();
    a.l(".idle");
    a.ldaImm(SLOT_PLAYER_IDLE).staDp(DP.tmpC);
    a.rts();
  }
}

/** Addresses the ROM builder needs to point the interrupt vectors at. */
export const VECTOR_LABELS = {
  reset: "Reset",
  nmi: "NMI",
  irq: "IrqStub",
} as const;
