// Pure text-chart helpers. No React, no I/O — just numbers to strings.

const BLOCKS = "▁▂▃▄▅▆▇█";

/** One-line sparkline from block elements (8 vertical levels). */
export function sparkline(values: number[], width?: number): string {
  const v = width && values.length > width ? values.slice(-width) : values;
  if (v.length === 0) return "";
  const min = Math.min(...v);
  const max = Math.max(...v);
  const range = max - min || 1;
  return v
    .map((n) => BLOCKS[Math.min(7, Math.floor(((n - min) / range) * 8))] ?? " ")
    .join("");
}

/**
 * Braille line chart.
 *
 * Each character cell packs a 2×4 dot grid, so a W×H block of characters is a
 * 2W×4H "pixel" canvas — which is how a terminal draws a smooth curve. Returns
 * `height` strings, top row first. With `fill`, every dot BELOW the curve is lit
 * too, turning the line into a filled area (the base for a gradient chart).
 */
export function brailleChart(
  values: number[],
  width: number,
  height: number,
  fill = false,
): string[] {
  const grid = new Uint8Array(width * height);

  if (values.length > 0) {
    const dotW = width * 2;
    const dotH = height * 4;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    // Which bit represents the dot at (col 0-1, row 0-3) inside a braille cell.
    const bitAt = (col: number, row: number): number => {
      const column = col === 0 ? [0x01, 0x02, 0x04, 0x40] : [0x08, 0x10, 0x20, 0x80];
      return column[row] ?? 0;
    };
    const lit = (x: number, yDot: number): void => {
      const cx = Math.floor(x / 2);
      const cy = Math.floor(yDot / 4);
      const idx = cy * width + cx;
      if (idx < 0 || idx >= grid.length) return;
      grid[idx] = (grid[idx] ?? 0) | bitAt(x % 2, yDot % 4);
    };

    for (let x = 0; x < dotW; x++) {
      const i = Math.round((x / Math.max(1, dotW - 1)) * (values.length - 1));
      const value = values[i] ?? min;
      const norm = (value - min) / range;
      const yDot = Math.round((1 - norm) * (dotH - 1)); // invert: high = top
      if (fill) for (let y = yDot; y < dotH; y++) lit(x, y);
      else lit(x, yDot);
    }
  }

  const rows: string[] = [];
  for (let cy = 0; cy < height; cy++) {
    let line = "";
    for (let cx = 0; cx < width; cx++) {
      const bits = grid[cy * width + cx] ?? 0;
      line += bits ? String.fromCharCode(0x2800 + bits) : " ";
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Linear interpolation between two "#rrggbb" colours, t in [0,1].
 *
 * Used to paint a vertical gradient down a chart's rows. Pure string maths.
 */
export function lerpHex(a: string, b: string, t: number): string {
  const parse = (h: string): [number, number, number] => {
    const s = h.replace("#", "");
    const n =
      s.length === 3
        ? s
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : s;
    return [
      parseInt(n.slice(0, 2), 16) || 0,
      parseInt(n.slice(2, 4), 16) || 0,
      parseInt(n.slice(4, 6), 16) || 0,
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const clamped = Math.max(0, Math.min(1, t));
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * clamped);
  const hx = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${hx(mix(ar, br))}${hx(mix(ag, bg))}${hx(mix(ab, bb))}`;
}
