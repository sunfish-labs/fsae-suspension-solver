// 08_charts.js - Small SVG line charts used by every panel.
// ------------------------------------------------------------------ charts
function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) {
    const c = Number.isFinite(lo) ? lo : 0,
      d = Math.abs(c) * 0.05 || 1;
    lo = c - d;
    hi = c + d;
  }
  const span = hi - lo,
    step0 = span / n,
    mag = 10 ** Math.floor(Math.log10(step0)),
    r = step0 / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const a = Math.floor(lo / step) * step,
    b = Math.ceil(hi / step) * step,
    t = [];
  for (let v = a; v <= b + step * 1e-6; v += step) t.push(+v.toFixed(10));
  return { lo: a, hi: b, ticks: t, step };
}
function tickLabel(v, step) {
  const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return fmt(v, d);
}
function chart({ title, cap = "", series, xlabel = "", marker = null, band = null, h = 170 }) {
  const W = 320,
    H = h,
    l = 46,
    r = 10,
    t = 10,
    b = 30;
  const pts = series.flatMap(s => s.x.map((x, i) => [x, s.y[i]])).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return `<div class="chart"><h3>${esc(title)}</h3><p class="cap">No data.</p></div>`;
  let ylo = Math.min(...pts.map(p => p[1])),
    yhi = Math.max(...pts.map(p => p[1]));
  if (band) {
    if (band[0] != null) ylo = Math.min(ylo, band[0]);
    if (band[1] != null) yhi = Math.max(yhi, band[1]);
  }
  const pad = (yhi - ylo) * 0.08;
  const yt = niceTicks(ylo - pad, yhi + pad, 4);
  const xlo = Math.min(...pts.map(p => p[0])),
    xhi = Math.max(...pts.map(p => p[0])),
    xt = niceTicks(xlo, xhi, 5);
  const X = x => l + ((x - xt.lo) / (xt.hi - xt.lo)) * (W - l - r),
    Y = y => H - b - ((y - yt.lo) / (yt.hi - yt.lo)) * (H - t - b);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  if (band) {
    const y1 = Y(band[1] ?? yt.hi),
      y0 = Y(band[0] ?? yt.lo);
    s += `<rect x="${attr(l)}" y="${attr(Math.min(y0, y1))}" width="${attr(W - l - r)}" height="${attr(Math.abs(y0 - y1))}" fill="var(--ok)" opacity=".10"/>`;
  }
  for (const v of yt.ticks)
    s += `<line x1="${attr(l)}" x2="${attr(W - r)}" y1="${attr(Y(v))}" y2="${attr(Y(v))}" stroke="var(--line)" stroke-width="1"/><text x="${attr(l - 5)}" y="${attr(Y(v) + 3.5)}" font-size="10" text-anchor="end" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${tickLabel(v, yt.step)}</text>`;
  for (const v of xt.ticks)
    s += `<text x="${attr(X(v))}" y="${attr(H - b + 13)}" font-size="10" text-anchor="middle" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${tickLabel(v, xt.step)}</text>`;
  if (xt.lo < 0 && xt.hi > 0)
    s += `<line x1="${attr(X(0))}" x2="${attr(X(0))}" y1="${attr(t)}" y2="${attr(H - b)}" stroke="var(--muted)" stroke-width=".7" opacity=".6"/>`;
  s += `<text x="${attr((l + W - r) / 2)}" y="${attr(H - 3)}" font-size="10" text-anchor="middle" fill="var(--muted)">${esc(xlabel)}</text>`;
  series.forEach(sr => {
    const d = sr.x.map((x, i) => (Number.isFinite(sr.y[i]) ? `${X(x).toFixed(1)},${Y(sr.y[i]).toFixed(1)}` : null)).filter(Boolean);
    if (d.length)
      s += `<polyline points="${attr(d.join(" "))}" fill="none" stroke="${attr(sr.color)}" stroke-width="${attr(sr.w ?? 2)}" ${sr.dash ? `stroke-dasharray="${attr(sr.dash)}"` : ""} stroke-linejoin="round"/>`;
  });
  if (marker != null && marker >= xt.lo && marker <= xt.hi) {
    s += `<line x1="${attr(X(marker))}" x2="${attr(X(marker))}" y1="${attr(t)}" y2="${attr(H - b)}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3"/>`;
    const sr = series[series.length - 1];
    const yi = interp(sr.x, sr.y, marker);
    if (Number.isFinite(yi)) s += `<circle cx="${attr(X(marker))}" cy="${attr(Y(yi))}" r="3.5" fill="var(--accent)"/>`;
  }
  const named = series.filter(sr => sr.name);
  if (named.length > 1)
    named.forEach((sr, i) => {
      s += `<line x1="${attr(l + 6 + i * 92)}" x2="${attr(l + 20 + i * 92)}" y1="${attr(t + 6)}" y2="${attr(t + 6)}" stroke="${attr(sr.color)}" stroke-width="2" ${sr.dash ? `stroke-dasharray="${attr(sr.dash)}"` : ""}/><text x="${attr(l + 24 + i * 92)}" y="${attr(t + 9.5)}" font-size="10" fill="var(--ink)">${esc(sr.name)}</text>`;
    });
  return `<div class="chart"><h3>${esc(title)}</h3>${cap ? `<p class="cap">${cap}</p>` : ""}${s}</svg></div>`;
}
function interp(xs, ys, x) {
  for (let i = 1; i < xs.length; i++)
    if ((xs[i - 1] - x) * (xs[i] - x) <= 0) {
      const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
      return ys[i - 1] + f * (ys[i] - ys[i - 1]);
    }
  return NaN;
}
