import type { GameProject, GameSettings } from "@utils/snes/types";

interface Props {
  project: GameProject;
  onChange: (project: GameProject) => void;
}

interface Knob {
  key: keyof GameSettings;
  label: string;
  min: number;
  max: number;
  hint: string;
  unit: "speed" | "accel";
}

const KNOBS: Knob[] = [
  {
    key: "walkSpeed",
    label: "Walk speed",
    min: 4,
    max: 64,
    unit: "speed",
    hint: "How fast the player moves left and right.",
  },
  {
    key: "jumpPower",
    label: "Jump strength",
    min: 16,
    max: 144,
    unit: "speed",
    hint: "Upward speed at the moment of the jump.",
  },
  {
    key: "gravity",
    label: "Gravity",
    min: 1,
    max: 24,
    unit: "accel",
    hint: "How quickly falling speed builds up.",
  },
  {
    key: "maxFall",
    label: "Maximum fall speed",
    min: 16,
    max: 144,
    unit: "speed",
    hint: "Terminal velocity. Keep it under 8 px/frame or fast falls can clip thin floors.",
  },
  {
    key: "enemySpeed",
    label: "Enemy speed",
    min: 1,
    max: 48,
    unit: "speed",
    hint: "How fast walking enemies patrol.",
  },
];

/** Fixed-point values are stored in sixteenths of a pixel. */
const format = (value: number, unit: Knob["unit"]) =>
  `${(value / 16).toFixed(2)} px/frame${unit === "accel" ? "²" : ""}`;

export default function SettingsPanel({ project, onChange }: Props) {
  const set = (key: keyof GameSettings, value: number) =>
    onChange({ ...project, settings: { ...project.settings, [key]: value } });

  return (
    <div className="max-w-2xl space-y-6">
      <label className="block">
        <span className="mb-1 block text-sm opacity-70">
          Game title (appears in the ROM header, 21 characters)
        </span>
        <input
          value={project.title}
          maxLength={21}
          onChange={e => onChange({ ...project, title: e.target.value })}
          className="w-full rounded border border-skin-line bg-skin-fill px-3 py-2"
        />
      </label>

      <div className="space-y-5">
        {KNOBS.map(knob => (
          <label key={knob.key} className="block">
            <span className="mb-1 flex items-baseline justify-between text-sm">
              <span>{knob.label}</span>
              <span className="tabular-nums opacity-70">
                {format(project.settings[knob.key], knob.unit)}
              </span>
            </span>
            <input
              type="range"
              min={knob.min}
              max={knob.max}
              value={project.settings[knob.key]}
              onChange={e => set(knob.key, Number(e.target.value))}
              className="w-full"
            />
            <span className="mt-1 block text-xs opacity-60">{knob.hint}</span>
          </label>
        ))}
      </div>

      <div className="rounded border border-skin-line p-4 text-xs opacity-80">
        <p className="mb-2 font-semibold">How the export works</p>
        <p>
          Exporting assembles a 65816 platformer engine, then appends your
          palettes, tile and sprite graphics, the level map, its collision data
          and your object placements. The result is a 256 KiB LoROM cartridge
          image with a valid header and checksum — the same thing a real
          development kit would produce.
        </p>
      </div>
    </div>
  );
}
