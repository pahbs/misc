/* Site monitor: reads GoatCounter's API with a key kept in this browser only. */
(() => {
"use strict";
const SITE = "https://pahbs.goatcounter.com";
const API = SITE + "/api/v0";
const KEY = "monitor.gc.token";

const $ = s => document.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const num = n => Math.round(n).toLocaleString("en-US");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const fmtDay = s => { const [y, m, d] = s.split("-").map(Number); return `${MON[m - 1]} ${d}`; };
const fmtDayLong = s => { const [y, m, d] = s.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); return `${DOW[dt.getUTCDay()]}, ${MON[m - 1]} ${d}`; };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const state = { days: 30, path: null, pathName: null };

// tooltip
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

// ---------- API ----------
function hourISO(d) { const x = new Date(d); x.setUTCMinutes(0, 0, 0); return x.toISOString().replace(".000", ""); }
function range(days, back = 0) {
  const end = new Date(Date.now() + 3600e3 - back * days * 864e5);
  const start = new Date(end.getTime() - days * 864e5);
  return { start: hourISO(start), end: hourISO(end) };
}
async function api(path, params = {}) {
  const token = store.get(KEY);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x)); else qs.append(k, v);
  }
  const r = await fetch(`${API}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) { const e = new Error("That key was rejected. Check that it has read-statistics permission."); e.auth = true; throw e; }
  if (r.status === 429) throw new Error("GoatCounter's rate limit was hit. Wait a few seconds and refresh.");
  if (!r.ok) throw new Error(`GoatCounter returned ${r.status}`);
  return r.json();
}

// ---------- Rendering ----------
function renderKPIs(total, prevTotal, hits) {
  const days = (total.stats || []).filter(s => s.day);
  const today = days.length ? days[days.length - 1] : null;
  const busiest = days.reduce((m, s) => (s.daily || 0) > (m?.daily || 0) ? s : m, null);
  const change = prevTotal.total ? Math.round((total.total - prevTotal.total) / prevTotal.total * 100) : null;
  const top = (hits.hits || []).filter(h => !h.event)[0];
  $("#kpis").innerHTML = `
    <div class="kpi"><div class="lab">Unique visitors · ${state.days} days</div><div class="val">${num(total.total || 0)}</div>
      <div class="foot">${change == null ? "No earlier data to compare" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs. the ${state.days} days before`}</div></div>
    <div class="kpi"><div class="lab">Today</div><div class="val">${num(today?.daily || 0)}</div><div class="foot">${today ? fmtDayLong(today.day) : ""}</div></div>
    <div class="kpi"><div class="lab">Busiest day</div><div class="val">${num(busiest?.daily || 0)}</div><div class="foot">${busiest && busiest.daily ? fmtDayLong(busiest.day) : "No visits yet"}</div></div>
    <div class="kpi"><div class="lab">${state.path ? "Filtered to" : "Top page"}</div><div class="val sm">${esc(state.path ? state.pathName : (top ? (top.title || top.path) : "—"))}</div>
      <div class="foot">${state.path ? `<span class="filter-pill" id="clearFilter">✕ Show all pages</span>` : top ? `${num(top.count)} visitors · ${esc(top.path)}` : ""}</div></div>`;
  const cf = $("#clearFilter"); if (cf) cf.onclick = () => { state.path = null; state.pathName = null; load(); };
}

function renderTrend(total) {
  const days = (total.stats || []).filter(s => s.day);
  const box = $("#trend"), W = Math.max(300, box.clientWidth), H = 220, m = { l: 34, r: 8, t: 10, b: 24 };
  box.innerHTML = "";
  $("#trendTitle").textContent = state.path ? `Unique visitors per day · ${state.pathName}` : "Unique visitors per day";
  $("#trendNote").textContent = days.length ? `${fmtDay(days[0].day)} – ${fmtDay(days[days.length - 1].day)}` : "";
  if (!days.length) { box.innerHTML = `<p class="empty">No visits in this period yet.</p>`; return; }
  const max = Math.max(4, ...days.map(s => s.daily || 0));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H }, box);
  const y = v => H - m.b - v / max * (H - m.t - m.b);
  const bw = (W - m.l - m.r) / days.length;
  const step = Math.max(1, Math.ceil(max / 4));
  for (let t = 0; t <= max; t += step) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: "var(--rule)", "stroke-dasharray": "2 3" }, svg);
    el("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end" }, svg).textContent = num(t);
  }
  days.forEach((s, i) => {
    const v = s.daily || 0;
    const r = el("rect", { x: m.l + i * bw + bw * .14, y: v ? y(v) : H - m.b - 1.5, width: Math.max(1, bw * .72), height: v ? H - m.b - y(v) : 1.5, rx: Math.min(3, bw / 4), fill: i === days.length - 1 ? "var(--gold)" : "var(--ink)", opacity: v ? .88 : .25 }, svg);
    r.addEventListener("mousemove", e => showTip(e, `<b>${fmtDayLong(s.day)}</b><br>${num(v)} unique visitor${v === 1 ? "" : "s"}`));
    r.addEventListener("mouseleave", hideTip);
  });
  const every = Math.max(1, Math.ceil(days.length / (W < 500 ? 5 : 9)));
  days.forEach((s, i) => { if (i % every === 0) el("text", { x: m.l + i * bw + bw / 2, y: H - 6, "text-anchor": "middle" }, svg).textContent = fmtDay(s.day); });
}

function spark(stats) {
  const v = (stats || []).map(s => s.daily || 0);
  if (!v.length) return "";
  const max = Math.max(1, ...v), w = 100, h = 30, bw = w / v.length;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${v.map((x, i) =>
    `<rect x="${(i * bw + bw * .1).toFixed(2)}" y="${(h - (x / max) * h).toFixed(2)}" width="${(bw * .8).toFixed(2)}" height="${((x / max) * h || .8).toFixed(2)}" fill="var(--ink)" opacity="${x ? .8 : .2}"/>`).join("")}</svg>`;
}
function renderPages(hits) {
  const list = (hits.hits || []).filter(h => !h.event);
  if (!list.length) { $("#pages").innerHTML = `<p class="empty">No page visits recorded in this period yet. Visits start counting once the tracking code is live.</p>`; return; }
  $("#pages").innerHTML = `<div class="prow head"><span>Page</span><span>Daily visitors</span><span style="text-align:right">Visitors</span></div>` +
    list.map(h => `<div class="prow${state.path === h.path_id ? " sel" : ""}" data-id="${h.path_id}" data-name="${esc(h.title || h.path)}">
      <div><div class="t">${esc(h.title || h.path)}</div><div class="p">${esc(h.path)}</div></div>
      <div>${spark(h.stats)}</div><div class="n">${num(h.count)}</div></div>`).join("");
  document.querySelectorAll(".prow[data-id]").forEach(r => r.onclick = () => {
    const id = +r.dataset.id;
    if (state.path === id) { state.path = null; state.pathName = null; } else { state.path = id; state.pathName = r.dataset.name; }
    load();
  });
}

const REF = { h: "", g: "Generated", c: "Campaign", o: "Other" };
function renderList(id, data, kind) {
  const list = (data.stats || []).filter(s => s.count > 0);
  const elx = $("#" + id);
  if (!list.length) { elx.innerHTML = `<p class="empty">Nothing yet.</p>`; return; }
  const max = Math.max(...list.map(s => s.count));
  elx.innerHTML = list.map(s => {
    let name = s.name || "(unknown)";
    if (kind === "toprefs" && !s.name) name = "Direct, or link from an app or text";
    return `<div class="bi"><i style="width:${(s.count / max * 100).toFixed(1)}%"></i><span title="${esc(name)}">${esc(name)}</span><b>${num(s.count)}</b></div>`;
  }).join("");
}

// ---------- Flow ----------
let loading = 0;
async function load() {
  const my = ++loading;
  const r = range(state.days), prev = range(state.days, 1);
  const inc = state.path ? { include_paths: [state.path] } : {};
  $("#source").innerHTML = `<span class="dot"></span>Loading…`;
  try {
    const [total, prevTotal, hits, refs, locs, sys, brs] = await Promise.all([
      api("/stats/total", { ...r, ...inc }),
      api("/stats/total", { ...prev, ...inc }),
      api("/stats/hits", { ...r, limit: 100 }),
      api("/stats/toprefs", { ...r, limit: 8, ...inc }),
      api("/stats/locations", { ...r, limit: 8, ...inc }),
      api("/stats/systems", { ...r, limit: 6, ...inc }),
      api("/stats/browsers", { ...r, limit: 6, ...inc }),
    ]);
    if (my !== loading) return;
    $("#lock").hidden = true; $("#dash").hidden = false; $("#diag").hidden = true;
    renderKPIs(total, prevTotal, hits); renderTrend(total); renderPages(hits);
    renderList("toprefs", refs, "toprefs"); renderList("locations", locs); renderList("systems", sys); renderList("browsers", brs);
    const t = new Date();
    $("#source").innerHTML = `<span class="dot live"></span>Connected to pahbs.goatcounter.com · updated ${t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    state.lastTotal = total;
  } catch (e) {
    if (my !== loading) return;
    if (e.auth) { store.set(KEY, null); showLock(e.message); return; }
    if (e instanceof TypeError) return diagnose();
    $("#source").innerHTML = `<span class="dot"></span>${esc(e.message)}`;
  }
}
// The browser blocked the request. Work out whether it's a content blocker or the API itself.
async function diagnose() {
  let blocked = false;
  try { await fetch("https://gc.zgo.at/count.js", { mode: "no-cors", cache: "no-store" }); } catch { blocked = true; }
  showLock();
  const d = $("#diag"); d.hidden = false;
  $("#source").innerHTML = `<span class="dot"></span>Couldn't reach GoatCounter`;
  d.innerHTML = blocked
    ? `<b>This browser is blocking GoatCounter.</b> An ad or tracker blocker is the usual cause. For example: Brave Shields, Safari content blockers, uBlock Origin, Firefox's strict tracking protection, or Private Relay. Allow <code>goatcounter.com</code> and <code>gc.zgo.at</code> on <code>pahbs.github.io</code>, then reconnect. The same blocker also stops visits from being counted for anyone who uses it.`
    : `<b>GoatCounter refused the request from this page.</b> The connection works, but its API didn't allow a browser request from pahbs.github.io. Your key is still saved in this browser. You can use <a href="${SITE}" target="_blank" rel="noopener">GoatCounter's own dashboard</a> for now.`;
}
function showLock(msg) {
  $("#dash").hidden = true; $("#lock").hidden = false;
  $("#source").innerHTML = `<span class="dot"></span>Not connected`;
  $("#keyErr").hidden = !msg; $("#keyErr").textContent = msg || ""; $("#diag").hidden = true;
  $("#keyInput").value = ""; $("#keyInput").focus();
}

function wire() {
  $("#keyForm").onsubmit = e => {
    e.preventDefault();
    const k = $("#keyInput").value.trim(); if (!k) return;
    store.set(KEY, k); $("#keyErr").hidden = true; load();
  };
  $("#forget").onclick = () => { store.set(KEY, null); showLock(); };
  $("#refresh").onclick = load;
  document.querySelectorAll("#rangeSeg button").forEach(b => b.onclick = () => {
    state.days = +b.dataset.days;
    document.querySelectorAll("#rangeSeg button").forEach(x => x.classList.toggle("on", x === b));
    load();
  });
  // GoatCounter's count.js skips counting when localStorage "skipgc" is "t" (same origin as the other pages).
  const skip = $("#skipMe");
  skip.checked = store.get("skipgc") === "t";
  skip.onchange = () => store.set("skipgc", skip.checked ? "t" : null);
  let rw; addEventListener("resize", () => { clearTimeout(rw); rw = setTimeout(() => state.lastTotal && renderTrend(state.lastTotal), 150); });
}

wire();
if (store.get(KEY)) load(); else showLock();
})();
