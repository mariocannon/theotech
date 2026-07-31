import { useState } from "react";
import { PALETTE_COUNT } from "@utils/snes/constants";
import { bgr555ToCss, bgr555ToHex, hexToBgr555 } from "@utils/snes/gfx";
import type { GameProject } from "@utils/snes/types";

interface Props {
  project: GameProject;
  onChange: (project: GameProject) => void;
}

type Which = "bg" | "obj";

export default function PalettePanel({ project, onChange }: Props) {
  const [which, setWhich] = useState<Which>("bg");
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(1);

  const key = which === "bg" ? "bgPalettes" : "objPalettes";
  const palettes = project[key];
  const current = palettes[row][col];

  const setColor = (value: number) => {
    const next = palettes.map(p => [...p]);
    next[row][col] = value & 0x7fff;
    onChange({ ...project, [key]: next });
  };

  const channel = (shift: number) => (current >> shift) & 31;
  const setChannel = (shift: number, value: number) => {
    setColor((current & ~(31 << shift)) | ((value & 31) << shift));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {(["bg", "obj"] as Which[]).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setWhich(k);
              setRow(0);
            }}
            className={`rounded border px-3 py-1 text-sm ${
              which === k
                ? "border-skin-accent bg-skin-accent text-skin-inverted"
                : "border-skin-line hover:bg-skin-card"
            }`}
          >
            {k === "bg" ? "Background palettes" : "Object palettes"}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {Array.from({ length: PALETTE_COUNT }, (_, p) => (
          <div key={p} className="flex items-center gap-2">
            <span className="w-6 text-right text-xs opacity-60">{p}</span>
            <div className="flex">
              {palettes[p].map((color, c) => {
                const selected = row === p && col === c;
                const transparent = which === "obj" && c === 0;
                return (
                  <button
                    key={c}
                    type="button"
                    title={`Palette ${p}, colour ${c}`}
                    onClick={() => {
                      setRow(p);
                      setCol(c);
                    }}
                    className={`h-8 w-8 border ${
                      selected
                        ? "z-10 scale-110 border-2 border-skin-accent"
                        : "border-skin-line"
                    }`}
                    style={{
                      backgroundColor: transparent
                        ? "transparent"
                        : bgr555ToCss(color),
                      backgroundImage: transparent
                        ? "linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%),linear-gradient(45deg,#555 25%,#333 25%,#333 75%,#555 75%)"
                        : undefined,
                      backgroundSize: "8px 8px",
                      backgroundPosition: "0 0, 4px 4px",
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-6 rounded border border-skin-line p-4">
        <div>
          <p className="mb-1 text-sm opacity-70">
            {which === "bg" ? "Background" : "Object"} palette {row}, colour{" "}
            {col}
          </p>
          <input
            type="color"
            value={bgr555ToHex(current)}
            onChange={e => setColor(hexToBgr555(e.target.value))}
            className="h-12 w-24 cursor-pointer rounded border border-skin-line bg-transparent"
          />
        </div>

        <div className="space-y-1">
          {(
            [
              ["Red", 0],
              ["Green", 5],
              ["Blue", 10],
            ] as const
          ).map(([label, shift]) => (
            <label key={label} className="flex items-center gap-2 text-xs">
              <span className="w-12">{label}</span>
              <input
                type="range"
                min={0}
                max={31}
                value={channel(shift)}
                onChange={e => setChannel(shift, Number(e.target.value))}
              />
              <span className="w-6 text-right tabular-nums">
                {channel(shift)}
              </span>
            </label>
          ))}
        </div>

        <p className="max-w-xs text-xs opacity-60">
          The SNES stores 5 bits per channel, so colours snap to the nearest of
          32 steps. Background palette 0 colour 0 is the backdrop: it fills
          everywhere nothing is drawn.
          {which === "obj" ? " Object colour 0 is always transparent." : ""}
        </p>
      </div>
    </div>
  );
}
