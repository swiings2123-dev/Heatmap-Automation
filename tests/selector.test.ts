// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { actionableTarget, classOf, cssSelector, idSelector, isStableId, labelFor } from "../tracker/src/dom";

beforeEach(() => {
  document.body.innerHTML = `
    <header>
      <button class="header__icon header__icon--search" type="button">
        <svg class="icon icon-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path id="p" d="m20 20-3.5-3.5"/></svg>
      </button>
      <a href="/cart" aria-label="Cart"><svg class="icon"><path d="M0 0"/></svg></a>
    </header>
    <main>
      <ul><li>One</li><li>Two</li><li><span class="x">Three</span></li></ul>
      <form action="/cart/add">
        <input type="text" name="email" value="secret@example.com">
        <input type="radio" id="size-M" name="Size" value="M"><label for="size-M">M</label>
        <button type="submit" name="add" id="ProductSubmitButton-template--123__main">Add to cart</button>
      </form>
      <div id=":r1:"><button data-testid="buy">Buy it now</button></div>
      <div class="card"><div><div><div><div><div><div><p>deep text</p></div></div></div></div></div></div></div>
      <div class="card"><div><div><div><div><div><div><p>deep text 2</p></div></div></div></div></div></div></div>
    </main>`;
});

describe("cssSelector", () => {
  it("prefers a stable id", () => {
    document.body.insertAdjacentHTML("beforeend", '<a id="logo-link" href="/">Logo</a>');
    expect(cssSelector(document.getElementById("logo-link")!)).toBe("#logo-link");
  });

  it("drops the theme-specific number from Shopify section ids", () => {
    const el = document.querySelector("button[name=add]")!;
    const sel = cssSelector(el);
    expect(sel).toBe('[id^="ProductSubmitButton-template--"][id$="__main"]');
    expect(document.querySelector(sel)).toBe(el);
    // Same element in a duplicated theme (different number) -> same selector.
    expect(idSelector("ProductSubmitButton-template--29143989518617__main")).toBe(sel);
    expect(idSelector("Slide-template--1__main-537")).toBe('[id^="Slide-template--"][id$="__main-537"]');
  });

  it("uses stable attributes before positions", () => {
    expect(cssSelector(document.querySelector("label")!)).toBe('label[for="size-M"]');
    expect(cssSelector(document.querySelector("[data-testid=buy]")!)).toBe('button[data-testid="buy"]');
  });

  it("skips runtime-generated ids", () => {
    expect(isStableId(":r1:")).toBe(false);
    expect(isStableId("1abc")).toBe(false);
    expect(isStableId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(false);
    expect(isStableId("ProductSubmitButton-template--123__main")).toBe(true);
  });

  it("falls back to nth-of-type paths that resolve back to the same element", () => {
    const li = document.querySelectorAll("li")[1]!;
    const sel = cssSelector(li);
    expect(sel).toContain("li:nth-of-type(2)");
    expect(document.querySelector(sel)).toBe(li);
  });

  it("walks past depth 6 until the selector is unique", () => {
    const p = document.querySelectorAll("p")[1]!;
    const sel = cssSelector(p);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(p);
  });
});

describe("actionableTarget + SVG safety", () => {
  it("maps a click on an SVG <path> to the surrounding button", () => {
    const path = document.getElementById("p")!;
    const target = actionableTarget(path)!;
    expect(target.tagName).toBe("BUTTON");
    expect(cssSelector(target)).toBe("body > header > button");
  });

  it("labels an icon-only button by its class (never 'svg.[object')", () => {
    const btn = actionableTarget(document.getElementById("p"))!;
    expect(labelFor(btn)).toBe("button.header__icon");
    const svg = document.querySelector("svg")!;
    expect(classOf(svg)).toBe("icon icon-search"); // SVGAnimatedString-safe
    expect(labelFor(svg)).not.toContain("[object");
  });

  it("prefers aria-label", () => {
    expect(labelFor(document.querySelector("a")!)).toBe("Cart");
  });
});

describe("labelFor privacy", () => {
  it("never reads values or text from form fields", () => {
    const input = document.querySelector("input[name=email]")!;
    expect(labelFor(input)).toBe("input[text] email");
    expect(labelFor(input)).not.toContain("secret");
  });

  it("truncates text labels to 40 chars and collapses whitespace", () => {
    const b = document.createElement("button");
    b.textContent = "  Add   to cart — limited stock, only a few left in this size today  ";
    document.body.append(b);
    expect(labelFor(b).length).toBeLessThanOrEqual(40);
    expect(labelFor(b).startsWith("Add to cart")).toBe(true);
  });
});
