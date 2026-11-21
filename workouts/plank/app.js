/* Equinox Plank Ledger — vanilla JS, no dependencies. */
(() => {
"use strict";

// ---------- Config ----------
const CFG = {
  sheetId: "1x8aUhMgR5wYGBRp2PhV57-Gsr6zqN_8WzpTZuc0gCIw",
  sheetName: "Form Responses 1",
  start: [2026, 9, 22],      // fall equinox, day 1
  days: 180,                 // through the spring equinox (Mar 20, 2027)
  min: 180,                  // seconds per day to stay in the black
  snapshot: "data/planks.csv",
};
CFG.liveUrl = `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(CFG.sheetName)}`;
CFG.goal = CFG.min * CFG.days;

// ---------- Helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const MS = 864e5;
const dayNum = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / MS);
const START = dayNum(...CFG.start);
const dateOf = i => new Date((START + i) * MS);
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const fmtDate = i => { const d = dateOf(i); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const fmtDateLong = i => { const d = dateOf(i); return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const num = n => Math.round(n).toLocaleString("en-US");
const bal = n => n < 0 ? `(${num(-n)})` : num(n);
const mmss = s => { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, "0")}`; };
const hrs = s => (s / 3600).toFixed(1);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function svgBox(container, w, h) {
  container.innerHTML = "";
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, preserveAspectRatio: "xMinYMin meet" }, container);
}
function scale(d0, d1, r0, r1) { const k = (r1 - r0) / ((d1 - d0) || 1); return v => r0 + (v - d0) * k; }
function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= step0);
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
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

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); rows.push(row); row = []; f = "";
    } else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function parseMDY(s) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  let y = +m[3]; if (y < 1000) y = 2000 + (y % 100);   // fixes "0026" typos
  return { day: dayNum(y, +m[1], +m[2]), hour: m[4] != null ? +m[4] : null, min: m[5] != null ? +m[5] : 0, raw: s };
}

// ---------- Model ----------
function buildModel(rows) {
  const head = rows[0].map(h => h.toLowerCase());
  const col = (key, dflt) => { const i = head.findIndex(h => h.includes(key)); return i < 0 ? dflt : i; };
  const C = { ts: col("timestamp", 0), who: col("planker", 1), day: col("what day", 2), sec: col("how long", 3), note: col("anything", 4) };
  const entries = [];
  for (const r of rows.slice(1)) {
    const who = (r[C.who] || "").trim(), ts = parseMDY(r[C.ts] || ""), sec = parseFloat(r[C.sec]);
    if (!who || !ts || !isFinite(sec) || sec <= 0) continue;
    const given = r[C.day] ? parseMDY(r[C.day]) : null;
    let d = (given ? given.day : ts.day);
    if (d > ts.day) d = ts.day;             // can't plank in the future: book on submission day
    let idx = clamp(d - START, 0, CFG.days - 1);
    entries.push({ who, idx, sec: Math.round(sec), tsDay: ts.day, hour: ts.hour, min: ts.min, tsRaw: ts.raw, note: (r[C.note] || "").trim() });
  }
  const names = [...new Set(entries.map(e => e.who))].sort((a, b) => a.localeCompare(b));
  const P = {};
  for (const n of names) P[n] = { name: n, daily: new Float64Array(CFG.days), cum: new Float64Array(CFG.days), entries: [] };
  for (const e of entries) { P[e.who].daily[e.idx] += e.sec; P[e.who].entries.push(e); }
  for (const n of names) { let c = 0; const p = P[n]; for (let i = 0; i < CFG.days; i++) { c += p.daily[i]; p.cum[i] = c; } }
  const lastTs = Math.max(...entries.map(e => e.tsDay));
  return { entries, names, P, lastTs };
}

// stats for one person as of day D
function statsAt(p, D) {
  const pace = CFG.min * (D + 1);
  const total = p.cum[D];
  let streak = 0, i = D;
  if (p.daily[D] < CFG.min) i = D - 1;      // today's still open: don't break the streak yet
  while (i >= 0 && p.daily[i] >= CFG.min) { streak++; i--; }
  let best = 0, run = 0, black = 0, active = 0;
  for (let k = 0; k <= D; k++) {
    if (p.daily[k] >= CFG.min) { run++; black++; best = Math.max(best, run); } else run = 0;
    if (p.daily[k] > 0) active++;
  }
  return { name: p.name, total, balance: total - pace, streak, best, black, active, today: p.daily[D] };
}

// ---------- State ----------
const state = { M: null, D: 0, maxD: 0, sel: null, sort: "name", race: "balance", playing: null, live: false };

// ---------- Renderers ----------
function renderKPIs(S) {
  const { M, D } = state;
  const n = S.length, blackN = S.filter(s => s.balance >= 0).length;
  const total = S.reduce((a, s) => a + s.total, 0), groupBal = S.reduce((a, s) => a + s.balance, 0);
  const todayTot = S.reduce((a, s) => a + s.today, 0), todayHit = S.filter(s => s.today >= CFG.min).length;
  const groupGoal = CFG.goal * n;
  $("#kpis").innerHTML = `
    <div class="kpi"><div class="lab">Day of challenge</div><div class="val">${D + 1}<small> / ${CFG.days}</small></div>
      <div class="bar"><i style="width:${((D + 1) / CFG.days * 100).toFixed(1)}%"></i></div><div class="foot">${fmtDateLong(D)}</div></div>
    <div class="kpi"><div class="lab">Planked together</div><div class="val">${hrs(total)}<small> hrs</small></div>
      <div class="bar"><i style="width:${Math.min(100, total / groupGoal * 100).toFixed(1)}%"></i></div><div class="foot">${(total / groupGoal * 100).toFixed(0)}% of the group finish line</div></div>
    <div class="kpi"><div class="lab">In the black</div><div class="val">${blackN}<small> of ${n}</small></div>
      <div class="bar"><i style="width:${(blackN / n * 100).toFixed(1)}%"></i></div><div class="foot">${n - blackN} working back to black</div></div>
    <div class="kpi"><div class="lab">Showed up ${D === state.maxD ? "today" : "that day"}</div><div class="val">${S.filter(s => s.today > 0).length}<small> of ${n}</small></div>
      <div class="bar"><i style="width:${(S.filter(s => s.today > 0).length / n * 100).toFixed(1)}%"></i></div><div class="foot">Every plank counts</div></div>
    <div class="kpi"><div class="lab">${D === state.maxD ? "Today" : "That day"}</div><div class="val">${mmss(todayTot / Math.max(1, S.filter(s => s.today > 0).length))}<small> avg</small></div>
      <div class="foot">${todayHit} hit 3:00 · ${num(todayTot)} sec total</div></div>`;
}

function sortStats(S) {
  const by = {
    balance: (a, b) => b.balance - a.balance || a.name.localeCompare(b.name),
    total: (a, b) => b.total - a.total || a.name.localeCompare(b.name),
    streak: (a, b) => b.streak - a.streak || b.balance - a.balance,
    name: (a, b) => a.name.localeCompare(b.name),
  }[state.sort];
  return [...S].sort(by);
}

function renderLedger(S) {
  const rows = sortStats(S);
  const maxAbs = Math.max(1, ...rows.map(s => Math.abs(s.balance)));
  let html = `<div class="lrow head"><span>Planker</span><span>± Pace</span><span class="amt">Balance</span><span class="stk">Streak</span></div>`;
  rows.forEach((s, i) => {
    const w = Math.abs(s.balance) / maxAbs * 50;
    const pos = s.balance >= 0;
    const nextNeg = state.sort === "balance" && pos && rows[i + 1] && rows[i + 1].balance < 0;
    html += `<div class="lrow${state.sel === s.name ? " sel" : ""}${nextNeg ? " ledger-zero" : ""}" data-name="${esc(s.name)}">
      <span class="nm">${esc(s.name)}</span>
      <span class="div-bar"><span class="zero"></span><span class="b ${pos ? "pos" : "neg"}" style="${pos ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`}"></span></span>
      <span class="amt ${pos ? "" : "neg"}">${bal(s.balance)}</span>
      <span class="stk">${s.streak ? `<b>${s.streak}</b> day${s.streak > 1 ? "s" : ""}` : "—"}</span></div>`;
  });
  const L = $("#ledger"); L.innerHTML = html;
  L.querySelectorAll(".lrow[data-name]").forEach(r => {
    r.onclick = () => select(r.dataset.name === state.sel ? null : r.dataset.name);
    r.onmousemove = e => { const s = S.find(x => x.name === r.dataset.name);
      showTip(e, `<b>${esc(s.name)}</b><br>${num(s.total)} sec planked (${mmss(s.total / (state.D + 1))}/day avg)<br>${s.black} of ${state.D + 1} days at 3:00+<br>Best streak ${s.best} days`); };
    r.onmouseleave = hideTip;
  });
}

function renderDonut(S) {
  const n = S.length, b = S.filter(s => s.balance >= 0).length, r = n - b;
  const R = 62, r0 = 42, cx = 70, cy = 70, a = b / n * Math.PI * 2;
  const arc = (a0, a1) => {
    const p = (ang, rad) => [cx + rad * Math.sin(ang), cy - rad * Math.cos(ang)];
    const large = a1 - a0 > Math.PI ? 1 : 0, [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r0), [x3, y3] = p(a0, r0);
    return `M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${large} 0 ${x3},${y3}Z`;
  };
  const full = (fill) => `<circle cx="${cx}" cy="${cy}" r="${(R + r0) / 2}" fill="none" stroke="${fill}" stroke-width="${R - r0}"/>`;
  let paths = b === n ? full("var(--ink)") : r === n ? full("var(--red)") :
    `<path d="${arc(0, a)}" fill="var(--ink)"/><path d="${arc(a, Math.PI * 2)}" fill="var(--red)"/>`;
  const blackTot = S.filter(s => s.balance >= 0).reduce((x, s) => x + s.balance, 0);
  const redTot = S.filter(s => s.balance < 0).reduce((x, s) => x + s.balance, 0);
  $("#donut").innerHTML = `<svg viewBox="0 0 140 140" width="140" height="140">${paths}
    <text x="70" y="68" text-anchor="middle" style="font:600 26px var(--serif);fill:var(--ink)">${Math.round(b / n * 100)}%</text>
    <text x="70" y="86" text-anchor="middle" style="font-size:8px;letter-spacing:.1em">IN THE BLACK</text></svg>
    <div class="lg">
      <div><span>In the black</span><b>${b}</b></div>
      <div><span>Catching up</span><b class="red">${r}</b></div>
      <div><span>Seconds banked</span><span>${num(blackTot)}</span></div>
      <div><span>Seconds to catch up</span><span class="red">${num(-redTot)}</span></div>
    </div>`;
}

function renderAwards(S) {
  const { M, D } = state;
  const es = M.entries.filter(e => e.idx <= D);
  const A = [];
  const longest = es.reduce((m, e) => e.sec > (m?.sec || 0) ? e : m, null);
  if (longest) A.push(["Longest hold", longest.who, `${mmss(longest.sec)} on ${fmtDate(longest.idx)}`]);
  let gDay = null;
  for (let i = 0; i <= D; i++) { let t = 0, c = 0; for (const n of M.names) { const v = M.P[n].daily[i]; t += v; if (v > 0) c++; } if (!gDay || c > gDay.c || (c === gDay.c && t > gDay.t)) gDay = { i, t, c }; }
  if (gDay) A.push(["Our best day together", fmtDate(gDay.i), `${gDay.c} plankers showed up · ${hrs(gDay.t)} hrs`]);
  const topBy = k => S.reduce((m, s) => s[k] > m[k] ? s : m, S[0]);
  const st = topBy("streak"); if (st.streak) A.push(["Steady streak", st.name, `${st.streak} days in a row at 3:00+`]);
  const bs = topBy("best"); A.push(["Longest run", bs.name, `${bs.best} days in a row`]);
  const mb = topBy("black"); A.push(["Most consistent", mb.name, `Showed up for 3:00+ on ${mb.black} of ${D + 1} days`]);
  if (D >= 7) {
    const w = Math.min(14, D);
    let cb = null;
    for (const n of M.names) { const p = M.P[n]; const gain = (p.cum[D] - p.cum[D - w]) - CFG.min * w; if (!cb || gain > cb.g) cb = { n, g: gain }; }
    A.push(["On a roll lately", cb.n, `Strong last ${w} days`]);
  }
  const times = {};
  for (const e of es) if (e.hour != null) (times[e.who] ||= []).push(e.hour + e.min / 60);
  const meds = Object.entries(times).filter(([, v]) => v.length >= 10).map(([n, v]) => ({ n, m: median(v) }));
  if (meds.length) {
    const early = meds.reduce((a, b) => b.m < a.m ? b : a), late = meds.reduce((a, b) => b.m > a.m ? b : a);
    const hh = m => { const h = Math.floor(m), mi = Math.round((m - h) * 60); return `${(h % 12) || 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
    A.push(["Early bird", early.n, `Typically logs by ${hh(early.m)}`]);
    A.push(["Night owl", late.n, `Typically logs around ${hh(late.m)}`]);
  }
  $("#awards").innerHTML = A.map(([t, w, d]) => `<div class="award"><div class="t">${t}</div><div class="w">${esc(w)}</div><div class="d">${d}</div></div>`).join("");
}

function renderRace() {
  const { M, D, sel } = state, mode = state.race;
  const box = $("#race"), W = Math.max(320, box.clientWidth), H = W < 600 ? 300 : 400;
  const m = { l: 52, r: 74, t: 14, b: 26 };
  const series = {}, thr = [];
  for (const n of M.names) {
    const p = M.P[n], arr = [];
    for (let i = 0; i <= D; i++) {
      if (mode === "balance") arr.push(p.cum[i] - CFG.min * (i + 1));
      else if (mode === "cumulative") arr.push(p.cum[i]);
      else { const k = Math.min(7, i + 1); arr.push((p.cum[i] - (i - k >= 0 ? p.cum[i - k] : 0)) / k); }
    }
    series[n] = arr;
  }
  for (let i = 0; i <= D; i++) thr.push(mode === "balance" ? 0 : mode === "cumulative" ? CFG.min * (i + 1) : CFG.min);
  let lo = Math.min(...thr), hi = Math.max(...thr);
  for (const n in series) for (const v of series[n]) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const x = scale(0, Math.max(1, D), m.l, W - m.r), y = scale(lo, hi, H - m.b, m.t);
  const svg = svgBox(box, W, H);
  const defs = el("defs", {}, svg);
  const thrPts = thr.map((v, i) => `${x(i)},${y(v)}`);
  if (D === 0) thrPts.push(`${x(1)},${y(thr[0])}`);
  const xs = D === 0 ? [x(0), x(1)] : [x(0), x(D)];
  const yT0 = y(thr[0]), yT1 = y(thr[thr.length - 1]);
  const band = edge => `M${xs[0] - 4},${edge}L${xs[0] - 4},${yT0}L${thrPts.join("L")}L${xs[1] + 6},${yT1}L${xs[1] + 6},${edge}Z`;
  el("path", { d: band(-50) }, el("clipPath", { id: "clipAbove", clipPathUnits: "userSpaceOnUse" }, defs));
  el("path", { d: band(H + 50) }, el("clipPath", { id: "clipBelow", clipPathUnits: "userSpaceOnUse" }, defs));
  // red-zone wash
  el("path", { d: `M${xs[0]},${H - m.b}L${thrPts.join("L")}L${xs[1]},${H - m.b}Z`, fill: "var(--red-faint)", opacity: .55 }, svg);
  // grid + axes
  const g = el("g", { class: "grid" }, svg);
  for (const t of niceTicks(lo, hi, 6)) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }, g);
    const tx = el("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end" }, svg);
    tx.textContent = mode === "balance" ? bal(t) : mode === "cumulative" ? (t >= 1000 ? (t / 1000) + "k" : t) : mmss(t);
  }
  const step = D > 120 ? 28 : D > 50 ? 14 : 7;
  for (let i = 0; i <= D; i += step) { const tx = el("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, svg); tx.textContent = fmtDate(i); }
  el("path", { d: `M${thrPts.join("L")}`, class: "zero-line", fill: "none", "stroke-dasharray": mode === "balance" ? "" : "5 4" }, svg);
  const lab = el("text", { x: W - m.r + 6, y: y(thr[thr.length - 1]) + 4, style: "font-weight:600;fill:var(--ink)" }, svg);
  lab.textContent = mode === "balance" ? "even" : mode === "cumulative" ? "pace" : "3:00";
  // lines
  const lines = el("g", {}, svg), hits = el("g", {}, svg);
  const paths = {};
  for (const n of M.names) {
    const d = series[n].map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("") + (D === 0 ? `L${x(1)},${y(series[n][0])}` : "");
    const gg = el("g", { class: "pl" }, lines);
    el("path", { d, stroke: "var(--ink)", "clip-path": "url(#clipAbove)", fill: "none" }, gg);
    el("path", { d, stroke: "var(--red)", "clip-path": "url(#clipBelow)", fill: "none" }, gg);
    paths[n] = gg;
    const h = el("path", { d, class: "hit" }, hits);
    h.addEventListener("mousemove", e => {
      focus(n);
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      const i = clamp(Math.round((loc.x - m.l) / ((W - m.r - m.l) / Math.max(1, D))), 0, D), v = series[n][i];
      const txt = mode === "balance" ? `<span class="${v < 0 ? "neg" : ""}">${bal(v)} sec</span>` : mode === "cumulative" ? `${num(v)} sec (pace ${num(thr[i])})` : `${mmss(v)} per day`;
      showTip(e, `<b>${esc(n)}</b> · ${fmtDate(i)}<br>${txt}`);
    });
    h.addEventListener("mouseleave", () => { focus(state.sel); hideTip(); });
    h.addEventListener("click", () => select(n === state.sel ? null : n));
  }
  // end labels: top 3, bottom 3, selected
  const last = M.names.map(n => ({ n, v: series[n][D] })).sort((a, b) => b.v - a.v);
  const pick = new Set(sel ? [sel] : []);
  const labs = last.filter(o => pick.has(o.n)).map(o => ({ ...o, y: y(o.v) }));
  labs.sort((a, b) => a.y - b.y); for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 12) labs[i].y = labs[i - 1].y + 12;
  const endG = el("g", {}, svg);
  for (const o of labs) {
    const t = el("text", { x: W - m.r + 6, y: o.y + 4, class: "endlab", style: `fill:${o.v < thr[D] ? "var(--red)" : "var(--ink)"}` }, endG);
    t.textContent = o.n; t.dataset.n = o.n;
  }
  function focus(n) {
    for (const k in paths) { paths[k].classList.toggle("dim", !!n && k !== n); paths[k].classList.toggle("hi", k === n); }
    if (n) lines.appendChild(paths[n]);
    endG.querySelectorAll("text").forEach(t => t.style.opacity = !n || t.dataset.n === n ? 1 : .25);
  }
  focus(sel);
  $("#raceTitle").textContent = { balance: "Balances over time", cumulative: "Progress toward the finish line", rolling: "Recent rhythm" }[mode];
  $("#raceNote").textContent = {
    balance: "Each line is one planker's running balance. Above the line is in the black; below it, a little catching up to do. Hover a line, or click a name in the ledger to follow someone.",
    cumulative: "Total seconds planked alongside the 3-minute-a-day pace line (dashed). The finish line is 32,400 seconds on March 20.",
    rolling: "Average seconds per day over the past week. Ups and downs are normal; the 3:00 line is the daily goal.",
  }[mode];
}

function renderHeat() {
  const { M, D, sel } = state;
  const S = M.names.map(n => statsAt(M.P[n], D));
  const shown = Math.min(CFG.days, Math.max(D + 1, state.maxD + 1));
  const H = $("#heat");
  let html = `<div class="heat" style="grid-template-columns:auto repeat(${shown},13px)"><div></div>`;
  for (let i = 0; i < shown; i++) {
    const d = dateOf(i);
    html += `<div class="mh">${d.getUTCDate() === 1 || i === 0 ? MON[d.getUTCMonth()] : ""}</div>`;
  }
  for (const s of S) {
    const p = M.P[s.name];
    html += `<div class="n${sel === s.name ? " sel" : ""}" data-name="${esc(s.name)}">${esc(s.name)}</div>`;
    for (let i = 0; i < shown; i++) {
      const v = p.daily[i];
      const cls = i > D ? "fut" : v >= 360 ? "b3" : v >= 240 ? "b2" : v >= CFG.min ? "b1" : v > 0 ? (v >= 90 ? "r2" : "r") : "";
      html += `<div class="c ${cls}" data-n="${esc(s.name)}" data-i="${i}"${sel && sel !== s.name ? ' style="opacity:.45"' : ""}></div>`;
    }
  }
  H.innerHTML = html + "</div>";
  H.onmousemove = e => {
    const c = e.target.closest(".c"); if (!c) return hideTip();
    const i = +c.dataset.i, v = M.P[c.dataset.n].daily[i];
    showTip(e, `<b>${esc(c.dataset.n)}</b> · ${fmtDateLong(i)}<br>${i > state.D ? "—" : v ? `${mmss(v)} ${v >= CFG.min ? "✓" : `<span class="neg">short ${mmss(CFG.min - v)}</span>`}` : `<span class="neg">no plank logged</span>`}`);
  };
  H.onmouseleave = hideTip;
  H.querySelectorAll(".n").forEach(n => n.onclick = () => select(n.dataset.name === state.sel ? null : n.dataset.name));
}

function renderVolume() {
  const { M, D } = state;
  const box = $("#volume"), W = Math.max(300, box.clientWidth), H = 240, m = { l: 44, r: 34, t: 10, b: 24 };
  const tot = [], hit = [], active = [];
  for (let i = 0; i <= state.maxD; i++) {
    let t = 0, h = 0, a = 0;
    for (const n of M.names) { const v = M.P[n].daily[i]; t += v; if (v >= CFG.min) h++; if (v > 0) a++; }
    tot.push(t); hit.push(h); active.push(a);
  }
  const N = tot.length, bw = (W - m.l - m.r) / N;
  const y = scale(0, Math.max(...tot) * 1.05, H - m.b, m.t), y2 = scale(0, M.names.length, H - m.b, m.t);
  const svg = svgBox(box, W, H);
  const g = el("g", { class: "grid" }, svg);
  for (const t of niceTicks(0, Math.max(...tot), 4)) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }, g);
    el("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end" }, svg).textContent = t >= 1000 ? (t / 3600).toFixed(1) + "h" : t;
  }
  for (const t of [0, Math.round(M.names.length / 2), M.names.length]) el("text", { x: W - m.r + 6, y: y2(t) + 4, style: "fill:var(--red)" }, svg).textContent = t;
  for (let i = 0; i < N; i++) {
    const r = el("rect", { x: m.l + i * bw + bw * .12, y: y(tot[i]), width: Math.max(1, bw * .76), height: H - m.b - y(tot[i]), rx: Math.min(2, bw / 4), fill: i === D ? "var(--gold)" : "var(--ink)", opacity: i > D ? .15 : .85 }, svg);
    r.addEventListener("mousemove", e => showTip(e, `<b>${fmtDateLong(i)}</b><br>${num(tot[i])} sec (${hrs(tot[i])} hrs)<br>${active[i]} plankers logged · ${hit[i]} hit 3:00`));
    r.addEventListener("mouseleave", hideTip);
    r.addEventListener("click", () => setDay(i));
  }
  const pts = hit.map((h, i) => `${i ? "L" : "M"}${m.l + i * bw + bw / 2},${y2(h)}`).join("");
  el("path", { d: pts, fill: "none", stroke: "var(--red)", "stroke-width": 1.6, "pointer-events": "none" }, svg);
  const step = N > 120 ? 28 : N > 50 ? 14 : 7;
  for (let i = 0; i < N; i += step) el("text", { x: m.l + i * bw + bw / 2, y: H - 6, "text-anchor": "middle" }, svg).textContent = fmtDate(i);
}

function renderClock() {
  const { M, D } = state;
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const e of M.entries) if (e.idx <= D && e.hour != null) {
    const wd = new Date(e.tsDay * MS).getUTCDay(); grid[(wd + 6) % 7][e.hour]++;
  }
  const max = Math.max(1, ...grid.flat());
  const box = $("#clock"), W = Math.max(300, box.clientWidth), m = { l: 34, t: 6, b: 22 };
  const cw = (W - m.l) / 24, ch = Math.min(26, cw * 1.1), H = m.t + ch * 7 + m.b;
  const svg = svgBox(box, W, H);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  grid.forEach((row, r) => {
    el("text", { x: m.l - 6, y: m.t + r * ch + ch / 2 + 4, "text-anchor": "end" }, svg).textContent = days[r];
    row.forEach((v, h) => {
      const t = v / max;
      const c = el("rect", { x: m.l + h * cw + 1, y: m.t + r * ch + 1, width: cw - 2, height: ch - 2, rx: 3,
        fill: v ? `rgba(27,26,23,${(0.08 + 0.92 * Math.sqrt(t)).toFixed(3)})` : "var(--paper-2)" }, svg);
      c.addEventListener("mousemove", e => showTip(e, `<b>${days[r]}, ${(h % 12) || 12}${h < 12 ? "am" : "pm"}</b><br>${v} plank${v === 1 ? "" : "s"} logged`));
      c.addEventListener("mouseleave", hideTip);
    });
  });
  for (const h of [0, 6, 12, 18, 23]) el("text", { x: m.l + h * cw + cw / 2, y: H - 6, "text-anchor": "middle" }, svg).textContent = h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? h + "a" : (h - 12) + "p";
}

function renderWeekly() {
  const { M, D } = state;
  const nW = Math.floor(D / 7) + 1;
  const S = M.names.map(n => statsAt(M.P[n], D));
  let html = `<table class="wk"><thead><tr><th></th>`;
  for (let w = 0; w < nW; w++) html += `<th>${fmtDate(w * 7)}${w === nW - 1 && (D % 7) !== 6 ? "*" : ""}</th>`;
  html += `</tr></thead><tbody>`;
  for (const s of S) {
    const p = M.P[s.name];
    html += `<tr><td class="n">${esc(s.name)}</td>`;
    for (let w = 0; w < nW; w++) {
      const a = w * 7, b = Math.min(D, a + 6), days = b - a + 1;
      const tot = p.cum[b] - (a ? p.cum[a - 1] : 0), pct = tot / (CFG.min * days);
      let bg, fg;
      if (pct >= 1) { const t = Math.min(1, (pct - 1) / 1); bg = `rgba(27,26,23,${(0.55 + 0.45 * t).toFixed(2)})`; fg = "#f6f1e7"; }
      else if (pct > 0) { bg = `rgba(179,38,30,${(0.12 + 0.6 * (1 - pct)).toFixed(2)})`; fg = pct < .5 ? "#fff" : "var(--red)"; }
      else { bg = "var(--paper-2)"; fg = "var(--muted)"; }
      html += `<td class="v" style="background:${bg};color:${fg}" title="${esc(s.name)} · week of ${fmtDate(a)}: ${num(tot)} sec of ${num(CFG.min * days)}">${pct ? Math.round(pct * 100) + "%" : "–"}</td>`;
    }
    html += `</tr>`;
  }
  $("#weekly").innerHTML = html + `</tbody></table>`;
}

function renderProfile() {
  const { M, D } = state;
  if (!state.profileDefault) state.profileDefault = M.names.map(n => statsAt(M.P[n], state.maxD)).sort((a, b) => b.balance - a.balance)[0].name;
  const name = state.sel || state.profileWho || state.profileDefault;
  $("#who").value = name;
  const p = M.P[name], s = statsAt(p, D);
  const es = p.entries.filter(e => e.idx <= D);
  const longest = es.reduce((a, e) => Math.max(a, e.sec), 0);
  const w = Math.min(14, D + 1), recent = (p.cum[D] - (D - w >= 0 ? p.cum[D - w] : 0)) / w;
  let proj;
  if (s.total >= CFG.goal) proj = `${esc(name)} has already crossed the 32,400-second finish line. 🎉`;
  else if (recent <= 0) proj = `No planks logged in the last ${w} days. Whenever you're ready, every plank moves you closer: ${num(CFG.goal - s.total)} seconds to the finish line.`;
  else {
    const daysNeeded = Math.ceil((CFG.goal - s.total) / recent), fin = D + daysNeeded;
    proj = `At the recent pace of ${mmss(recent)}/day, ${esc(name)} ${fin <= CFG.days - 1 ? `crosses the finish line on <b>${fmtDateLong(fin)}</b>` : `is on track to finish ${num(fin - CFG.days + 1)} days after the spring equinox. About ${mmss((CFG.goal - s.total) / Math.max(1, CFG.days - 1 - D))}/day would land it right on March 20`}.`;
  }
  $("#profile").innerHTML = `
    <div class="prof-top">
      <div class="stat"><div class="lab">Balance</div><div class="val ${s.balance < 0 ? "red" : ""}">${bal(s.balance)}</div></div>
      <div class="stat"><div class="lab">Avg / day</div><div class="val">${mmss(s.total / (D + 1))}</div></div>
      <div class="stat"><div class="lab">Total</div><div class="val">${hrs(s.total)} h</div></div>
      <div class="stat"><div class="lab">Days in black</div><div class="val">${s.black}</div></div>
      <div class="stat"><div class="lab">Streak · best</div><div class="val">${s.streak} · ${s.best}</div></div>
      <div class="stat"><div class="lab">Longest plank</div><div class="val">${mmss(longest)}</div></div>
    </div>
    <div class="chart" id="pchart"></div>
    <p class="proj">${proj}</p>`;
  // daily bars with balance line
  const box = $("#pchart"), W = Math.max(300, box.clientWidth), H = 220, m = { l: 40, r: 50, t: 10, b: 24 };
  const N = D + 1, bw = (W - m.l - m.r) / N;
  const maxV = Math.max(CFG.min * 1.5, ...Array.from(p.daily.slice(0, N)));
  const y = scale(0, maxV, H - m.b, m.t);
  const balArr = []; for (let i = 0; i < N; i++) balArr.push(p.cum[i] - CFG.min * (i + 1));
  const bl = Math.min(0, ...balArr), bh = Math.max(0, ...balArr), yb = scale(bl, bh || 1, H - m.b, m.t);
  const svg = svgBox(box, W, H);
  for (const t of niceTicks(0, maxV, 4)) el("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end" }, svg).textContent = mmss(t);
  for (let i = 0; i < N; i++) {
    const v = p.daily[i];
    const r = el("rect", { x: m.l + i * bw + bw * .12, y: v ? y(v) : H - m.b - 2, width: Math.max(1, bw * .76), height: v ? H - m.b - y(v) : 2, rx: Math.min(2, bw / 4), fill: v >= CFG.min ? "var(--ink)" : "var(--red)", opacity: v ? .9 : .5 }, svg);
    r.addEventListener("mousemove", e => showTip(e, `<b>${fmtDateLong(i)}</b><br>${v ? mmss(v) : "No plank"} · balance <span class="${balArr[i] < 0 ? "neg" : ""}">${bal(balArr[i])}</span>`));
    r.addEventListener("mouseleave", hideTip);
  }
  el("line", { x1: m.l, x2: W - m.r, y1: y(CFG.min), y2: y(CFG.min), stroke: "var(--gold)", "stroke-dasharray": "4 3", "stroke-width": 1.4 }, svg);
  el("text", { x: W - m.r + 6, y: y(CFG.min) + 4, style: "fill:var(--gold);font-weight:600" }, svg).textContent = "3:00";
  const bp = balArr.map((v, i) => `${i ? "L" : "M"}${m.l + i * bw + bw / 2},${yb(v)}`).join("");
  el("path", { d: bp, fill: "none", stroke: s.balance < 0 ? "var(--red)" : "var(--ink)", "stroke-width": 2, opacity: .55, "stroke-dasharray": "1 0", "pointer-events": "none" }, svg);
  el("text", { x: W - m.r + 6, y: yb(balArr[N - 1]) + 4, style: `fill:${s.balance < 0 ? "var(--red)" : "var(--ink)"}` }, svg).textContent = "balance";
  const step = N > 120 ? 28 : N > 50 ? 14 : 7;
  for (let i = 0; i < N; i += step) el("text", { x: m.l + i * bw + bw / 2, y: H - 6, "text-anchor": "middle" }, svg).textContent = fmtDate(i);
}

function renderChatter() {
  const { M, D } = state;
  const notes = M.entries.filter(e => e.idx <= D && e.note && !/^\d+$/.test(e.note))
    .sort((a, b) => (b.tsDay - a.tsDay) || ((b.hour * 60 + b.min) - (a.hour * 60 + a.min)));
  const seen = new Set(), out = [];
  for (const e of notes) { const k = e.who + "|" + e.note; if (seen.has(k)) continue; seen.add(k); out.push(e); if (out.length >= 30) break; }
  $("#chatter").innerHTML = out.map(e => `<div class="msg"><span class="who">${esc(e.who)}</span><span class="when">${fmtDate(e.tsDay - START < 0 ? 0 : Math.min(e.tsDay - START, CFG.days - 1))}</span><div class="txt">${esc(e.note)}</div></div>`).join("") || `<p class="note">No messages yet.</p>`;
}

// ---------- Orchestration ----------
let raf = 0;
function renderAll() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const { M, D } = state;
    const S = M.names.map(n => statsAt(M.P[n], D));
    $("#dayLabel").textContent = `Day ${D + 1}`;
    $("#dateLabel").textContent = fmtDateLong(D);
    renderKPIs(S); renderLedger(S); renderDonut(S); renderAwards(S);
    renderRace(); renderHeat(); renderVolume(); renderClock(); renderWeekly(); renderProfile(); renderChatter();
  });
}
function setDay(i) { state.D = clamp(i, 0, state.maxD); $("#day").value = state.D + 1; renderAll(); }
function select(n) {
  state.sel = n;
  if (n) state.profileWho = n;
  renderAll();
}

function wire() {
  const M = state.M;
  $("#day").max = state.maxD + 1; $("#day").value = state.D + 1;
  $("#day").oninput = e => { stop(); setDay(+e.target.value - 1); };
  $("#who").innerHTML = M.names.map(n => `<option>${esc(n)}</option>`).join("");
  $("#who").onchange = e => select(e.target.value);
  document.querySelectorAll("#sortSeg button").forEach(b => b.onclick = () => {
    state.sort = b.dataset.sort; document.querySelectorAll("#sortSeg button").forEach(x => x.classList.toggle("on", x === b)); renderAll();
  });
  document.querySelectorAll("#raceSeg button").forEach(b => b.onclick = () => {
    state.race = b.dataset.mode; document.querySelectorAll("#raceSeg button").forEach(x => x.classList.toggle("on", x === b)); renderAll();
  });
  $("#play").onclick = () => state.playing ? stop() : play();
  let rw; addEventListener("resize", () => { clearTimeout(rw); rw = setTimeout(renderAll, 120); });
}
function play() {
  if (state.D >= state.maxD) state.D = 0;
  $("#play").textContent = "❚❚ Pause";
  const tick = () => { if (state.D >= state.maxD) return stop(); setDay(state.D + 1); };
  setDay(state.D);
  state.playing = setInterval(tick, Math.max(60, 6000 / state.maxD));
}
function stop() { clearInterval(state.playing); state.playing = null; $("#play").textContent = "▶ Replay"; }

async function fetchText(url, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, cache: "no-store" }); if (!r.ok) throw new Error(r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
async function load() {
  let rows = null, live = false;
  const force = new URLSearchParams(location.search).get("data");
  if (force !== "snapshot") {
    try {
      const txt = await fetchText(CFG.liveUrl, 7000);
      const r = parseCSV(txt);
      if (r.length > 1 && /planker/i.test(r[0].join(","))) { rows = r; live = true; }
    } catch (e) { /* not public or offline — fall back */ }
  }
  if (!rows) rows = parseCSV(await fetchText(CFG.snapshot, 10000));
  const M = buildModel(rows);
  state.M = M; state.live = live;
  const todayLocal = (() => { const d = new Date(); return dayNum(d.getFullYear(), d.getMonth() + 1, d.getDate()); })();
  const ref = live ? Math.max(todayLocal, M.lastTs) : M.lastTs;
  state.maxD = clamp(ref - START, 0, CFG.days - 1);
  state.D = state.maxD;
  const lastSub = M.entries.reduce((a, e) => (e.tsDay > a.tsDay || (e.tsDay === a.tsDay && e.hour * 60 + e.min > a.hour * 60 + a.min)) ? e : a, M.entries[0]);
  $("#source").innerHTML = `<span class="dot${live ? " live" : ""}"></span>${live ? "Live from the Google Sheet" : "Snapshot data"} · ${num(M.entries.length)} planks logged · last entry ${esc(lastSub.tsRaw)}`;
  wire(); renderAll();
}
load().catch(err => { $("#source").textContent = "Couldn't load data: " + err.message; console.error(err); });
})();
