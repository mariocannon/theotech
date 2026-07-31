import { useEffect, useRef, useState } from "react";
import {
  JOY_A,
  JOY_B,
  JOY_DOWN,
  JOY_LEFT,
  JOY_RIGHT,
  JOY_START,
  JOY_UP,
  SCREEN_H,
  SCREEN_W,
  STATE_DEAD,
  STATE_WIN,
} from "@utils/snes/constants";
import { Atlas, GameSim, renderFrame } from "@utils/snes/sim";
import type { GameProject } from "@utils/snes/types";

interface Props {
  project: GameProject;
}

const KEY_MAP: Record<string, number> = {
  ArrowLeft: JOY_LEFT,
  ArrowRight: JOY_RIGHT,
  ArrowUp: JOY_UP,
  ArrowDown: JOY_DOWN,
  KeyA: JOY_LEFT,
  KeyD: JOY_RIGHT,
  KeyW: JOY_UP,
  KeyS: JOY_DOWN,
  KeyZ: JOY_A,
  KeyX: JOY_B,
  Space: JOY_A,
  Enter: JOY_START,
};

const FRAME_MS = 1000 / 60;

export default function PlayPanel({ project }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<GameSim | null>(null);
  const buttonsRef = useRef(0);
  const [scale, setScale] = useState(2);
  const [hud, setHud] = useState({ score: 0, state: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const atlas = new Atlas();
    atlas.rebuild(project);
    const sim = new GameSim(project);
    simRef.current = sim;

    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let lastHud = -1;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      accumulator += now - last;
      last = now;
      // Don't try to catch up after a long tab-switch pause.
      if (accumulator > 250) accumulator = 250;
      while (accumulator >= FRAME_MS) {
        sim.step(buttonsRef.current);
        accumulator -= FRAME_MS;
      }
      ctx.imageSmoothingEnabled = false;
      renderFrame(ctx, atlas, project, sim);
      const stamp = sim.score * 8 + sim.state;
      if (stamp !== lastHud) {
        lastHud = stamp;
        setHud({ score: sim.score, state: sim.state });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [project]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const bit = KEY_MAP[event.code];
      if (bit === undefined) return;
      // The game owns the arrow keys while it has focus.
      event.preventDefault();
      buttonsRef.current |= bit;
    };
    const up = (event: KeyboardEvent) => {
      const bit = KEY_MAP[event.code];
      if (bit === undefined) return;
      event.preventDefault();
      buttonsRef.current &= ~bit;
    };
    const blur = () => {
      buttonsRef.current = 0;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const hold = (bit: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      buttonsRef.current |= bit;
    },
    onPointerUp: () => {
      buttonsRef.current &= ~bit;
    },
    onPointerLeave: () => {
      buttonsRef.current &= ~bit;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-sm">
          <span className="opacity-70">Coins </span>
          <span className="tabular-nums">{hud.score}</span>
          {hud.state === STATE_WIN && (
            <span className="ml-3 font-semibold text-green-500">
              Level complete
            </span>
          )}
          {hud.state === STATE_DEAD && (
            <span className="ml-3 font-semibold text-red-500">Ouch</span>
          )}
        </div>
        <label className="ml-auto flex items-center gap-1 text-sm">
          Scale
          <select
            value={scale}
            onChange={e => setScale(Number(e.target.value))}
            className="rounded border border-skin-line bg-skin-fill px-1 py-1"
          >
            {[1, 2, 3].map(s => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded border border-skin-line px-3 py-1 text-sm hover:bg-skin-card"
          onClick={() => simRef.current?.reset()}
        >
          Restart
        </button>
      </div>

      <canvas
        ref={canvasRef}
        width={SCREEN_W}
        height={SCREEN_H}
        className="mx-auto block max-w-full rounded border border-skin-line bg-black"
        style={{
          width: SCREEN_W * scale,
          height: SCREEN_H * scale,
          imageRendering: "pixelated",
        }}
      />

      <div className="flex justify-center gap-8 sm:hidden">
        <div className="flex gap-2">
          <button
            className="h-14 w-14 rounded border border-skin-line text-xl"
            {...hold(JOY_LEFT)}
          >
            ←
          </button>
          <button
            className="h-14 w-14 rounded border border-skin-line text-xl"
            {...hold(JOY_RIGHT)}
          >
            →
          </button>
        </div>
        <button
          className="h-14 w-14 rounded-full border border-skin-line text-lg"
          {...hold(JOY_A)}
        >
          A
        </button>
      </div>

      <p className="text-center text-xs opacity-60">
        Arrow keys or A/D to move, Z or Space to jump. This preview runs the
        same rules as the exported ROM.
      </p>
    </div>
  );
}
