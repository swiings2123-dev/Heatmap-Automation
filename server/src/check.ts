// /check — open this on a phone to see whether tracker.js would run there, and if not, why.
// Mirrors the tracker's opt-out/bot checks; stores nothing.
export function checkPageHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Heatmap check</title>
<style>
  body{font:17px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;margin:0;padding:20px;background:#f6f6f4;color:#111}
  h1{font-size:22px;margin:0 0 4px} p.sub{color:#555;margin:0 0 18px}
  .verdict{padding:16px;border-radius:12px;font-weight:700;font-size:19px;margin-bottom:16px}
  .ok{background:#e3f6e3;color:#0a5c0a}.bad{background:#fde7e7;color:#a11}
  ul{list-style:none;padding:0;margin:0;background:#fff;border-radius:12px;border:1px solid #e4e3df}
  li{padding:12px 14px;border-top:1px solid #eee;display:flex;justify-content:space-between;gap:12px} li:first-child{border:0}
  li span:last-child{font-weight:600;text-align:right} .fix{font-size:14px;color:#a11;font-weight:400;display:block}
  @media (prefers-color-scheme:dark){body{background:#121211;color:#eee}ul{background:#1a1a19;border-color:#2e2e2c}li{border-color:#2e2e2c}p.sub{color:#aaa}}
</style></head><body>
<h1>Heatmap tracker check</h1><p class="sub">Is this browser counted by the heatmap?</p>
<div id="verdict" class="verdict">Checking…</div>
<ul id="list"></ul>
<script>
(async function () {
  var n = navigator, rows = [], blocked = false;
  function row(name, good, value, fix) { rows.push({ name: name, good: good, value: value, fix: fix }); if (!good) blocked = true; }
  var BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|gtmetrix|facebookexternalhit|bingpreview|prerender|phantom/i;
  row("Do Not Track", !(n.doNotTrack === "1" || window.doNotTrack === "1"), (n.doNotTrack === "1" || window.doNotTrack === "1") ? "ON" : "off",
      "Browser settings → Privacy → turn off \\"Send a Do Not Track request\\"");
  row("Global Privacy Control", n.globalPrivacyControl !== true, n.globalPrivacyControl === true ? "ON" : "off",
      "Brave / DuckDuckGo / Firefox send this by default. Test in Chrome instead.");
  row("Automation / bot browser", !n.webdriver && !BOT.test(n.userAgent), n.webdriver ? "webdriver" : BOT.test(n.userAgent) ? "bot UA" : "no", "");
  var ls = "ok"; try { localStorage.setItem("hm_check", "1"); localStorage.removeItem("hm_check"); } catch (e) { ls = "blocked (still works, in memory)"; }
  rows.push({ name: "Local storage", good: true, value: ls });
  var w = innerWidth; rows.push({ name: "Counted as", good: true, value: (w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop") + " (" + w + "px)" });
  try { var r = await fetch("/tracker.js", { cache: "no-store" }); row("tracker.js reachable", r.ok, r.ok ? "yes" : "HTTP " + r.status, "Collector/tunnel is down"); }
  catch (e) { row("tracker.js reachable", false, "blocked", "An ad-blocker or private DNS (AdGuard, NextDNS…) is blocking it. Turn it off and retry."); }
  try { var c = await fetch("/api/collect?probe=1", { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" }, keepalive: true });
        row("Sending data", c.status === 204, c.status === 204 ? "yes" : "HTTP " + c.status, "Collector rejected the request"); }
  catch (e) { row("Sending data", false, "blocked", "An ad-blocker or private DNS is blocking requests to the collector."); }
  var v = document.getElementById("verdict");
  v.className = "verdict " + (blocked ? "bad" : "ok");
  v.textContent = blocked ? "✕ This browser will NOT be tracked. See the red line below." : "✓ This browser will be tracked. Clicks on product pages show up within ~5 s.";
  document.getElementById("list").innerHTML = rows.map(function (x) {
    return "<li><span>" + x.name + (!x.good && x.fix ? "<span class=fix>" + x.fix + "</span>" : "") + "</span><span style='color:" + (x.good ? "inherit" : "#c22") + "'>" + x.value + "</span></li>";
  }).join("");
})();
</script></body></html>`;
}
