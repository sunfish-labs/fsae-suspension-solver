// ------------------------------------------------------------------ vehicle layout and drivetrain (Car view)
// The car's parts with mass, position and size (car.layout), the drivetrain (car.drivetrain), their totals and the
// straight-line run. Positions are in the car frame (the front corner's X, Y right, Z up); coordinates go through
// dispPt / undispPt so the Settings' coordinate frame applies to them like to the hardpoints.
let layRes = null,
  layErr = null,
  layAccel = null,
  layShow = store.get("susp.layShow") !== "0";
const LAY_GROUPS = ["driver", "chassis", "drivetrain", "cooling", "electrical", "controls", "suspension", "other"];
// the car's mass and CG from the layout, written into the shared vehicle block when layout.apply is on
function syncLayout() {
  layRes = null;
  layErr = null;
  if (!car || !car.layout) return;
  try {
    S.checkLayout(car.layout);
    layRes = S.layoutMass(car.layout, car.front, car.rear, car.vehicle.wheelbase);
    if (car.layout.apply) Object.assign(car.vehicle, S.applyLayout(car.vehicle, layRes));
  } catch (e) {
    layErr = e.message;
  }
}
function layoutStarter() {
  const p = PRESETS.find(q => q.cfg && q.cfg.layout);
  return p ? JSON.parse(JSON.stringify({ layout: p.cfg.layout, drivetrain: p.cfg.drivetrain })) : null;
}
function layNum(i, k, j, v, opts = {}) {
  return `<input class="num lnum" type="number" step="${attr(opts.step ?? "any")}" data-lay="${attr(i)}" data-lk="${attr(k)}"${j != null ? ` data-lj="${attr(j)}"` : ""} value="${attr(v ?? "")}" aria-label="${attr(opts.aria || k)}">`;
}
function layoutTableHtml() {
  const C = car.layout.components;
  const rows = C.map((c, i) => {
    const at = dispPt(c.at, "car"),
      sz = c.size || ["", "", ""];
    return `<tr><td><input class="ltext" type="text" data-lay="${attr(i)}" data-lk="name" value="${attr(c.name || "")}" aria-label="Part name"></td>
      <td><select class="sel lsel" data-lay="${attr(i)}" data-lk="group" aria-label="Group">${LAY_GROUPS.map(g => `<option${(c.group || "other") === g ? " selected" : ""}>${g}</option>`).join("")}</select></td>
      <td class="n">${layNum(i, "mass", null, c.mass, { step: 0.5, aria: `${c.name} mass, kg` })}</td>
      ${[0, 1, 2].map(j => `<td class="n">${layNum(i, "at", j, +at[j].toFixed(1), { step: 5, aria: `${c.name} ${frameAxisName(j)}` })}</td>`).join("")}
      ${[0, 1, 2].map(j => `<td class="n">${layNum(i, "size", j, sz[j], { step: 5, aria: `${c.name} size ${j}` })}</td>`).join("")}
      <td class="c"><input type="checkbox" data-lay="${attr(i)}" data-lk="solid"${c.solid !== false ? " checked" : ""} aria-label="${attr(c.name)}: a solid part (drawn and checked for clearance)"></td>
      <td><button class="btn small" type="button" data-laydel="${attr(i)}" aria-label="Remove ${attr(c.name)}" title="Remove">✕</button></td></tr>`;
  }).join("");
  return `<div class="tbl-wrap"><table class="data laytab"><thead><tr><th>Part</th><th>Group</th><th class="n">Mass, kg</th>${[0, 1, 2].map(j => `<th class="n">${frameAxisName(j)}, mm</th>`).join("")}<th class="n">Length</th><th class="n">Width</th><th class="n">Height</th><th title="A solid part: drawn in 3D and checked for clearance. Off for mass spread over the car (frame, wiring)">Solid</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="laybtns"><button class="btn small" type="button" id="layAdd">+ Add a part</button></div>`;
}
function layoutTotalsHtml() {
  if (layErr) return `<div class="banner bad">${esc(layErr)}</div>`;
  const R = layRes,
    cg = dispPt(R.cg, "car");
  const grp = Object.entries(R.groups)
    .sort((a, b) => b[1] - a[1])
    .map(([g, m]) => `<span class="pill neutral">${esc(g)} ${fmt(m, 1)} kg</span>`)
    .join("");
  return `<div class="kv">
      <div><span>Total, with ${fmt(R.unsprung, 1)} kg of wheel assemblies</span><b>${fmt(R.mass, 1)} <small>kg</small></b></div>
      <div><span>Weight on front / left</span><b>${fmt(R.weight_front * 100, 1)} <small>%</small> / ${fmt(R.weight_left * 100, 1)} <small>%</small></b></div>
      <div><span>CG height</span><b>${fmt(R.cg_height, 0)} <small>mm</small></b></div>
      <div><span>CG ${frameAxisName(0)} / ${frameAxisName(1)} / ${frameAxisName(2)}</span><b>${cg.map(v => fmt(v, 0)).join(" / ")} <small>mm</small></b></div>
      <div><span>Inertia about the CG: roll / pitch / yaw</span><b>${fmt(R.Ixx, 1)} / ${fmt(R.Iyy, 1)} / ${fmt(R.Izz, 1)} <small>kg m²</small></b></div></div>
    <div class="laygroups">${grp}</div>`;
}
function drivetrainHtml() {
  const d = car.drivetrain;
  if (!d)
    return `<p class="note">No drivetrain yet. <button class="btn small" type="button" id="dtStart">Start from the example single-cylinder drivetrain</button></p>`;
  const f = (lab, unit, k, step = "any", extra = "") =>
    `<div class="field"><label>${lab} <i>${unit}</i></label><input class="num" type="number" step="${attr(step)}" data-lay="dt" data-lk="${attr(k)}" value="${attr(d[k] ?? "")}"${extra} aria-label="${attr(lab)}"></div>`;
  const tc = (d.torque_curve || []).map(p => p.join(", ")).join("\n");
  let res = "";
  if (layAccel && layAccel.err) res = `<div class="banner bad">${esc(layAccel.err)}</div>`;
  else if (layAccel) {
    const A = layAccel;
    res = `<div class="kv">
        <div><span>${fmt(A.distance, 0)} m acceleration</span><b>${fmt(A.time, 2)} <small>s</small></b></div>
        <div><span>Speed at the line</span><b>${fmt(A.speed * 3.6, 1)} <small>km/h</small></b></div>
        <div><span>Grip-limited for the first</span><b>${fmt(A.grip_limited_to, 1)} <small>m</small></b></div>
        <div><span>Launch / grip limit</span><b>${fmt(A.launch_accel, 2)} / ${fmt(A.grip_accel, 2)} <small>g</small></b></div>
        <div><span>Top speed</span><b>${fmt(A.top_speed * 3.6, 1)} <small>km/h</small></b></div></div>
      <div class="tbl-wrap"><table class="data"><thead><tr><th>Gear</th><th class="n">Overall ratio</th><th class="n">At the redline, km/h</th><th>Shift</th></tr></thead><tbody>
      ${A.gears
        .map(g => {
          const s = A.shifts.find(q => q.gear === g.gear + 1);
          return `<tr><td>${g.gear}</td><td class="n">${fmt(g.ratio, 2)}</td><td class="n">${fmt(g.top_speed * 3.6, 1)}${g.max_speed < g.top_speed - 1e-6 ? ` <span class="muted">(drag: ${fmt(g.max_speed * 3.6, 1)})</span>` : ""}</td><td>${s ? `to ${s.gear} at ${fmt(s.t, 2)} s, ${fmt(s.x, 1)} m` : '<span class="muted">–</span>'}</td></tr>`;
        })
        .join("")}</tbody></table></div>
      <div class="charts">${chart({
        title: "Speed in the acceleration run, km/h",
        xlabel: "distance, m",
        series: [{ name: "speed", x: A.trace.map(p => p[1]), y: A.trace.map(p => p[2] * 3.6), color: "var(--s1)" }],
      })}${chart({
        title: "Engine torque, N m",
        xlabel: "rpm",
        series: [{ name: "torque", x: d.torque_curve.map(p => p[0]), y: d.torque_curve.map(p => p[1]), color: "var(--s2)" }],
      })}</div>`;
  }
  return `<div class="fields">
      <div class="field wide"><label>Name</label><input class="ltext" type="text" data-lay="dt" data-lk="name" value="${attr(d.name || "")}" aria-label="Drivetrain name"></div>
      <div class="field wide"><label>Torque curve <i>rpm, N m (one point per line)</i></label><textarea class="laytc" rows="5" data-lay="dt" data-lk="torque_curve" aria-label="Torque curve">${esc(tc)}</textarea></div>
      <div class="field wide"><label>Gear ratios <i>first to last, commas</i></label><input class="ltext" type="text" data-lay="dt" data-lk="gears" value="${attr((d.gears || []).join(", "))}" aria-label="Gear ratios"></div>
      ${f("Primary ratio", "", "primary", 0.01)}${f("Final drive (rear / front sprocket)", "", "final", 0.01)}
      ${f("Redline", "rpm", "redline", 100)}${f("Launch (clutch) rpm", "rpm", "launch_rpm", 100)}
      ${f("Drivetrain efficiency", "0–1", "efficiency", 0.01)}${f("Shift time", "s", "shift_time", 0.01)}
      ${f("Spinning parts as extra mass", "× mass", "mass_factor", 0.01)}${f("Drag area (Cd × A)", "m²", "drag_area", 0.05)}
      ${f("Rolling resistance", "", "rolling", 0.001)}</div>
    <p class="note">Rear-wheel drive from rest, shifting at the redline. Wheel force = torque × primary × gear × final × efficiency ÷ tire radius, capped by the rear tires' grip (μ ${fmt(+(car.vehicle.tire_mu || 1.5), 2)} from Tires at the limit), which grows as the load moves back. Below the launch rpm the clutch slips and the engine gives its torque there. A straight-line estimate: no wheelspin model or tire curve.</p>
    ${res}`;
}
function renderLayoutBox() {
  const box = $("#layBox");
  if (!box || !car) return;
  if (box.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
    // don't rebuild under the cursor: just refresh the results
    const t = $("#layTotals", box),
      dr = $("#dtRes", box);
    if (t && car.layout) t.innerHTML = layoutTotalsHtml();
    if (dr && car.drivetrain) dr.innerHTML = drivetrainResultsOnly();
    const cr = $("#ckRes", box);
    if (cr && car.cockpit) cr.innerHTML = cockpitResults();
    const gr = $("#gpRes", box);
    if (gr) gr.innerHTML = groundResults();
    return;
  }
  runAccel();
  box.innerHTML = `<h3 class="sub-h">Layout: what sits where</h3>
    ${
      car.layout
        ? `<label class="small-check"><input type="checkbox" id="layApply"${car.layout.apply ? " checked" : ""}> Use the layout for the car's mass, front weight and CG height</label>
      <div id="layTotals">${layoutTotalsHtml()}</div>${layoutTableHtml()}
      <p class="note">Each part's CG position and a box around it (its inertia; solid parts are also drawn and checked for clearance: untick <i>Solid</i> for mass spread over the car, like the frame or the wiring). The four wheel assemblies come from each corner's unsprung mass, at the wheel centers. ${frameNote("car")}</p>
      <div class="laybtns"><button class="btn small" type="button" id="layCheck">Check link clearance to these parts</button><button class="btn small" type="button" id="layRemove">Remove the layout</button></div>
      <div id="layClear"></div>`
        : `<p class="note">Put in the main parts (engine, driver, fuel, battery, differential…) with their masses and positions to get the car's mass, weight split, CG height and inertia from them instead of guessing, see them as boxes in the 3D view, and check the suspension links against them over travel and steer.</p>
      <div class="laybtns"><button class="btn small" type="button" id="layStart">Start from a typical first-year layout</button><button class="btn small" type="button" id="layBlank">Start empty</button></div>`
    }
    <h3 class="sub-h">Drivetrain: gearing and the acceleration run</h3><div id="dtBox">${drivetrainHtml()}</div>
    <h3 class="sub-h">Driver and roll hoops (side view)</h3><div id="ckBox">${cockpitHtml()}</div>
    <h3 class="sub-h">Lowest points (ground clearance)</h3><div id="gpBox">${groundHtml()}</div>`;
  wireLayout(box);
}
function drivetrainResultsOnly() {
  const h = drivetrainHtml(),
    i = h.indexOf('<div class="kv">');
  return i >= 0 ? h.slice(i) : "";
}
function runAccel() {
  layAccel = null;
  if (!car || !car.drivetrain) return;
  try {
    S.checkDrivetrain(car.drivetrain);
    const r = carRes || evalCar(),
      veh = car.vehicle,
      R = (r && r.R.ev ? r.R.ev.cfg.wheel.tire_radius : car.rear.wheel.tire_radius) || 254;
    layAccel = S.accelRun(car.drivetrain, veh, R, veh.wheelbase);
  } catch (e) {
    layAccel = { err: e.message };
  }
}
function wireLayout(box) {
  const edit = fn => {
    pushHistory();
    fn();
    schedule();
  };
  const st = $("#layStart", box);
  if (st)
    st.addEventListener("click", () =>
      edit(() => {
        const s = layoutStarter();
        car.layout = s ? s.layout : { apply: false, components: [] };
        car.layout.apply = false;
        if (!car.drivetrain && s) car.drivetrain = s.drivetrain;
      })
    );
  const bl = $("#layBlank", box);
  if (bl)
    bl.addEventListener("click", () =>
      edit(
        () =>
          (car.layout = {
            apply: false,
            components: [{ name: "Driver", group: "driver", mass: 75, at: [-760, 0, 330], size: [1100, 420, 560] }],
          })
      )
    );
  const ds = $("#dtStart", box);
  if (ds)
    ds.addEventListener("click", () =>
      edit(() => {
        const s = layoutStarter();
        car.drivetrain = s ? s.drivetrain : null;
      })
    );
  const rm = $("#layRemove", box);
  if (rm) rm.addEventListener("click", () => edit(() => (car.layout = null)));
  const ap = $("#layApply", box);
  if (ap) ap.addEventListener("change", () => edit(() => (car.layout.apply = ap.checked)));
  const add = $("#layAdd", box);
  if (add)
    add.addEventListener("click", () =>
      edit(() => car.layout.components.push({ name: "New part", group: "other", mass: 1, at: [-700, 0, 300], size: [100, 100, 100] }))
    );
  $$("[data-laydel]", box).forEach(b => b.addEventListener("click", () => edit(() => car.layout.components.splice(+b.dataset.laydel, 1))));
  $$("[data-lay]", box).forEach(el =>
    el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
      const k = el.dataset.lk;
      if (el.dataset.lay === "dt") {
        const d = car.drivetrain;
        if (k === "name") d.name = el.value;
        else if (k === "torque_curve") {
          const pts = el.value
            .split(/\n/)
            .map(l =>
              l
                .split(/[,;\s]+/)
                .filter(Boolean)
                .map(Number)
            )
            .filter(p => p.length === 2 && p.every(Number.isFinite));
          if (pts.length >= 2) d.torque_curve = pts;
          else return;
        } else if (k === "gears") {
          const g = el.value
            .split(/[,;\s]+/)
            .filter(Boolean)
            .map(Number);
          if (g.length && g.every(v => Number.isFinite(v) && v > 0)) d.gears = g;
          else return;
        } else {
          if (el.value === "") delete d[k];
          else if (Number.isFinite(+el.value)) d[k] = +el.value;
          else return;
        }
        schedule();
        return;
      }
      const c = car.layout.components[+el.dataset.lay];
      if (!c) return;
      if (k === "name") c.name = el.value;
      else if (k === "group") c.group = el.value;
      else if (k === "solid") {
        if (el.checked) delete c.solid;
        else c.solid = false;
      } else if (k === "mass") {
        if (!(+el.value > 0)) return;
        c.mass = +el.value;
      } else if (k === "at") {
        if (el.value === "" || !Number.isFinite(+el.value)) return;
        const d = dispPt(c.at, "car");
        d[+el.dataset.lj] = +el.value;
        c.at = undispPt(d, "car").map(v => +v.toFixed(6));
      } else if (k === "size") {
        const s = c.size ? c.size.slice() : [100, 100, 100];
        if (!(+el.value > 0)) return;
        s[+el.dataset.lj] = +el.value;
        c.size = s;
      }
      schedule();
    })
  );
  const ck = $("#layCheck", box);
  if (ck)
    ck.addEventListener("click", async () => {
      ck.disabled = true;
      ck.textContent = "Checking…";
      try {
        chassis.clear = await chClearance(); // the design check reads it too
        chRenderClear(chassis.clear, $("#layClear", box));
      } finally {
        ck.disabled = false;
        ck.textContent = "Check link clearance to these parts";
      }
    });
}
// ---- the parts as boxes in the 3D view (car frame; a rear corner view shifts them like the chassis model)
function layoutBoxes() {
  if (!car || !car.layout || chal) return [];
  return car.layout.components
    .filter(c => c.size && c.solid !== false)
    .map(c => ({ name: c.name || "part", at: c.at, size: c.size, group: c.group || "other" }));
}
const LAY_COLORS = {
  driver: "#2F5D7C",
  chassis: "#7a8794",
  drivetrain: "#b42318",
  cooling: "#1f7a8c",
  electrical: "#9E7E38",
  controls: "#5b4b8a",
  suspension: "#3d6b3d",
  other: "#8d99a6",
};
function drawLayout(group, dx = 0) {
  $("#tgLayout").hidden = !(car && car.layout && !chal);
  $("#tgLayout").setAttribute("aria-pressed", String(layShow));
  if (!layShow || !three) return;
  const T = three.T,
    boxes = layoutBoxes();
  for (const b of boxes) {
    const g = new T.BoxGeometry(b.size[0], b.size[2], b.size[1]),
      m = new T.MeshStandardMaterial({
        color: new T.Color(LAY_COLORS[b.group] || LAY_COLORS.other),
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        roughness: 0.8,
      }),
      me = new T.Mesh(g, m);
    me.position.copy(toT([b.at[0] + dx, b.at[1], b.at[2]]));
    me.userData.layName = b.name;
    group.add(me);
    const e = new T.LineSegments(
      new T.EdgesGeometry(g),
      new T.LineBasicMaterial({ color: new T.Color(LAY_COLORS[b.group] || LAY_COLORS.other), transparent: true, opacity: 0.7 })
    );
    e.position.copy(me.position);
    group.add(e);
  }
  if (layRes && boxes.length) {
    const D = drawKit(group, themeColors(), true),
      cg = [layRes.cg[0] + dx, layRes.cg[1], layRes.cg[2]];
    D.dot(cg, "#d1342f", 16);
    D.label([cg[0], cg[1], cg[2] + 90], "layout CG", "#d1342f");
  }
}
// triangles of the layout boxes, for the clearance check: [Float32Array of triangles, owner name per triangle]
function layoutTris() {
  const boxes = layoutBoxes(),
    P = new Float32Array(boxes.length * 12 * 9),
    names = [];
  const F = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ];
  let o = 0;
  for (const b of boxes) {
    const h = b.size.map(v => v / 2),
      V8 = [];
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) for (const sz of [-1, 1]) V8.push([b.at[0] + sx * h[0], b.at[1] + sy * h[1], b.at[2] + sz * h[2]]);
    for (const [a, c, d, e] of F)
      for (const tri of [
        [a, c, d],
        [a, d, e],
      ]) {
        for (const vi of tri) for (let j = 0; j < 3; j++) P[o++] = V8[vi][j];
        names.push(b.name);
      }
  }
  return [P, names];
}
$("#tgLayout").addEventListener("click", () => {
  layShow = !layShow;
  store.set("susp.layShow", layShow ? "1" : "0");
  updateScene();
});

// ---- driver template and roll hoops in side view: a few points off the frame CAD (car.cockpit), checked by F.5.6-F.5.9
const CK_PTS = [
  ["main_hoop_top", "Main Hoop, top-most surface"],
  ["front_hoop_top", "Front Hoop, top-most surface"],
  ["brace_upper", "Main Hoop Braces, where they attach"],
  ["brace_lower", "Main Hoop Braces, lower end"],
  ["hip", "Template hip circle center (seat back)"],
];
// optional: the side impact structure, the hoops' lower parts and the harness mounts (frame and harness rules)
const CK_OPT = [
  ["sis_upper_front", "Upper Side Impact Member, top edge at the front"],
  ["sis_upper_rear", "Upper Side Impact Member, top edge at the rear"],
  ["sis_lower_low", "Lower Side Impact Member, bottom at its lowest"],
  ["front_hoop_at_sis", "Front Hoop where the upper side impact member meets it"],
  ["main_hoop_at_sis", "Main Hoop where the upper side impact member attaches"],
  ["main_hoop_bottom", "Main Hoop, bottom"],
  ["lap_belt_mount", "Lap belt mount"],
  ["shoulder_belt_mount", "Shoulder harness bar (where the belt wraps)"],
];
const CK_NUMS = [
  ["back_angle", "Seat back angle from vertical", "deg"],
  ["neck_angle", "Neck line recline beyond the back", "deg"],
];
const CK_X = [
  ["pedal_face_x", "Rearmost pedal face (pedals forward)"],
  ["wheel_front_x", "Steering wheel rim, forward-most"],
];
const ckVi = () => (SET.axes === "sw" ? 1 : 2); // which shown axis is the height
function ckShow(p) {
  const d = dispPt([p[0], 0, p[1]], "car");
  return [d[0], d[ckVi()]];
}
function ckStore(old, j, v) {
  const d = dispPt([old[0], 0, old[1]], "car");
  d[j === 0 ? 0 : ckVi()] = v;
  const s = undispPt(d, "car");
  return [+s[0].toFixed(6), +s[2].toFixed(6)];
}
function cockpitStarter() {
  const p = PRESETS.find(q => q.cfg && q.cfg.cockpit);
  return p ? JSON.parse(JSON.stringify(p.cfg.cockpit)) : null;
}
function cockpitHtml() {
  const ck = car.cockpit;
  if (!ck)
    return `<p class="note">Seven points off your frame CAD's side view (hoop tops, brace ends, seat hip point and back angle, pedal face, steering wheel) check the 95th percentile driver template and the roll hoops against F.5.6.4 to F.5.9.4: helmet 50 mm under the hoop lines, 915 mm from hip to pedals, the Front Hoop over and near the steering wheel, the braces near the top. Optional frame and harness points add the side impact structure heights, the hoops' angles and the belt angles.</p>
      <div class="laybtns"><button class="btn small" type="button" id="ckStart">Start from the example's points</button></div>`;
  const hn = frameAxes().names,
    vi = ckVi();
  const rows = [...CK_PTS, ["_opt", ""], ...CK_OPT]
    .map(([k, lab]) => {
      if (k === "_opt")
        return `<tr><td colspan="3" class="muted"><b>Frame and harness</b> (optional, for F.5.7.6 to F.6.4.4, V.1.4.2 and T.2.5 to T.2.6)</td></tr>`;
      const p = ck[k],
        s = p ? ckShow(p) : ["", ""];
      return `<tr><td>${lab}</td>${[0, 1].map(j => `<td class="n"><input class="num lnum" type="number" step="5" data-ck="${attr(k)}" data-cj="${j}" value="${attr(p ? +s[j].toFixed(1) : "")}" aria-label="${attr(lab)} ${j ? "height" : "fore-aft"}"></td>`).join("")}</tr>`;
    })
    .join("");
  const xs = CK_X.map(([k, lab]) => {
    const v = ck[k] != null ? dispPt([ck[k], 0, 0], "car")[0] : "";
    return `<div class="field"><label>${lab} <i>${esc(hn[0])}, mm</i></label><input class="num" type="number" step="5" data-ck="${attr(k)}" data-cj="x" value="${attr(v === "" ? "" : +v.toFixed(1))}"></div>`;
  }).join("");
  const nums = CK_NUMS.map(
    ([k, lab, u]) =>
      `<div class="field"><label>${lab} <i>${u}</i></label><input class="num" type="number" step="1" data-ck="${attr(k)}" data-cj="n" value="${attr(ck[k] ?? "")}"></div>`
  ).join("");
  return `<div class="tbl-wrap"><table class="data laytab"><thead><tr><th>Point</th><th class="n">${esc(hn[0])}, mm</th><th class="n">${esc(hn[vi])} (height), mm</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="fields">${xs}<div class="field"><label>Steering wheel top, any angle <i>height, mm</i></label><input class="num" type="number" step="5" data-ck="wheel_top_z" data-cj="n" value="${attr(ck.wheel_top_z ?? "")}"></div>${nums}<div class="field"><label>Shoulder belt mounts, center to center <i>mm</i></label><input class="num" type="number" step="5" data-ck="shoulder_belt_spacing" data-cj="n" value="${attr(ck.shoulder_belt_spacing ?? "")}"></div></div>
    <div id="ckRes">${cockpitResults()}</div>
    <p class="note">Side view on the car's centerline. The template (F.5.6.5): 200 mm hip and shoulder circles 490 mm apart along the seat back, a 300 mm head circle 280 mm on. Place it as F.5.6.6 says (seat rearmost, pedals forward) and check the head sits within 25 mm of the head restraint. ${frameNote("car")}</p>
    <div class="laybtns"><button class="btn small" type="button" id="ckRemove">Remove these points</button></div>`;
}
function cockpitResults() {
  const ck = car.cockpit;
  let v;
  try {
    S.checkCockpit(ck);
    v = S.cockpitValues(ck);
  } catch (e) {
    return `<div class="banner bad">${esc(e.message)}</div>`;
  }
  const T = v._template,
    pts = [
      ck.main_hoop_top,
      ck.front_hoop_top,
      ck.brace_lower,
      ck.brace_upper,
      ...(T ? [T.hip, T.shoulder, T.head] : []),
      ...CK_OPT.map(([k]) => ck[k]),
    ].filter(Boolean);
  const lo = [Math.min(...pts.map(p => p[0])) - 250, -40],
    hi = [Math.max(...pts.map(p => p[0]), ck.pedal_face_x ?? -1e9) + 150, Math.max(...pts.map(p => p[1])) + 200];
  const W = 560,
    sc = W / (hi[0] - lo[0]),
    H = (hi[1] - lo[1]) * sc,
    X = x => (x - lo[0]) * sc,
    Y = z => H - (z - lo[1]) * sc;
  const line = (a, b, c, w = 2, dash = "") =>
    `<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  const circ = (c, r, col) =>
    `<circle cx="${X(c[0])}" cy="${Y(c[1])}" r="${r * sc}" fill="${col}" fill-opacity=".12" stroke="${col}" stroke-width="1.5"/>`;
  const ok = (val, lim, max) => (typeof val !== "number" ? "var(--muted)" : (max ? val <= lim : val >= lim) ? "var(--ok)" : "var(--bad)");
  let s = `<svg viewBox="0 0 ${W} ${H.toFixed(1)}" class="cksvg" role="img" aria-label="Driver template and roll hoops, side view">`;
  s += line([lo[0], 0], [hi[0], 0], "var(--muted)", 1);
  // the hoops: through their side-impact points when given, otherwise straight down
  const mhLow = ck.main_hoop_at_sis
      ? [ck.main_hoop_at_sis, ck.main_hoop_bottom || [ck.main_hoop_at_sis[0], 0]]
      : [[ck.main_hoop_top[0], 0]],
    fhLow = ck.front_hoop_at_sis ? [ck.front_hoop_at_sis, [ck.front_hoop_at_sis[0], 0]] : [[ck.front_hoop_top[0], 0]];
  for (const [top, low] of [
    [ck.main_hoop_top, mhLow],
    [ck.front_hoop_top, fhLow],
  ]) {
    let a = top;
    for (const b of low) {
      s += line(a, b, "var(--ink)", 3);
      a = b;
    }
  }
  if (ck.sis_upper_front && ck.sis_upper_rear)
    s += line(
      ck.sis_upper_front,
      ck.sis_upper_rear,
      typeof v.upper_sis_low === "number" ? (v.upper_sis_low >= 290 && v.upper_sis_high <= 345 ? "var(--ok)" : "var(--bad)") : "var(--ink)",
      2.5
    );
  if (ck.sis_lower_low)
    s += `<circle cx="${X(ck.sis_lower_low[0])}" cy="${Y(ck.sis_lower_low[1])}" r="4" fill="${ok(v.lsis_height && v.lsis_height.v, 90, true)}"/>`;
  if (ck.lap_belt_mount && T) s += line(ck.lap_belt_mount, T.hip, "#8a5a00", 1.5, "3 3");
  if (ck.shoulder_belt_mount && T) s += line(ck.shoulder_belt_mount, [T.shoulder[0], T.shoulder[1] + 100], "#8a5a00", 1.5, "3 3");
  s += line(ck.main_hoop_top, ck.front_hoop_top, ok(v.helmet_front_line, 50), 2, "6 4");
  if (ck.brace_lower)
    s += line(ck.main_hoop_top, ck.brace_lower, typeof v.helmet_brace_line === "number" ? ok(v.helmet_brace_line, 50) : "var(--ink)", 2);
  if (T) {
    s += circ(T.hip, 100, "#2f6fd6") + circ(T.shoulder, 100, "#2f6fd6") + circ(T.head, 150, "#2f6fd6");
    s += line(T.hip, T.shoulder, "#2f6fd6", 1.5) + line(T.shoulder, T.head, "#2f6fd6", 1.5);
  }
  if (ck.pedal_face_x != null) s += line([ck.pedal_face_x, 0], [ck.pedal_face_x, 350], ok(v.hip_to_pedals, 915), 2);
  if (ck.wheel_top_z != null && ck.wheel_front_x != null)
    s += `<circle cx="${X(ck.wheel_front_x)}" cy="${Y(ck.wheel_top_z)}" r="4" fill="${ok(v.front_hoop_over_wheel, 0)}"/>`;
  s += `<text x="${X(ck.main_hoop_top[0])}" y="${Y(ck.main_hoop_top[1]) - 6}" font-size="11" text-anchor="middle" fill="var(--muted)">Main Hoop</text><text x="${X(ck.front_hoop_top[0])}" y="${Y(ck.front_hoop_top[1]) - 6}" font-size="11" text-anchor="middle" fill="var(--muted)">Front Hoop</text>`;
  s += `<text x="${X(hi[0]) - 4}" y="${Y(0) - 4}" font-size="11" text-anchor="end" fill="var(--muted)">forward →</text></svg>`;
  const kvb = (lab, a, b, lo, hi, unit) =>
    `<div><span>${lab}</span><b class="${a >= lo && b <= hi ? "ok-t" : "bad-t"}">${a === b ? fmt(a, 0) : `${fmt(a, 0)}–${fmt(b, 0)}`} <small>${unit} (${lo} to ${hi})</small></b></div>`;
  const kv = (lab, val, lim, max, unit = "mm") =>
    `<div><span>${lab}</span><b class="${typeof val !== "number" ? "" : (max ? val <= lim : val >= lim) ? "ok-t" : "bad-t"}">${typeof val === "number" ? fmt(val, 0) : "–"} <small>${unit} (${max ? "max" : "min"} ${lim})</small></b></div>`;
  const noDriver = T
    ? ""
    : `<p class="note">No seat hip point and back angle yet, so the driver template, the helmet clearances and the hip-to-pedal length aren't checked; the frame points still are.</p>`;
  return `${s}${noDriver}<div class="kv">${T ? kv("Helmet below the hoop line (F.5.6.4 a)", v.helmet_front_line, 50) : ""}${typeof v.helmet_brace_line === "number" ? kv("Helmet from the brace line (F.5.6.4 b)", v.helmet_brace_line, 50) : ""}${typeof v.helmet_behind_hoop === "number" ? kv("Helmet ahead of the Main Hoop (F.5.6.4 c)", v.helmet_behind_hoop, 0) : ""}${T ? kv("Hip to pedals (F.5.6.6)", v.hip_to_pedals, 915) : ""}${kv("Front Hoop over the wheel (F.5.7.4)", v.front_hoop_over_wheel, 0)}${kv("Front Hoop ahead of the wheel (F.5.7.5)", v.front_hoop_ahead_of_wheel, 250, true)}${kv("Brace attachment below the top (F.5.9.4)", v.brace_drop, 160, true)}${
    v.lsis_height ? kv("Lower side impact member above the ground (V.1.4.2)", v.lsis_height.v, 90, true) : ""
  }${typeof v.upper_sis_low === "number" ? kvb("Upper side impact member above it (F.6.4.4 b)", v.upper_sis_low, v.upper_sis_high, 290, 345, "mm") : ""}${
    typeof v.front_hoop_incline === "number" ? kv("Front Hoop from vertical, above (F.5.7.6)", v.front_hoop_incline, 20, true, "°") : ""
  }${typeof v.main_hoop_incline_above === "number" ? kv("Main Hoop from vertical, above (F.5.8.3)", v.main_hoop_incline_above, 10, true, "°") : ""}${
    typeof v.brace_angle === "number" ? kv("Hoop to brace angle (F.5.9.5)", v.brace_angle, 30, false, "°") : ""
  }${typeof v.lap_belt_upright === "number" ? kvb("Lap belt angle (T.2.5.4)", v.lap_belt_upright, v.lap_belt_upright, 45, 65, "°") : ""}${
    typeof v.lap_belt_reclined === "number" ? kvb("Lap belt angle (T.2.5.5)", v.lap_belt_reclined, v.lap_belt_reclined, 60, 80, "°") : ""
  }${typeof v.shoulder_belt_angle === "number" ? kvb("Shoulder belt below horizontal (T.2.6.1)", v.shoulder_belt_angle, v.shoulder_belt_angle, -10, 20, "°") : ""}</div>`;
}
document.addEventListener("click", e => {
  const t = e.target;
  if (!t || !car) return;
  if (t.id === "ckStart") {
    pushHistory();
    car.cockpit = cockpitStarter() || { main_hoop_top: [-1300, 1160], front_hoop_top: [-300, 700], hip: [-800, 200], back_angle: 30 };
    schedule();
  } else if (t.id === "ckRemove") {
    pushHistory();
    car.cockpit = null;
    schedule();
  }
});
document.addEventListener("input", e => {
  const el = e.target;
  if (!el || !el.dataset || el.dataset.ck === undefined || !car || !car.cockpit) return;
  const k = el.dataset.ck,
    j = el.dataset.cj,
    v = +el.value;
  if (el.value === "" || !Number.isFinite(v)) {
    if (
      el.value === "" &&
      (j === "x" || j === "n" || k.startsWith("brace") || k === "hip" || k === "back_angle" || CK_OPT.some(([q]) => q === k))
    ) {
      delete car.cockpit[k];
      schedule();
    }
    return;
  }
  if (j === "x") car.cockpit[k] = +undispPt([v, 0, 0], "car")[0].toFixed(6);
  else if (j === "n") car.cockpit[k] = v;
  else car.cockpit[k] = ckStore(car.cockpit[k] || [0, 0], +j, v);
  schedule();
});

// ---- the car's lowest points for the ground clearance rule (car.ground_points), and the frame model's worst point
const GP_START = [
  { name: "Front bulkhead, bottom", at: [300, 150, 95] },
  { name: "Lower side impact tube, lowest", at: [-700, 280, 75] },
  { name: "Main hoop base, bottom rail", at: [-1300, 260, 80] },
  { name: "Engine sump or lowest drivetrain part", at: [-1180, 0, 85] },
  { name: "Rear frame, bottom", at: [-1700, 200, 100] },
];
// the points the rules check uses: the car file's, plus the frame model's worst vertex once it's loaded
const gpCache = { sig: null, pt: null };
function groundPointsFor(F, R) {
  const pts = (car && car.ground_points ? car.ground_points : []).slice();
  if (chassis.base && F && R) {
    const planes = S.groundPlanes(F.cfg, F, R.cfg, R, +car.vehicle.wheelbase)[0],
      sig = chSignature() + JSON.stringify(planes.map(p => [p.a, p.b, p.c]));
    if (gpCache.sig !== sig) {
      const P = chMoved();
      let best = null;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i],
          y = P[i + 1],
          z = P[i + 2];
        let dr = -Infinity;
        for (const pl of planes) dr = Math.max(dr, pl.a + pl.b * x + pl.c * y);
        const cl = z - dr;
        if (!best || cl < best[0]) best = [cl, x, y, z];
      }
      gpCache.sig = sig;
      gpCache.pt = best ? { name: "Frame model, lowest point in motion", at: best.slice(1) } : null;
    }
    if (gpCache.pt) pts.push(gpCache.pt);
  }
  return pts.length ? pts : null;
}
function groundResults() {
  const r = carRes || evalCar();
  if (!r || !r.F.ev || !r.R.ev) return "";
  const pts = groundPointsFor(r.F.ev, r.R.ev);
  if (!pts) return `<p class="note">No points yet.</p>`;
  let g;
  try {
    g = S.groundClearance(pts, S.groundPlanes(r.F.ev.cfg, r.F.ev, r.R.ev.cfg, r.R.ev, +car.vehicle.wheelbase)[0]);
  } catch (e) {
    return `<div class="banner bad">${esc(e.message)}</div>`;
  }
  const ok = g.value >= 0;
  return `<div class="kv"><div><span>Tightest point in motion</span><b class="${ok ? "ok-t" : "bad-t"}">${fmt(g.value, 1)} <small>mm · ${esc(g.point)}</small></b></div>
    <div><span>Body down there</span><b>${fmt(g.drop, 1)} <small>mm (${esc(
      Object.entries(g.state)
        .map(([k, s]) => `${k} ${s}`)
        .join(", ")
    )})</small></b></div></div>`;
}
function groundHtml() {
  const gp = car.ground_points;
  const note = `<p class="note">The lowest parts of the car at ride height, driver in: frame rails and nodes, the lower side impact tube, the impact attenuator, engine sump, diff, exhaust, bellypan. The check moves the body to every position the dampers allow (each corner from full droop to full bump, plus the tire squashing at full bump), with pitch and roll, and reports the point that gets closest to the ground (V.1.4.1). A loaded frame model (Open → Chassis model) is checked the same way, every vertex.</p>`;
  if (!gp || !gp.length)
    return `${note}<div class="laybtns"><button class="btn small" type="button" id="gpStart">Start from typical points</button></div><div id="gpRes">${groundResults()}</div>`;
  const hn = frameAxes().names;
  const rows = gp
    .map((p, i) => {
      const d = dispPt(p.at, "car");
      return `<tr><td><input class="ltext" type="text" data-gp="${i}" data-gj="name" value="${attr(p.name || "")}" aria-label="Point name"></td>${[
        0, 1, 2,
      ]
        .map(
          j =>
            `<td class="n"><input class="num lnum" type="number" step="5" data-gp="${i}" data-gj="${j}" value="${attr(+d[j].toFixed(1))}" aria-label="${attr(hn[j])}"></td>`
        )
        .join(
          ""
        )}<td><button class="btn small" type="button" data-gp-del="${i}" aria-label="Remove ${attr(p.name || "point")}">✕</button></td></tr>`;
    })
    .join("");
  return `${note}<div class="tbl-wrap"><table class="data laytab"><thead><tr><th>Point</th>${hn.map(h => `<th class="n">${esc(h)}, mm</th>`).join("")}<th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="laybtns"><button class="btn small" type="button" id="gpAdd">Add a point</button></div>
    <div id="gpRes">${groundResults()}</div><p class="note">${frameNote("car")}</p>`;
}
document.addEventListener("click", e => {
  const t = e.target;
  if (!t || !car) return;
  if (t.id === "gpStart") {
    pushHistory();
    car.ground_points = JSON.parse(JSON.stringify(GP_START));
    schedule();
  } else if (t.id === "gpAdd") {
    pushHistory();
    car.ground_points.push({ name: "New point", at: [0, 0, 100] });
    schedule();
  } else if (t.dataset && t.dataset.gpDel !== undefined) {
    pushHistory();
    car.ground_points.splice(+t.dataset.gpDel, 1);
    if (!car.ground_points.length) car.ground_points = null;
    schedule();
  }
});
document.addEventListener("input", e => {
  const el = e.target;
  if (!el || !el.dataset || el.dataset.gp === undefined || !car || !car.ground_points) return;
  const p = car.ground_points[+el.dataset.gp];
  if (!p) return;
  if (el.dataset.gj === "name") p.name = el.value;
  else {
    const v = +el.value;
    if (el.value === "" || !Number.isFinite(v)) return;
    const d = dispPt(p.at, "car");
    d[+el.dataset.gj] = v;
    p.at = undispPt(d, "car").map(x => +x.toFixed(6));
  }
  schedule();
});
