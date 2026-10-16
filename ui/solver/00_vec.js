/* 00_vec.js: Vector helpers, SolveError and small linear algebra (Python: numpy and kinematics.py helpers). */
// ------------------------------------------------------------------ vector helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => mul(a, 1 / norm(a));
const perp = (v, k) => sub(v, mul(k, dot(v, k)));
const deg = r => (r * 180) / Math.PI,
  rad = d => (d * Math.PI) / 180;
const matvec = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
const clone = o => JSON.parse(JSON.stringify(o));

class SolveError extends Error {}

function rodrigues(rv) {
  const th = norm(rv);
  const k = th < 1e-12 ? rv : mul(rv, 1 / th);
  const K = [
    [0, -k[2], k[1]],
    [k[2], 0, -k[0]],
    [-k[1], k[0], 0],
  ];
  const K2 = [0, 1, 2].map(i => [0, 1, 2].map(j => K[i][0] * K[0][j] + K[i][1] * K[1][j] + K[i][2] * K[2][j]));
  const s = th < 1e-12 ? 1 : Math.sin(th),
    c = th < 1e-12 ? 0.5 : 1 - Math.cos(th);
  return [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) + s * K[i][j] + c * K2[i][j]));
}

function solveLinear(A, b) {
  // Gaussian elimination with partial pivoting
  const n = b.length,
    M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

function segDist(p1, q1, p2, q2) {
  const d1 = sub(q1, p1),
    d2 = sub(q2, p2),
    r = sub(p1, p2);
  const a = dot(d1, d1),
    e = dot(d2, d2),
    f = dot(d2, r),
    c = dot(d1, r),
    b = dot(d1, d2);
  const den = a * e - b * b;
  const clamp = v => Math.min(1, Math.max(0, v));
  let s = den > 1e-12 ? clamp((b * f - c * e) / den) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a);
  }
  return norm(sub(add(p1, mul(d1, s)), add(p2, mul(d2, t))));
}

function plane(p1, p2, p3) {
  const n = unit(cross(sub(p2, p1), sub(p3, p1)));
  return [n, dot(n, p1)];
}

function lineIntersect2d(p1, d1, p2, d2) {
  const det = d1[0] * -d2[1] - -d2[0] * d1[1];
  if (Math.abs(det) < 1e-12) return null;
  const bx = p2[0] - p1[0],
    by = p2[1] - p1[1];
  const t = (bx * -d2[1] - -d2[0] * by) / det;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}
