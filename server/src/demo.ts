// Fake Shopify-like product page for zero-setup testing: /demo/products/demo-product
// Mobile-first, long, with SVG icon buttons, variant pickers, a fixed sticky
// add-to-cart bar, lazy images, a popup and a cookie banner (hidden by the capture worker).

const PALETTES = [
  ["#f4e1d2", "#d97a4a"], ["#e3eef7", "#3d6f9e"], ["#efe9f7", "#7a52b3"], ["#e6f2ea", "#3f8a5c"],
  ["#fbefd5", "#c48a1a"], ["#f7e4e8", "#b8475f"], ["#e9ecef", "#495057"], ["#e0f3f3", "#2b8a8a"],
];

export function demoImageSvg(n: number): string {
  const [bg, fg] = PALETTES[(n - 1) % PALETTES.length]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="${bg}"/>
  <circle cx="400" cy="360" r="190" fill="${fg}" opacity=".85"/>
  <rect x="250" y="520" width="300" height="70" rx="35" fill="${fg}" opacity=".5"/>
  <text x="400" y="700" font-family="Arial, sans-serif" font-size="44" text-anchor="middle" fill="${fg}">Photo ${n}</text>
</svg>`;
}

const icon = {
  menu: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" class="icon icon-search"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  cart: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" class="icon icon-cart"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.4 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.2C19.5 16.4 12 21 12 21z"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
};

export function demoPageHtml(handle: string): string {
  const safeHandle = handle.replace(/[^a-z0-9-]/gi, "");
  const title = safeHandle.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const thumbs = [1, 2, 3, 4]
    .map((n) => `<button type="button" class="thumb" data-img="${n}" aria-label="Show photo ${n}"><img src="/demo/img/${n}" alt="" width="64" height="64"></button>`)
    .join("");
  const related = [5, 6, 7, 8]
    .map((n) => `<a class="card" href="/demo/products/related-${n}"><img loading="lazy" src="/demo/img/${n}" alt="Related product ${n}" width="300" height="300"><span class="card__title">Related product ${n}</span><span class="price">₹${499 + n * 100}</span></a>`)
    .join("");
  const reviews = [
    ["Priya S.", "Exactly like the photos. Delivery was quick and packaging was lovely."],
    ["Rahul M.", "Good quality for the price. Size runs slightly large."],
    ["Ananya K.", "Bought as a gift, my sister loved it! Ordering another one."],
    ["Vikram T.", "Nice finish, colour is a bit lighter than on screen."],
  ]
    .map(([n, t]) => `<article class="review"><div class="stars" aria-hidden="true">★★★★★</div><p>${t}</p><span class="muted">— ${n}</span></article>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} – Demo Store</title>
<script src="/tracker.js" async></script>
<style>
  *{box-sizing:border-box} body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#1a1a1a;background:#fff}
  a{color:inherit} img{max-width:100%;height:auto;display:block}
  .announce{background:#1a1a1a;color:#fff;text-align:center;font-size:13px;padding:8px}
  header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #eee;background:#fff}
  .header__icon{background:none;border:0;padding:8px;cursor:pointer;color:#1a1a1a;position:relative;display:inline-flex}
  .logo{font-weight:800;letter-spacing:.08em;text-decoration:none;font-size:18px}
  .cart-count{position:absolute;top:2px;right:0;background:#d1342f;color:#fff;border-radius:9px;font-size:11px;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center}
  .wrap{max-width:1200px;margin:0 auto}
  .product{display:grid;gap:24px;padding:0 0 24px}
  .gallery .main{aspect-ratio:1;background:#f5f5f5}
  .thumbs{display:flex;gap:8px;padding:8px 16px}
  .thumb{border:2px solid transparent;padding:0;background:none;cursor:pointer;border-radius:6px;overflow:hidden}
  .thumb.active{border-color:#1a1a1a}
  .info{padding:0 16px}
  h1{font-size:26px;line-height:1.2;margin:4px 0 8px}
  .rating{font-size:14px;color:#555;text-decoration:none}
  .price-row{display:flex;gap:10px;align-items:baseline;margin:10px 0}
  .price{font-size:22px;font-weight:700} .compare{text-decoration:line-through;color:#888}
  .badge{background:#d1342f;color:#fff;font-size:12px;padding:2px 8px;border-radius:12px}
  fieldset{border:0;padding:0;margin:16px 0}
  legend{font-size:14px;font-weight:600;margin-bottom:8px}
  .pills{display:flex;flex-wrap:wrap;gap:8px}
  .pills input{position:absolute;opacity:0;pointer-events:none}
  .pills label{border:1px solid #ccc;border-radius:22px;padding:8px 18px;cursor:pointer;font-size:14px}
  .pills input:checked+label{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
  .swatch{width:34px;height:34px;border-radius:50%;padding:0!important}
  .qty{display:inline-flex;border:1px solid #ccc;border-radius:6px;margin:8px 0 16px}
  .qty button{background:none;border:0;padding:10px 14px;cursor:pointer}
  .qty input{width:46px;text-align:center;border:0;font-size:16px}
  .btn{display:block;width:100%;padding:15px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;border:2px solid #1a1a1a;margin-bottom:10px}
  .btn--atc{background:#fff;color:#1a1a1a}
  .shopify-payment-button__button{background:#5a31f4;color:#fff;border-color:#5a31f4}
  .trust{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;font-size:12px;color:#555;margin:16px 0}
  .trust div{background:#f7f7f7;border-radius:8px;padding:10px 4px}
  details{border-top:1px solid #eee;padding:14px 0} summary{cursor:pointer;font-weight:600}
  .wish{position:absolute;right:12px;top:12px;background:#fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.15)}
  section.block{padding:28px 16px;border-top:8px solid #f5f5f5}
  section.block h2{margin:0 0 12px;font-size:20px}
  .story img{margin:16px 0;border-radius:10px;aspect-ratio:1;background:#f0f0f0}
  .review{border:1px solid #eee;border-radius:10px;padding:14px;margin-bottom:10px} .stars{color:#e8a317} .muted{color:#777;font-size:13px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .card{text-decoration:none;font-size:14px} .card img{border-radius:8px;aspect-ratio:1;background:#f0f0f0} .card .price{font-size:15px}
  .btn--ghost{background:#fff;border-color:#ccc;font-weight:600}
  footer{background:#1a1a1a;color:#ccc;padding:32px 16px 120px;font-size:14px} footer a{display:block;margin:6px 0}
  .sticky-atc{position:fixed;left:0;right:0;bottom:0;background:#fff;box-shadow:0 -2px 12px rgba(0,0,0,.12);padding:10px 16px;display:flex;gap:12px;align-items:center;transform:translateY(110%);transition:transform .25s;z-index:20}
  .sticky-atc.visible{transform:none}
  .sticky-atc .btn{margin:0;flex:1;background:#1a1a1a;color:#fff}
  .sticky-atc img{width:44px;height:44px;border-radius:6px}
  .toast{position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:8px;display:none;z-index:40}
  .popup-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:50}
  .popup-modal.is-open{display:flex} .popup-modal .box{background:#fff;padding:24px;border-radius:12px;width:86%;max-width:380px;text-align:center}
  #shopify-pc__banner{position:fixed;left:8px;right:8px;bottom:8px;background:#fff;border:1px solid #ddd;border-radius:10px;padding:14px;z-index:45;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,.15)}
  @media (min-width:990px){
    .product{grid-template-columns:1.2fr 1fr;padding:24px 16px}
    .info{position:sticky;top:20px;align-self:start}
    .story{columns:2;column-gap:32px}
    .grid{grid-template-columns:repeat(4,1fr)}
  }
</style>
</head>
<body>
<div class="announce">Free shipping on prepaid orders · COD available</div>
<header>
  <button class="header__icon" aria-label="Menu" type="button">${icon.menu}</button>
  <a class="logo" href="/demo/products/${safeHandle}">DEMO</a>
  <div>
    <button class="header__icon header__icon--search" type="button">${icon.search}</button>
    <a class="header__icon header__icon--cart" id="cart-icon-bubble" href="#cart" aria-label="Cart">${icon.cart}<span class="cart-count" id="cart-count">0</span></a>
  </div>
</header>
<main class="wrap">
  <div class="product">
    <div class="gallery">
      <div style="position:relative">
        <img class="main" id="main-image" src="/demo/img/1" alt="${title} photo" width="800" height="800">
        <button class="header__icon wish" type="button">${icon.heart}</button>
      </div>
      <div class="thumbs">${thumbs}</div>
    </div>
    <div class="info">
      <a class="rating" href="#reviews">★★★★★ 4.8 (128 reviews)</a>
      <h1>${title}</h1>
      <div class="price-row"><span class="price" id="price">₹899</span><span class="compare">₹1,499</span><span class="badge">40% OFF</span></div>
      <form action="/cart/add" method="post" id="product-form">
        <fieldset>
          <legend>Size</legend>
          <div class="pills">
            ${["S", "M", "L", "XL"].map((s, i) => `<input type="radio" name="Size" id="size-${s}" value="${s}" ${i === 1 ? "checked" : ""}><label for="size-${s}">${s}</label>`).join("")}
          </div>
        </fieldset>
        <fieldset>
          <legend>Colour</legend>
          <div class="pills">
            ${[["Coral", "#d97a4a"], ["Ocean", "#3d6f9e"], ["Plum", "#7a52b3"]].map(([c, hex], i) => `<input type="radio" name="Colour" id="colour-${c}" value="${c}" ${i === 0 ? "checked" : ""}><label class="swatch" for="colour-${c}" aria-label="${c}" style="background:${hex}"></label>`).join("")}
          </div>
        </fieldset>
        <div class="qty">
          <button type="button" name="minus" aria-label="Decrease quantity">${icon.minus}</button>
          <input type="number" name="quantity" value="1" min="1" aria-label="Quantity">
          <button type="button" name="plus" aria-label="Increase quantity">${icon.plus}</button>
        </div>
        <button type="submit" name="add" class="btn btn--atc" id="ProductSubmitButton">Add to cart</button>
        <button type="button" class="btn shopify-payment-button__button">Buy it now</button>
      </form>
      <div class="trust"><div>🚚 Free shipping</div><div>↩️ 7-day returns</div><div>🔒 Secure checkout</div></div>
      <details open><summary>Description</summary><p>Hand-finished, made to last. A best-seller loved by 10,000+ customers. Gentle on skin, easy to clean, and gift-ready packaging.</p></details>
      <details><summary>Shipping &amp; delivery</summary><p>Dispatched in 24 hours. Delivered in 3–6 days across India.</p></details>
      <details><summary>Returns</summary><p>Easy 7-day returns on unused products.</p></details>
    </div>
  </div>

  <section class="block story">
    <h2>Why customers love it</h2>
    <p>Designed for everyday use, our ${title.toLowerCase()} combines durable materials with a clean look. Each piece is checked by hand before it ships.</p>
    <img loading="lazy" src="/demo/img/5" alt="Detail shot" width="800" height="800">
    <p>Pairs well with everything in your wardrobe. Lightweight, comfortable and built to last for years, not months.</p>
    <img loading="lazy" src="/demo/img/6" alt="Lifestyle shot" width="800" height="800">
    <p>Free shipping on prepaid orders. Cash on delivery available on all pin codes we serve.</p>
    <img loading="lazy" src="/demo/img/7" alt="Packaging" width="800" height="800">
  </section>

  <section class="block" id="reviews">
    <h2>Customer reviews</h2>
    ${reviews}
    <button type="button" class="btn btn--ghost">Write a review</button>
  </section>

  <section class="block">
    <h2>You may also like</h2>
    <div class="grid">${related}</div>
  </section>
</main>
<footer>
  <strong>DEMO STORE</strong>
  <a href="#">Contact us</a><a href="#">Shipping policy</a><a href="#">Refund policy</a><a href="#">Track order</a>
  <p>© Demo Store. This page exists to test the heatmap.</p>
</footer>

<div class="sticky-atc" id="sticky-atc">
  <img src="/demo/img/1" alt="">
  <button type="button" class="btn" data-heatmap-label="Sticky add to cart" data-heatmap-atc>Add to cart · ₹899</button>
</div>
<div class="toast" id="toast">Added to cart ✓</div>
<div class="popup-modal" id="popup"><div class="box"><h3>Get 10% off</h3><p>Join our list for early access.</p><button type="button" class="btn" id="popup-close">No thanks</button></div></div>
<div id="shopify-pc__banner">We use cookies to improve your experience. <button type="button" id="cookie-ok">Accept</button></div>

<script>
  (function () {
    var count = 0, toast = document.getElementById('toast');
    function added() {
      count++; document.getElementById('cart-count').textContent = count;
      toast.style.display = 'block'; clearTimeout(added.t); added.t = setTimeout(function () { toast.style.display = 'none'; }, 1500);
    }
    document.getElementById('product-form').addEventListener('submit', function (e) { e.preventDefault(); added(); });
    document.querySelector('#sticky-atc .btn').addEventListener('click', added);
    document.querySelector('.shopify-payment-button__button').addEventListener('click', added);
    document.querySelectorAll('.thumb').forEach(function (b) {
      b.addEventListener('click', function () {
        document.getElementById('main-image').src = '/demo/img/' + b.dataset.img;
        document.querySelectorAll('.thumb').forEach(function (t) { t.classList.toggle('active', t === b); });
      });
    });
    var qty = document.querySelector('input[name=quantity]');
    document.querySelector('[name=minus]').addEventListener('click', function () { qty.value = Math.max(1, +qty.value - 1); });
    document.querySelector('[name=plus]').addEventListener('click', function () { qty.value = +qty.value + 1; });
    var sticky = document.getElementById('sticky-atc');
    new IntersectionObserver(function (entries) {
      sticky.classList.toggle('visible', !entries[0].isIntersecting && entries[0].boundingClientRect.top < 0);
    }).observe(document.getElementById('ProductSubmitButton'));
    setTimeout(function () { document.getElementById('popup').classList.add('is-open'); }, 2500);
    document.getElementById('popup-close').addEventListener('click', function () { document.getElementById('popup').classList.remove('is-open'); });
    document.getElementById('cookie-ok').addEventListener('click', function () { document.getElementById('shopify-pc__banner').remove(); });
  })();
</script>
</body>
</html>`;
}
