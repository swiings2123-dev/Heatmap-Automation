// Small custom heatmap renderer: accumulate a kernel density grid, normalise by an
// ADAPTIVE max (a high percentile of the data, not a fixed constant), colourise
// through a palette lookup table, then draw scaled onto the target canvas.

import type { HeatPoint } from "../../../shared/types";

/** Thermal-camera ramp (cold blue -> hot magenta). Low densities are also more transparent, so photos stay readable. */
export const HEAT_STOPS: [number, string][] = [
  [0.0, "#2b59ff"],
  [0.22, "#00c8ff"],
  [0.45, "#8dff4f"],
  [0.62, "#ffd23d"],
  [0.8, "#ff7a1a"],
  [1.0, "#ff1f6b"],
];

/** Device pixel ratio for a canvas, capped so very tall pages stay under browser canvas limits. */
function canvasDpr(heightCss: number): number {
  return Math.max(0.5, Math.min(window.devicePixelRatio || 1, 2, 16_000 / Math.max(heightCss, 1)));
}

let lut: Uint8ClampedArray | null = null;
function palette(): Uint8ClampedArray {
  if (lut) return lut;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 1;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  for (const [o, col] of HEAT_STOPS) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1);
  lut = ctx.getImageData(0, 0, 256, 1).data;
  return lut;
}

export interface HeatOptions {
  /** CSS px of the source coordinate space -> display px */
  scale: number;
  /** kernel radius in display px */
  radius: number;
  /** grid resolution relative to display px (lower = faster) */
  resolution?: number;
  /** percentile of non-zero density used as the max (adaptive) */
  percentile?: number;
  /** y offset in source px subtracted before scaling (for the floating fixed layer) */
  mapY?: (y: number) => number;
}

/** Returns the density value used as "max" (exposed for the legend/tests). */
export function drawHeat(canvas: HTMLCanvasElement, points: HeatPoint[], opts: HeatOptions): number {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const dpr = canvasDpr(H);
  canvas.width = Math.max(1, Math.round(W * dpr));
  canvas.height = Math.max(1, Math.round(H * dpr));
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!points.length || !W || !H) return 0;

  const res = opts.resolution ?? 0.5;
  const gw = Math.ceil(W * res);
  const gh = Math.ceil(H * res);
  const grid = new Float32Array(gw * gh);
  const R = Math.max(2, Math.round(opts.radius * res));
  const kernel: number[] = [];
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const d2 = (dx * dx + dy * dy) / (R * R);
      kernel.push(d2 < 1 ? (1 - d2) * (1 - d2) : 0);
    }

  for (const [x, y, n] of points) {
    const sy = opts.mapY ? opts.mapY(y) : y * opts.scale;
    const cx = Math.round(x * opts.scale * res);
    const cy = Math.round(sy * res);
    if (cx < -R || cy < -R || cx > gw + R || cy > gh + R) continue;
    let k = 0;
    for (let dy = -R; dy <= R; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= gh) {
        k += 2 * R + 1;
        continue;
      }
      const row = yy * gw;
      for (let dx = -R; dx <= R; dx++, k++) {
        const xx = cx + dx;
        if (xx >= 0 && xx < gw) grid[row + xx]! += n * kernel[k]!;
      }
    }
  }

  // Adaptive max: a high percentile of non-zero cells, so one hotspot doesn't wash out the rest.
  const nz: number[] = [];
  const step = Math.max(1, Math.floor(grid.length / 200_000));
  for (let i = 0; i < grid.length; i += step) if (grid[i]! > 0) nz.push(grid[i]!);
  if (!nz.length) return 0;
  nz.sort((a, b) => a - b);
  const max = Math.max(nz[Math.min(nz.length - 1, Math.floor(nz.length * (opts.percentile ?? 0.985)))]!, 1e-6);

  const pal = palette();
  const img = new ImageData(gw, gh);
  const px = img.data;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]! / max;
    if (v < 0.015) continue;
    const t = Math.min(1, v);
    const p = Math.round(t * 255) * 4;
    px[i * 4] = pal[p]!;
    px[i * 4 + 1] = pal[p + 1]!;
    px[i * 4 + 2] = pal[p + 2]!;
    px[i * 4 + 3] = Math.round(Math.min(1, 0.35 + t * 0.6) * Math.min(1, v * 6) * 235);
  }
  const off = document.createElement("canvas");
  off.width = gw;
  off.height = gh;
  off.getContext("2d")!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  return max;
}

/** Rage / dead click markers: rings sized by count. */
export function drawMarkers(
  canvas: HTMLCanvasElement,
  sets: { points: HeatPoint[]; color: string }[],
  scale: number,
  mapY?: (y: number) => number,
) {
  const dpr = canvasDpr(canvas.clientHeight);
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);
  for (const { points, color } of sets) {
    for (const [x, y, n] of points) {
      const r = Math.min(18, 5 + Math.sqrt(n) * 2.2);
      const cy = mapY ? mapY(y) : y * scale;
      ctx.beginPath();
      ctx.arc(x * scale, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color + "40";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x * scale, cy, r - 2, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
}
