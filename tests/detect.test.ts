import { describe, expect, it } from "vitest";
import { RageDetector, inferSource, isDeadClick, milestones } from "../tracker/src/core";

describe("RageDetector", () => {
  it("flags the 3rd click within 1 s and 40 px", () => {
    const r = new RageDetector();
    expect(r.hit(100, 100, 0)).toBe(false);
    expect(r.hit(110, 105, 200)).toBe(false);
    expect(r.hit(95, 120, 400)).toBe(true);
    expect(r.hit(100, 100, 600)).toBe(true);
  });

  it("uses a 40 PIXEL radius, not a page percentage", () => {
    const r = new RageDetector();
    r.hit(100, 1000, 0);
    r.hit(100, 1045, 100); // 45 px away
    expect(r.hit(100, 1090, 200)).toBe(false); // each 45 px from the previous: not "same spot"
  });

  it("ignores clicks older than 1 s", () => {
    const r = new RageDetector();
    r.hit(10, 10, 0);
    r.hit(10, 10, 500);
    expect(r.hit(10, 10, 1600)).toBe(false);
  });
});

describe("isDeadClick", () => {
  const same = { mutations: 3, url: "https://s.com/products/a" };
  it("is dead when nothing changed on a non-interactive element", () => {
    expect(isDeadClick(false, same, { ...same })).toBe(true);
  });
  it("is not dead when the DOM changed or the URL changed", () => {
    expect(isDeadClick(false, same, { ...same, mutations: 4 })).toBe(false);
    expect(isDeadClick(false, same, { ...same, url: "https://s.com/cart" })).toBe(false);
  });
  it("is never dead for interactive elements", () => {
    expect(isDeadClick(true, same, { ...same })).toBe(false);
  });
});

describe("milestones", () => {
  it("returns every milestone passed", () => {
    expect(milestones(400, 1000)).toEqual([25]);
    expect(milestones(800, 1000)).toEqual([25, 50, 75]);
    expect(milestones(985, 1000)).toEqual([25, 50, 75, 100]);
    expect(milestones(100, 0)).toEqual([]);
  });
});

describe("inferSource", () => {
  it("prefers utm_source, then click ids, then referrer", () => {
    expect(inferSource(new URLSearchParams("utm_source=Facebook&fbclid=x"), "", "s.com")).toBe("facebook");
    expect(inferSource(new URLSearchParams("fbclid=abc"), "", "s.com")).toBe("facebook");
    expect(inferSource(new URLSearchParams(""), "l.instagram.com", "s.com")).toBe("instagram");
    expect(inferSource(new URLSearchParams(""), "s.com", "s.com")).toBe("direct");
  });
});
