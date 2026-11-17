// Layout probe injected by the screenshot worker (Playwright). Uses the exact
// same selector code as tracker.js, then records each element's document rect.

import { ACTIONABLE, cssSelector, labelFor, positionMode } from "./dom";
import type { LayoutElement } from "../../shared/types";

export interface ProbeResult {
  width: number;
  height: number;
  elements: Record<string, LayoutElement>;
  /** interactive elements, used for the layout hash */
  interactive: { sel: string; x: number; y: number; w: number; h: number }[];
}

(window as unknown as { __hmProbe: (s: string[]) => ProbeResult }).__hmProbe = (selectors) => {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const rectOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const elements: Record<string, LayoutElement> = {};
  const add = (sel: string, el: Element) => {
    const rect = rectOf(el);
    if (rect.w < 1 || rect.h < 1) return null;
    const entry: LayoutElement = { ...rect, label: labelFor(el) };
    // Only position:fixed floats over the page; sticky elements are drawn at their in-flow rect.
    if (positionMode(el) === "fixed") {
      // Viewport coordinates. Bars that slide in on scroll are often parked just outside
      // the viewport at capture time: clamp them to where they appear when shown.
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      entry.x = Math.min(Math.max(rect.x - sx, 0), Math.max(vw - rect.w, 0));
      entry.y = Math.min(Math.max(rect.y - sy, 0), Math.max(vh - rect.h, 0));
      entry.fixed = true;
    }
    elements[sel] = entry;
    return rect;
  };
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) add(sel, el);
    } catch {}
  }
  const interactive: ProbeResult["interactive"] = [];
  document.querySelectorAll(ACTIONABLE).forEach((el) => {
    const sel = cssSelector(el);
    const rect = elements[sel] ?? add(sel, el);
    if (rect && !elements[sel]?.fixed) interactive.push({ sel, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  });
  const de = document.documentElement;
  return {
    width: de.clientWidth,
    height: Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0),
    elements,
    interactive,
  };
};
