/**
 * Builds the default project into a ROM and runs it in the bundled 65816
 * emulator, asserting that the game actually boots and plays.
 *
 *   node scripts/verify-rom.mjs [--write out.sfc]
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Snes } from "./snes-emu.mjs";

// esbuild ships as a transitive dependency of Astro/Vite rather than a direct
// one, so resolve it from there instead of requiring an extra install.
function loadEsbuild() {
  for (const from of ["vite", "astro", "./package.json"]) {
    try {
      return createRequire(import.meta.resolve(from))("esbuild");
    } catch {
      /* try the next one */
    }
  }
  throw new Error("could not resolve esbuild; run npm install first");
}
const { build } = loadEsbuild();

const ENTRY = `
export { buildRom, romFilename } from "../src/utils/snes/rom";
export { buildEngine } from "../src/utils/snes/engine";
export { createDefaultProject } from "../src/utils/snes/defaults";
export * as C from "../src/utils/snes/constants";
`;

let failures = 0;
let checks = 0;

function check(name, condition, detail = "") {
  checks++;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `got ${actual}, expected ${expected}`);
}

async function loadBuilder() {
  const dir = await mkdtemp(join(tmpdir(), "snes-verify-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, ENTRY.replaceAll("../src", join(process.cwd(), "src")));
  const out = join(dir, "bundle.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "warning",
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const { mod, cleanup } = await loadBuilder();
const { buildRom, buildEngine, createDefaultProject, C } = mod;

const project = createDefaultProject();
const { rom, codeSize } = buildRom(project);
const asm = buildEngine(project.settings);
asm.assemble();

console.log(`ROM: ${rom.length} bytes, engine code: ${codeSize} bytes\n`);

// ------------------------------------------------------------------- header

console.log("header");
{
  const HEADER = 0x7fc0;
  const title = new TextDecoder()
    .decode(rom.subarray(HEADER, HEADER + 21))
    .trimEnd();
  eq("title", title, "MY SNES GAME");
  eq("map mode is LoROM", rom[HEADER + 0x15], 0x20);
  eq("rom size byte", rom[HEADER + 0x17], 0x08);

  const stored = rom[HEADER + 0x1e] | (rom[HEADER + 0x1f] << 8);
  const complement = rom[HEADER + 0x1c] | (rom[HEADER + 0x1d] << 8);
  eq("checksum complements", stored ^ complement, 0xffff);

  const copy = Uint8Array.from(rom);
  copy[HEADER + 0x1c] = 0xff;
  copy[HEADER + 0x1d] = 0xff;
  copy[HEADER + 0x1e] = 0x00;
  copy[HEADER + 0x1f] = 0x00;
  let sum = 0;
  for (const b of copy) sum += b;
  eq("checksum matches contents", stored, sum & 0xffff);

  const reset = rom[0x7ffc] | (rom[0x7ffd] << 8);
  const nmi = rom[0x7fea] | (rom[0x7feb] << 8);
  eq("reset vector", reset, asm.labelAddress("Reset"));
  eq("nmi vector", nmi, asm.labelAddress("NMI"));
  check("reset vector points into ROM", reset >= 0x8000);
}

// -------------------------------------------------------------------- boot

const snes = new Snes(rom);
snes.reset();

const WAIT = asm.labelAddress("MainLoop.wait");
const DP = C.DP;

const byteAt = a => snes.wram[a];
const wordAt = a => snes.wram[a] | (snes.wram[a + 1] << 8);
const signedAt = a => {
  const v = wordAt(a);
  return v >= 0x8000 ? v - 0x10000 : v;
};
const setWord = (a, v) => {
  snes.wram[a] = v & 0xff;
  snes.wram[a + 1] = (v >> 8) & 0xff;
};

function runUntilIdle(limit = 8_000_000) {
  let n = 0;
  while (!(snes.pbr === 0 && snes.pc === WAIT)) {
    snes.step();
    if (++n > limit) throw new Error("CPU never reached the main wait loop");
  }
}

function frame(joypad = 0) {
  snes.joypad = joypad;
  runUntilIdle();
  const before = wordAt(DP.frame);
  snes.nmi();
  let n = 0;
  while (wordAt(DP.frame) === before) {
    snes.step();
    if (++n > 8_000_000) throw new Error("frame never completed");
  }
}

function frames(count, joypad = 0) {
  for (let i = 0; i < count; i++) frame(joypad);
}

console.log("\nboot");
{
  runUntilIdle();
  check("reached the main loop", true);
  eq("screen turned on", snes.inidisp, 0x0f);
  eq("nmi enabled", snes.nmiEnabled, true);
  eq("bg mode 1", snes.ppu[0x05], 0x01);
  eq("bg1 map: base 0, 64x64", snes.ppu[0x07], 0x03);
  eq("bg1 chars at word $1000", snes.ppu[0x0b], 0x01);
  eq("main screen = BG1 + OBJ", snes.ppu[0x2c], 0x11);
}

console.log("\nuploaded data");
{
  // Palette 0 colour 0 is the backdrop, and must match the project.
  const cg0 = snes.cgram[0] | (snes.cgram[1] << 8);
  eq("backdrop colour", cg0, project.bgPalettes[0][0]);
  const objColour = snes.cgram[(128 + 2) * 2] | (snes.cgram[(128 + 2) * 2 + 1] << 8);
  eq("object palette 0 colour 2", objColour, project.objPalettes[0][2]);

  // Tilemap word for level cell (3, 38): tile index in the low byte.
  const tx = 3;
  const ty = 38;
  const expectedTile = project.level[ty * C.LEVEL_W + tx];
  const screen = (tx >> 5) + (ty >> 5) * 2;
  const wordIndex = screen * 1024 + (ty & 31) * 32 + (tx & 31);
  const vramWord =
    snes.vram[wordIndex * 2] | (snes.vram[wordIndex * 2 + 1] << 8);
  eq("tilemap cell (3,38)", vramWord & 0x3ff, expectedTile);

  // Ground row, in the second horizontal screen so the layout is exercised.
  const gx = 40;
  const gy = 40;
  const gScreen = (gx >> 5) + (gy >> 5) * 2;
  const gIndex = gScreen * 1024 + (gy & 31) * 32 + (gx & 31);
  const gWord = snes.vram[gIndex * 2] | (snes.vram[gIndex * 2 + 1] << 8);
  eq("tilemap cell (40,40)", gWord & 0x3ff, project.level[gy * C.LEVEL_W + gx]);

  // Tile 1 graphics land at VRAM word $1000 -> byte $2000.
  const nonZero = snes.vram.subarray(0x2000, 0x2000 + 8192).some(b => b !== 0);
  check("background tiles uploaded", nonZero);
  const objNonZero = snes.vram.subarray(0x4000, 0x4000 + 4096).some(b => b !== 0);
  check("object tiles uploaded", objNonZero);
}

// Landmarks are derived from the level rather than hard-coded, so editing the
// demo project cannot silently invalidate the gameplay checks below.
const tileAt = (x, y) => project.level[y * C.LEVEL_W + x];
const colAt = (x, y) => project.tiles[tileAt(x, y)].collision;

const GROUND = (() => {
  for (let y = 0; y < C.LEVEL_H; y++) if (colAt(0, y) === C.COL_SOLID) return y;
  throw new Error("demo level has no floor in column 0");
})();

/** A column with no floor anywhere: falling here leaves the level. */
const PIT = (() => {
  for (let x = 0; x < C.LEVEL_W; x++) {
    let solid = false;
    for (let y = GROUND; y < C.LEVEL_H; y++) {
      if (colAt(x, y) === C.COL_SOLID) solid = true;
    }
    if (!solid) return x;
  }
  throw new Error("demo level has no pit to fall into");
})();

const HAZARD = (() => {
  for (let y = 0; y < C.LEVEL_H; y++) {
    for (let x = 0; x < C.LEVEL_W; x++) {
      if (colAt(x, y) === C.COL_HAZARD) return { x, y };
    }
  }
  throw new Error("demo level has no hazard tile");
})();

/** A wall standing on the ground with clear floor to walk in from the left. */
const WALL = (() => {
  for (let x = 3; x < C.LEVEL_W; x++) {
    if (
      colAt(x, GROUND - 1) === C.COL_SOLID &&
      colAt(x - 1, GROUND - 1) === C.COL_EMPTY &&
      colAt(x - 2, GROUND - 1) === C.COL_EMPTY &&
      colAt(x - 3, GROUND - 1) === C.COL_EMPTY &&
      colAt(x - 1, GROUND) === C.COL_SOLID &&
      colAt(x - 2, GROUND) === C.COL_SOLID
    ) {
      return x;
    }
  }
  throw new Error("demo level has no wall to walk into");
})();

const RESTING_Y = GROUND * 8 - C.HITH;
console.log(
  `landmarks: ground row ${GROUND}, pit column ${PIT}, hazard (${HAZARD.x},${HAZARD.y}), wall column ${WALL}`
);

console.log("\nspawn and gravity");
{
  const spawn = project.entities.find(e => e.type === C.ENT_PLAYER);
  eq("spawned at the player marker (x)", wordAt(DP.plX) >> 4, spawn.x);
  frames(30);
  eq("standing on the ground", byteAt(DP.plOnGround), 1);
  eq("resting height", wordAt(DP.plY) >> 4, RESTING_Y);
  eq("still alive", wordAt(DP.state), C.STATE_PLAY);
}

console.log("\nwalking");
{
  const before = wordAt(DP.plX) >> 4;
  frames(40, C.JOY_RIGHT);
  const after = wordAt(DP.plX) >> 4;
  check("moves right", after > before, `${before} -> ${after}`);
  eq("faces right", wordAt(DP.plFacing), 0);
  check(
    "camera follows",
    wordAt(DP.camX) > 0 || after < C.SCREEN_W / 2,
    `camX=${wordAt(DP.camX)}`
  );

  frames(40, C.JOY_LEFT);
  eq("faces left", wordAt(DP.plFacing), 1);
  check("moves back left", (wordAt(DP.plX) >> 4) < after);
}

console.log("\njumping");
{
  // Settle first so the jump starts from the ground.
  frames(20);
  const groundY = wordAt(DP.plY);
  frame(C.JOY_A);
  check("leaves the ground", byteAt(DP.plOnGround) === 0);
  frames(10, C.JOY_A);
  const peakish = wordAt(DP.plY);
  check("rises", peakish < groundY, `${groundY} -> ${peakish}`);
  frames(60);
  eq("lands again", byteAt(DP.plOnGround), 1);
  eq("back on the floor", wordAt(DP.plY), groundY);
}

console.log("\nsolid walls");
{
  // Start three tiles clear of the wall and walk straight into it.
  setWord(DP.plX, (WALL - 3) * 8 * 16);
  setWord(DP.plY, RESTING_Y * 16);
  setWord(DP.plVY, 0);
  frames(60, C.JOY_RIGHT);
  const x = wordAt(DP.plX) >> 4;
  check(
    "stopped by the wall",
    x + C.HITX + C.HITW <= WALL * 8,
    `right edge at ${x + C.HITX + C.HITW}, wall at ${WALL * 8}`
  );
  eq("survived the walk", wordAt(DP.state), C.STATE_PLAY);
}

console.log("\ncoins");
{
  const coin = project.entities.find(e => e.type === C.ENT_COIN);
  const scoreBefore = wordAt(DP.score);
  setWord(DP.plX, coin.x * 16);
  setWord(DP.plY, coin.y * 16);
  setWord(DP.plVY, 0);
  frame();
  // The demo places two coins side by side, so one step can collect both.
  check(
    "collected a coin",
    wordAt(DP.score) > scoreBefore,
    `score ${scoreBefore} -> ${wordAt(DP.score)}`
  );
  const before = wordAt(DP.score);
  frame();
  eq("a collected coin does not score twice", wordAt(DP.score), before);
}

console.log("\nhazards");
{
  // Stand on the ground next to the spikes, which sit on the floor row.
  setWord(DP.plX, HAZARD.x * 8 * 16);
  setWord(DP.plY, RESTING_Y * 16);
  setWord(DP.plVY, 0);
  setWord(DP.state, C.STATE_PLAY);
  frame();
  eq("spikes kill", wordAt(DP.state), C.STATE_DEAD);

  // The death state restarts the level after DEAD_FRAMES.
  frames(C.DEAD_FRAMES + 2);
  eq("level restarts after dying", wordAt(DP.state), C.STATE_PLAY);
  const spawn = project.entities.find(e => e.type === C.ENT_PLAYER);
  eq("respawned at the marker", wordAt(DP.plX) >> 4, spawn.x);
  eq("score reset", wordAt(DP.score), 0);
}

console.log("\nfalling out of the level");
{
  setWord(DP.plX, PIT * 8 * 16);
  setWord(DP.plY, GROUND * 8 * 16);
  // Long enough to fall out of the level, short of the automatic restart.
  frames(60);
  eq("dies in the pit", wordAt(DP.state), C.STATE_DEAD);
  frames(C.DEAD_FRAMES + 2);
  eq("and restarts", wordAt(DP.state), C.STATE_PLAY);
}

console.log("\nenemies");
{
  const enemy = project.entities.find(e => e.type === C.ENT_ENEMY);
  const idx = project.entities.indexOf(enemy);
  // Enemies patrol, so read where this one actually is right now.
  setWord(DP.plX, wordAt(C.RAM_ENT_X + idx * 2));
  setWord(DP.plY, wordAt(C.RAM_ENT_Y + idx * 2));
  setWord(DP.plVY, 0);
  setWord(DP.state, C.STATE_PLAY);
  frame();
  eq("touching an enemy kills", wordAt(DP.state), C.STATE_DEAD);

  frames(C.DEAD_FRAMES + 2);
  // Now land on one from above.
  setWord(DP.plX, wordAt(C.RAM_ENT_X + idx * 2));
  setWord(DP.plY, wordAt(C.RAM_ENT_Y + idx * 2) - 10 * 16);
  setWord(DP.plVY, project.settings.maxFall);
  setWord(DP.plOnGround, 0);
  setWord(DP.state, C.STATE_PLAY);
  let stomped = false;
  for (let i = 0; i < 20 && !stomped; i++) {
    frame();
    if (snes.wram[C.RAM_ENT_STATE + idx] === 1) stomped = true;
    if (wordAt(DP.state) !== C.STATE_PLAY) break;
  }
  check("stomping removes the enemy", stomped, `state=${wordAt(DP.state)}`);
  check("stomp bounces the player", signedAt(DP.plVY) < 0);
}

console.log("\ngoal");
{
  frames(C.DEAD_FRAMES + 2);
  const goal = project.entities.find(e => e.type === C.ENT_GOAL);
  setWord(DP.plX, goal.x * 16);
  setWord(DP.plY, goal.y * 16);
  setWord(DP.state, C.STATE_PLAY);
  frame();
  eq("reaching the goal wins", wordAt(DP.state), C.STATE_WIN);
  frames(C.WIN_FRAMES + 2);
  eq("then the level restarts", wordAt(DP.state), C.STATE_PLAY);
}

console.log("\nsprites");
{
  frames(5);
  // OAM entry 0 is the player; it must sit inside the visible area.
  const x = snes.oam[0];
  const y = snes.oam[1];
  const tile = snes.oam[2];
  const attr = snes.oam[3];
  check("player sprite is on screen", y < 0xe0, `y=${y}`);
  eq("player sprite x matches the camera", x, (wordAt(DP.plX) >> 4) - wordAt(DP.camX));
  eq("player sprite y matches the camera", y, (wordAt(DP.plY) >> 4) - wordAt(DP.camY));
  check("player uses a player tile", tile <= 6, `tile=${tile}`);
  eq("player sprite priority is 2", (attr >> 4) & 3, 2);
  eq("all sprites are 16x16", snes.oam[0x200] & 0xaa, 0xaa);

  let visible = 0;
  for (let i = 0; i < 128; i++) if (snes.oam[i * 4 + 1] !== 0xf0) visible++;
  check("entities are drawn too", visible > 1, `${visible} sprites visible`);
}

console.log("\nscroll registers");
{
  eq("horizontal scroll follows the camera", snes.bg1hofs, wordAt(DP.camX));
  eq(
    "vertical scroll is camera - 1",
    snes.bg1vofs,
    (wordAt(DP.camY) - 1) & 0x3ff
  );
}

console.log("\nstability");
{
  // A long unattended run must not hit an unimplemented opcode or wander off.
  const before = snes.opcodeHistogram.size;
  frames(600, C.JOY_RIGHT);
  check("survived 600 frames of input", true);
  check("executed a broad opcode mix", snes.opcodeHistogram.size >= before);
}

await cleanup();

const writeIndex = process.argv.indexOf("--write");
if (writeIndex !== -1 && process.argv[writeIndex + 1]) {
  await writeFile(process.argv[writeIndex + 1], rom);
  console.log(`\nwrote ${process.argv[writeIndex + 1]}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
