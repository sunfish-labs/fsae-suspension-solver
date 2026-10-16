// 67_chassis.js - A chassis (or any other) model from CAD shown see-through in the 3D view, to check packaging by eye.
// STL (binary or text) or OBJ, read in the browser and kept in this browser (IndexedDB) between visits; never uploaded.
const chassis = {
  buf: null,
  name: "",
  ext: "stl",
  tris: 0,
  mesh: null,
  base: null, // the model in the car frame before the move / rotate (mm), and its bounding-box center
  c0: [0, 0, 0],
  opts: { frame: "sw", units: "mm", origin: "axle", opacity: 0.3, show: true, off: [0, 0, 0], rot: [0, 0, 0] },
};
const CH_UNITS = { mm: 1, in: 25.4, m: 1000 };

function parseSTL(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (n > 0 && 84 + n * 50 === buf.byteLength) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) for (let j = 0; j < 9; j++) out[i * 9 + j] = dv.getFloat32(84 + i * 50 + 12 + j * 4, true);
      return out;
    }
  }
  const txt = new TextDecoder().decode(buf),
    re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g,
    v = [];
  let m;
  while ((m = re.exec(txt))) v.push(+m[1], +m[2], +m[3]);
  if (!v.length || v.length % 9 || v.some(x => !Number.isFinite(x)))
    throw new Error("This doesn't read as an STL file (no triangles found).");
  return new Float32Array(v);
}
function parseOBJ(buf) {
  const txt = new TextDecoder().decode(buf),
    V = [],
    out = [];
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "v") V.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === "f") {
      const ix = t.slice(1).map(s => {
        const k = parseInt(s, 10);
        return k < 0 ? V.length + k : k - 1;
      });
      for (let i = 1; i + 1 < ix.length; i++)
        for (const k of [ix[0], ix[i], ix[i + 1]]) {
          const p = V[k];
          if (!p) throw new Error("This OBJ file has a face that points at a missing vertex.");
          out.push(p[0], p[1], p[2]);
        }
    }
  }
  if (!out.length) throw new Error("No faces found in this OBJ file.");
  return new Float32Array(out);
}
// the model's frame and units -> the solver frame of the front corner (X forward, Y right, Z up, mm). Every export
// frame is its own inverse (a swap or a sign flip), so the same map takes CAD back to the solver.
function chassisSolverPoints() {
  const src = chassis.ext === "obj" ? parseOBJ(chassis.buf) : parseSTL(chassis.buf),
    f = window.SuspCAD.FRAMES[chassis.opts.frame].f,
    k = CH_UNITS[chassis.opts.units] || 1,
    fr = car ? car.front : cfg,
    x0 = chassis.opts.origin === "axle" && fr ? fr.hardpoints.contact_patch[0] : 0;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const q = f([src[i] * k, src[i + 1] * k, src[i + 2] * k]);
    out[i] = q[0] + x0;
    out[i + 1] = q[1];
    out[i + 2] = q[2];
  }
  return out;
}
function chassisInfo(P) {
  const [lo, hi] = bbox(P),
    L = hi[0] - lo[0],
    W = hi[1] - lo[1],
    H = hi[2] - lo[2],
    mid = (hi[1] + lo[1]) / 2;
  let note = `${fmt(L, 0)} mm long, ${fmt(W, 0)} mm wide, ${fmt(H, 0)} mm tall; lowest point ${fmt(lo[2], 0)} mm above the ground; centered ${fmt(Math.abs(mid), 0)} mm ${mid >= 0 ? "right" : "left"} of the car centerline.`;
  if (Math.max(L, W, H) < 300) note += " That is very small: check the units.";
  else if (Math.max(L, W, H) > 8000) note += " That is very large: check the units.";
  else if (W > L * 1.3 || H > L) note += " It looks rotated: try another axes setting.";
  return note;
}
// the move: R = Rz(yaw) Ry(pitch) Rx(roll) about the model's center c0, then the offset (car frame, mm / deg)
function chRot() {
  const [a, b, c] = chassis.opts.rot.map(d => (d * Math.PI) / 180),
    [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
    [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
    [-sb, cb * sa, cb * ca],
  ];
}
function chMoved() {
  const P = chassis.base,
    R = chRot(),
    c = chassis.c0,
    o = chassis.opts.off,
    out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i] - c[0],
      y = P[i + 1] - c[1],
      z = P[i + 2] - c[2];
    for (let j = 0; j < 3; j++) out[i + j] = R[j][0] * x + R[j][1] * y + R[j][2] * z + c[j] + o[j];
  }
  return out;
}
function bbox(P) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3)
    for (let j = 0; j < 3; j++) {
      lo[j] = Math.min(lo[j], P[i + j]);
      hi[j] = Math.max(hi[j], P[i + j]);
    }
  return [lo, hi];
}
function buildChassisMesh() {
  if (!three) return;
  if (chassis.mesh) {
    three.scene.remove(chassis.mesh);
    chassis.mesh.geometry.dispose();
    chassis.mesh.material.dispose();
    chassis.mesh = null;
  }
  if (!chassis.buf) return;
  const T = three.T,
    P = (chassis.base = chassisSolverPoints()),
    [lo, hi] = bbox(P),
    c = (chassis.c0 = lo.map((v, j) => (v + hi[j]) / 2)),
    pos = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    // centered on the model's middle so rotations turn it in place; same axis mapping as toT
    pos[i] = P[i] - c[0];
    pos[i + 1] = P[i + 2] - c[2];
    pos[i + 2] = P[i + 1] - c[1];
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const mat = new T.MeshStandardMaterial({
    color: 0x8a96a3,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    opacity: chassis.opts.opacity,
    depthWrite: false,
    side: T.DoubleSide,
  });
  chassis.mesh = new T.Mesh(g, mat);
  chassis.mesh.renderOrder = -1;
  chassis.mesh.name = "chassis";
  chassis.tris = P.length / 9;
  three.scene.add(chassis.mesh);
  placeChassis();
}
// the mesh lives in the front corner's frame; the rear corner view is one wheelbase further forward
function placeChassis() {
  if (!three || !chassis.mesh) return;
  const carView = car && axleView === "car" && !chal,
    rearView = !carView && cfg && cfg.axle === "rear",
    wb = ((car && car.vehicle) || (cfg && cfg.vehicle) || {}).wheelbase || 1550;
  const c = chassis.c0,
    o = chassis.opts.off,
    r = chassis.opts.rot.map(d => (d * Math.PI) / 180),
    dx = rearView ? wb : 0;
  // vehicle (x, y, z) -> three (x, z, y), a reflection, so each rotation turns the other way in three.js:
  // vehicle Rz(yaw) Ry(pitch) Rx(roll) -> three Ry(-yaw) Rz(-pitch) Rx(-roll), Euler order YZX
  chassis.mesh.position.set(c[0] + o[0] + dx, c[2] + o[2], c[1] + o[1]);
  chassis.mesh.rotation.set(-r[0], -r[2], -r[1], "YZX");
  chassis.mesh.userData.dx = dx;
  if (chassis.clear) chStale();
  if (three.chHit) {
    const h = chassis.hit,
      at =
        h &&
        Math.abs(pose.dz - h.hz) < 1e-6 &&
        (h.corner[0] === "R" || Math.abs(pose.rack - h.rk) < 1e-6 || Math.abs(pose.rack + h.rk) < 1e-6);
    three.chHit.position.x = dx;
    three.chHit.visible = !!at && chassis.opts.show;
  }
  chassis.mesh.visible = chassis.opts.show;
  chassis.mesh.material.opacity = chassis.opts.opacity;
  $("#tgChassis").hidden = false;
  $("#tgChassis").setAttribute("aria-pressed", String(chassis.opts.show));
  three.need = true;
}

// ---- kept in this browser between visits
function chDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("susp-chassis", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("m");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
// the file is stored once when it is loaded (withFile); every move after that only rewrites the small settings record
async function chSave(withFile = false) {
  try {
    const db = await chDB(),
      tx = db.transaction("m", "readwrite"),
      st = tx.objectStore("m");
    if (!chassis.buf) {
      st.delete("model");
      st.delete("opts");
    } else {
      if (withFile) st.put({ buf: chassis.buf, name: chassis.name, ext: chassis.ext }, "model");
      st.put(chassis.opts, "opts");
    }
  } catch (e) {
    /* private window or storage off: the model just isn't remembered */
  }
}
async function chLoadSaved() {
  try {
    const db = await chDB(),
      get = k =>
        new Promise(res => {
          const r = db.transaction("m").objectStore("m").get(k);
          r.onsuccess = () => res(r.result);
          r.onerror = () => res(null);
        }),
      v = await get("model"),
      o = await get("opts");
    if (v && v.buf) {
      Object.assign(chassis, { buf: v.buf, name: v.name, ext: v.ext });
      Object.assign(chassis.opts, o || v.opts || {});
      if (!Array.isArray(chassis.opts.off)) chassis.opts.off = [0, 0, 0];
      if (!Array.isArray(chassis.opts.rot)) chassis.opts.rot = [0, 0, 0];
      buildChassisMesh();
    }
  } catch (e) {
    /* nothing saved */
  }
}

// ---- the dialog
function chSync() {
  const has = !!chassis.buf;
  $("#fmName").textContent = has ? `${chassis.name} · ${chassis.tris.toLocaleString()} triangles` : "";
  chMoveFields();
  $("#fmInfo").textContent = has && chassis.base ? chassisInfo(chMoved()) : has ? "" : "No model loaded.";
  for (const [k, id] of [
    ["frame", "#fmFrame"],
    ["units", "#fmUnits"],
    ["origin", "#fmOrigin"],
  ])
    $(id).value = chassis.opts[k];
  $("#fmOp").value = chassis.opts.opacity;
  $("#fmShow").checked = chassis.opts.show;
  $("#tgChassis").hidden = !has;
}
const CH_MOVE = [
  ["off", 0, "X", "mm", "forward"],
  ["off", 1, "Y", "mm", "right"],
  ["off", 2, "Z", "mm", "up"],
  ["rot", 0, "Roll", "°", "about X"],
  ["rot", 1, "Pitch", "°", "about Y"],
  ["rot", 2, "Yaw", "°", "about Z"],
];
function chMoveFields() {
  const box = $("#fmMove");
  if (!box.children.length)
    box.innerHTML = CH_MOVE.map(
      ([k, i, lab, u, hint]) =>
        `<label for="fmm_${k}${i}" title="${attr(hint)}">${lab}</label><button class="btn small icon" type="button" data-chn="${k}${i}" data-sg="-1" aria-label="${attr(lab)} minus">−</button><input class="num" id="fmm_${k}${i}" type="number" step="any" data-chm="${k}${i}"><button class="btn small icon" type="button" data-chn="${k}${i}" data-sg="1" aria-label="${attr(lab)} plus">+</button><span class="u">${u} ${hint}</span>`
    ).join("");
  for (const [k, i] of CH_MOVE) $(`#fmm_${k}${i}`).value = +chassis.opts[k][i].toFixed(3);
}
function chStale() {
  if (chassis.clear && $("#fmClearNote"))
    $("#fmClearNote").textContent =
      chassis.clear.sig === chSignature() ? "" : "The design or the model moved since this check: run it again.";
}
let chInfoRaf = 0;
function chApplyMove() {
  chStale();
  placeChassis();
  // the size readout moves every vertex: once per frame at most
  cancelAnimationFrame(chInfoRaf);
  chInfoRaf = requestAnimationFrame(() => chassis.base && ($("#fmInfo").textContent = chassisInfo(chMoved())));
  chSave();
}
function openChassis() {
  $("#fmFrame").innerHTML = Object.entries(window.SuspCAD.FRAMES)
    .map(([k, f]) => `<option value="${attr(k)}">${esc(f.label)}</option>`)
    .join("");
  chSync();
  $("#fmDlg").hidden = false;
  setTimeout(() => $("#fmPick").focus(), 0);
}
function wireChassis() {
  $("#fmClose").addEventListener("click", () => ($("#fmDlg").hidden = true));
  $("#fmDlg").addEventListener("click", e => {
    if (e.target.id === "fmDlg") $("#fmDlg").hidden = true;
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("#fmDlg").hidden) $("#fmDlg").hidden = true;
  });
  $("#fmPick").addEventListener("click", () => $("#fmFile").click());
  $("#fmFile").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const ext = /\.obj$/i.test(f.name) ? "obj" : "stl";
    try {
      const buf = await busy(f.arrayBuffer());
      (ext === "obj" ? parseOBJ : parseSTL)(buf); // check it reads before replacing the current model
      Object.assign(chassis, { buf, name: f.name, ext });
      chassis.opts.show = true;
      chassis.opts.off = [0, 0, 0];
      chassis.opts.rot = [0, 0, 0];
      chassis.clear = null;
      chDrawHit(null);
      chRenderClear(null);
      buildChassisMesh();
      chSave(true);
      chSync();
      if (!three) $("#fmInfo").textContent = "Loaded, but the 3D view is not available in this browser.";
    } catch (er) {
      $("#fmInfo").textContent = "That file did not load: " + er.message;
    }
  });
  const change = () => {
    chassis.opts.frame = $("#fmFrame").value;
    chassis.opts.units = $("#fmUnits").value;
    chassis.opts.origin = $("#fmOrigin").value;
    buildChassisMesh();
    chSave();
    chSync();
  };
  ["#fmFrame", "#fmUnits", "#fmOrigin"].forEach(id => $(id).addEventListener("change", change));
  $("#fmMove").addEventListener("input", e => {
    const m = e.target.dataset.chm;
    if (!m || e.target.value === "" || !Number.isFinite(+e.target.value)) return;
    chassis.opts[m.slice(0, 3)][+m[3]] = +e.target.value;
    chApplyMove();
  });
  $("#fmMove").addEventListener("click", e => {
    const b = e.target.closest("[data-chn]");
    if (!b) return;
    const k = b.dataset.chn.slice(0, 3),
      i = +b.dataset.chn[3],
      st = +$("#fmStep").value,
      d = k === "off" ? st : { 1: 0.5, 10: 5, 100: 90 }[st];
    chassis.opts[k][i] = +(chassis.opts[k][i] + +b.dataset.sg * d).toFixed(3);
    chMoveFields();
    chApplyMove();
  });
  $("#fmCenter").addEventListener("click", () => {
    if (!chassis.base) return;
    const [lo, hi] = bbox(chMoved());
    chassis.opts.off[1] = +(chassis.opts.off[1] - (lo[1] + hi[1]) / 2).toFixed(3);
    chMoveFields();
    chApplyMove();
  });
  $("#fmGround").addEventListener("click", () => {
    if (!chassis.base) return;
    const [lo] = bbox(chMoved());
    chassis.opts.off[2] = +(chassis.opts.off[2] + (+$("#fmGap").value || 0) - lo[2]).toFixed(3);
    chMoveFields();
    chApplyMove();
  });
  $("#fmZero").addEventListener("click", () => {
    chassis.opts.off = [0, 0, 0];
    chassis.opts.rot = [0, 0, 0];
    chMoveFields();
    chApplyMove();
  });
  $("#fmOp").addEventListener("input", () => {
    chassis.opts.opacity = +$("#fmOp").value;
    placeChassis();
    chSave();
  });
  $("#fmShow").addEventListener("change", () => {
    chassis.opts.show = $("#fmShow").checked;
    placeChassis();
    chSave();
  });
  $("#fmCheck").addEventListener("click", async () => {
    if (!chassis.base) return;
    const b = $("#fmCheck");
    b.disabled = true;
    $("#fmClearNote").textContent = "Checking…";
    try {
      chassis.clear = await busy(chClearance());
      chRenderClear(chassis.clear);
      $("#fmClearNote").textContent = "";
    } catch (er) {
      $("#fmClearNote").textContent = "The check failed: " + er.message;
    }
    b.disabled = false;
  });
  $("#fmRemove").addEventListener("click", () => {
    chassis.clear = null;
    chDrawHit(null);
    chRenderClear(null);
    $("#fmClearNote").textContent = "";
    chassis.buf = null;
    buildChassisMesh();
    chSave();
    chSync();
    if (three) three.need = true;
  });
  $("#tgChassis").addEventListener("click", () => {
    chassis.opts.show = !chassis.opts.show;
    placeChassis();
    chSave();
  });
  chLoadSaved();
}
window.__suspChassis = () => ({ chassis, moved: chMoved, clearance: chClearance, corners: chCorners, tireShape: chTireShape }); // used by the browser tests

// ---- clearance from every link to the chassis model, over the travel and rack range, both sides, both axles
// closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9)
function chSegSeg(p1, q1, p2, q2) {
  const d1 = V.sub(q1, p1),
    d2 = V.sub(q2, p2),
    r = V.sub(p1, p2),
    a = V.dot(d1, d1),
    e = V.dot(d2, d2),
    f = V.dot(d2, r),
    cl = v => Math.min(1, Math.max(0, v));
  let s, t;
  if (a < 1e-12 && e < 1e-12) [s, t] = [0, 0];
  else if (a < 1e-12) [s, t] = [0, cl(f / e)];
  else {
    const c = V.dot(d1, r);
    if (e < 1e-12) [s, t] = [cl(-c / a), 0];
    else {
      const b = V.dot(d1, d2),
        den = a * e - b * b;
      s = den > 1e-12 ? cl((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) [t, s] = [0, cl(-c / a)];
      else if (t > 1) [t, s] = [1, cl((b - c) / a)];
    }
  }
  return [V.add(p1, V.mul(d1, s)), V.add(p2, V.mul(d2, t))];
}
// closest point on triangle abc to p (Ericson 5.1.5)
function chPtTri(p, a, b, c) {
  const ab = V.sub(b, a),
    ac = V.sub(c, a),
    ap = V.sub(p, a),
    d1 = V.dot(ab, ap),
    d2 = V.dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = V.sub(p, b),
    d3 = V.dot(ab, bp),
    d4 = V.dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return V.add(a, V.mul(ab, d1 / (d1 - d3)));
  const cp = V.sub(p, c),
    d5 = V.dot(ab, cp),
    d6 = V.dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return V.add(a, V.mul(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return V.add(b, V.mul(V.sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const den = 1 / (va + vb + vc);
  return V.add(a, V.add(V.mul(ab, vb * den), V.mul(ac, vc * den)));
}
// closest points between segment p-q and triangle abc: [distance, point on segment, point on triangle]
function chSegTri(p, q, a, b, c) {
  // the segment crossing the triangle (Moller-Trumbore, t in [0, 1])
  const d = V.sub(q, p),
    e1 = V.sub(b, a),
    e2 = V.sub(c, a),
    h = V.cross(d, e2),
    det = V.dot(e1, h);
  if (Math.abs(det) > 1e-12) {
    const f = 1 / det,
      s = V.sub(p, a),
      u = f * V.dot(s, h),
      qq = V.cross(s, e1),
      v = f * V.dot(d, qq),
      t = f * V.dot(e2, qq);
    if (u >= 0 && v >= 0 && u + v <= 1 && t >= 0 && t <= 1) {
      const x = V.add(p, V.mul(d, t));
      return [0, x, x];
    }
  }
  let best = null;
  const take = (x, y) => {
    const dd = V.norm(V.sub(x, y));
    if (!best || dd < best[0]) best = [dd, x, y];
  };
  take(p, chPtTri(p, a, b, c));
  take(q, chPtTri(q, a, b, c));
  for (const [u0, u1] of [
    [a, b],
    [b, c],
    [c, a],
  ]) {
    const [x, y] = chSegSeg(p, q, u0, u1);
    take(x, y);
  }
  return best;
}
// triangles of the moved model bucketed in a uniform grid, so each link only looks at the triangles near it
function chBuildGrid(P, cell) {
  const map = new Map(),
    key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  for (let t = 0; t < P.length / 9; t++) {
    const o = t * 9,
      lo = [0, 1, 2].map(j => Math.floor(Math.min(P[o + j], P[o + 3 + j], P[o + 6 + j]) / cell)),
      hi = [0, 1, 2].map(j => Math.floor(Math.max(P[o + j], P[o + 3 + j], P[o + 6 + j]) / cell));
    for (let i = lo[0]; i <= hi[0]; i++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let k = lo[2]; k <= hi[2]; k++) {
          const kk = key(i, j, k);
          let l = map.get(kk);
          if (!l) map.set(kk, (l = []));
          l.push(t);
        }
  }
  // a bounding sphere per triangle: most triangles near a link are skipped without the exact test
  const n = P.length / 9,
    C = new Float64Array(n * 3),
    R = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    for (let j = 0; j < 3; j++) C[t * 3 + j] = (P[o + j] + P[o + 3 + j] + P[o + 6 + j]) / 3;
    for (let v = 0; v < 3; v++)
      R[t] = Math.max(R[t], Math.hypot(P[o + v * 3] - C[t * 3], P[o + v * 3 + 1] - C[t * 3 + 1], P[o + v * 3 + 2] - C[t * 3 + 2]));
  }
  return { map, cell, key, stamp: new Uint32Array(n), gen: 0, C, R };
}
// closest approach of segment p-q to the model within `reach` mm (null if farther); brute = check every triangle
function chNearest(P, G, p, q, reach, brute = false) {
  let best = null;
  const d = V.sub(q, p),
    dd = V.dot(d, d);
  const test = t => {
    if (!brute && G && G.C) {
      // distance from the segment to the triangle's bounding sphere: skip it if it can't beat what we have
      const c = [G.C[t * 3], G.C[t * 3 + 1], G.C[t * 3 + 2]],
        u = dd > 1e-12 ? Math.min(1, Math.max(0, V.dot(V.sub(c, p), d) / dd)) : 0,
        lb = V.norm(V.sub(c, V.add(p, V.mul(d, u)))) - G.R[t];
      if (lb > reach || (best && lb >= best[0])) return;
    }
    const o = t * 9,
      r = chSegTri(p, q, [P[o], P[o + 1], P[o + 2]], [P[o + 3], P[o + 4], P[o + 5]], [P[o + 6], P[o + 7], P[o + 8]]);
    if (r[0] <= reach && (!best || r[0] < best[0])) best = r;
  };
  if (brute) {
    for (let t = 0; t < P.length / 9; t++) test(t);
    return best;
  }
  const c = G.cell,
    lo = [0, 1, 2].map(j => Math.floor((Math.min(p[j], q[j]) - reach) / c)),
    hi = [0, 1, 2].map(j => Math.floor((Math.max(p[j], q[j]) + reach) / c)),
    gen = ++G.gen;
  for (let i = lo[0]; i <= hi[0]; i++)
    for (let j = lo[1]; j <= hi[1]; j++)
      for (let k = lo[2]; k <= hi[2]; k++) {
        const l = G.map.get(G.key(i, j, k));
        if (l)
          for (const t of l)
            if (G.stamp[t] !== gen) {
              G.stamp[t] = gen;
              test(t);
            }
      }
  return best;
}
const CH_REACH = 150; // gaps larger than this are reported as "more than 150 mm"
// ---- the tire as drawn: a solid cylinder with rounded shoulders. That solid is convex: a core cylinder (radius
// R - rnd, half width w/2 - rnd) grown by a ball of radius rnd, so its distance to a triangle is the core's
// distance minus rnd, and alternating projections between the triangle and the core converge to the closest pair.
function chTireShape(e, p, side) {
  const s = e.susp,
    w = +e.cfg.wheel.tire_width || 190,
    rr = ((+e.cfg.wheel.rim_diameter_in || 13) * 25.4) / 2,
    R = s.R,
    rnd = Math.min(28, (R - rr) / 2),
    m = v => (side === "R" ? v : [v[0], -v[1], v[2]]);
  return { c: m(p.c), a: m(p.a), rc: R - rnd, hc: w / 2 - rnd, rnd, R, w };
}
function chProjCore(x, T) {
  const v = V.sub(x, T.c),
    ax = V.dot(v, T.a),
    rv = V.sub(v, V.mul(T.a, ax)),
    r = V.norm(rv),
    aa = Math.min(T.hc, Math.max(-T.hc, ax));
  return V.add(V.add(T.c, V.mul(T.a, aa)), r > T.rc ? V.mul(rv, T.rc / r) : rv);
}
// closest approach of triangle abc to the tire: [gap (negative = inside), point on the tire, point on the triangle]
function chTireTri(T, a, b, c) {
  let x = chPtTri(T.c, a, b, c),
    y = chProjCore(x, T),
    d = V.norm(V.sub(x, y));
  for (let i = 0; i < 80 && d > 1e-9; i++) {
    const x2 = chPtTri(y, a, b, c),
      y2 = chProjCore(x2, T),
      d2 = V.norm(V.sub(x2, y2));
    const done = d - d2 < 1e-7;
    [x, y, d] = [x2, y2, d2];
    if (done) break;
  }
  const onTire = d > 1e-9 ? V.add(y, V.mul(V.sub(x, y), T.rnd / d)) : x;
  return [d - T.rnd, onTire, x];
}
// the closest the tire comes to the model, within reach (null if farther)
function chTireNearest(P, G, T, reach, brute = false) {
  let best = null;
  if (brute) {
    for (let o = 0; o < P.length; o += 9) {
      const r = chTireTri(T, [P[o], P[o + 1], P[o + 2]], [P[o + 3], P[o + 4], P[o + 5]], [P[o + 6], P[o + 7], P[o + 8]]);
      if (r[0] <= reach && (!best || r[0] < best[0])) best = r;
    }
    return best;
  }
  const ext = T.R + T.rnd + reach,
    c = G.cell,
    lo = T.c.map(v => Math.floor((v - ext) / c)),
    hi = T.c.map(v => Math.floor((v + ext) / c)),
    gen = ++G.gen;
  for (let i = lo[0]; i <= hi[0]; i++)
    for (let j = lo[1]; j <= hi[1]; j++)
      for (let k = lo[2]; k <= hi[2]; k++) {
        const l = G.map.get(G.key(i, j, k));
        if (!l) continue;
        for (const t of l) {
          if (G.stamp[t] === gen) continue;
          G.stamp[t] = gen;
          const ct = [G.C[t * 3], G.C[t * 3 + 1], G.C[t * 3 + 2]],
            lb = V.norm(V.sub(ct, chProjCore(ct, T))) - T.rnd - G.R[t];
          if (lb > reach || (best && lb >= best[0])) continue;
          const o = t * 9,
            r = chTireTri(T, [P[o], P[o + 1], P[o + 2]], [P[o + 3], P[o + 4], P[o + 5]], [P[o + 6], P[o + 7], P[o + 8]]);
          if (r[0] <= reach && (!best || r[0] < best[0])) best = r;
        }
      }
  return best;
}
// the links of one corner at one pose (right-hand side, that corner's own frame): [name, a, b, radius]
function chLinks(e, x, hz, rk) {
  const s = e.susp,
    h = s.h,
    cl = e.cfg.clearance,
    o = s.observe(x, hz, rk),
    p = o._pts,
    rod = e.cfg.axle === "rear" ? "toe link" : "tie rod",
    wr = (cl.wishbone_tube_od || 15.9) / 2;
  const L = [
    [`lower leg to pivot X=${h.lif[0].toFixed(0)}`, h.lif, p.lb, wr],
    [`lower leg to pivot X=${h.lir[0].toFixed(0)}`, h.lir, p.lb, wr],
    [`upper leg to pivot X=${h.uif[0].toFixed(0)}`, h.uif, p.ub, wr],
    [`upper leg to pivot X=${h.uir[0].toFixed(0)}`, h.uir, p.ub, wr],
    [rod, p.tri, p.tro, (cl.tie_rod_od || 15.9) / 2],
  ];
  if (e.spring) {
    const st = e.spring.state(x);
    if (!e.spring.direct) {
      L.push(["pushrod", st.rod_out, st.rod_in, (cl.pushrod_od || 15.9) / 2]);
      // the rocker plate as drawn: its three edges
      const sp = e.spring;
      for (const [a, b] of [
        [sp.c, st.rod_in],
        [sp.c, st.damper_out],
        [st.rod_in, st.damper_out],
      ])
        L.push(["rocker (as drawn)", a, b, 6]);
    }
    L.push(["damper", st.damper_out, e.spring.dch, (cl.damper_od || 50) / 2]);
  }
  // the upright as drawn (stick tubes between its joints): a real upright is bulkier, so leave room
  for (const [a, b, r] of [
    [p.ub, p.lb, 13],
    [p.lb, p.tro, 9],
    [p.ub, p.c, 9],
    [p.lb, p.c, 9],
  ])
    L.push(["upright (as drawn)", a, b, r]);
  const parts = S.cornerParts(s, o);
  if (parts.caliper) L.push(["brake caliper envelope", parts.caliper.c, parts.caliper.c, parts.caliper.r]);
  if (parts.halfshaft) L.push(["halfshaft", parts.halfshaft.a, parts.halfshaft.b, parts.halfshaft.r]);
  return L;
}
function chCorners() {
  const list = car
    ? [
        ["F", carEvalCorner(car.front).ev],
        ["R", carEvalCorner(car.rear).ev],
      ]
    : [[cfg.axle === "rear" ? "R" : "F", ev]];
  const wb = ((car && car.vehicle) || cfg.vehicle).wheelbase || 1550;
  return list.filter(([, e]) => e).map(([ax, e]) => ({ ax, e, dx: ax === "R" ? -wb : 0 })); // dx: corner frame -> car frame
}
function chSignature() {
  return JSON.stringify([chCorners().map(c => c.e.cfg), chassis.name, chassis.tris, chassis.opts]);
}
async function chClearance({ brute = false } = {}) {
  if (!chassis.base) return null;
  const P = chMoved(),
    G = chBuildGrid(P, 60),
    rows = new Map();
  let n = 0;
  for (const { ax, e, dx } of chCorners()) {
    const sw = e.cfg.sweep,
      [D, B] = S.travelRange(e.cfg),
      heaves = S.heavePoints(D, B, +(sw.pack_heave_steps || 9)),
      racks = ax === "F" ? S.heavePoints(sw.rack_travel, sw.rack_travel, +(sw.pack_rack_steps || 7)) : [0];
    for (const [hz, rk, x] of e.susp.grid(heaves, racks))
      for (const [name, a0, b0, r] of chLinks(e, x, hz, rk))
        for (const side of ["R", "L"]) {
          // the left corner is the mirror image of the right one at the opposite rack position
          const m = v => [v[0] + dx, side === "R" ? v[1] : -v[1], v[2]],
            hit = chNearest(P, G, m(a0), m(b0), CH_REACH + r, brute),
            key = `${ax}${side} ${name}`,
            gap = hit ? hit[0] - r : Infinity,
            cur = rows.get(key);
          if (!cur || gap < cur.gap)
            rows.set(key, { key, corner: ax + side, name, gap, hz, rk: side === "R" ? rk : -rk, a: hit && hit[1], b: hit && hit[2], r });
          if (++n % 200 === 0) await new Promise(res => setTimeout(res, 0)); // keep the page responsive
        }
    // the tire over the same travel and steer, both sides
    for (const [hz, rk, x] of e.susp.grid(heaves, racks)) {
      const p = e.susp.observe(x, hz, rk)._pts;
      for (const side of ["R", "L"]) {
        const T = chTireShape(e, p, side);
        T.c = [T.c[0] + dx, T.c[1], T.c[2]];
        const hit = chTireNearest(P, G, T, CH_REACH, brute),
          key = `${ax}${side} tire`,
          gap = hit ? hit[0] : Infinity,
          cur = rows.get(key);
        if (!cur || gap < cur.gap)
          rows.set(key, {
            key,
            corner: ax + side,
            name: "tire",
            gap,
            hz,
            rk: side === "R" ? rk : -rk,
            a: hit && hit[1],
            b: hit && hit[2],
            r: 0,
          });
        await new Promise(res => setTimeout(res, 0));
      }
    }
  }
  const need = (chCorners()[0] || {}).e?.cfg.clearance.margin ?? 5;
  const out = [...rows.values()].sort((u, v) => u.gap - v.gap);
  return { rows: out, need, sig: chSignature(), worst: out[0] || null };
}
// the closest pair drawn in the 3D view while the pose is the one it was found at
function chDrawHit(hit) {
  if (!three) return;
  const T = three.T;
  if (three.chHit) {
    three.scene.remove(three.chHit);
    three.chHit.traverse(n => n.geometry && n.geometry.dispose());
    three.chHit = null;
  }
  chassis.hit = hit;
  if (!hit || !hit.a) return void (three.need = true);
  const g = new T.Group(),
    mat = new T.MeshBasicMaterial({ color: 0xd1342f, depthTest: false }),
    toW = v => new T.Vector3(v[0], v[2], v[1]); // car frame -> three.js, as toT
  for (const v of [hit.a, hit.b]) {
    const s = new T.Mesh(new T.SphereGeometry(6, 14, 10), mat);
    s.position.copy(toW(v));
    g.add(s);
  }
  g.add(
    new T.Line(
      new T.BufferGeometry().setFromPoints([toW(hit.a), toW(hit.b)]),
      new T.LineBasicMaterial({ color: 0xd1342f, depthTest: false })
    )
  );
  g.renderOrder = 10;
  three.chHit = g;
  three.scene.add(g);
  placeChassis();
}
function chRenderClear(res) {
  const box = $("#fmClear");
  if (!res) return void (box.innerHTML = "");
  const fr = res.rows.some(r => r.corner[0] === "F"),
    near = res.rows.filter(r => r.gap < CH_REACH),
    far = res.rows.length - near.length;
  box.innerHTML =
    (res.worst
      ? `<p class="note">Closest: <b class="${res.worst.gap >= res.need ? "ok" : "bad"}">${esc(res.worst.key)}, ${Number.isFinite(res.worst.gap) ? fmt(res.worst.gap, 1) + " mm" : `more than ${CH_REACH} mm`}</b> (needs ${fmt(res.need, 0)} mm, the clearance margin). Gap = tube surface to the model's surface. The tire is the solid drawn in the view (no growth at speed); the upright and rocker are checked as drawn, and real ones are bulkier, so leave room.</p>`
      : "") +
    (near.length
      ? `<div class="tbl-wrap"><table class="data"><thead><tr><th>Link</th><th class="n">Gap, mm</th><th>At travel${fr ? " / rack" : ""}</th><th></th></tr></thead><tbody>${near
          .map(
            (r, i) =>
              `<tr><td><button class="lnk" type="button" data-chhit="${i}" title="Show this pose and the closest points">${esc(r.key)}</button></td><td class="n">${r.gap <= -r.r + 1e-9 ? "touches" : fmt(r.gap, 1)}</td><td>${fmt(r.hz, 0)} mm${r.corner[0] === "F" ? `, rack ${fmt(r.rk, 0)} mm` : ""}</td><td>${r.gap >= res.need ? `<span class="pill ok">Clear</span>` : `<span class="pill bad">Too close</span>`}</td></tr>`
          )
          .join("")}</tbody></table></div>`
      : "") +
    (far ? `<p class="note">${far} more link${far > 1 ? "s" : ""} stay more than ${CH_REACH} mm from the model.</p>` : "");
  $$("[data-chhit]", box).forEach(b =>
    b.addEventListener("click", () => {
      const r = near[+b.dataset.chhit];
      const ax = r.corner[0] === "F" ? "front" : "rear";
      if (car && axleView !== "car" && axleView !== ax) setView(ax, { keepCam: true });
      setTravel(r.hz);
      if (r.corner[0] === "F") setRack(r.rk);
      else if (!(car && axleView === "car")) setRack(0);
      chDrawHit(r);
      updateScene();
    })
  );
}
