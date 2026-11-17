import { describe, expect, it } from "vitest";
import { canonicalSelector, parseBatch } from "../server/src/lib/validate";
import { idSelector } from "../tracker/src/dom";
import { batch, click } from "./helpers";

describe("parseBatch", () => {
  const now = Date.now();
  it("accepts a text/plain JSON body", () => {
    const r = parseBatch(JSON.stringify(batch([click()])), now);
    expect(r.ok).toBe(true);
  });
  it("rejects garbage and oversized batches", () => {
    expect(parseBatch("not json", now).ok).toBe(false);
    expect(parseBatch({ v: 1 }, now).ok).toBe(false);
    expect(parseBatch(batch(Array.from({ length: 101 }, () => click())), now).ok).toBe(false);
    expect(parseBatch(batch([click({ ex: 2 })]), now).ok).toBe(false);
  });
  it("trusts the Origin header over the claimed store", () => {
    const r = parseBatch(batch([click()], { store: "victim.com", url: "https://www.attacker.com/products/x" }), now, "www.attacker.com");
    expect(r.ok && r.batch.store).toBe("www.attacker.com");
  });
  it("rejects page URLs that aren't on the store's host (the screenshot worker opens them)", () => {
    expect(parseBatch(batch([click()], { url: "http://169.254.169.254/products/x" }), now).ok).toBe(false);
    expect(parseBatch(batch([click()], { url: "file:///etc/passwd" }), now).ok).toBe(false);
    expect(parseBatch(batch([click()], { store: "victim.com" }), now, "www.attacker.com").ok).toBe(false);
  });
  it("canonicalises Shopify theme-specific ids from older trackers", () => {
    expect(canonicalSelector("#ProductInfo-template--29143989518617__main > div:nth-of-type(5)")).toBe(
      `${idSelector("ProductInfo-template--1__main")} > div:nth-of-type(5)`,
    );
    expect(canonicalSelector("#cart-icon-bubble")).toBe("#cart-icon-bubble");
  });
  it("replaces timestamps from broken device clocks and strips query strings", () => {
    const r = parseBatch(batch([click({ ts: now - 5 * 864e5 })], { url: "https://shop.test/products/tee?email=a@b.c" }), now);
    expect(r.ok && r.batch.ev[0]!.ts).toBe(now);
    expect(r.ok && r.batch.url).toBe("https://shop.test/products/tee");
  });
});
