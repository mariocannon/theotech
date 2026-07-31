import { useState } from "react";
import {
  PALETTE_COUNT,
  TYPE_TO_SLOT,
  ENTITY_NAMES,
} from "@utils/snes/constants";
import type { GameProject, SpriteDef } from "@utils/snes/types";
import PixelEditor from "./PixelEditor";
import SheetPicker from "./SheetPicker";

interface Props {
  project: GameProject;
  onChange: (project: GameProject) => void;
  selected: number;
  onSelect: (index: number) => void;
}

/** Which slots the engine draws automatically, and what for. */
const SLOT_ROLES: Record<number, string> = {
  0: "Player — standing still",
  1: "Player — walking (frame 1)",
  2: "Player — walking (frame 2)",
  3: "Player — in the air",
  4: ENTITY_NAMES[2],
  5: ENTITY_NAMES[3],
  7: ENTITY_NAMES[4],
};

export default function SpritesPanel({
  project,
  onChange,
  selected,
  onSelect,
}: Props) {
  const [colorIndex, setColorIndex] = useState(1);
  const sprite = project.sprites[selected];

  const updateSprite = (patch: Partial<SpriteDef>) => {
    const sprites = [...project.sprites];
    sprites[selected] = { ...sprites[selected], ...patch };
    onChange({ ...project, sprites });
  };

  const role = SLOT_ROLES[selected];
  const usedByType = Object.entries(TYPE_TO_SLOT).find(
    ([type, slot]) => slot === selected && Number(type) > 1
  );

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Sprites</h3>
        <SheetPicker
          cells={project.sprites}
          palettes={project.objPalettes}
          cellSize={16}
          columns={8}
          zoom={2}
          selected={selected}
          onSelect={onSelect}
        />
        <p className="mt-2 max-w-[16rem] text-xs opacity-60">
          32 objects, 16x16 pixels each. Slots 0-7 are wired to the engine; the
          rest are spare.
        </p>
      </div>

      <div className="flex-1">
        <h3 className="mb-2 text-sm font-semibold">
          Slot {selected}
          {role ? (
            <span className="ml-2 font-normal opacity-60">{role}</span>
          ) : (
            <span className="ml-2 font-normal opacity-60">unused</span>
          )}
        </h3>

        <PixelEditor
          pixels={sprite.pixels}
          size={16}
          palette={project.objPalettes[sprite.palette & 7]}
          colorIndex={colorIndex}
          onColorIndex={setColorIndex}
          onChange={pixels => updateSprite({ pixels })}
          zeroIsTransparent
        />

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block opacity-70">Name</span>
            <input
              value={sprite.name}
              onChange={e => updateSprite({ name: e.target.value })}
              className="w-48 rounded border border-skin-line bg-skin-fill px-2 py-1"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block opacity-70">Palette</span>
            <select
              value={sprite.palette}
              onChange={e => updateSprite({ palette: Number(e.target.value) })}
              className="rounded border border-skin-line bg-skin-fill px-2 py-1"
            >
              {Array.from({ length: PALETTE_COUNT }, (_, i) => (
                <option key={i} value={i}>
                  Object palette {i}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="rounded border border-skin-line px-3 py-1 text-sm hover:bg-skin-card"
            onClick={() => updateSprite({ pixels: new Array(256).fill(0) })}
          >
            Clear
          </button>
          <button
            type="button"
            className="rounded border border-skin-line px-3 py-1 text-sm hover:bg-skin-card"
            onClick={() => {
              const flipped = new Array<number>(256);
              for (let y = 0; y < 16; y++)
                for (let x = 0; x < 16; x++)
                  flipped[y * 16 + x] = sprite.pixels[y * 16 + (15 - x)];
              updateSprite({ pixels: flipped });
            }}
          >
            Flip
          </button>
        </div>

        <p className="mt-4 max-w-md text-xs opacity-60">
          Colour 0 is transparent. The player sprite is drawn facing right and
          mirrored automatically when walking left.
          {usedByType
            ? " This slot is drawn for every entity of its type."
            : ""}
        </p>
      </div>
    </div>
  );
}
