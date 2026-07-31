/** Project persistence: browser autosave plus JSON import/export. */

import { createDefaultProject } from "./defaults";
import {
  LEVEL_H,
  LEVEL_W,
  MAX_ENTITIES,
  PALETTE_COUNT,
  SPRITE_COUNT,
  TILE_COUNT,
} from "./constants";
import type { GameProject } from "./types";

const STORAGE_KEY = "snes-builder-project-v1";

export function loadProject(): GameProject {
  if (typeof localStorage === "undefined") return createDefaultProject();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultProject();
    return normalizeProject(JSON.parse(raw));
  } catch {
    return createDefaultProject();
  }
}

export function saveProject(project: GameProject): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // Quota exceeded or storage disabled: autosave is best-effort.
  }
}

export function clearSavedProject(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Coerce arbitrary parsed JSON into a project the builder can work with,
 * filling gaps from the defaults rather than rejecting near-miss files.
 */
export function normalizeProject(input: unknown): GameProject {
  const base = createDefaultProject();
  if (!input || typeof input !== "object") return base;
  const raw = input as Partial<GameProject>;

  const project: GameProject = {
    version: 1,
    title: typeof raw.title === "string" ? raw.title : base.title,
    bgPalettes: normalizePalettes(raw.bgPalettes, base.bgPalettes),
    objPalettes: normalizePalettes(raw.objPalettes, base.objPalettes),
    tiles: base.tiles.map((fallback, i) => {
      const t = raw.tiles?.[i];
      if (!t) return fallback;
      return {
        pixels: normalizePixels(t.pixels, 64, fallback.pixels),
        palette: clampInt(t.palette, 0, PALETTE_COUNT - 1, fallback.palette),
        collision: clampInt(t.collision, 0, 3, fallback.collision),
      };
    }),
    sprites: base.sprites.map((fallback, i) => {
      const s = raw.sprites?.[i];
      if (!s) return fallback;
      return {
        name: typeof s.name === "string" ? s.name : fallback.name,
        pixels: normalizePixels(s.pixels, 256, fallback.pixels),
        palette: clampInt(s.palette, 0, PALETTE_COUNT - 1, fallback.palette),
      };
    }),
    level: normalizePixels(raw.level, LEVEL_W * LEVEL_H, base.level, 255),
    entities: Array.isArray(raw.entities)
      ? raw.entities.slice(0, MAX_ENTITIES).map(e => ({
          type: clampInt(e?.type, 0, 7, 0),
          x: clampInt(e?.x, 0, LEVEL_W * 8 - 1, 0),
          y: clampInt(e?.y, 0, LEVEL_H * 8 - 1, 0),
        }))
      : base.entities,
    settings: {
      walkSpeed: clampInt(
        raw.settings?.walkSpeed,
        1,
        96,
        base.settings.walkSpeed
      ),
      jumpPower: clampInt(
        raw.settings?.jumpPower,
        8,
        160,
        base.settings.jumpPower
      ),
      gravity: clampInt(raw.settings?.gravity, 1, 32, base.settings.gravity),
      maxFall: clampInt(raw.settings?.maxFall, 8, 160, base.settings.maxFall),
      enemySpeed: clampInt(
        raw.settings?.enemySpeed,
        1,
        64,
        base.settings.enemySpeed
      ),
    },
  };

  if (project.tiles.length !== TILE_COUNT) project.tiles = base.tiles;
  if (project.sprites.length !== SPRITE_COUNT) project.sprites = base.sprites;
  return project;
}

function clampInt(
  value: unknown,
  lo: number,
  hi: number,
  fallback: number
): number {
  const n = typeof value === "number" ? Math.round(value) : NaN;
  if (Number.isNaN(n)) return fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

function normalizePixels(
  value: unknown,
  length: number,
  fallback: number[],
  max = 15
): number[] {
  if (!Array.isArray(value) || value.length !== length) return [...fallback];
  return value.map(v => clampInt(v, 0, max, 0));
}

function normalizePalettes(value: unknown, fallback: number[][]): number[][] {
  if (!Array.isArray(value)) return fallback.map(p => [...p]);
  return fallback.map((fb, i) => {
    const p = value[i];
    if (!Array.isArray(p) || p.length !== 16) return [...fb];
    return p.map(c => clampInt(c, 0, 0x7fff, 0));
  });
}

export function downloadBlob(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
