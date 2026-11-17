import type { Device, WireBatch, WireClick, WireEvent } from "../shared/types";

let n = 0;
export function click(over: Partial<WireClick> = {}): WireClick {
  return { t: "click", ts: Date.now() - 1000, x: 100, y: 200, pw: 390, ph: 5000, vx: 100, vy: 200, sel: "#atc", lbl: "Add to cart", ex: 0.5, ey: 0.5, ...over };
}
export function batch(ev: WireEvent[], over: Partial<WireBatch> = {}): WireBatch {
  n++;
  return {
    v: 1, sid: `session-${n}`, vid: `visitor-${n}`, store: "shop.test", page: "tee", url: "https://shop.test/products/tee",
    dev: "mobile" as Device, vw: 390, vh: 844, src: "facebook", ev, ...over,
  };
}
