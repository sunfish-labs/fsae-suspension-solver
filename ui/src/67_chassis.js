// 67_chassis.js - A chassis (or any other) model from CAD shown see-through in the 3D view, to check packaging by eye.
// STL (binary or text) or OBJ, read in the browser and kept in this browser (IndexedDB) between visits; never uploaded.
const chassis = {
  buf: null,
  name: "",
  ext: "stl",
  tris: 0,
  mesh: null,
  opts: { frame: "sw", units: "mm", origin: "axle", opacity: 0.3, show: true },
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
  let lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3)
    for (let j = 0; j < 3; j++) {
      lo[j] = Math.min(lo[j], P[i + j]);
      hi[j] = Math.max(hi[j], P[i + j]);
    }
  const L = hi[0] - lo[0],
    W = hi[1] - lo[1],
    H = hi[2] - lo[2],
    mid = (hi[1] + lo[1]) / 2;
  let note = `${fmt(L, 0)} mm long, ${fmt(W, 0)} mm wide, ${fmt(H, 0)} mm tall; lowest point ${fmt(lo[2], 0)} mm above the ground; centered ${fmt(Math.abs(mid), 0)} mm ${mid >= 0 ? "right" : "left"} of the car centerline.`;
  if (Math.max(L, W, H) < 300) note += " That is very small: check the units.";
  else if (Math.max(L, W, H) > 8000) note += " That is very large: check the units.";
  else if (W > L * 1.3 || H > L) note += " It looks rotated: try another axes setting.";
  return note;
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
    P = chassisSolverPoints(),
    pos = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    pos[i] = P[i];
    pos[i + 1] = P[i + 2];
    pos[i + 2] = -P[i + 1]; // same mapping as toT
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
  chassis.info = chassisInfo(P);
  three.scene.add(chassis.mesh);
  placeChassis();
}
// the mesh lives in the front corner's frame; the rear corner view is one wheelbase further forward
function placeChassis() {
  if (!three || !chassis.mesh) return;
  const carView = car && axleView === "car" && !chal,
    rearView = !carView && cfg && cfg.axle === "rear",
    wb = ((car && car.vehicle) || (cfg && cfg.vehicle) || {}).wheelbase || 1550;
  chassis.mesh.position.x = rearView ? wb : 0;
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
async function chSave() {
  try {
    const db = await chDB(),
      tx = db.transaction("m", "readwrite");
    if (chassis.buf) tx.objectStore("m").put({ buf: chassis.buf, name: chassis.name, ext: chassis.ext, opts: chassis.opts }, "model");
    else tx.objectStore("m").delete("model");
  } catch (e) {
    /* private window or storage off: the model just isn't remembered */
  }
}
async function chLoadSaved() {
  try {
    const db = await chDB(),
      v = await new Promise(res => {
        const r = db.transaction("m").objectStore("m").get("model");
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      });
    if (v && v.buf) {
      Object.assign(chassis, { buf: v.buf, name: v.name, ext: v.ext });
      Object.assign(chassis.opts, v.opts || {});
      buildChassisMesh();
    }
  } catch (e) {
    /* nothing saved */
  }
}

// ---- the dialog
function chSync() {
  const has = !!chassis.buf;
  $("#chLoaded").hidden = !has;
  $("#chName").textContent = has ? `${chassis.name} · ${chassis.tris.toLocaleString()} triangles` : "";
  $("#chInfo").textContent = has ? chassis.info || "" : "No model loaded.";
  for (const [k, id] of [
    ["frame", "#chFrame"],
    ["units", "#chUnits"],
    ["origin", "#chOrigin"],
  ])
    $(id).value = chassis.opts[k];
  $("#chOp").value = chassis.opts.opacity;
  $("#chShow").checked = chassis.opts.show;
  $("#tgChassis").hidden = !has;
}
function openChassis() {
  $("#chFrame").innerHTML = Object.entries(window.SuspCAD.FRAMES)
    .map(([k, f]) => `<option value="${attr(k)}">${esc(f.label)}</option>`)
    .join("");
  chSync();
  $("#chDlg").hidden = false;
  setTimeout(() => $("#chPick").focus(), 0);
}
function wireChassis() {
  $("#chClose").addEventListener("click", () => ($("#chDlg").hidden = true));
  $("#chDlg").addEventListener("click", e => {
    if (e.target.id === "chDlg") $("#chDlg").hidden = true;
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("#chDlg").hidden) $("#chDlg").hidden = true;
  });
  $("#chPick").addEventListener("click", () => $("#chFile").click());
  $("#chFile").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const ext = /\.obj$/i.test(f.name) ? "obj" : "stl";
    try {
      const buf = await busy(f.arrayBuffer());
      (ext === "obj" ? parseOBJ : parseSTL)(buf); // check it reads before replacing the current model
      Object.assign(chassis, { buf, name: f.name, ext });
      chassis.opts.show = true;
      buildChassisMesh();
      chSave();
      chSync();
      if (!three) $("#chInfo").textContent = "Loaded, but the 3D view is not available in this browser.";
    } catch (er) {
      $("#chInfo").textContent = "That file did not load: " + er.message;
    }
  });
  const change = () => {
    chassis.opts.frame = $("#chFrame").value;
    chassis.opts.units = $("#chUnits").value;
    chassis.opts.origin = $("#chOrigin").value;
    buildChassisMesh();
    chSave();
    chSync();
  };
  ["#chFrame", "#chUnits", "#chOrigin"].forEach(id => $(id).addEventListener("change", change));
  $("#chOp").addEventListener("input", () => {
    chassis.opts.opacity = +$("#chOp").value;
    placeChassis();
    chSave();
  });
  $("#chShow").addEventListener("change", () => {
    chassis.opts.show = $("#chShow").checked;
    placeChassis();
    chSave();
  });
  $("#chRemove").addEventListener("click", () => {
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
