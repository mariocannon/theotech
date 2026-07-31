import { useCallback, useEffect, useRef, useState } from "react";
import { bgr555ToCss } from "@utils/snes/gfx";

interface Props {
  pixels: number[];
  /** Edge length in pixels: 8 for background tiles, 16 for sprites. */
  size: number;
  palette: number[];
  colorIndex: number;
  onColorIndex: (index: number) => void;
  onChange: (pixels: number[]) => void;
  /** Index 0 is transparent for sprites, backdrop-coloured for tiles. */
  zeroIsTransparent?: boolean;
}

const ZOOM = 22;

export default function PixelEditor({
  pixels,
  size,
  palette,
  colorIndex,
  onColorIndex,
  onChange,
  zeroIsTransparent = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painting, setPainting] = useState(false);
  const dimension = size * ZOOM;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, dimension, dimension);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = pixels[y * size + x] & 0x0f;
        if (index === 0 && zeroIsTransparent) {
          // Checkerboard so transparent pixels read as empty, not black.
          ctx.fillStyle = (x + y) % 2 === 0 ? "#3a3a3a" : "#2c2c2c";
        } else {
          ctx.fillStyle = bgr555ToCss(palette[index] ?? 0);
        }
        ctx.fillRect(x * ZOOM, y * ZOOM, ZOOM, ZOOM);
      }
    }

    ctx.strokeStyle = "rgba(128,128,128,0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i++) {
      const p = i * ZOOM + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, dimension);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(dimension, p);
      ctx.stroke();
    }
    // Emphasise the 8x8 tile boundaries inside a 16x16 sprite.
    if (size === 16) {
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.moveTo(8 * ZOOM + 0.5, 0);
      ctx.lineTo(8 * ZOOM + 0.5, dimension);
      ctx.moveTo(0, 8 * ZOOM + 0.5);
      ctx.lineTo(dimension, 8 * ZOOM + 0.5);
      ctx.stroke();
    }
  }, [pixels, size, palette, dimension, zeroIsTransparent]);

  const paintAt = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>, erase: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((event.clientX - rect.left) / rect.width) * size);
      const y = Math.floor(((event.clientY - rect.top) / rect.height) * size);
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const value = erase ? 0 : colorIndex;
      if (pixels[y * size + x] === value) return;
      const next = [...pixels];
      next[y * size + x] = value;
      onChange(next);
    },
    [pixels, size, colorIndex, onChange]
  );

  return (
    <div className="flex flex-wrap items-start gap-4">
      <canvas
        ref={canvasRef}
        width={dimension}
        height={dimension}
        className="max-w-full cursor-crosshair touch-none rounded border border-skin-line"
        style={{ imageRendering: "pixelated" }}
        onContextMenu={e => e.preventDefault()}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setPainting(true);
          paintAt(e, e.button === 2);
        }}
        onPointerMove={e => {
          if (painting) paintAt(e, e.buttons === 2);
        }}
        onPointerUp={() => setPainting(false)}
        onPointerCancel={() => setPainting(false)}
      />

      <div>
        <p className="mb-2 text-xs opacity-70">
          Colour {colorIndex}
          {colorIndex === 0 && zeroIsTransparent ? " (transparent)" : ""}
        </p>
        <div className="grid w-max grid-cols-4 gap-1">
          {palette.map((color, i) => (
            <button
              key={i}
              type="button"
              title={`Colour ${i}`}
              onClick={() => onColorIndex(i)}
              className={`h-9 w-9 rounded border-2 ${
                i === colorIndex ? "border-skin-accent" : "border-skin-line"
              }`}
              style={{
                backgroundColor:
                  i === 0 && zeroIsTransparent
                    ? "transparent"
                    : bgr555ToCss(color),
                backgroundImage:
                  i === 0 && zeroIsTransparent
                    ? "linear-gradient(45deg,#3a3a3a 25%,transparent 25%,transparent 75%,#3a3a3a 75%),linear-gradient(45deg,#3a3a3a 25%,#2c2c2c 25%,#2c2c2c 75%,#3a3a3a 75%)"
                    : undefined,
                backgroundSize: "10px 10px",
                backgroundPosition: "0 0, 5px 5px",
              }}
            />
          ))}
        </div>
        <p className="mt-2 max-w-[9rem] text-xs opacity-60">
          Right-click to erase.
        </p>
      </div>
    </div>
  );
}
