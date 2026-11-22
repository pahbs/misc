/* Site monitor: decrypts GoatCounter stats that a GitHub Action saves to the repo. */
(() => {
"use strict";
const SOURCES = [
  "https://raw.githubusercontent.com/pahbs/misc/main/monitor/data/stats.enc.json", // freshest, right after the Action commits
  "data/stats.enc.json",                                                           // GitHub Pages copy
];
const PASS_KEY = "monitor.pass";

const $ = s => document.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const num = n => Math.round(n).toLocaleString("en-US");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const parseDay = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isoDay = d => d.toISOString().slice(0, 10);
const fmtDay = s => { const d = parseDay(s); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const fmtDayLong = s => { const d = parseDay(s); return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
store.set("monitor.gc.token", null); // key from the earlier version of this page; no longer used

const state = { days: 30, path: null, data: null };

// ---------- tooltip / svg ----------
const tip = $("#tip");
function showTip(e, html) {
  tip.innerHTML = html; tip.style.opacity = 1;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.style.opacity = 0; };
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// ---------- data ----------
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function fetchBlob() {
  let missing = false;
  for (const url of SOURCES) {
    try {
      const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (r.ok) return await r.json();
      if (r.status === 404) missing = true;
    } catch { /* try the next source */ }
  }
  const e = new Error("no stats"); e.code = missing ? "missing" : "unreachable"; throw e;
}
async function decrypt(blob, pass) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64(blob.salt), iterations: blob.iter },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.iv) }, key, b64(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// The last N days (ISO dates), ending on the newest day in the data; back=1 is the N days before that.
function dayWindow(days, back = 0) {
  const D = state.data;
  const last = D.daily.length ? parseDay(D.daily[D.daily.length - 1].day) : parseDay(D.generated_at.slice(0, 10));
  const out = [];
  for (let i = days * (back + 1) - 1; i >= days * back; i--) out.push(isoDay(new Date(last.getTime() - i * 864e5)));
  return out;
}

// ---------- rendering ----------
function render() {
  const D = state.data, days = state.days, R = D.ranges[String(days)] || {};
  const dayList = dayWindow(days);
  const path = state.path != null ? D.paths.find(p => p.id === state.path) : null;
  const pathName = path ? (path.title || path.path) : null;
  const siteDaily = new Map(D.daily.map(s => [s.day, s.n]));
  const series = dayList.map(d => ({ day: d, n: path ? (path.daily[d] || 0) : (siteDaily.get(d) || 0) }));

  // KPIs
  let total = R.total ?? series.reduce((a, s) => a + s.n, 0), prev = R.prev;
  if (path) {
    total = series.reduce((a, s) => a + s.n, 0);
    prev = days <= 182 ? dayWindow(days, 1).reduce((a, d) => a + (path.daily[d] || 0), 0) : null;
  }
  const change = prev ? Math.round((total - prev) / prev * 100) : null;
  const latest = series[series.length - 1];
  const busiest = series.reduce((m, s) => s.n > (m?.n || 0) ? s : m, null);
  const pages = D.paths.map(p => ({ ...p, n: dayList.reduce((a, d) => a + (p.daily[d] || 0), 0) })).sort((a, b) => b.n - a.n);
  const top = pages.find(p => p.n > 0);
  $("#kpis").innerHTML = `
    <div class="kpi"><div class="lab">Unique visitors · ${days} days</div><div class="val">${num(total)}</div>
      <div class="foot">${change == null ? "No earlier data to compare" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs. the ${days} days before`}</div></div>
    <div class="kpi"><div class="lab">Latest day</div><div class="val">${num(latest?.n || 0)}</div><div class="foot">${latest ? fmtDayLong(latest.day) : ""}</div></div>
    <div class="kpi"><div class="lab">Busiest day</div><div class="val">${num(busiest?.n || 0)}</div><div class="foot">${busiest ? fmtDayLong(busiest.day) : "No visits yet"}</div></div>
    <div class="kpi"><div class="lab">${path ? "Filtered to" : "Top page"}</div><div class="val sm">${esc(path ? pathName : (top ? (top.title || top.path) : "—"))}</div>
      <div class="foot">${path ? `<span class="filter-pill" id="clearFilter">✕ Show all pages</span>` : top ? `${num(top.n)} visitors · ${esc(top.path)}` : ""}</div></div>`;
  const cf = $("#clearFilter"); if (cf) cf.onclick = () => { state.path = null; render(); };

  renderTrend(series, pathName);

  const shown = pages.filter(p => p.n > 0);
  $("#pages").innerHTML = !shown.length ? `<p class="empty">No page visits in this period yet.</p>` :
    `<div class="prow head"><span>Page</span><span>Daily visitors</span><span style="text-align:right">Visitors</span></div>` +
    shown.map(p => `<div class="prow${state.path === p.id ? " sel" : ""}" data-id="${p.id}">
      <div><div class="t">${esc(p.title || p.path)}</div><div class="p">${esc(p.path)}</div></div>
      <div>${spark(dayList.map(d => p.daily[d] || 0))}</div><div class="n">${num(p.n)}</div></div>`).join("");
  document.querySelectorAll(".prow[data-id]").forEach(r => r.onclick = () => {
    const id = +r.dataset.id; state.path = state.path === id ? null : id; render();
  });

  $("#listNote").textContent = path ? "These lists are for all pages." : "";
  renderList("toprefs", R.toprefs, "toprefs"); renderList("locations", R.locations); renderList("systems", R.systems); renderList("browsers", R.browsers);
  renderMap(R.map);

  const g = new Date(D.generated_at);
  $("#source").innerHTML = `<span class="dot live"></span>Unlocked · stats as of ${g.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

function renderTrend(series, pathName) {
  const box = $("#trend"), W = Math.max(300, box.clientWidth), H = 220, m = { l: 34, r: 8, t: 10, b: 24 };
  box.innerHTML = "";
  $("#trendTitle").textContent = pathName ? `Unique visitors per day · ${pathName}` : "Unique visitors per day";
  $("#trendNote").textContent = series.length ? `${fmtDay(series[0].day)} – ${fmtDay(series[series.length - 1].day)}` : "";
  const max = Math.max(4, ...series.map(s => s.n));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H }, box);
  const y = v => H - m.b - v / max * (H - m.t - m.b);
  const bw = (W - m.l - m.r) / series.length;
  const step = Math.max(1, Math.ceil(max / 4));
  for (let t = 0; t <= max; t += step) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: "var(--rule)", "stroke-dasharray": "2 3" }, svg);
    el("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end" }, svg).textContent = num(t);
  }
  series.forEach((s, i) => {
    const r = el("rect", { x: m.l + i * bw + bw * .14, y: s.n ? y(s.n) : H - m.b - 1.5, width: Math.max(1, bw * .72), height: s.n ? H - m.b - y(s.n) : 1.5,
      rx: Math.min(3, bw / 4), fill: i === series.length - 1 ? "var(--gold)" : "var(--ink)", opacity: s.n ? .88 : .25 }, svg);
    r.addEventListener("mousemove", e => showTip(e, `<b>${fmtDayLong(s.day)}</b><br>${num(s.n)} unique visitor${s.n === 1 ? "" : "s"}`));
    r.addEventListener("mouseleave", hideTip);
  });
  const every = Math.max(1, Math.ceil(series.length / (W < 500 ? 5 : 9)));
  series.forEach((s, i) => { if (i % every === 0) el("text", { x: m.l + i * bw + bw / 2, y: H - 6, "text-anchor": "middle" }, svg).textContent = fmtDay(s.day); });
}
function spark(v) {
  if (!v.length) return "";
  const max = Math.max(1, ...v), w = 100, h = 30, bw = w / v.length;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${v.map((x, i) =>
    `<rect x="${(i * bw + bw * .1).toFixed(2)}" y="${(h - (x / max) * h).toFixed(2)}" width="${(bw * .8).toFixed(2)}" height="${((x / max) * h || .8).toFixed(2)}" fill="var(--ink)" opacity="${x ? .8 : .2}"/>`).join("")}</svg>`;
}
function renderList(id, list, kind) {
  const box = $("#" + id); list = (list || []).filter(s => s.n > 0);
  if (!list.length) { box.innerHTML = `<p class="empty">Nothing yet.</p>`; return; }
  const max = Math.max(...list.map(s => s.n));
  box.innerHTML = list.map(s => {
    const name = s.name || (kind === "toprefs" ? "Direct, or link from an app or text" : "(unknown)");
    return `<div class="bi"><i style="width:${(s.n / max * 100).toFixed(1)}%"></i><span title="${esc(name)}">${esc(name)}</span><b>${num(s.n)}</b></div>`;
  }).join("");
}

// ---------- map ----------
let map = null, layer = null, fitted = null;
function renderMap(points) {
  points = (points || []).filter(p => p.n > 0 && isFinite(p.lat) && isFinite(p.lon)).sort((a, b) => b.n - a.n);
  $("#mapNote").textContent = state.path ? "Locations are for all pages." : "Pinch or scroll to zoom. Tap a circle for details.";
  // side list of top places
  const max = Math.max(1, ...points.map(p => p.n));
  $("#places").innerHTML = points.length ? points.slice(0, 8).map(p => {
    const label = p.country_level ? p.name : `${p.name}, ${p.country}`;
    return `<div class="bi"><i style="width:${(p.n / max * 100).toFixed(1)}%"></i><span title="${esc(label)}">${esc(label)}</span><b>${num(p.n)}</b></div>`;
  }).join("") : `<p class="empty">Nothing yet.</p>`;

  const box = $("#map");
  if (!window.L) { box.innerHTML = `<div class="empty-map">The map couldn't load. A content blocker may be stopping unpkg.com or the map tiles.</div>`; return; }
  if (!map) {
    map = L.map(box, { worldCopyJump: true, scrollWheelZoom: true, zoomSnap: 0.5 }).setView([30, -40], 2);
    // OpenStreetMap's standard tiles: free, no key; muted with CSS (.map .leaflet-tile-pane) to suit the page
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  layer.clearLayers();
  const rad = n => 5 + 22 * Math.sqrt(n / max);
  // biggest first so small circles stay clickable on top
  for (const p of points) {
    const label = p.country_level ? p.name : `${p.name}, ${p.country}`;
    L.circleMarker([p.lat, p.lon], {
      radius: rad(p.n), color: "#1b1a17", weight: 1.2, fillColor: p.country_level ? "#857c6b" : "#1b1a17", fillOpacity: .55,
    }).bindPopup(`<b>${esc(label)}</b><br>${num(p.n)} unique visitor${p.n === 1 ? "" : "s"} · last ${state.days} days`)
      .bindTooltip(`${esc(label)}: ${num(p.n)}`, { direction: "top", offset: [0, -4] })
      .addTo(layer);
  }
  // zoom to fit the visitors once per range, not on every re-render
  const key = state.days + ":" + points.length;
  if (points.length && fitted !== key) {
    fitted = key;
    const b = L.latLngBounds(points.map(p => [p.lat, p.lon]));
    map.fitBounds(b.pad(0.35), { maxZoom: 6 });
  }
  setTimeout(() => map.invalidateSize(), 0);
}

// ---------- flow ----------
function showLock(msg, diagHTML) {
  $("#dash").hidden = true; $("#lock").hidden = false;
  $("#source").innerHTML = `<span class="dot"></span>Locked`;
  $("#keyErr").hidden = !msg; $("#keyErr").textContent = msg || "";
  $("#diag").hidden = !diagHTML; $("#diag").innerHTML = diagHTML || "";
  $("#keyInput").value = "";
}
const SETUP = `<b>No stats file yet.</b> The GitHub Action that collects the stats hasn't run successfully yet. To set it up:
  <ul><li>In GitHub, open <b>pahbs/misc → Settings → Secrets and variables → Actions</b>.</li>
  <li>Add <code>GOATCOUNTER_TOKEN</code> (your GoatCounter key) and <code>MONITOR_PASSPHRASE</code> (a passphrase you make up).</li>
  <li>Open <a href="https://github.com/pahbs/misc/actions/workflows/monitor.yml" target="_blank" rel="noopener">Actions → Update site monitor</a> and click <b>Run workflow</b>.</li></ul>`;

async function unlock(pass) {
  $("#source").innerHTML = `<span class="dot"></span>Unlocking…`;
  let blob;
  try { blob = await fetchBlob(); }
  catch (e) { return showLock("", e.code === "missing" ? SETUP : "<b>Couldn't download the stats.</b> Check your connection and reload."); }
  try { state.data = await decrypt(blob, pass); }
  catch { store.set(PASS_KEY, null); return showLock("That passphrase didn't unlock the stats. Use the same one you saved as the MONITOR_PASSPHRASE secret."); }
  store.set(PASS_KEY, pass);
  $("#lock").hidden = true; $("#dash").hidden = false;
  render();
}

function wire() {
  $("#keyForm").onsubmit = e => { e.preventDefault(); const k = $("#keyInput").value; if (k) unlock(k); };
  $("#forget").onclick = () => { store.set(PASS_KEY, null); state.data = null; showLock(); };
  document.querySelectorAll("#rangeSeg button").forEach(b => b.onclick = () => {
    state.days = +b.dataset.days;
    document.querySelectorAll("#rangeSeg button").forEach(x => x.classList.toggle("on", x === b));
    if (state.data) render();
  });
  // GoatCounter's count.js skips counting when localStorage "skipgc" is "t" (same origin as the other pages).
  const skip = $("#skipMe");
  skip.checked = store.get("skipgc") === "t";
  skip.onchange = () => store.set("skipgc", skip.checked ? "t" : null);
  let rw; addEventListener("resize", () => { clearTimeout(rw); rw = setTimeout(() => state.data && render(), 150); });
}

wire();
const saved = store.get(PASS_KEY);
if (saved) unlock(saved); else showLock();
})();
