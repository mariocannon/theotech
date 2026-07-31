import { useState } from "react";
import { COLLISION_NAMES, PALETTE_COUNT } from "@utils/snes/constants";
import type { GameProject, TileDef } from "@utils/snes/types";
import PixelEditor from "./PixelEditor";
import SheetPicker from "./SheetPicker";

interface Props {
  project: GameProject;
  onChange: (project: GameProject) => void;
  selected: number;
  onSelect: (index: number) => void;
}

export default function TilesPanel({
  project,
  onChange,
  selected,
  onSelect,
}: Props) {
  const [colorIndex, setColorIndex] = useState(1);
  const tile = project.tiles[selected];

  const updateTile = (patch: Partial<TileDef>) => {
    const tiles = [...project.tiles];
    tiles[selected] = { ...tiles[selected], ...patch };
    onChange({ ...project, tiles });
  };

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Tileset</h3>
        <SheetPicker
          cells={project.tiles}
          palettes={project.bgPalettes}
          cellSize={8}
          columns={16}
          zoom={2}
          selected={selected}
          onSelect={onSelect}
        />
        <p className="mt-2 max-w-[16rem] text-xs opacity-60">
          256 background tiles. Tile 0 is the sky: leave it blank so empty space
          shows the backdrop colour.
        </p>
      </div>

      <div className="flex-1">
        <h3 className="mb-2 text-sm font-semibold">
          Tile {selected}
          <span className="ml-2 font-normal opacity-60">
            palette {tile.palette} · {COLLISION_NAMES[tile.collision]}
          </span>
        </h3>

        <PixelEditor
          pixels={tile.pixels}
          size={8}
          palette={project.bgPalettes[tile.palette & 7]}
          colorIndex={colorIndex}
          onColorIndex={setColorIndex}
          onChange={pixels => updateTile({ pixels })}
        />

        <div className="mt-4 flex flex-wrap gap-6">
          <label className="text-sm">
            <span className="mb-1 block opacity-70">Palette</span>
            <select
              value={tile.palette}
              onChange={e => updateTile({ palette: Number(e.target.value) })}
              className="rounded border border-skin-line bg-skin-fill px-2 py-1"
            >
              {Array.from({ length: PALETTE_COUNT }, (_, i) => (
                <option key={i} value={i}>
                  Palette {i}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block opacity-70">Collision</span>
            <select
              value={tile.collision}
              onChange={e => updateTile({ collision: Number(e.target.value) })}
              className="rounded border border-skin-line bg-skin-fill px-2 py-1"
            >
              {COLLISION_NAMES.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              className="rounded border border-skin-line px-3 py-1 text-sm hover:bg-skin-card"
              onClick={() => updateTile({ pixels: new Array(64).fill(0) })}
            >
              Clear
            </button>
            <button
              type="button"
              className="rounded border border-skin-line px-3 py-1 text-sm hover:bg-skin-card"
              onClick={() => {
                const flipped = new Array<number>(64);
                for (let y = 0; y < 8; y++)
                  for (let x = 0; x < 8; x++)
                    flipped[y * 8 + x] = tile.pixels[y * 8 + (7 - x)];
                updateTile({ pixels: flipped });
              }}
            >
              Flip
            </button>
          </div>
        </div>

        <dl className="mt-6 space-y-1 text-xs opacity-70">
          <div>
            <dt className="inline font-semibold">Empty</dt>
            <dd className="inline"> — the player passes straight through.</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Solid</dt>
            <dd className="inline"> — floors, walls and ceilings.</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Hazard</dt>
            <dd className="inline"> — touching it kills the player.</dd>
          </div>
          <div>
            <dt className="inline font-semibold">One-way</dt>
            <dd className="inline">
              {" "}
              — you land on it from above but can jump up through it.
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
