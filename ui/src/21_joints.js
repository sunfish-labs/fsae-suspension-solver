// 21_joints.js - Rod-end and spherical-bearing misalignment: the table for the Packaging tab, the report and Excel.
const MOUNT_NAME = { chassis: "chassis", upright: "upright", upper: "upper wishbone", lower: "lower wishbone", rocker: "rocker" };
const BOLT_NAME = {
  x: "fore-aft (X)",
  y: "sideways (Y)",
  z: "vertical (Z)",
  pivot: "along the wishbone pivot axis",
  kingpin: "along the kingpin axis",
  rocker: "along the rocker axis",
  vector: "set direction",
};
function nearAxis(v) {
  const a = v.map(Math.abs),
    i = a.indexOf(Math.max(...a));
  return a[i] > 0.9 ? ` (≈ ${"XYZ"[i]})` : "";
}
function boltText(r) {
  if (r.kind === "bearing")
    return `race in the ${MOUNT_NAME[r.mount]}, bolt in the upright ${BOLT_NAME[r.bolt] || r.bolt}, aligned at ${r.align ? `${r.align > 0 ? "+" : ""}${fmt(r.align, 0)} mm of wheel travel` : "ride height"}`;
  return `bolt on the ${MOUNT_NAME[r.mount]}, ${BOLT_NAME[r.bolt] || r.bolt}${r.square ? ", bracket square to the rod end at ride height" : ""}`;
}
const vecTxt = v => `[${v.map(q => fmt(q, 2)).join(", ")}]`;
// rows for one corner: [{...row, status, bestTxt}]
function jointRows(e) {
  if (!e.joints) return [];
  return e.joints.rows.map(r => ({
    ...r,
    ok: r.margin >= 0,
    bestTxt: r.best && r.worst - r.best.worst > 0.5 ? `${vecTxt(r.best.bolt)}${nearAxis(r.best.bolt)}: worst ${fmt(r.best.worst, 1)}°` : "",
  }));
}
const atTxt = (r, front) => `${fmt(r.at[0], 0)} mm${front ? `, rack ${fmt(r.at[1], 0)} mm` : ""}`;
// the bolt choices offered per joint in the Packaging tab
function boltChoices(r, e) {
  const sp = e.cfg.spring,
    out = [["", "default"]];
  if (r.kind === "bearing") out.push(["kingpin", "kingpin axis"], ["pivot", "wishbone pivot axis"], ["x", "X"], ["y", "Y"], ["z", "Z"]);
  else {
    out.push(["x", "X, square"], ["y", "Y, square"], ["z", "Z, square"]);
    if (r.mount === "upper" || r.mount === "lower" || /inboard_(front|rear)$/.test(r.key)) out.push(["pivot", "pivot axis"]);
    if (sp && sp.rocker_axis) out.push(["rocker", "rocker axis"]);
    if (r.best) out.push(["best", "best direction"]);
  }
  return out;
}
function jointTable(e, { editable = false } = {}) {
  const rows = jointRows(e);
  if (!rows.length) return `<p class="note">Not computed.</p>`;
  const front = e.cfg.axle === "front",
    cur = e.cfg.joints || {};
  const sel = r => {
    const uc = cur[r.key] || {},
      v = Array.isArray(uc.bolt) ? "vector" : uc.bolt || "";
    const opts = boltChoices(r, e);
    if (v === "vector") opts.push(["vector", "set direction"]);
    const align =
      r.kind === "bearing"
        ? `<label class="jal"><small>aligned at</small> <input class="jnum jalign" type="number" step="1" data-joint="${attr(r.key)}" value="${uc.align != null ? attr(uc.align) : ""}" placeholder="0" aria-label="Wheel travel where ${attr(r.label)} is square, mm"> <small>mm</small></label>`
        : "";
    return `<select class="sel jbolt" data-joint="${attr(r.key)}" aria-label="Bolt direction for ${attr(r.label)}">${opts.map(([k, t]) => `<option value="${attr(k)}"${k === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>${align}`;
  };
  // the limit: this joint's own value from the joints block, else the catalog default (shown as the placeholder)
  const lim = r => {
    const uc = cur[r.key] || {};
    return editable
      ? `<input class="jnum jallow" type="number" step="0.5" min="0.5" data-joint="${attr(r.key)}" value="${uc.allow != null ? attr(uc.allow) : ""}" placeholder="${attr(fmt(r.allow, 1))}" aria-label="Misalignment limit for ${attr(r.label)}, degrees">°`
      : `${fmt(r.allow, 1)}°`;
  };
  return `<div class="tbl-wrap"><table class="data jtab"><thead><tr><th>Joint</th><th>How it is mounted</th><th class="n">At ride</th><th class="n">Worst</th><th>Worst at travel${front ? " / rack" : ""}</th><th class="n">Limit</th><th class="n">Margin</th><th></th><th>Better bolt direction</th>${editable ? "<th>Bolt</th>" : ""}</tr></thead><tbody>${rows
    .map(
      r =>
        `<tr><td>${esc(r.label)}<br><small class="note">${r.kind === "bearing" ? "spherical bearing" : "rod end"}</small></td><td><small>${esc(boltText(r))}</small></td><td class="n">${fmt(r.ride, 1)}°</td><td class="n">${fmt(r.worst, 1)}°</td><td>${atTxt(r, front)}</td><td class="n">${lim(r)}</td><td class="n">${fmt(r.margin, 1)}°</td><td>${r.ok ? `<span class="pill ok">OK</span>` : `<span class="pill bad">Binds</span>`}</td><td><small>${esc(r.bestTxt)}</small></td>${editable ? `<td>${sel(r)}</td>` : ""}</tr>`
    )
    .join("")}</tbody></table></div>`;
}
const JOINT_NOTE =
  "Misalignment = how far each rod end or spherical bearing tilts from square to its bolt, searched over the whole travel and rack range. A rod end can spin on its link, so only the link's angle to the plane square to the bolt counts; a spherical bearing (the ball joints) is square at ride height unless you set it otherwise. Limits are the catalog's misalignment angles (inputs → Loads → Parts); type a joint's own limit in its row to override it. A ball joint can be set square at another wheel travel (aligned at, mm), for example mid-bump where it spends most of its time. Past the limit the joint binds: use a high-misalignment rod end or misalignment spacers, or turn the bracket to the better bolt direction.";
// a number typed in a joint's row: allow (deg) or align (mm); empty removes it
function setJointNum(key, field, raw) {
  const v = raw.trim() === "" ? null : +raw;
  if (v != null && !Number.isFinite(v)) return;
  pushHistory();
  cfg.joints = Object.assign({}, cfg.joints || {});
  const uc = Object.assign({}, cfg.joints[key] || {});
  if (v == null || (field === "align" && v === 0)) delete uc[field];
  else uc[field] = v;
  if (Object.keys(uc).length) cfg.joints[key] = uc;
  else delete cfg.joints[key];
  if (!Object.keys(cfg.joints).length) delete cfg.joints;
  schedule();
}
function wireJointSelects(box) {
  $$(".jallow", box).forEach(i => i.addEventListener("change", () => setJointNum(i.dataset.joint, "allow", i.value)));
  $$(".jalign", box).forEach(i => i.addEventListener("change", () => setJointNum(i.dataset.joint, "align", i.value)));
  $$(".jbolt", box).forEach(s =>
    s.addEventListener("change", () => {
      const key = s.dataset.joint,
        r = (ev.joints ? ev.joints.rows : []).find(q => q.key === key);
      pushHistory();
      cfg.joints = Object.assign({}, cfg.joints || {});
      const uc = Object.assign({}, cfg.joints[key] || {});
      delete uc.bolt;
      delete uc.square;
      if (s.value === "best" && r && r.best) Object.assign(uc, { bolt: r.best.bolt.map(v => +v.toFixed(4)), square: false });
      else if (s.value && s.value !== "vector") uc.bolt = s.value;
      if (Object.keys(uc).length) cfg.joints[key] = uc;
      else delete cfg.joints[key];
      if (!Object.keys(cfg.joints).length) delete cfg.joints;
      schedule();
    })
  );
}
