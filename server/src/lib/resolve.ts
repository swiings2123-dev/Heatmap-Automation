// Resolving stored clicks onto a specific screenshot version.
//
// Anchored clicks: page_x = rect.x + x_in_el * rect.w (same for y), using the rect
// of the clicked element in THIS screenshot's layout.json (same device bucket).
// Fallback clicks (selector not found in the layout): page-relative position scaled
// to the screenshot's size. Clicks on position:fixed elements resolve to viewport
// coordinates (`fixed`), because they float over the page instead of scrolling with it.

import type { HeatPoint, LayoutFile, PointSet } from "../../../shared/types";
import type { AnchoredBin, FallbackBin } from "../storage/types";

export interface Resolved extends PointSet {
  anchored: number;
  fallback: number;
}

/** Output grid cell size in CSS px. Bounds response size regardless of event volume. */
export const CELL_PX = 6;

class Grid {
  private cells = new Map<string, { sx: number; sy: number; n: number }>();
  constructor(
    private readonly w: number,
    private readonly h: number,
    private readonly cell: number,
  ) {}
  add(x: number, y: number, n: number) {
    const cx = Math.min(Math.max(x, 0), this.w);
    const cy = Math.min(Math.max(y, 0), this.h);
    const key = `${Math.floor(cx / this.cell)},${Math.floor(cy / this.cell)}`;
    const g = this.cells.get(key);
    if (g) {
      g.sx += cx * n;
      g.sy += cy * n;
      g.n += n;
    } else this.cells.set(key, { sx: cx * n, sy: cy * n, n });
  }
  points(): HeatPoint[] {
    const out: HeatPoint[] = [];
    for (const g of this.cells.values()) out.push([Math.round(g.sx / g.n), Math.round(g.sy / g.n), g.n]);
    return out;
  }
}

export function resolvePoints(
  anchored: AnchoredBin[],
  fallback: FallbackBin[],
  layout: Pick<LayoutFile, "width" | "height" | "elements" | "viewport">,
  cell = CELL_PX,
): Resolved {
  const W = layout.width;
  const page = new Grid(W, layout.height, cell);
  const fixed = new Grid(layout.viewport.w, layout.viewport.h, cell);

  let anchoredCount = 0;
  let fallbackCount = 0;
  for (const b of anchored) {
    const rect = layout.elements[b.selector];
    if (!rect) continue; // caller only passes known selectors; defensive
    const x = rect.x + ((b.gx + 0.5) / 20) * rect.w;
    const y = rect.y + ((b.gy + 0.5) / 20) * rect.h;
    (rect.fixed ? fixed : page).add(x, y, b.n);
    anchoredCount += b.n;
  }
  for (const b of fallback) {
    if (b.fixed) fixed.add(((b.qx + 0.5) / 200) * layout.viewport.w, ((b.qy + 0.5) / 1000) * layout.viewport.h, b.n);
    else page.add(((b.qx + 0.5) / 200) * W, ((b.qy + 0.5) / 1000) * layout.height, b.n);
    fallbackCount += b.n;
  }
  return { page: page.points(), fixed: fixed.points(), anchored: anchoredCount, fallback: fallbackCount };
}
