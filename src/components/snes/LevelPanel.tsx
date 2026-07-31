import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COL_HAZARD,
  COL_ONEWAY,
  COL_SOLID,
  ENTITY_NAMES,
  ENT_COIN,
  ENT_ENEMY,
  ENT_GOAL,
  ENT_PLAYER,
  LEVEL_H,
  LEVEL_W,
  MAX_ENTITIES,
  TYPE_TO_SLOT,
} from "@utils/snes/constants";
import { bgr555ToRgb } from "@utils/snes/gfx";
import type { GameProject } from "@utils/snes/types";
import SheetPicker from "./SheetPicker";

interface Props {
  project: GameProject;
  onChange: (project: GameProject) => void;
  selectedTile: number;
  onSelectTile: (index: number) => void;
}

type Tool = "tile" | "entity" | "erase";

const ENTITY_TYPES = [ENT_PLAYER, ENT_COIN, ENT_ENEMY, ENT_GOAL];

const COLLISION_TINT: Record<number, string> = {
  [COL_SOLID]: "rgba(80,160,255,0.35)",
  [COL_HAZARD]: "rgba(255,60,60,0.45)",
  [COL_ONEWAY]: "rgba(120,255,140,0.35)",
};

export default function LevelPanel({
  project,
  onChange,
  selectedTile,
  onSelectTile,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const centred = useRef(false);
  const [tool, setTool] = useState<Tool>("tile");
  const [entityType, setEntityType] = useState<number>(ENT_COIN);
  const [zoom, setZoom] = useState(2);
  const [showGrid, setShowGrid] = useState(true);
  const [showCollision, setShowCollision] = useState(false);
  const [painting, setPainting] = useState(false);

  // Native-resolution buffers, rebuilt only when the artwork changes.
  const tileSheet = useMemo(
    () => buildTileSheet(project),
    [project.tiles, project.bgPalettes]
  );
  const spriteSheet = useMemo(
    () => buildSpriteSheet(project),
    [project.sprites, project.objPalettes]
  );

  const width = LEVEL_W * 8 * zoom;
  const height = LEVEL_H * 8 * zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const [r, g, b] = bgr555ToRgb(project.bgPalettes[0][0]);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, width, height);

    const step = 8 * zoom;
    for (let ty = 0; ty < LEVEL_H; ty++) {
      for (let tx = 0; tx < LEVEL_W; tx++) {
        const tile = project.level[ty * LEVEL_W + tx] & 0xff;
        if (tile !== 0) {
          ctx.drawImage(
            tileSheet,
            (tile % 16) * 8,
            Math.floor(tile / 16) * 8,
            8,
            8,
            tx * step,
            ty * step,
            step,
            step
          );
        }
        if (showCollision) {
          const tint = COLLISION_TINT[project.tiles[tile].collision];
          if (tint) {
            ctx.fillStyle = tint;
            ctx.fillRect(tx * step, ty * step, step, step);
          }
        }
      }
    }

    for (const entity of project.entities) {
      if (!entity.type) continue;
      const slot = TYPE_TO_SLOT[entity.type] ?? 0;
      ctx.drawImage(
        spriteSheet,
        (slot % 8) * 16,
        Math.floor(slot / 8) * 16,
        16,
        16,
        entity.x * zoom,
        entity.y * zoom,
        16 * zoom,
        16 * zoom
      );
      ctx.strokeStyle =
        entity.type === ENT_PLAYER ? "#ffd800" : "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        entity.x * zoom + 0.5,
        entity.y * zoom + 0.5,
        16 * zoom - 1,
        16 * zoom - 1
      );
    }

    if (showGrid && zoom >= 2) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= LEVEL_W; x++) {
        ctx.beginPath();
        ctx.moveTo(x * step + 0.5, 0);
        ctx.lineTo(x * step + 0.5, height);
        ctx.stroke();
      }
      for (let y = 0; y <= LEVEL_H; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * step + 0.5);
        ctx.lineTo(width, y * step + 0.5);
        ctx.stroke();
      }
    }
  }, [
    project,
    tileSheet,
    spriteSheet,
    zoom,
    showGrid,
    showCollision,
    width,
    height,
  ]);

  // Most of a fresh level is empty sky, so open the view on the spawn point
  // rather than the top-left corner.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || centred.current) return;
    const spawn =
      project.entities.find(e => e.type === ENT_PLAYER) ?? project.entities[0];
    if (!spawn) return;
    centred.current = true;
    container.scrollLeft = Math.max(
      0,
      spawn.x * zoom - container.clientWidth / 2
    );
    container.scrollTop = Math.max(
      0,
      spawn.y * zoom - container.clientHeight / 2
    );
  }, [project.entities, zoom]);

  const cellFromEvent = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.floor(
        ((event.clientX - rect.left) / rect.width) * LEVEL_W
      );
      const y = Math.floor(
        ((event.clientY - rect.top) / rect.height) * LEVEL_H
      );
      if (x < 0 || y < 0 || x >= LEVEL_W || y >= LEVEL_H) return null;
      return { x, y };
    },
    []
  );

  const paintTile = (x: number, y: number, tile: number) => {
    const index = y * LEVEL_W + x;
    if (project.level[index] === tile) return;
    const level = [...project.level];
    level[index] = tile;
    onChange({ ...project, level });
  };

  const removeEntityAt = (x: number, y: number) => {
    const pxx = x * 8;
    const pyy = y * 8;
    const entities = project.entities.filter(
      e =>
        !(pxx >= e.x - 8 && pxx <= e.x + 8 && pyy >= e.y - 8 && pyy <= e.y + 8)
    );
    if (entities.length !== project.entities.length) {
      onChange({ ...project, entities });
    }
  };

  const placeEntity = (x: number, y: number) => {
    const spot = { type: entityType, x: x * 8, y: y * 8 };
    let entities = project.entities.filter(
      e => !(e.x === spot.x && e.y === spot.y)
    );
    if (entityType === ENT_PLAYER) {
      // Exactly one spawn point makes sense, so a new one replaces the old.
      entities = entities.filter(e => e.type !== ENT_PLAYER);
    }
    if (entities.length >= MAX_ENTITIES) return;
    onChange({ ...project, entities: [...entities, spot] });
  };

  const apply = (
    event: React.PointerEvent<HTMLCanvasElement>,
    secondary: boolean
  ) => {
    const cell = cellFromEvent(event);
    if (!cell) return;
    if (tool === "entity") {
      if (secondary) removeEntityAt(cell.x, cell.y);
      else placeEntity(cell.x, cell.y);
      return;
    }
    paintTile(cell.x, cell.y, secondary || tool === "erase" ? 0 : selectedTile);
  };

  const playerCount = project.entities.filter(
    e => e.type === ENT_PLAYER
  ).length;

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {(
            [
              ["tile", "Paint tiles"],
              ["erase", "Erase tiles"],
              ["entity", "Place objects"],
            ] as Array<[Tool, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTool(id)}
              className={`rounded border px-3 py-1 ${
                tool === id
                  ? "border-skin-accent bg-skin-accent text-skin-inverted"
                  : "border-skin-line hover:bg-skin-card"
              }`}
            >
              {label}
            </button>
          ))}

          <label className="ml-auto flex items-center gap-1">
            Zoom
            <select
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="rounded border border-skin-line bg-skin-fill px-1 py-1"
            >
              {[1, 2, 3, 4].map(z => (
                <option key={z} value={z}>
                  {z}x
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={e => setShowGrid(e.target.checked)}
            />
            Grid
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showCollision}
              onChange={e => setShowCollision(e.target.checked)}
            />
            Collision
          </label>
        </div>

        <div
          ref={scrollRef}
          className="max-h-[70vh] overflow-auto rounded border border-skin-line"
        >
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="block cursor-crosshair touch-none"
            style={{ imageRendering: "pixelated" }}
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setPainting(true);
              apply(e, e.button === 2);
            }}
            onPointerMove={e => {
              // Dragging paints tiles; objects are placed one click at a time.
              if (painting && tool !== "entity") apply(e, e.buttons === 2);
            }}
            onPointerUp={() => setPainting(false)}
            onPointerCancel={() => setPainting(false)}
          />
        </div>

        <p className="mt-2 text-xs opacity-60">
          The level is {LEVEL_W}x{LEVEL_H} tiles ({LEVEL_W * 8}x{LEVEL_H * 8}{" "}
          pixels). Right-click erases. Walking off the bottom kills the player.
        </p>
      </div>

      <div className="w-full shrink-0 sm:w-72">
        {tool === "entity" ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Object to place</h3>
            <div className="space-y-1">
              {ENTITY_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setEntityType(type)}
                  className={`block w-full rounded border px-3 py-2 text-left text-sm ${
                    entityType === type
                      ? "border-skin-accent bg-skin-accent text-skin-inverted"
                      : "border-skin-line hover:bg-skin-card"
                  }`}
                >
                  {ENTITY_NAMES[type]}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs opacity-70">
              {project.entities.length} / {MAX_ENTITIES} objects placed.
            </p>
            {playerCount === 0 && (
              <p className="mt-2 text-xs text-red-500">
                No player start placed — the game will spawn at the top-left
                corner.
              </p>
            )}
          </div>
        ) : (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Tile {selectedTile}</h3>
            <SheetPicker
              cells={project.tiles}
              palettes={project.bgPalettes}
              cellSize={8}
              columns={16}
              zoom={2}
              selected={selectedTile}
              onSelect={onSelectTile}
            />
            <p className="mt-2 text-xs opacity-60">
              Pick a tile here, then paint on the map. Edit the artwork in the
              Tiles tab.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sheets

function buildTileSheet(project: GameProject): HTMLCanvasElement {
  return buildSheet(project.tiles, project.bgPalettes, 8, 16);
}

function buildSpriteSheet(project: GameProject): HTMLCanvasElement {
  return buildSheet(project.sprites, project.objPalettes, 16, 8);
}

function buildSheet(
  cells: Array<{ pixels: number[]; palette: number }>,
  palettes: number[][],
  cellSize: number,
  columns: number
): HTMLCanvasElement {
  const rows = Math.ceil(cells.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = columns * cellSize;
  canvas.height = rows * cellSize;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  cells.forEach((cell, index) => {
    const palette = palettes[cell.palette & 7] ?? palettes[0];
    const ox = (index % columns) * cellSize;
    const oy = Math.floor(index / columns) * cellSize;
    for (let y = 0; y < cellSize; y++) {
      for (let x = 0; x < cellSize; x++) {
        const value = cell.pixels[y * cellSize + x] & 0x0f;
        if (value === 0) continue;
        const [r, g, b] = bgr555ToRgb(palette[value] ?? 0);
        const o = ((oy + y) * canvas.width + ox + x) * 4;
        image.data[o] = r;
        image.data[o + 1] = g;
        image.data[o + 2] = b;
        image.data[o + 3] = 255;
      }
    }
  });
  ctx.putImageData(image, 0, 0);
  return canvas;
}
