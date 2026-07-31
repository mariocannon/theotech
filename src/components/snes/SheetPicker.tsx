import { useEffect, useRef } from "react";
import { bgr555ToRgb } from "@utils/snes/gfx";

interface Props {
  /** One entry per cell: its pixel indices and which palette to use. */
  cells: Array<{ pixels: number[]; palette: number }>;
  palettes: number[][];
  /** Edge length of a cell in source pixels (8 or 16). */
  cellSize: number;
  columns: number;
  zoom: number;
  selected: number;
  onSelect: (index: number) => void;
  /** Optional label under the grid. */
  emptyFrom?: number;
}

/**
 * A clickable grid of tiles or sprites drawn straight from project data, so
 * the picker always reflects unsaved pixel edits.
 */
export default function SheetPicker({
  cells,
  palettes,
  cellSize,
  columns,
  zoom,
  selected,
  onSelect,
  emptyFrom,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rows = Math.ceil(cells.length / columns);
  const width = columns * cellSize * zoom;
  const height = rows * cellSize * zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Draw at native resolution first, then scale up without smoothing.
    const buffer = document.createElement("canvas");
    buffer.width = columns * cellSize;
    buffer.height = rows * cellSize;
    const bctx = buffer.getContext("2d")!;
    const image = bctx.createImageData(buffer.width, buffer.height);

    cells.forEach((cell, index) => {
      const palette = palettes[cell.palette & 7] ?? palettes[0];
      const ox = (index % columns) * cellSize;
      const oy = Math.floor(index / columns) * cellSize;
      for (let y = 0; y < cellSize; y++) {
        for (let x = 0; x < cellSize; x++) {
          const value = cell.pixels[y * cellSize + x] & 0x0f;
          const o = ((oy + y) * buffer.width + ox + x) * 4;
          if (value === 0) {
            const checker = ((ox + x) >> 2) + ((oy + y) >> 2);
            const shade = checker % 2 === 0 ? 58 : 44;
            image.data[o] = shade;
            image.data[o + 1] = shade;
            image.data[o + 2] = shade;
            image.data[o + 3] = 255;
            continue;
          }
          const [r, g, b] = bgr555ToRgb(palette[value] ?? 0);
          image.data[o] = r;
          image.data[o + 1] = g;
          image.data[o + 2] = b;
          image.data[o + 3] = 255;
        }
      }
    });
    bctx.putImageData(image, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(buffer, 0, 0, width, height);

    ctx.strokeStyle = "rgba(128,128,128,0.3)";
    ctx.lineWidth = 1;
    for (let c = 1; c < columns; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cellSize * zoom + 0.5, 0);
      ctx.lineTo(c * cellSize * zoom + 0.5, height);
      ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cellSize * zoom + 0.5);
      ctx.lineTo(width, r * cellSize * zoom + 0.5);
      ctx.stroke();
    }

    if (emptyFrom !== undefined && emptyFrom < cells.length) {
      // Dim the range that is still blank so the used part stands out.
      const startRow = Math.floor(emptyFrom / columns);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(
        0,
        (startRow + 1) * cellSize * zoom,
        width,
        height - (startRow + 1) * cellSize * zoom
      );
    }

    const sx = (selected % columns) * cellSize * zoom;
    const sy = Math.floor(selected / columns) * cellSize * zoom;
    ctx.strokeStyle = "#ff6b01";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, cellSize * zoom - 2, cellSize * zoom - 2);
  }, [
    cells,
    palettes,
    cellSize,
    columns,
    zoom,
    selected,
    width,
    height,
    rows,
    emptyFrom,
  ]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="max-w-full cursor-pointer rounded border border-skin-line"
      style={{ imageRendering: "pixelated" }}
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.floor(
          ((event.clientX - rect.left) / rect.width) * columns
        );
        const y = Math.floor(((event.clientY - rect.top) / rect.height) * rows);
        const index = y * columns + x;
        if (index >= 0 && index < cells.length) onSelect(index);
      }}
    />
  );
}
