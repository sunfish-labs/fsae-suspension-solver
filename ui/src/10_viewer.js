// ------------------------------------------------------------------ 3D viewer
const view = { theta: 0.95, phi: 1.12, r: 1550, target: null, mode: "iso", rc: true, mirror: false, overlay: null, hl: null, anim: null };
let three = null, preview = null;
const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function initThree() {
  if (!window.THREE) { $("#vmsg").hidden = false; $("#vmsg").textContent = "The 3D view needs the three.js library, which did not load. All results below still work."; return; }
  const T = window.THREE, cv = $("#cv");
  const renderer = new T.WebGLRenderer({ canvas: cv, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(35, 1, 5, 40000);
  scene.add(new T.HemisphereLight(0xffffff, 0x8899aa, 0.85));
  const dl = new T.DirectionalLight(0xffffff, 0.75); dl.position.set(800, 1600, 900); scene.add(dl);
  const dl2 = new T.DirectionalLight(0xffffff, 0.3); dl2.position.set(-900, 500, -700); scene.add(dl2);
  const dyn = new T.Group(); scene.add(dyn);
  three = { T, renderer, scene, cam, dyn, cv, need: true, pickables: [] };
  const ro = new ResizeObserver(() => { const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); three.need = true; });
  ro.observe(cv);
  // orbit / pan / zoom, and click-to-pick a joint
  const ptrs = new Map(); let last = null, pinch = null, downAt = null;
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY, e.button, e.shiftKey]; downAt = [e.clientX, e.clientY]; });
  cv.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) view.r = Math.max(300, Math.min(20000, view.r * pinch / d)); pinch = d; three.need = true; return; }
    const dx = e.clientX - last[0], dy = e.clientY - last[1];
    if (last[2] === 2 || last[2] === 1 || last[3]) {
      const s = view.r / cv.clientHeight * 0.9, c = cam;
      const right = new T.Vector3().setFromMatrixColumn(c.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(c.matrixWorld, 1);
      view.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    } else { view.theta -= dx * 0.008; view.phi = Math.max(0.02, Math.min(Math.PI - 0.08, view.phi - dy * 0.008)); setMode(null); }
    last = [e.clientX, e.clientY, last[2], last[3]]; three.need = true;
  });
  const up = (e) => {
    const single = ptrs.size === 1;
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (single && downAt && e.button === 0 && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) pick(e);
    downAt = null;
  };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", (e) => { ptrs.delete(e.pointerId); pinch = null; downAt = null; });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("wheel", (e) => { e.preventDefault(); view.r = Math.max(300, Math.min(20000, view.r * Math.exp(e.deltaY * 0.0012))); three.need = true; }, { passive: false });
  (function loop(now) {
    requestAnimationFrame(loop);
    if (view.anim) stepAnim(now);
    if (three.need && view.target) { placeCam(); renderer.render(scene, cam); three.need = false; layoutLabels(); }
  })();
}
window.__suspView = () => ({ three, toT, view });   // used by the browser tests
// screen-space hardpoint labels: two columns either side of the corner, nudged apart so none overlap
function layoutLabels() {
  const box = $("#vlabels"), list = three.labels || [];
  box.hidden = !list.length; $$(".vlab", box).forEach(n => n.remove());
  if (!list.length) { $("#vlabSvg").innerHTML = ""; return; }
  const W = three.cv.clientWidth, H = three.cv.clientHeight;
  const pts = list.map(l => { const v = toT(l.pt).project(three.cam); return { ...l, x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H }; });
  const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length, top = 50, bot = H - ($("#ovcap").hidden ? 52 : 100), gap = 22;
  let svg = "";
  for (const side of ["l", "r"]) {
    const col = pts.filter(q => (q.x < cx) === (side === "l")).sort((a, b) => a.y - b.y);
    const xs = side === "l" ? Math.max(8, Math.min(...col.map(q => q.x)) - 36) : Math.min(W - 8, Math.max(...col.map(q => q.x)) + 36);
    col.forEach((q, i) => { q.ly = Math.max(q.y, i ? col[i - 1].ly + gap : top); });
    const over = col.length ? col[col.length - 1].ly - bot : 0;
    if (over > 0) { col.forEach(q => q.ly -= over); for (let i = 0; i < col.length; i++) col[i].ly = Math.max(col[i].ly, i ? col[i - 1].ly + gap : top); }
    for (const q of col) {
      svg += `<line x1="${attr(q.x.toFixed(1))}" y1="${attr(q.y.toFixed(1))}" x2="${attr(xs.toFixed(1))}" y2="${attr(q.ly.toFixed(1))}"/><circle cx="${attr(q.x.toFixed(1))}" cy="${attr(q.y.toFixed(1))}" r="2.5"/>`;
      const b = document.createElement("button"); b.type = "button"; b.className = "vlab " + side; b.textContent = q.text;
      b.style.left = xs + "px"; b.style.top = q.ly + "px"; b.title = "What does moving this point do?";
      b.addEventListener("click", () => openInfluence(q.path)); box.appendChild(b);
    }
  }
  $("#vlabSvg").innerHTML = svg;
}
function tipSeen() { store.set("susp.tipSeen", "1"); $("#vhint").hidden = true; }
function pick(e) {
  if (!three || !three.pickables.length) return;
  const T = three.T, rect = three.cv.getBoundingClientRect();
  const ndc = new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  const rc = new T.Raycaster(); rc.setFromCamera(ndc, three.cam);
  const hits = rc.intersectObjects(three.pickables, false);
  if (!hits.length) return;
  tipSeen();
  const ud = hits[0].object.userData;
  if (ud.axle && axleView === "car") { setView(ud.axle); setTimeout(() => openInfluence(ud.hp), 0); return; }
  openInfluence(ud.hp);
}
const toT = (p) => new three.T.Vector3(p[0], p[2], -p[1]);
function placeCam() {
  const { cam } = three, t = view.target;
  cam.position.set(t.x + view.r * Math.sin(view.phi) * Math.sin(view.theta), t.y + view.r * Math.cos(view.phi), t.z + view.r * Math.sin(view.phi) * Math.cos(view.theta));
  cam.up.set(0, 1, 0); cam.lookAt(t);
}
function setMode(mode) {
  view.mode = mode;
  $$(".seg [data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === mode)));
  if (!mode || !three) return;
  // theta measured from +Z(three) = -Y(vehicle) toward +X(three) = +X(vehicle)
  const presets = { iso: [0.95, 1.12], front: [Math.PI / 2, Math.PI / 2], side: [Math.PI, Math.PI / 2], top: [Math.PI / 2, 0.02] };
  [view.theta, view.phi] = presets[mode]; three.need = true;
}
function frameOn(pt, r) { if (!three) return; view.target = toT(pt); view.r = Math.max(400, Math.min(20000, r)); three.need = true; }
$$(".seg [data-view]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.view)));
$("#tgRC").addEventListener("click", (e) => { view.rc = !view.rc; e.currentTarget.setAttribute("aria-pressed", String(view.rc)); updateScene(); });
$("#tgMirror").addEventListener("click", (e) => { view.mirror = !view.mirror; e.currentTarget.setAttribute("aria-pressed", String(view.mirror)); updateScene(); });
$("#tgLabels").addEventListener("click", (e) => { const on = view.overlay !== "labels"; showMe(on ? "labels" : null); });
$("#showSel").addEventListener("change", (e) => { const v = e.target.value; showMe(v || null); });

const legKey = () => `<span class="legkey"><i class="lk-f"></i>front leg <i class="lk-r"></i>rear leg</span>`;
function themeColors() {
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
  // in 3D the "accent" is the orange highlight; the page itself uses gold
  return { bg: g("--viewer"), accent: g("--hi") || g("--accent"), gold: g("--gold"), ink: g("--ink"), line: g("--line"), s1: g("--s1"), s2: g("--s2"), s3: g("--s3"), bad: g("--bad"), ok: g("--ok"), muted: g("--muted"), panel: g("--panel") };
}

// physical names for points, from the actual geometry (X forward)
function pointName(path) {
  const [grp, key] = path.split(".");
  const h = cfg.hardpoints, rear = cfg.axle === "rear";
  if (grp === "spring") return { rod_outboard: "Pushrod lower end", rocker_pivot: "Rocker pivot", rocker_axis: "Rocker axis", rocker_rod: "Rocker pushrod pin",
    rocker_damper: "Rocker damper pin", damper_chassis: "Damper chassis mount" }[key] || key;
  const fr = (a, b) => (h[a][0] > h[b][0] ? "front" : "rear");
  return { upper_inboard_front: `Upper ${fr("upper_inboard_front", "upper_inboard_rear")} inboard pivot`, upper_inboard_rear: `Upper ${fr("upper_inboard_rear", "upper_inboard_front")} inboard pivot`,
    lower_inboard_front: `Lower ${fr("lower_inboard_front", "lower_inboard_rear")} inboard pivot`, lower_inboard_rear: `Lower ${fr("lower_inboard_rear", "lower_inboard_front")} inboard pivot`,
    upper_outboard: "Upper ball joint", lower_outboard: "Lower ball joint", trackrod_inboard: rear ? "Toe-link inner end" : "Tie-rod inner end",
    trackrod_outboard: rear ? "Toe-link outer end" : "Tie-rod outer end", contact_patch: "Contact patch" }[key] || key;
}
const PACKAGING = new Set(["hardpoints.upper_outboard", "hardpoints.lower_outboard", "hardpoints.contact_patch", "spring.rocker_pivot"]);
let lockPack = store.get("susp.lockpack") !== "0";

// --------------------------------------------------- scene building
function updateScene() {
  if (three && car && axleView === "car" && !chal) return updateCarScene();
  if (!three || !ev || err) return;
  const { T, dyn, scene } = three, col = themeColors();
  scene.background = new T.Color(col.bg || "#dfe5ea");
  while (dyn.children.length) { const o = dyn.children.pop(); o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); } }); }
  three.pickables = []; three.labels = [];
  const s = ev.susp, sp = ev.spring;
  let x, o, sst;
  try { x = s.pose(pose.dz, pose.rack); o = s.observe(x, pose.dz, pose.rack); sst = sp ? sp.state(x, rad0(pose.dz)) : null; }
  catch (e) { $("#hud").innerHTML = `<span>Cannot reach ${fmt(pose.dz, 1)} mm / rack ${fmt(pose.rack, 1)} mm: ${esc(e.message)}</span>`; three.need = true; return; }
  const p = o._pts, h = s.h;
  const xray = !!view.overlay && view.overlay !== "labels";
  dyn.add(buildCorner(ev, o, sst, { col, xray }));
  if (view.mirror || view.overlay === "roll_center" || (view.overlay === "ackermann" && cfg.axle === "front")) {
    // the left wheel is the mirror image of the right wheel at the opposite rack position
    let oL = o, sL = sst;
    if (pose.rack) { try { const xl = s.pose(pose.dz, -pose.rack); oL = s.observe(xl, pose.dz, -pose.rack); sL = sp ? sp.state(xl, rad0(pose.dz)) : null; } catch (e) { oL = null; } }
    if (oL) dyn.add(buildCorner(ev, oL, sL, { col, mirror: true, xray }));
  }
  if (preview) {
    try {
      const ps = preview.ev.susp, px = ps.pose(pose.dz, pose.rack), po = ps.observe(px, pose.dz, pose.rack);
      const pst = preview.ev.spring ? preview.ev.spring.state(px, rad0(pose.dz)) : null;
      dyn.add(buildCorner(preview.ev, po, pst, { col, ghost: true }));
    } catch (e) { /* preview pose unreachable: skip the ghost */ }
  }
  drawCompareGhosts(dyn, col);
  const D = drawKit(dyn, col), DT = drawKit(dyn, col, true);
  // ground grid, centerline, contact patch, roll center
  const gsize = Math.max(2400, s.track + 1200);
  const grid = new T.GridHelper(gsize, 24, new T.Color(col.muted || "#5a6876"), new T.Color(col.line || "#cfd7de"));
  grid.position.set(h.cp[0], 0, 0); grid.material.transparent = true; grid.material.opacity = 0.6; dyn.add(grid);
  D.line([[h.cp[0] - 700, 0, 0.5], [h.cp[0] + 700, 0, 0.5]], col.muted, true);
  const cpm = new T.Mesh(new T.RingGeometry(14, 24, 32), new T.MeshBasicMaterial({ color: new T.Color(col.accent || "#9E7E38"), side: T.DoubleSide }));
  cpm.rotation.x = -Math.PI / 2; cpm.position.copy(toT([p.cp[0], p.cp[1], p.cp[2] + 0.8])); dyn.add(cpm);
  if (view.rc && (!view.overlay || view.overlay === "labels") && Number.isFinite(o.roll_center)) {
    const rcPt = [p.cp[0], 0, o.roll_center + p.cp[2]];
    D.line([p.cp, rcPt, [p.cp[0], -p.cp[1], p.cp[2]]], col.accent, true); D.dot(rcPt, col.accent, 13);
  }
  if (view.overlay) drawOverlay(view.overlay, { D: DT, o, p, h, s, x, sst, col });
  if (view.hl) drawHighlight(DT, view.hl, o, sst, col);
  if (!view.target) { view.target = toT([h.cp[0], h.cp[1] * 0.62, 230]); setMode("iso"); }
  const sp2 = sst ? ` · <b>damper</b> ${fmt(sst.damper_len, 1)} mm` : "";
  $("#hud").innerHTML = legKey() + `<span><b>travel</b> ${fmt(pose.dz, 1)} mm${cfg.axle === "front" ? ` · <b>rack</b> ${fmt(pose.rack, 1)} mm` : ""}</span><span><b>camber</b> ${fmt(o.camber, 2)}°</span><span><b>toe</b> ${fmt(o.toe, 3)}°</span><span><b>caster</b> ${fmt(o.caster, 2)}°</span><span><b>RC</b> ${fmt(o.roll_center, 1)} mm${sp2}</span>`;
  const hb = ($("#hud").offsetHeight || 30) + 18 + "px"; for (const id of ["#ovcap", "#pvbar", "#vhint"]) $(id).style.bottom = hb;
  three.need = true;
}

function drawKit(group, col, onTop = false) {
  const T = three.T, top = onTop ? { depthTest: false, transparent: true } : {};
  const basic = (c, extra = {}) => new T.MeshBasicMaterial({ color: new T.Color(c || "#9E7E38"), ...top, ...extra });
  const add = (o) => { if (onTop) o.renderOrder = 5; group.add(o); return o; };
  return {
    line(pts, c, dashed) {
      const g = new T.BufferGeometry().setFromPoints(pts.map(toT));
      const m = dashed ? new T.LineDashedMaterial({ color: new T.Color(c || "#5a6876"), dashSize: 30, gapSize: 18, ...top }) : new T.LineBasicMaterial({ color: new T.Color(c || "#5a6876"), ...top });
      const l = new T.Line(g, m); if (dashed) l.computeLineDistances(); return add(l);
    },
    rod(a, b, r, c) {
      const A = toT(a), B = toT(b), d = new T.Vector3().subVectors(B, A), L = d.length(); if (L < 1e-6) return;
      const me = new T.Mesh(new T.CylinderGeometry(r, r, L, 10), basic(c)); me.position.copy(A).addScaledVector(d, 0.5);
      me.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); add(me);
    },
    dot(pt, c, r = 10) { const me = new T.Mesh(new T.SphereGeometry(r, 16, 10), basic(c)); me.position.copy(toT(pt)); add(me); },
    label(pt, text, c) {
      const cvs = document.createElement("canvas"), ctx = cvs.getContext("2d"), fs = 40;
      ctx.font = `600 ${fs}px "IBM Plex Sans", system-ui, sans-serif`;
      const w = Math.ceil(ctx.measureText(text).width) + 28; cvs.width = w; cvs.height = fs + 24;
      ctx.font = `600 ${fs}px "IBM Plex Sans", system-ui, sans-serif`;
      ctx.fillStyle = col.panel || "#ffffff"; ctx.globalAlpha = 0.9; ctx.fillRect(0, 0, w, cvs.height); ctx.globalAlpha = 1;
      ctx.strokeStyle = c || col.accent; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, cvs.height - 4);
      ctx.fillStyle = col.ink || "#15212b"; ctx.textBaseline = "middle"; ctx.fillText(text, 14, cvs.height / 2 + 2);
      const tex = new T.CanvasTexture(cvs); tex.minFilter = T.LinearFilter;
      const spr = new T.Sprite(new T.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true }));
      const hgt = 0.03 * Math.min(1.25, Math.max(0.8, 460 / (three.cv.clientHeight || 460))); spr.scale.set(hgt * w / cvs.height, hgt, 1); spr.position.copy(toT(pt)); spr.renderOrder = 10; group.add(spr);
    },
    arrow(origin, dirV, len, c) {
      const d = toT(dirV).sub(toT([0, 0, 0])).normalize();
      const a = new T.ArrowHelper(d, toT(origin), len, new T.Color(c).getHex(), len * 0.28, len * 0.16);
      if (onTop) a.traverse(n => { if (n.material) { n.material.depthTest = false; n.material.transparent = true; } n.renderOrder = 6; }); group.add(a);
    },
  };
}

function buildCorner(e, o, sst, { col, mirror = false, ghost = false, xray = false, ghostCol = null, solid = false }) {
  const T = three.T, s = e.susp, sp = e.spring, p = o._pts, h = s.h, g = new T.Group();
  const mat = (c, extra = {}) => ghost ? new T.MeshBasicMaterial({ color: new T.Color(ghostCol || col.accent || "#9E7E38"), transparent: true, opacity: 0.42, depthWrite: false })
    : new T.MeshStandardMaterial({ color: new T.Color(c), roughness: 0.55, metalness: 0.25, ...extra });
  const steel = mat("#8d99a6"), steelD = mat("#5d6975"), arm1 = mat(col.s1 || "#2F5D7C"), tie = mat("#6c7a89"), push = mat(col.bad || "#b42318"),
    rocker = mat(col.accent || "#9E7E38", { side: T.DoubleSide }), springM = mat("#26338f", { metalness: 0.4 }), damperM = mat("#e0b21c", { metalness: 0.3 }),
    tire = mat("#202326", xray ? { roughness: 0.92, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false } : { roughness: 0.92, metalness: 0 }), rimM = mat("#b9c2cb", { metalness: 0.7, roughness: 0.35, transparent: true, opacity: 0.45, side: T.DoubleSide });
  const pickable = (me, hp) => { if (!mirror && !ghost && hp) { me.userData.hp = hp; three.pickables.push(me); } };
  const tube = (a, b, r, m) => { const A = toT(a), B = toT(b), d = new T.Vector3().subVectors(B, A), L = d.length(); if (L < 1e-6) return;
    const me = new T.Mesh(new T.CylinderGeometry(r, r, L, 14), m); me.position.copy(A).addScaledVector(d, 0.5); me.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); g.add(me); };
  const ball = (q, r, m, hp) => { const me = new T.Mesh(new T.SphereGeometry(r, 18, 12), m); me.position.copy(toT(q)); g.add(me); pickable(me, hp); };
  const box = (q, sz, m, hp) => { const me = new T.Mesh(new T.BoxGeometry(sz, sz, sz), m); me.position.copy(toT(q)); g.add(me); pickable(me, hp); };
  // front leg (pivot with the larger X) blue, rear leg gold, so the two legs of each wishbone are easy to tell apart
  const armR = mat(col.gold || "#9E7E38"), leg = (a, b) => a[0] >= b[0] ? arm1 : armR;
  tube(h.uif, p.ub, 8, leg(h.uif, h.uir)); tube(h.uir, p.ub, 8, leg(h.uir, h.uif)); tube(h.lif, p.lb, 8, leg(h.lif, h.lir)); tube(h.lir, p.lb, 8, leg(h.lir, h.lif));
  tube(p.tri, p.tro, 6.5, tie);
  box(h.uif, 22, steelD, "hardpoints.upper_inboard_front"); box(h.uir, 22, steelD, "hardpoints.upper_inboard_rear");
  box(h.lif, 22, steelD, "hardpoints.lower_inboard_front"); box(h.lir, 22, steelD, "hardpoints.lower_inboard_rear");
  box(p.tri, 18, steelD, "hardpoints.trackrod_inboard");
  ball(p.ub, 11, steel, "hardpoints.upper_outboard"); ball(p.lb, 11, steel, "hardpoints.lower_outboard"); ball(p.tro, 11, steel, "hardpoints.trackrod_outboard");
  tube(p.ub, p.lb, 13, steelD); tube(p.lb, p.tro, 9, steelD); tube(p.ub, p.c, 9, steelD); tube(p.lb, p.c, 9, steelD);
  if (!ghost) {
    const R = s.R, w = s.cfg.wheel.tire_width, rr = s.cfg.wheel.rim_diameter_in * 25.4 / 2, prof = [];
    const rnd = Math.min(28, (R - rr) / 2);
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + i / 8 * Math.PI / 2; prof.push(new T.Vector2(R - rnd + rnd * Math.cos(a), -w / 2 + rnd + rnd * Math.sin(a))); }
    for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; prof.push(new T.Vector2(R - rnd + rnd * Math.cos(a), w / 2 - rnd + rnd * Math.sin(a))); }
    prof.push(new T.Vector2(rr, w / 2 - 4)); prof.unshift(new T.Vector2(rr, -w / 2 + 4));
    const ty = new T.Mesh(new T.LatheGeometry(prof, 72), tire);
    const rim = new T.Mesh(new T.CylinderGeometry(rr, rr, w * 0.92, 48, 1, true), rimM);
    const axle = toT(p.a).sub(toT([0, 0, 0])).normalize(), q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), axle);
    for (const me of [ty, rim]) { me.position.copy(toT(p.c)); me.quaternion.copy(q); g.add(me); }
    const hub = new T.Mesh(new T.CylinderGeometry(40, 40, 30, 24), steel); hub.position.copy(toT(p.c)); hub.quaternion.copy(q); g.add(hub);
  }
  if (sp && sst) {
    tube(sst.rod_out, sst.rod_in, 7, push); ball(sst.rod_out, 9, steel, "spring.rod_outboard");
    if (!sp.direct) {
      const k = sp.k, n = toT(V.add(sp.c, k)).sub(toT(sp.c)).normalize();
      const tri = [sp.c, sst.rod_in, sst.damper_out].map(toT), geo = new T.BufferGeometry();
      const off = n.clone().multiplyScalar(4), pts = [];
      for (const sgn of [1, -1]) tri.forEach(t => pts.push(t.clone().addScaledVector(off, sgn)));
      geo.setAttribute("position", new T.Float32BufferAttribute(pts.flatMap(v => [v.x, v.y, v.z]), 3));
      geo.setIndex([0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0]); geo.computeVertexNormals();
      g.add(new T.Mesh(geo, rocker));
      const pin = new T.Mesh(new T.CylinderGeometry(9, 9, 34, 16), steelD); pin.position.copy(toT(sp.c)); pin.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), n); g.add(pin);
      pickable(pin, "spring.rocker_pivot");
      ball(sst.rod_in, 8, steel, "spring.rocker_rod"); ball(sst.damper_out, 8, steel, "spring.rocker_damper");
    }
    const A = sst.damper_out, B = sp.dch, Lc = V.norm(V.sub(B, A)), u = V.unit(V.sub(B, A));
    const bodyStart = V.add(A, V.mul(u, Lc * 0.42));
    tube(A, bodyStart, 6, steel); tube(bodyStart, B, 19, damperM); box(B, 20, steelD, "spring.damper_chassis");
    if (!ghost) {
      const a3 = toT(A), b3 = toT(V.add(A, V.mul(u, Lc * 0.86))), ax = new T.Vector3().subVectors(b3, a3), Lh = ax.length(); ax.normalize();
      const ref = Math.abs(ax.y) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0), e1 = new T.Vector3().crossVectors(ax, ref).normalize(), e2 = new T.Vector3().crossVectors(ax, e1);
      class Helix extends T.Curve { getPoint(t) { const ang = t * Math.PI * 2 * 7.5, rr2 = 27; return a3.clone().addScaledVector(ax, Lh * (0.06 + 0.9 * t)).addScaledVector(e1, rr2 * Math.cos(ang)).addScaledVector(e2, rr2 * Math.sin(ang)); } }
      g.add(new T.Mesh(new T.TubeGeometry(new Helix(), 240, 3.6, 8, false), springM));
    }
  }
  if (mirror) { g.scale.z = -1; g.traverse(n => { if (n.material) { n.material = n.material.clone(); n.material.side = T.DoubleSide; if (!solid) { n.material.transparent = true; n.material.opacity = 0.28; } } }); }
  return g;
}

function drawHighlight(D, hl, o, sst, col) {
  const pt = livePoint(hl.path, o, sst); if (!pt) return;
  D.dot(pt, col.accent, 17);
  const dirs = hl.dir ? [hl.dir] : [[[1, 0, 0], "forward", col.bad], [[0, 1, 0], "outboard", col.ok], [[0, 0, 1], "up", col.s1]];
  for (const [d, lab, c] of dirs) { D.arrow(pt, d, 110, c || col.accent); if (lab) D.label(V.add(pt, V.mul(d, 135)), lab, c); }
}
function livePoint(path, o, sst) {
  const [grp, key] = path.split("."), p = o._pts, h = ev.susp.h;
  if (grp === "hardpoints") return { upper_inboard_front: h.uif, upper_inboard_rear: h.uir, lower_inboard_front: h.lif, lower_inboard_rear: h.lir,
    upper_outboard: p.ub, lower_outboard: p.lb, trackrod_inboard: p.tri, trackrod_outboard: p.tro, contact_patch: p.cp }[key];
  if (!sst) return null;
  return { rod_outboard: sst.rod_out, rocker_rod: sst.rod_in, rocker_damper: sst.damper_out, damper_chassis: ev.spring.dch, rocker_pivot: ev.spring.c }[key] || null;
}

// --------------------------------------------------- "Show me" overlays
const OVERLAYS = {
  labels: { mode: "iso", name: "Hardpoint names" },
  kingpin: { mode: "iso", name: "Steering axis" }, caster: { mode: "side", name: "Caster" }, kpi: { mode: "front", name: "KPI" },
  scrub: { mode: "front", name: "Scrub radius" }, trail: { mode: "side", name: "Mechanical trail" },
  camber: { mode: "front", name: "Camber" }, toe: { mode: "top", name: "Toe" }, steer_arm: { mode: "top", name: "Steering arm" },
  ackermann: { mode: "top", name: "Ackermann" }, fvsa: { mode: "front", name: "Front-view instant center and swing arm" },
  roll_center: { mode: "front", name: "Roll center" }, anti: { mode: "side", name: "Side-view instant center and anti geometry" },
  travel: { mode: "front", name: "Bump and droop", anim: true }, camber_gain: { mode: "front", name: "Camber gain", anim: true },
  bump_steer: { mode: "top", name: "Bump steer", anim: true }, track_change: { mode: "front", name: "Track change", anim: true },
  motion_ratio: { mode: "iso", name: "Motion ratio", anim: true },
};
$("#showSel").innerHTML = `<option value="">Show me…</option>` + Object.entries(OVERLAYS).filter(([k]) => k !== "labels").map(([k, o]) => `<option value="${attr(k)}">${esc(o.name)}</option>`).join("");
function axisGround(p) { // steering axis through the ball joints, and where it meets the ground
  const k = V.unit(V.sub(p.ub, p.lb)), t = (p.cp[2] - p.lb[2]) / k[2];
  return { k, g: V.add(p.lb, V.mul(k, t)) };
}
// camera distance that fits a w × h (mm) region of the screen plane
function fitR(w, hh) { const asp = three ? three.cam.aspect || 2 : 2, t = Math.tan(17.5 * Math.PI / 180); return Math.max(hh, w / asp) / (2 * t) * 1.12; }
let savedCam = null;
function showMe(id) {
  stopAnim();
  if (id && !view.overlay && three && view.target) savedCam = { theta: view.theta, phi: view.phi, r: view.r, target: view.target.clone(), mode: view.mode, rack: pose.rack };
  view.overlay = id;
  $("#tgLabels").setAttribute("aria-pressed", String(id === "labels"));
  $("#showSel").value = id && id !== "labels" ? id : ""; $("#vhint").hidden = !!id || store.get("susp.tipSeen") === "1";
  if (!id) {
    $("#ovcap").hidden = true;
    if (savedCam) { Object.assign(view, { theta: savedCam.theta, phi: savedCam.phi, r: savedCam.r, target: savedCam.target }); setMode(savedCam.mode); setRack(savedCam.rack); if (three) three.need = true; savedCam = null; }
    if (Math.abs(pose.dz) > 0 && !view.anim) setTravel(0);
    updateScene(); return;
  }
  const ov = OVERLAYS[id];
  if (ov.mode) setMode(ov.mode);
  if (savedCam && id !== "ackermann") setRack(savedCam.rack);
  // frame the view on what the overlay draws
  const s = ev.susp, o0 = s.observe(s.pose(pose.dz, pose.rack), pose.dz, pose.rack), p = o0._pts, D = 2 * s.R;
  if (id === "fvsa" || id === "roll_center") {
    const ic = o0.fv_ic, icy = ic ? Math.max(ic[0], p.cp[1] - 5000) : -p.cp[1];
    const lo = Math.min(icy, id === "roll_center" ? -p.cp[1] : p.cp[1]) - 150, hi = p.cp[1] + s.cfg.wheel.tire_width;
    frameOn([p.cp[0], (lo + hi) / 2, Math.max(250, (ic ? Math.min(ic[1], 1500) : 0) / 2) - 170], fitR(hi - lo, D + 650));
  } else if (id === "anti") {
    const Lr = s.WB * 0.7, dirx = cfg.axle === "front" ? -1 : 1;
    frameOn([p.cp[0] + dirx * Lr / 2, p.cp[1], 350], fitR(Lr + D + 200, D + 500));
  } else if (id === "ackermann") {
    if (cfg.axle === "front" && Math.abs(pose.rack) < 3) setRack(Math.round(cfg.sweep.rack_travel * 0.9));
    const ak = ackPoints(s), hy = ak ? ak.w.filter(q => q.hit && Math.abs(q.hit[1]) < s.track * 6).map(q => q.hit[1]) : [];
    const xs = [p.cp[0] + 450, p.cp[0] - s.WB - 450], ys = [-s.track / 2 - 350, s.track / 2 + 350, ...hy.map(y => y - 250), ...hy.map(y => y + 250)];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    frameOn([(x0 + x1) / 2, (y0 + y1) / 2, 0], fitR(y1 - y0, (x1 - x0) * 1.45));
  } else if (id === "labels" || id === "motion_ratio") frameOn([p.cp[0], p.cp[1] * 0.55, 260], fitR(p.cp[1] * 1.3 + 500, D + 300));
  else if (id === "toe" || id === "bump_steer" || id === "steer_arm") frameOn([p.cp[0], p.cp[1] * 0.8, 0], fitR(p.cp[1] + 700, 1300));
  else frameOn([p.cp[0], p.cp[1] * 0.85, 280], fitR(p.cp[1] * 0.6 + 600, D + 480));
  clearTimeout(view.ovTimer); view.ovStage = 3;
  if (id === "roll_center" && !reduceMotion) { view.ovStage = 1; view.ovTimer = setTimeout(() => { view.ovStage = 2; updateScene(); view.ovTimer = setTimeout(() => { view.ovStage = 3; updateScene(); }, 1600); }, 1600); }
  if (ov.anim && !reduceMotion) view.anim = { t0: null, T: cfg.sweep.travel };
  else if (ov.anim) setTravel(cfg.sweep.travel);
  else if (pose.dz) setTravel(0);
  $("#ovcap").hidden = false;
  updateScene();
  const vw = $("#viewer"); if (vw.getBoundingClientRect().top < 0 || vw.getBoundingClientRect().top > window.innerHeight * 0.6) vw.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}
function setRack(v) { if (cfg.axle !== "front") v = 0; pose.rack = v; $("#poseR").value = v; $("#poseRo").value = (+v).toFixed(1); }
function setTravel(v) { pose.dz = v; $("#poseZ").value = v; $("#poseZo").value = (+v).toFixed(1); }
function stopAnim() { if (view.anim) { view.anim = null; } }
function stepAnim(now) {
  const a = view.anim; if (!a.t0) a.t0 = now;
  const t = (now - a.t0) / 4200;
  if (t >= 1) { view.anim = null; pose.dz = 0; } else pose.dz = +(a.T * Math.sin(2 * Math.PI * t)).toFixed(1);
  $("#poseZ").value = pose.dz; $("#poseZo").value = (+pose.dz).toFixed(1);
  updateScene();
}
function drawOverlay(id, { D, o, p, h, s, x, sst, col }) {
  const A = col.accent, m = ev.metrics, cap = (name, val, note) => { $("#ovcap").innerHTML = `<span><b>${esc(name)}</b>${val ? ` <span class="mono">${val}</span>` : ""}${note ? ` · ${note}` : ""}</span>${OVERLAYS[id].anim || id === "roll_center" ? `<button class="btn small" type="button" id="ovReplay">Replay</button>` : ""}<button class="btn small" type="button" id="ovHide">Hide</button>`; };
  const { k, g } = axisGround(p);
  const axisRod = () => { D.rod(g, V.add(p.ub, V.mul(k, 140)), 3.2, A); D.dot(g, A, 9); };
  const wheelUp = () => V.unit(V.sub([0, 0, 1], V.mul(p.a, p.a[2])));
  switch (id) {
    case "labels": {
      const pts = [["hardpoints.upper_inboard_front", h.uif], ["hardpoints.upper_inboard_rear", h.uir], ["hardpoints.lower_inboard_front", h.lif], ["hardpoints.lower_inboard_rear", h.lir],
        ["hardpoints.upper_outboard", p.ub], ["hardpoints.lower_outboard", p.lb], ["hardpoints.trackrod_inboard", p.tri], ["hardpoints.trackrod_outboard", p.tro], ["hardpoints.contact_patch", p.cp]];
      if (sst) { pts.push(["spring.rod_outboard", sst.rod_out], ["spring.damper_chassis", ev.spring.dch]); if (!ev.spring.direct) pts.push(["spring.rocker_pivot", ev.spring.c]); }
      three.labels = pts.map(([path, pt]) => ({ path, pt, text: pointName(path) }));
      cap("Hardpoint names", "", "click any joint in the 3D view to see what moving it does"); break;
    }
    case "kingpin": axisRod(); D.dot(p.cp, col.s1, 8); D.label(V.add(p.ub, V.mul(k, 170)), "steering axis", A); D.label(g, "meets the ground here", A);
      cap("Steering axis", "", "the line through the ball joints; the wheel steers about it"); break;
    case "caster": axisRod(); D.line([g, [g[0], g[1], p.ub[2] + 140]], col.muted, true); D.label(V.add(g, [170, 0, 140]), `caster ${fmt(o.caster, 2)}°`, A);
      cap("Caster", `${fmt(o.caster, 2)}°`, "tilt of the steering axis seen from the side (dashed = vertical)"); break;
    case "kpi": axisRod(); D.line([g, [g[0], g[1], p.ub[2] + 140]], col.muted, true); D.label(V.add(g, [0, -190, 140]), `KPI ${fmt(o.kpi, 2)}°`, A);
      cap("KPI", `${fmt(o.kpi, 2)}°`, "tilt of the steering axis seen from the front (dashed = vertical)"); break;
    case "scrub": axisRod(); D.rod([p.cp[0], g[1], 2], [p.cp[0], p.cp[1], 2], 4, col.s1); D.dot(p.cp, col.s1, 9);
      D.label([p.cp[0], (g[1] + p.cp[1]) / 2, 60], `scrub ${fmt(o.scrub, 1)} mm`, col.s1);
      cap("Scrub radius", `${fmt(o.scrub, 1)} mm`, "sideways gap at the ground between the steering axis and the contact patch"); break;
    case "trail": axisRod(); D.rod([g[0], p.cp[1], 2], [p.cp[0], p.cp[1], 2], 4, col.s1); D.dot(p.cp, col.s1, 9);
      D.label([(g[0] + p.cp[0]) / 2, p.cp[1], 60], `trail ${fmt(o.trail, 1)} mm`, col.s1);
      cap("Mechanical trail", `${fmt(o.trail, 1)} mm`, "fore-aft gap at the ground: axis ahead of the contact patch = self-centering"); break;
    case "camber": case "camber_gain": {
      const L = 2 * s.R + 80, u = wheelUp();
      D.line([p.cp, V.add(p.cp, [0, 0, L])], col.muted, true); D.rod(p.cp, V.add(p.cp, V.mul(u, L)), 3.2, A);
      D.label(V.add(p.cp, V.mul(u, L + 40)), `camber ${fmt(o.camber, 2)}°`, A);
      if (id === "camber") cap("Camber", `${fmt(o.camber, 2)}°`, "wheel lean from vertical (dashed); negative = top leans in");
      else cap("Camber gain", `${fmt(m.camber_gain, 3)} deg/in`, `camber now ${fmt(o.camber, 2)}° at ${fmt(pose.dz, 0)} mm travel`);
      break;
    }
    case "toe": case "bump_steer": {
      const toe0 = ev.metrics.toe, mag = id === "bump_steer" ? 25 : 10, ang = (id === "bump_steer" ? (o.toe - toe0) * mag + toe0 : o.toe * mag) * Math.PI / 180;
      const hd = [Math.cos(ang), -Math.sin(ang), 0];          // toe-in (+) points the front of the right wheel inboard (-Y)
      D.line([V.add(p.cp, [-520, 0, 2]), V.add(p.cp, [520, 0, 2])], col.muted, true);
      D.rod(V.add(p.cp, V.add(V.mul(hd, -480), [0, 0, 3])), V.add(p.cp, V.add(V.mul(hd, 480), [0, 0, 3])), 3.5, A);
      D.label(V.add(p.cp, [250, 260, 10]), id === "toe" ? `toe ${fmt(o.toe, 3)}°` : `toe change ${fmt(o.toe - toe0, 3)}°`, A);
      if (id === "toe") cap("Toe", `${fmt(o.toe, 3)}°`, "wheel heading vs straight ahead (dashed); angle drawn 10× larger to be visible");
      else cap("Bump steer", `${fmt(m.bump_steer, 3)} deg/in`, `toe change at ${fmt(pose.dz, 0)} mm travel, drawn 25× larger`);
      break;
    }
    case "steer_arm": { const f = V.add(p.lb, V.mul(k, V.dot(V.sub(p.tro, p.lb), k))); axisRod(); D.rod(p.tro, f, 4, col.s1); D.label(V.mul(V.add(p.tro, f), 0.5), `steering arm ${fmt(m.steer_arm ?? V.norm(V.sub(p.tro, f)), 0)} mm`, col.s1);
      cap("Steering arm", `${fmt(V.norm(V.sub(p.tro, f)), 1)} mm`, "tie-rod joint to the steering axis, at right angles"); break; }
    case "ackermann": {
      if (cfg.axle !== "front") { cap("Ackermann", "", "steering applies to the front axle"); break; }
      if (!pose.rack) { cap("Ackermann", `${fmt(m.ackermann, 0)} %`, "drag Rack to steer; the lines appear once the wheels are turned"); break; }
      const ak = ackPoints(s); if (!ak) { cap("Ackermann", "", "this rack position cannot be reached"); break; }
      const { rx, w } = ak, lim = s.track * 6;
      D.line([[rx, Math.min(-s.track * 0.7, ...w.map(q => q.hit ? q.hit[1] : 0)) - 200, 3], [rx, Math.max(s.track * 0.7, ...w.map(q => q.hit ? q.hit[1] : 0)) + 200, 3]], col.muted, true);
      D.label([rx + 120, 0, 40], "rear axle line", col.muted);
      w.forEach((q, i) => { const c = i ? col.s1 : A;
        if (q.hit && Math.abs(q.hit[1]) < lim) { D.line([q.c, [q.hit[0], q.hit[1], 3]], c); D.dot([q.hit[0], q.hit[1], 3], c, 14); }
        else D.line([q.c, V.add(q.c, V.mul(V.unit(q.d), -Math.sign(q.d[0] || 1) * s.WB))], c); });
      const gap = w[0].hit && w[1].hit ? Math.abs(w[0].hit[1] - w[1].hit[1]) : null;
      cap("Ackermann", `${fmt(m.ackermann, 0)} %`, `axle lines of both front wheels; at 100 % they meet the rear axle line at one point${gap != null ? ` (now ${fmt(gap, 0)} mm apart)` : ""}`); break;
    }
    case "fvsa": case "roll_center": {
      if (!o.fv_ic) { cap(OVERLAYS[id].name, "", "the arms are parallel in front view, so the instant center is at infinity"); break; }
      const ic = [p.cp[0], o.fv_ic[0], o.fv_ic[1]];
      if (Math.abs(ic[1] - p.cp[1]) > 5200) { const u = V.unit(V.sub(ic, [p.cp[0], p.lb[1], p.lb[2]])); D.line([[p.cp[0], p.ub[1], p.ub[2]], V.add([p.cp[0], p.ub[1], p.ub[2]], V.mul(V.unit(V.sub(ic, [p.cp[0], p.ub[1], p.ub[2]])), 4000))], col.s1, true); D.line([[p.cp[0], p.lb[1], p.lb[2]], V.add([p.cp[0], p.lb[1], p.lb[2]], V.mul(u, 4000))], col.s1, true);
        cap(OVERLAYS[id].name, id === "fvsa" ? `${fmt(o.fvsa, 0)} mm` : `${fmt(o.roll_center, 1)} mm`, `the wishbones (dashed blue) cross ${fmt(Math.abs(ic[1] - p.cp[1]) / 1000, 1)} m away, off screen: nearly parallel arms`); break; }
      const stg = id === "roll_center" ? (view.ovStage || 3) : 3;
      D.line([[p.cp[0], p.ub[1], p.ub[2]], ic], col.s1, true); D.line([[p.cp[0], p.lb[1], p.lb[2]], ic], col.s1, true);
      if (stg === 1) { cap("Roll center · step 1 of 3", "", "extend both wishbones inboard (dashed blue) until they cross"); break; }
      D.dot(ic, col.s1, 16); D.label(V.add(ic, [0, 0, 70]), "instant center", col.s1);
      if (stg === 2) { cap("Roll center · step 2 of 3", "", "where the extended wishbones cross is the instant center (blue dot)"); break; }
      if (id === "fvsa") {
        D.rod([p.cp[0], p.cp[1], 2], [p.cp[0], ic[1], 2], 4, A); D.line([ic, [p.cp[0], ic[1], 0]], col.muted, true);
        D.label([p.cp[0], (p.cp[1] + ic[1]) / 2, -70], `FVSA ${fmt(o.fvsa, 0)} mm`, A);
        cap("Front-view swing arm", `${fmt(o.fvsa, 0)} mm`, "dashed blue = the wishbones extended until they cross");
      } else {
        const rc = [p.cp[0], 0, o.roll_center + p.cp[2]];
        D.line([[p.cp[0], 0, 0], [p.cp[0], 0, Math.max(450, rc[2] + 250)]], col.muted, true); D.label([p.cp[0], 0, Math.max(450, rc[2] + 250) + 30], "car centerline", col.muted);
        D.rod(p.cp, ic, 3, A); D.rod([p.cp[0], -p.cp[1], p.cp[2]], [p.cp[0], -ic[1], ic[2]], 3, A); D.dot([p.cp[0], -ic[1], ic[2]], col.s1, 10);
        D.dot(rc, A, 18); D.label(V.add(rc, [0, 0, 80]), `roll center ${fmt(o.roll_center, 1)} mm`, A);
        cap("Roll center", `${fmt(o.roll_center, 1)} mm`, "orange: contact patch → instant center; where the lines from both sides cross the centerline is the roll center");
      }
      break;
    }
    case "anti": {
      if (!o.sv_ic) { cap("Anti geometry", "", "the pivot axes are parallel in side view (no anti effect)"); break; }
      const veh = cfg.vehicle, front = cfg.axle === "front";
      const ref = (front ? veh.brakes === "inboard" : veh.drive === "inboard") ? p.c : p.cp;
      const sv = [o.sv_ic[0], p.cp[1], o.sv_ic[1]], Lr = s.WB * 0.7, dirx = front ? -1 : 1;
      const dx = sv[0] - ref[0], mine = Math.abs(dx) > 1e-6 ? (sv[2] - ref[2]) / dx : 0;
      const slope = front ? s.CG / (s.WB * veh.front_brake_share) : s.CG / s.WB;
      const yours = [ref[0] + dirx * Lr, ref[1], ref[2] + mine * dirx * Lr], full = [ref[0] + dirx * Lr, ref[1], ref[2] + slope * Lr];
      D.rod(ref, yours, 3.2, A); D.label(yours, "your line", A);
      D.line([ref, full], col.ok, true); D.label(full, "100 % line", col.ok);
      if (Math.abs(dx) < Lr * 1.3) { D.dot(sv, A, 15); D.label(V.add(sv, [0, 0, 70]), "side-view instant center", A); }
      const val = front ? m.antidive : m.antisquat;
      cap(front ? "Anti-dive" : "Anti-squat", `${fmt(val, 1)} %`, `the line from the ${ref === p.c ? "wheel center" : "contact patch"} toward the side-view instant center (orange) vs the 100 % line (green); steeper = more anti`);
      break;
    }
    case "travel": cap("Bump and droop", `${fmt(pose.dz, 0)} mm`, "the wheel moving through its full travel"); break;
    case "track_change": D.dot([h.cp[0], h.cp[1], 3], col.muted, 9); D.rod([h.cp[0], h.cp[1], 3], [p.cp[0], p.cp[1], 3], 3, A);
      cap("Track change", `${fmt(p.cp[1] - h.cp[1], 2)} mm`, `sideways contact-patch shift at ${fmt(pose.dz, 0)} mm travel (gray = ride height)`); break;
    case "motion_ratio": {
      if (!sst) { cap("Motion ratio", "", "turn on the spring and damper to see it"); break; }
      D.label(V.add(sst.damper_out, [0, 0, 70]), `damper ${fmt(sst.damper_len, 1)} mm`, A);
      cap("Motion ratio", fmt(m.motion_ratio, 3), `damper ${fmt(sst.damper_len, 1)} mm at ${fmt(pose.dz, 0)} mm wheel travel`); break;
    }
  }
  const hb = $("#ovHide"); if (hb) hb.onclick = () => showMe(null);
  const rb = $("#ovReplay"); if (rb) rb.onclick = () => showMe(view.overlay);
}
function ackPoints(s) {   // where each front wheel's axle line crosses the rear axle line, at the current rack
  try {
    const q1 = s.observe(s.pose(pose.dz, pose.rack), pose.dz, pose.rack)._pts, q2 = s.observe(s.pose(pose.dz, -pose.rack), pose.dz, -pose.rack)._pts;
    const rx = q1.cp[0] - s.WB;
    const w = [[[q1.c[0], q1.c[1], 3], [q1.a[0], q1.a[1], 0]], [[q2.c[0], -q2.c[1], 3], [q2.a[0], -q2.a[1], 0]]].map(([c, d]) => {
      const t = Math.abs(d[0]) > 1e-6 ? (rx - c[0]) / d[0] : NaN; return { c, d, hit: Number.isFinite(t) ? [rx, c[1] + t * d[1]] : null }; });
    return { rx, w };
  } catch (e) { return null; }
}
function rad0(dz) { // rocker angle guess from the sweep, keeps the rocker on its branch
  if (!ev.ride) return 0; const r = ev.rows; let best = r[0]; for (const q of r) if (Math.abs(q.dz - dz) < Math.abs(best.dz - dz)) best = q; return (best.rocker_deg || 0) * Math.PI / 180;
}
let poseTimer = null;
function onPose() {
  stopAnim();
  pose.dz = +$("#poseZ").value; pose.rack = +$("#poseR").value;
  $("#poseZo").value = (+pose.dz).toFixed(1); $("#poseRo").value = (+pose.rack).toFixed(1);
  cancelAnimationFrame(poseTimer);
  poseTimer = requestAnimationFrame(() => {
    updateScene();
    if (!err && ev) { const map = { heave: panelHeave, spring: panelSpring, steer: panelSteer }; if (map[tab]) $("#pn_" + tab).innerHTML = (MOTION.includes(tab) ? motionSeg(tab) : "") + map[tab](); }
  });
}
$("#poseZ").addEventListener("input", onPose); $("#poseR").addEventListener("input", onPose);
$("#poseZo").addEventListener("change", (e) => { const v = +e.target.value; if (Number.isFinite(v)) { $("#poseZ").value = v; onPose(); } });
$("#poseRo").addEventListener("change", (e) => { const v = +e.target.value; if (Number.isFinite(v)) { $("#poseR").value = v; onPose(); } });
$("#poseZ0").addEventListener("click", () => { $("#poseZ").value = 0; onPose(); });
$("#poseR0").addEventListener("click", () => { $("#poseR").value = 0; onPose(); });
$("#posePlay").addEventListener("click", () => { stopAnim(); if (!reduceMotion) view.anim = { t0: null, T: cfg.sweep.travel }; else { $("#poseZ").value = cfg.sweep.travel; onPose(); } });
const mq = window.matchMedia("(prefers-color-scheme: dark)"); if (mq.addEventListener) mq.addEventListener("change", () => updateScene());
new MutationObserver(() => updateScene()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

