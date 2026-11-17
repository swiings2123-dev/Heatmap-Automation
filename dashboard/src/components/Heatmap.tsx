import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HeatmapResponse, HotElement, StatsResponse } from "../../../shared/types";
import { withToken } from "../lib/api";
import { fmtInt, fmtPct } from "../lib/format";
import { drawHeat, drawMarkers } from "../lib/heat";

export interface Layers {
  clicks: boolean;
  frustration: boolean;
  scroll: boolean;
}

interface Props {
  data: HeatmapResponse;
  stats: StatsResponse | null;
  layers: Layers;
  highlight: string | null;
  onHover: (selector: string | null) => void;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#e34948";

/**
 * Screenshot + canvas overlays. The scroll box mimics the capture device's viewport:
 * clicks on position:fixed elements are drawn in a layer that stays put while you scroll,
 * just like the sticky bar does on a real phone.
 */
export function Heatmap({ data, stats, layers, highlight, onHover }: Props) {
  const shot = data.screenshot!;
  const outer = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const heatCanvas = useRef<HTMLCanvasElement>(null);
  const markCanvas = useRef<HTMLCanvasElement>(null);
  const fixedHeat = useRef<HTMLCanvasElement>(null);
  const fixedMarks = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [winH, setWinH] = useState(window.innerHeight);
  const [hover, setHover] = useState<{ el: HotElement; x: number; y: number; pinned?: boolean } | null>(null);
  const [loadedSrc, setLoadedSrc] = useState("");

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => setWidth(outer.current?.clientWidth ?? 0));
    if (outer.current) ro.observe(outer.current);
    const onResize = () => setWinH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Mobile is shown at its real CSS width (crisp, since captured at 2x); bigger devices fit the column.
  const dispW = Math.max(1, Math.min(width - 2, shot.width));
  const scale = dispW / shot.width;
  const dispH = Math.round(shot.height * scale);
  const vh = shot.viewport.h;
  const boxH = Math.round(Math.min(vh * scale, Math.max(420, winH - 190), dispH));
  // Fixed elements: top-anchored stay at the top, bottom-anchored stick to the bottom of the box.
  const mapFixedY = useMemo(() => (y: number) => (y < vh / 2 ? y * scale : boxH - (vh - y) * scale), [vh, scale, boxH]);
  const totalClicks = data.total || 1;

  useEffect(() => {
    if (!width) return;
    const radius = Math.max(12, Math.min(30, shot.width * 0.045)) * Math.max(scale, 0.6);
    if (heatCanvas.current) drawHeat(heatCanvas.current, layers.clicks ? data.clicks.page : [], { scale, radius });
    if (fixedHeat.current) drawHeat(fixedHeat.current, layers.clicks ? data.clicks.fixed : [], { scale, radius, mapY: mapFixedY });
    const rage = css("--rage");
    const dead = css("--dead");
    if (markCanvas.current)
      drawMarkers(markCanvas.current, layers.frustration ? [{ points: data.dead.page, color: dead }, { points: data.rage.page, color: rage }] : [], scale);
    if (fixedMarks.current)
      drawMarkers(fixedMarks.current, layers.frustration ? [{ points: data.dead.fixed, color: dead }, { points: data.rage.fixed, color: rage }] : [], scale, mapFixedY);
  }, [data, layers, width, scale, mapFixedY, shot.width]);

  const pageEls = data.elements.filter((e) => e.rect && !e.fixed);
  const fixedEls = data.elements.filter((e) => e.rect && e.fixed);

  function findAt(clientX: number, clientY: number): HotElement | null {
    const b = box.current!.getBoundingClientRect();
    const bx = clientX - b.left;
    const by = clientY - b.top;
    for (const e of fixedEls) {
      const r = e.rect!;
      const top = mapFixedY(r.y);
      if (bx >= r.x * scale && bx <= (r.x + r.w) * scale && by >= top && by <= top + r.h * scale) return e;
    }
    const px = bx / scale;
    const py = (by + box.current!.scrollTop) / scale;
    let best: HotElement | null = null;
    for (const e of pageEls) {
      const r = e.rect!;
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h && (!best || r.w * r.h < best.rect!.w * best.rect!.h)) best = e;
    }
    return best;
  }

  // Mouse moves fire far more often than frames; handle at most one per animation frame.
  const moveFrame = useRef(0);
  const lastMove = useRef({ x: 0, y: 0 });
  useEffect(() => () => cancelAnimationFrame(moveFrame.current), []);
  function onMove(ev: React.MouseEvent) {
    if (hover?.pinned) return;
    lastMove.current = { x: ev.clientX, y: ev.clientY };
    if (moveFrame.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = 0;
      if (!box.current || !outer.current) return;
      const { x, y } = lastMove.current;
      const el = findAt(x, y);
      const o = outer.current.getBoundingClientRect();
      setHover((prev) => (prev?.pinned ? prev : el ? { el, x: x - o.left, y: y - o.top } : null));
      onHover(el?.selector ?? null);
    });
  }
  function onClick(ev: React.MouseEvent) {
    cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    const el = findAt(ev.clientX, ev.clientY);
    const o = outer.current!.getBoundingClientRect();
    setHover(el ? { el, x: ev.clientX - o.left, y: ev.clientY - o.top, pinned: true } : null);
    onHover(el?.selector ?? null);
  }

  const highlighted = data.elements.find((e) => e.selector === (hover?.el.selector ?? highlight) && e.rect);

  // Scroll an element highlighted from the side panel into view.
  useEffect(() => {
    if (!highlight || hover || !box.current) return;
    const e = data.elements.find((x) => x.selector === highlight);
    if (e?.rect && !e.fixed) {
      const y = e.rect.y * scale;
      const st = box.current.scrollTop;
      if (y < st || y > st + boxH - 40) box.current.scrollTo({ top: Math.max(0, y - boxH / 3), behavior: "smooth" });
    }
  }, [highlight, hover, data.elements, scale, boxH]);

  const bands = stats && layers.scroll ? stats.scroll : [];

  return (
    <div ref={outer} className="relative flex justify-center">
      <div
        ref={box}
        className="relative overflow-y-auto overflow-x-hidden rounded-xl border border-line-strong bg-surface shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)]"
        style={{ width: dispW + 2, height: boxH }}
        onMouseMove={onMove}
        onMouseLeave={() => {
          cancelAnimationFrame(moveFrame.current);
          moveFrame.current = 0;
          if (!hover?.pinned) {
            setHover(null);
            onHover(null);
          }
        }}
        onClick={onClick}
        data-testid="heatmap-box"
      >
        {/* Floating layer for position:fixed elements */}
        <div className="pointer-events-none sticky top-0 z-20 h-0">
          {layers.clicks && (
            <div className="absolute left-0 top-0 overflow-hidden" style={{ width: dispW, height: boxH }} aria-hidden>
              <div className="scanline" />
            </div>
          )}
          <div className="absolute left-0 top-0" style={{ width: dispW, height: boxH }}>
            {layers.clicks &&
              fixedEls.map((e) => (
                <div
                  key={e.selector}
                  className="absolute rounded border border-dashed border-accent/80"
                  style={{ left: e.rect!.x * scale, top: mapFixedY(e.rect!.y), width: e.rect!.w * scale, height: e.rect!.h * scale }}
                >
                  <span className="absolute -top-5 left-0 whitespace-nowrap rounded-full bg-black/80 px-2 font-mono text-[10px] leading-4 text-white">
                    fixed · {e.label}
                  </span>
                </div>
              ))}
            <canvas ref={fixedHeat} className="absolute inset-0 h-full w-full" />
            <canvas ref={fixedMarks} className="absolute inset-0 h-full w-full" />
            {highlighted?.fixed && (
              <div
                className="absolute rounded-md ring-2 ring-accent shadow-[0_0_0_4px_rgb(255_122_26/0.25),0_0_30px_rgb(255_122_26/0.6)]"
                style={{ left: highlighted.rect!.x * scale, top: mapFixedY(highlighted.rect!.y), width: highlighted.rect!.w * scale, height: highlighted.rect!.h * scale }}
              />
            )}
          </div>
        </div>

        <div className="relative" style={{ width: dispW, height: dispH }}>
          <img
            src={withToken(shot.imageUrl)}
            alt="Page screenshot"
            width={dispW}
            height={dispH}
            onLoad={() => setLoadedSrc(shot.imageUrl)}
            className={`block select-none transition-opacity ${loadedSrc === shot.imageUrl ? "opacity-100" : "opacity-30"}`}
            draggable={false}
          />
          <canvas ref={heatCanvas} className="pointer-events-none absolute inset-0 h-full w-full" />
          <canvas ref={markCanvas} className="pointer-events-none absolute inset-0 h-full w-full" />
          {bands.map((b, i) => {
            const top = Math.min(dispH - 1, (b.depth / 100) * dispH);
            const next = i + 1 < bands.length ? Math.min(dispH, (bands[i + 1]!.depth / 100) * dispH) : dispH;
            return (
              <div key={b.depth} className="pointer-events-none absolute left-0 right-0" style={{ top }}>
                <div className="absolute left-0 right-0 bg-black" style={{ height: Math.max(0, next - top), opacity: (1 - b.pct) * 0.5 }} />
                <div className="absolute left-0 right-0 border-t-2 border-dashed border-[#ffd23d]" />
                <span className="absolute left-2 top-1.5 rounded-full bg-black/80 px-2.5 py-0.5 font-mono text-[11px] font-medium text-[#ffd23d] backdrop-blur">
                  {fmtPct(b.pct, 0)} reached {b.depth}%
                </span>
              </div>
            );
          })}
          {highlighted && !highlighted.fixed && (
            <div
              className="pointer-events-none absolute rounded-md ring-2 ring-accent shadow-[0_0_0_4px_rgb(255_122_26/0.25),0_0_30px_rgb(255_122_26/0.6)]"
              style={{ left: highlighted.rect!.x * scale, top: highlighted.rect!.y * scale, width: highlighted.rect!.w * scale, height: highlighted.rect!.h * scale }}
            />
          )}
        </div>
      </div>

      {hover && (
        <div
          role="tooltip"
          className="glass pointer-events-none absolute z-30 w-64 overflow-hidden rounded-2xl bg-[var(--panel-solid)] p-3.5 text-sm shadow-[var(--glow)]"
          style={{ left: Math.min(Math.max(8, hover.x + 14), Math.max(8, width - 250)), top: hover.y + 14 }}
        >
          <span className="bg-hot absolute inset-x-0 top-0 h-[3px]" aria-hidden />
          <p className="truncate font-display text-[13px] font-semibold text-ink">{hover.el.label || "Unlabelled element"}</p>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-ink-2">
            <dt>Clicks</dt>
            <dd className="tabular text-right text-ink">{fmtInt(hover.el.clicks)}</dd>
            <dt>Share of clicks</dt>
            <dd className="tabular text-right text-ink">{fmtPct(hover.el.clicks / totalClicks)}</dd>
            <dt>Sessions</dt>
            <dd className="tabular text-right text-ink">{fmtInt(hover.el.sessions)}</dd>
            <dt>Clicks / session</dt>
            <dd className="tabular text-right text-ink">{(hover.el.clicks / Math.max(1, hover.el.sessions)).toFixed(2)}</dd>
          </dl>
          <p className="mt-2 truncate rounded-md bg-surface px-1.5 py-0.5 font-mono text-[10px] text-accent">{hover.el.selector}</p>
          {hover.pinned && <p className="mt-1 text-[11px] text-ink-3">Click elsewhere to unpin</p>}
        </div>
      )}
    </div>
  );
}
