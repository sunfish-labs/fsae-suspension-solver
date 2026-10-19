// 69_lapsim.js - Lap time, point mass (Car view → Lap time). A quasi-steady point-mass model: the car is a mass with
// a friction circle (tire μ, plus downforce), an engine (the drivetrain's torque curve and gears, or a power figure),
// drag and rolling resistance. Corners cap the speed at what the grip allows; the car accelerates out of them and
// brakes into them with whatever grip the cornering leaves (the friction circle). No suspension, no load transfer
// except the rear axle's share for traction, no driver: it compares cars, it doesn't predict a lap to the tenth.
// Saved in the car file as "lapsim": {power_kw, cla, cda}. App-side only (not in the Python solver).
const LAP_G = 9.81,
  LAP_RHO = 1.2,
  LAP_DS = 0.5;
// the skidpad: one lap of a circle on the centerline (15.25 m inner diameter + 3 m wide path, D.4)
const LAP_SKID_R = 9.125;
// an example autocross-style lap, invented (not a real course): [length m, radius m (0 = straight)]; arcs by angle
const lapArc = (r, deg) => [(r * deg * Math.PI) / 180, r];
const LAP_TRACK = [
  [40, 0],
  lapArc(9, 90),
  [25, 0],
  lapArc(5, 180),
  [50, 0],
  lapArc(15, 90),
  lapArc(12, 45),
  lapArc(12, 45),
  lapArc(12, 45),
  lapArc(12, 45),
  [35, 0],
  lapArc(7, 180),
  [60, 0],
  lapArc(20, 90),
  [30, 0],
  lapArc(9, 90),
  [45, 0],
  lapArc(6, 120),
  [20, 0],
  lapArc(10, 60),
];
const LAP_ENDURANCE = 22000; // m, about the endurance event's length (D.12.13)
let lapOpen = false;
// the car's numbers for the model: mass, grip, aero, engine
function lapCar(over = {}) {
  const v = car.vehicle,
    L = car.lapsim || {},
    d = car.drivetrain,
    r = carRes || evalCar(),
    R = ((r && r.R.ev ? r.R.ev.cfg.wheel.tire_radius : car.rear.wheel.tire_radius) || 254) / 1000;
  const P = {
    m: +v.mass,
    wf: +v.weight_front,
    mu: +(v.tire_mu || 1.5),
    cla: +(L.cla || 0),
    cda: d ? +(d.drag_area ?? 0.9) : +(L.cda ?? 0.9),
    power: +(L.power_kw || 60) * 1000,
    powerScale: 1,
    rolling: d ? +(d.rolling ?? 0.015) : 0.015,
    mf: d ? +(d.mass_factor ?? 1.05) : 1.05,
    R,
    d,
  };
  Object.assign(P, over);
  if (d && d.torque_curve) {
    const tc = d.torque_curve,
      red = +(d.redline || tc[tc.length - 1][0]),
      ratios = d.gears.map(g => (d.primary || 1) * g * d.final),
      eff = +(d.efficiency ?? 0.9),
      tq = rpm => {
        if (rpm <= tc[0][0]) return tc[0][1];
        for (let i = 1; i < tc.length; i++)
          if (rpm <= tc[i][0]) return tc[i - 1][1] + ((tc[i][1] - tc[i - 1][1]) * (rpm - tc[i - 1][0])) / (tc[i][0] - tc[i - 1][0]);
        return 0;
      };
    P.drive = vel => {
      let best = 0;
      for (const k of ratios) {
        const rpm = Math.max((vel / R) * k * (60 / (2 * Math.PI)), tc[0][0]);
        if (rpm <= red) best = Math.max(best, (tq(rpm) * k * eff) / R);
      }
      return best * P.powerScale;
    };
    P.engine = "drivetrain";
  } else {
    P.drive = vel => (P.power * P.powerScale) / Math.max(vel, 2);
    P.engine = "power";
  }
  return P;
}
// one run over a list of points (radius per point, Infinity = straight): the speed limited by the corners, then a
// forward pass (accelerating) and a backward pass (braking); a flying lap starts at the speed it ends with
function lapRun(P, radii, flying, v0 = 0) {
  const n = radii.length,
    k = (0.5 * LAP_RHO * P.cla) / P.m,
    drag = vel => (0.5 * LAP_RHO * P.cda * vel * vel) / P.m + P.rolling * LAP_G,
    ayMax = vel => P.mu * (LAP_G + k * vel * vel);
  // top speed: where the engine force equals the drag
  let vTop = 5;
  while (vTop < 80 && P.drive(vTop) / P.m > drag(vTop)) vTop += 0.25;
  const lim = radii.map(R => {
    if (!Number.isFinite(R)) return vTop;
    const den = 1 - P.mu * k * R;
    return Math.min(vTop, den > 0 ? Math.sqrt((P.mu * LAP_G * R) / den) : vTop);
  });
  const left = (vel, R) => {
    if (!Number.isFinite(R)) return 1;
    const f = (vel * vel) / R / ayMax(vel);
    return f >= 1 ? 0 : Math.sqrt(1 - f * f);
  };
  const v = new Array(n);
  let start = flying ? lim[0] : v0;
  for (let pass = 0; pass < (flying ? 2 : 1); pass++) {
    v[0] = Math.min(start, lim[0]);
    for (let i = 0; i < n - 1; i++) {
      const u = v[i],
        traction = P.mu * (LAP_G * (1 - P.wf) + (k * u * u) / 2),
        ax = Math.min((P.drive(u) / P.m - drag(u)) / P.mf, traction * left(u, radii[i]) - drag(u));
      v[i + 1] = Math.min(lim[i + 1], Math.sqrt(Math.max(0, u * u + 2 * Math.max(ax, 0) * LAP_DS)));
    }
    for (let i = n - 1; i > 0; i--) {
      const u = v[i],
        ab = ayMax(u) * left(u, radii[i]) + drag(u);
      v[i - 1] = Math.min(v[i - 1], Math.sqrt(u * u + 2 * ab * LAP_DS));
    }
    start = v[n - 1];
  }
  let t = 0;
  for (let i = 0; i < n - 1; i++) t += (2 * LAP_DS) / Math.max(v[i] + v[i + 1], 1e-6);
  return { time: t, vmin: Math.min(...v), vmax: Math.max(...v), vTop, dist: (n - 1) * LAP_DS };
}
const lapPoints = segs => {
  const out = [];
  for (const [len, R] of segs) {
    const m = Math.max(1, Math.round(len / LAP_DS));
    for (let i = 0; i < m; i++) out.push(R > 0 ? R : Infinity);
  }
  out.push(out[out.length - 1]);
  return out;
};
function lapEvents(over = {}) {
  // a lighter car loads its tires less: with load sensitivity on (Tires at the limit), the same tires grip a little
  // more (μ = tire μ (1 − k (Fz / Fz0 − 1)), the reference load being this car's)
  const ks = car.vehicle.tire_load_sens;
  if (over.m != null && ks != null)
    over = Object.assign({}, over, { mu: +(car.vehicle.tire_mu || 1.5) * (1 - ks * (over.m / car.vehicle.mass - 1)) });
  const P = lapCar(over),
    lap = lapRun(P, lapPoints(LAP_TRACK), true),
    skid = lapRun(P, lapPoints([lapArc(LAP_SKID_R, 360)]), true);
  let accel;
  if (P.d && P.d.torque_curve) {
    const veh = Object.assign({}, car.vehicle, { mass: P.m, tire_mu: P.mu }),
      d = Object.assign({}, P.d);
    if (P.powerScale !== 1) d.torque_curve = d.torque_curve.map(([r, t]) => [r, t * P.powerScale]);
    accel = S.accelRun(d, veh, P.R * 1000, veh.wheelbase).time;
  } else accel = lapRun(P, lapPoints([[75, 0]]), false, 0).time;
  return { P, lap, skid: skid.time, accel, endurance: lap.time * (LAP_ENDURANCE / lap.dist) };
}
function renderLapsim() {
  const box = $("#lapBox");
  if (!box || !car || chal) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  const L = car.lapsim || {};
  let body = "";
  if (lapOpen) {
    try {
      const E = lapEvents(),
        P = E.P,
        rows = [
          ["10 kg lighter", { m: P.m - 10 }],
          ["10 % more power", { powerScale: 1.1 }],
          ["Tires 0.1 μ grippier", { mu: P.mu + 0.1 }],
          ["Downforce: +1 m² Cl·A", { cla: P.cla + 1 }],
          ["Drag: +0.2 m² Cd·A", { cda: P.cda + 0.2 }],
        ].map(([label, o]) => {
          const W = lapEvents(o),
            d = (a, b) => `${a - b > 0 ? "+" : ""}${fmt(a - b, 3)}`;
          return `<tr><td>${esc(label)}</td><td class="n">${d(W.accel, E.accel)}</td><td class="n">${d(W.skid, E.skid)}</td><td class="n">${d(W.lap.time, E.lap.time)}</td><td class="n">${d(W.endurance, E.endurance)}</td></tr>`;
        });
      const kmh = v => fmt(v * 3.6, 0);
      body = `<div class="kv"><div><span>Acceleration, 75 m</span><b id="lapAcc">${fmt(E.accel, 2)} <small>s</small></b></div><div><span>Skidpad, one lap</span><b id="lapSkid">${fmt(E.skid, 2)} <small>s</small></b></div><div><span>Example lap, ${fmt(E.lap.dist, 0)} m</span><b id="lapLap">${fmt(E.lap.time, 2)} <small>s</small></b></div><div><span>Endurance, ~22 km</span><b>${fmt(E.endurance / 60, 1)} <small>min</small></b></div></div>
        <p class="note">Example lap: ${kmh(E.lap.dist / E.lap.time)} km/h average, slowest corner ${kmh(E.lap.vmin)} km/h, fastest ${kmh(E.lap.vmax)} km/h (top speed ${kmh(E.lap.vTop)} km/h). Engine: ${P.engine === "drivetrain" ? "the drivetrain's torque curve and gears" : `${fmt(P.power / 1000, 0)} kW at the wheels (no drivetrain in this car file)`}; mass ${fmt(P.m, 0)} kg, tire μ ${fmt(P.mu, 2)}, Cl·A ${fmt(P.cla, 2)} m², Cd·A ${fmt(P.cda, 2)} m².</p>
        <h4>What each change is worth (seconds; minus is faster)</h4>
        <div class="tbl-wrap"><table class="data"><thead><tr><th>Change</th><th class="n">Accel</th><th class="n">Skidpad</th><th class="n">Example lap</th><th class="n">Endurance</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
    } catch (e) {
      body = `<p class="note">Can't run the lap: ${esc(e.message)}</p>`;
    }
  }
  const f = (label, unit, k, step, show = true) =>
    show
      ? `<div class="field"><label>${label} <i>${unit}</i></label><input class="num" type="number" step="${step}" min="0" data-lap="${k}" value="${attr(L[k] ?? "")}" placeholder="${k === "power_kw" ? 60 : k === "cda" ? 0.9 : 0}"></div>`
      : "";
  box.innerHTML = `<details class="laysec" id="lapSec"${lapOpen ? " open" : ""}><summary><h3 class="sub-h">Lap time (point mass)</h3></summary>
    <p class="note">A quick point-mass lap simulation: grip from the tire μ (plus downforce), the engine from the drivetrain (or a power figure), drag and rolling resistance. Corners cap the speed; the car accelerates and brakes with the grip the corner leaves. It has no suspension or driver, so use it to compare changes (the table below), not to predict a lap time. Grip-limited, a point mass corners the same at any weight; set a load sensitivity (Tires at the limit) to see weight cost grip. The example lap is invented, not a real course.</p>
    <div class="fields">${f("Power at the wheels (used without a drivetrain)", "kW", "power_kw", 1, !car.drivetrain)}${f("Downforce area Cl·A", "m²", "cla", 0.1)}${f("Drag area Cd·A (the drivetrain's when it has one)", "m²", "cda", 0.05, !car.drivetrain)}</div>
    ${body}</details>`;
  $("#lapSec", box).addEventListener("toggle", e => {
    const was = lapOpen;
    lapOpen = e.target.open;
    if (lapOpen && !was) renderLapsim();
  });
  $$("[data-lap]", box).forEach(el =>
    el.addEventListener("change", () => {
      pushHistory();
      car.lapsim = Object.assign({}, car.lapsim || {});
      if (el.value === "") delete car.lapsim[el.dataset.lap];
      else car.lapsim[el.dataset.lap] = Math.max(0, +el.value);
      if (!Object.keys(car.lapsim).length) car.lapsim = null;
      run();
    })
  );
}
