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
    <h3 class="sub-h">Drivetrain: gearing and the acceleration run</h3><div id="dtBox">${drivetrainHtml()}</div>`;
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
        chRenderClear(await chClearance(), $("#layClear", box));
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
