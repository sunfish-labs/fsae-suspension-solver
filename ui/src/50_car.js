// ------------------------------------------------------------------ whole car (front + rear)
// The app always holds a car: a front corner, a rear corner, one shared vehicle block, anti-roll bars and car-level
// targets. Front and Rear views edit one corner exactly as before; the Car view shows both corners together with the
// roll balance. Single-corner files still open: they go into the slot named by their "axle".
let car = null,
  axleView = store.get("susp.view") || "car";
const isCarRaw = r => !!(r && r.front && r.rear && r.front.hardpoints && r.rear.hardpoints);
const springTemplate = () => {
  const p = PRESETS.find(q => q.cfg.spring) || PRESETS.find(q => q.cfg.front && q.cfg.front.spring);
  return p.cfg.spring || p.cfg.front.spring;
};
function cornerFrom(raw) {
  S.finishConfig(JSON.parse(JSON.stringify(raw)));
  const c = JSON.parse(JSON.stringify(raw));
  for (const k of ["wheel", "vehicle", "sweep", "clearance", "loads", "members"]) c[k] = S.deepMerge(S.DEFAULTS[k], c[k] || {});
  if (!c.rack_direction) c.rack_direction = [0, 1, 0];
  if (c.spring) c.spring = S.deepMerge(S.SPRING_DEFAULTS, c.spring);
  return c;
}
function carFrom(raw) {
  const veh = S.deepMerge(S.DEFAULTS.vehicle, Object.assign({}, raw.front.vehicle || {}, raw.vehicle || {}));
  const c = {
    name: raw.name || "Car",
    vehicle: veh,
    arb: { front: +((raw.arb || {}).front || 0), rear: +((raw.arb || {}).rear || 0) },
    car_targets: Object.assign({}, S.CAR_TARGETS, raw.car_targets || {}),
    warn: S.unknownTargetKeys(raw.car_targets, S.CAR_TARGETS, "car", ""),
    src: { front: raw.name || "car file", rear: raw.name || "car file" },
    layout: raw.layout ? JSON.parse(JSON.stringify(raw.layout)) : null,
    drivetrain: raw.drivetrain ? JSON.parse(JSON.stringify(raw.drivetrain)) : null,
  };
  for (const ax of ["front", "rear"]) {
    c[ax] = cornerFrom(Object.assign({}, raw[ax], { axle: ax }));
    c[ax].vehicle = veh;
  }
  return c;
}
function exampleCarRaw() {
  const p = PRESETS.find(q => isCarRaw(q.cfg));
  return p ? p.cfg : null;
}
function exportCar(local = false) {
  // Each corner keeps only the target ranges its user set (its own "targets"), plus the link to the team targets file.
  // Built-in defaults and the team file's ranges are never frozen into the file, so a later change to the team file
  // still applies. The browser's own saved state (local) also keeps the team ranges it has read.
  const strip = c => {
    const o = {};
    for (const k of [
      "name",
      "targets_file",
      "hardpoints",
      "wheel",
      "sweep",
      "clearance",
      "rack_direction",
      "targets",
      "spring",
      "loads",
      "members",
    ])
      if (c[k] != null) o[k] = c[k];
    if (local && c._team_targets) o._team_targets = c._team_targets;
    return o;
  };
  return {
    type: "car",
    name: car.name,
    vehicle: car.vehicle,
    arb: car.arb,
    car_targets: car.car_targets,
    ...(car.layout ? { layout: car.layout } : {}),
    ...(car.drivetrain ? { drivetrain: car.drivetrain } : {}),
    front: strip(car.front),
    rear: strip(car.rear),
  };
}
function loadCar(raw, label) {
  pushHistory();
  try {
    car = carFrom(raw);
  } catch (e) {
    $("#errBox").innerHTML = `<div class="banner bad">That car file does not load: ${esc(e.message)}</div>`;
    return false;
  }
  if (label) car.src = { front: label, rear: label };
  cfg = car[axleView === "rear" ? "rear" : "front"];
  savedSpring = null;
  savedRocker = null;
  view.target = null;
  fillForm();
  run();
  return true;
}
// called from run(): keeps the edited corner in its slot and the vehicle block shared by both corners
function syncCar() {
  if (!car || chal || !cfg) return;
  syncLayout();
  if (cfg.vehicle !== car.vehicle) {
    Object.assign(car.vehicle, cfg.vehicle);
    cfg.vehicle = car.vehicle;
  }
  car[cfg.axle] = cfg;
  const other = car[cfg.axle === "front" ? "rear" : "front"];
  if (other) other.vehicle = car.vehicle;
}
function setView(v, opts = {}) {
  if (chal && v !== "front") return;
  axleView = v;
  store.set("susp.view", v);
  if (v !== "car") {
    cfg = car[v];
    savedSpring = null;
    savedRocker = null;
    fillForm();
  }
  closeInfluence();
  showMe(null);
  if (!opts.keepCam) view.target = null;
  applyViewClasses();
  run();
}
function applyViewClasses() {
  document.body.classList.toggle("carview", axleView === "car");
  $$("#axleSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.ax === axleView)));
  $("#carIn").hidden = axleView !== "car" || !!chal;
  $("#carBox").hidden = axleView !== "car";
  $("#layBox").hidden = axleView !== "car" || !!chal;
  if (axleView === "car") {
    $("#cardsIn").hidden = true;
  } else if (!chal && $("#crail").hidden) $("#cardsIn").hidden = false;
}

// ---------------------------------------------------------------- car evaluation
const carCache = new Map();
function carEvalCorner(c) {
  const key = JSON.stringify(c);
  if (carCache.has(key)) return carCache.get(key);
  let r;
  try {
    r = { ev: S.evaluate(c) };
  } catch (e) {
    r = { err: e.message };
  }
  if (carCache.size > 12) carCache.clear();
  carCache.set(key, r);
  return r;
}
let carRes = null;
// the car's front LLTD with this corner as edited (the other corner from the cache), for the corner's load cases
function carLltdFor(e) {
  if (!car || chal || !e || !e.ride) return null;
  const front = e.cfg.axle !== "rear",
    o = carEvalCorner(front ? car.rear : car.front).ev;
  if (!o || !o.ride) return null;
  try {
    const F = front ? e : o,
      R = front ? o : e;
    return S.carBalance(F.cfg, F, R.cfg, R, { arbF: +car.arb.front || 0, arbR: +car.arb.rear || 0 }).lltd;
  } catch (x) {
    return null;
  }
}
function evalCar() {
  if (!car) return null;
  syncLayout();
  const F = carEvalCorner(car.front),
    R = carEvalCorner(car.rear);
  let bal = null,
    why = "";
  if (F.ev && R.ev) {
    if (F.ev.ride && R.ev.ride) {
      const mid = r => (r && r[0] != null && r[1] != null ? (r[0] + r[1]) / 2 : null),
        t = car.car_targets;
      try {
        bal = S.carBalance(F.ev.cfg, F.ev, R.ev.cfg, R.ev, {
          arbF: +car.arb.front || 0,
          arbR: +car.arb.rear || 0,
          targets: t,
          targetGrad: mid(t.roll_gradient) || 1,
          targetLltd: car.vehicle.weight_front + (mid(t.lltd_vs_weight) ?? 5) / 100,
        });
      } catch (e) {
        why = e.message;
      }
    } else
      why = `Turn on "Model the spring and damper" on ${!F.ev.ride ? "the front" : "the rear"} corner: the roll balance needs both axles' springs.`;
  }
  carRes = { F, R, bal, why };
  return carRes;
}

// ---------------------------------------------------------------- car inputs column
function carField(label, unit, path, opts = {}) {
  const v = getPath(car, path),
    val = v == null ? "" : opts.scale ? +(v * opts.scale).toFixed(6) : v;
  if (opts.options)
    return `<div class="field"><label>${label}<select data-cpath="${attr(path)}" data-type="select">${opts.options.map(([k, t]) => `<option value="${attr(k)}"${k === v ? " selected" : ""}>${t}</option>`).join("")}</select></label></div>`;
  return `<div class="field"><label>${label} <i>${unit}</i></label><input class="num" type="number" step="${attr(opts.step ?? "any")}" data-cpath="${attr(path)}"${opts.scale ? ` data-scale="${attr(opts.scale)}"` : ""}${opts.opt ? ' data-opt="1"' : ""} value="${attr(val)}" aria-label="${esc(label)}"></div>`;
}
function renderCarIn() {
  const box = $("#carIn");
  if (!box || !car) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return; // don't rebuild under the cursor
  const r = carRes || evalCar(),
    tg = car.car_targets,
    slot = ax => {
      const e = r[ax === "front" ? "F" : "R"],
        n = e.ev ? e.ev.checks.filter(c => c.status !== "n/a") : [],
        p = n.filter(c => c.status === "PASS").length;
      return `<div class="slot"><div><b>${ax === "front" ? "Front" : "Rear"}</b> <span class="muted">${esc(car[ax].name || "")}</span>
      <small class="muted">${esc(car.src[ax] || "")}</small></div>
      <div class="tact">${e.ev ? `<span class="pill ${p === n.length ? "ok" : "bad"}">${p}/${n.length} targets</span>` : `<span class="pill bad">no solution</span>`}
      <button class="btn small" type="button" data-edit="${attr(ax)}">Edit ${ax}</button><button class="btn small" type="button" data-open="${attr(ax)}">Open ${ax} file…</button></div></div>`;
    };
  const rng = (k, lab, unit) =>
    `<div class="field wide"><label>${lab} <i>${unit}</i></label><span class="rng"><input class="num" type="number" step="any" data-ctg="${attr(k)}" data-i="0" value="${attr(tg[k][0] ?? "")}" aria-label="${esc(lab)} minimum"> to <input class="num" type="number" step="any" data-ctg="${attr(k)}" data-i="1" value="${attr(tg[k][1] ?? "")}" aria-label="${esc(lab)} maximum"></span></div>`;
  box.innerHTML = `
    <div class="card"><div class="hd"><h2>Car</h2><span class="hint">front + rear</span></div><div class="body">
      <div class="field"><label>Car name</label><input class="num" style="text-align:left;font-family:var(--f-body)" type="text" data-cpath="name" data-type="text" value="${esc(car.name || "")}"></div>
      ${slot("front")}${slot("rear")}
      ${(car.warn || []).map(m => `<div class="banner warn">${esc(m)}</div>`).join("")}
      <p class="note">Save JSON in this view saves both corners in one car file. Single-corner files still open: they go into the front or rear slot.</p></div></div>
    <div class="card"><div class="hd"><h2>Vehicle</h2><span class="hint">shared by both axles</span></div><div class="body"><div class="fields">
      ${
        layRes && car.layout && car.layout.apply
          ? `<div class="field wide"><label>Mass, front weight, CG height</label><div class="muted"><b>${fmt(car.vehicle.mass, 1)} kg · ${fmt(car.vehicle.weight_front * 100, 1)} % · ${fmt(car.vehicle.cg_height, 0)} mm</b>, from the layout (below the car results)</div></div>`
          : `${carField("Car mass with driver", "kg", "vehicle.mass")}${carField("Weight on front", "%", "vehicle.weight_front", { scale: 100, step: 0.5 })}${carField("CG height", "mm", "vehicle.cg_height")}`
      }${carField("Wheelbase", "mm", "vehicle.wheelbase")}
      ${carField("Brake balance (front)", "%", "vehicle.front_brake_share", { scale: 100, step: 1 })}
      ${carField("Brakes", "", "vehicle.brakes", {
        options: [
          ["outboard", "Outboard"],
          ["inboard", "Inboard"],
        ],
      })}
      ${carField("Drive", "", "vehicle.drive", {
        options: [
          ["inboard", "Inboard diff"],
          ["outboard", "Hub motors"],
        ],
      })}</div></div></div>
    <div class="card"><div class="hd"><h2>Anti-roll bars</h2><span class="hint">0 = none</span></div><div class="body"><div class="fields">
      ${car.front.arb ? `<div class="field"><label>Front bar, at the wheels <i>Nm/deg</i></label><div class="muted">from the linkage (Front view → Pushrod, rocker &amp; damper)</div></div>` : carField("Front bar, at the wheels", "Nm/deg", "arb.front", { step: 10 })}${car.rear.arb ? `<div class="field"><label>Rear bar, at the wheels <i>Nm/deg</i></label><div class="muted">from the linkage (Rear view → Pushrod, rocker &amp; damper)</div></div>` : carField("Rear bar, at the wheels", "Nm/deg", "arb.rear", { step: 10 })}</div>
      <p class="note">A bar adds roll stiffness without changing the ride frequency. How much you add at each end sets the balance: more at the front moves load transfer forward (more understeer). Model a bar's drop link and tube in a corner view to get its stiffness from the geometry.</p></div></div>
    <div class="card"><div class="hd"><h2>Tires at the limit</h2><span class="hint">optional</span></div><div class="body"><div class="fields">
      ${carField("Tire friction μ at static load", "", "vehicle.tire_mu", { step: 0.05 })}${carField("Load sensitivity k (blank = off)", "", "vehicle.tire_load_sens", { step: 0.01, opt: 1 })}</div>
      <p class="note">μ = μ₀ (1 − k (Fz / Fz₀ − 1)): a loaded tire gives less grip per newton, so the axle that transfers more load (relative to its weight) lets go first. Fit k to your tire's data (e.g. the FSAE Tire Test Consortium); 0.1–0.3 is common.</p></div></div>
    <div class="card"><div class="hd"><h2>Car targets</h2><span class="hint">whole-car checks</span></div><div class="body"><div class="fields">
      ${rng("roll_gradient", "Roll gradient", "deg/g")}${rng("lltd_vs_weight", "Front LLTD minus front weight", "% pts")}${rng("freq_ratio", "Ride frequency ratio, rear/front", "")}</div></div></div>`;
  $$("[data-cpath]", box).forEach(el =>
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      let v = el.dataset.type === "select" || el.dataset.type === "text" ? el.value : +el.value;
      if (typeof v === "number") {
        if (el.value === "" && el.dataset.opt) v = null;
        else if (el.value === "" || !Number.isFinite(v)) return;
        if (v != null && el.dataset.scale) v /= +el.dataset.scale;
      }
      setPath(car, el.dataset.cpath, v);
      schedule();
    })
  );
  $$("[data-ctg]", box).forEach(el =>
    el.addEventListener("change", () => {
      const k = el.dataset.ctg,
        a = (car.car_targets[k] || [null, null]).slice();
      a[+el.dataset.i] = el.value === "" ? null : +el.value;
      car.car_targets[k] = a;
      schedule();
    })
  );
  $$("[data-edit]", box).forEach(b => b.addEventListener("click", () => setView(b.dataset.edit)));
  $$("[data-open]", box).forEach(b =>
    b.addEventListener("click", () => {
      carSlotPending = b.dataset.open;
      $("#carFile").click();
    })
  );
}
let carSlotPending = null;

// ---------------------------------------------------------------- car results
// the Car view hides the result tabs, so each corner's checks are summarized here with a way into the details
const CORNER_TABS = [
  ["checks", "Targets"],
  ["motion", "Motion"],
  ["spring", "Spring & damper"],
  ["loads", "Loads"],
  ["pack", "Packaging & joints"],
];
function cornerChecksHtml(F, R) {
  const card = (ax, e) => {
    const rows = checkRows(e),
      bad = rows.filter(c => c.status !== "PASS");
    const list = bad.length
      ? `<ul class="cfails">${bad.map(c => `<li><b>${esc(c.lab)}</b> ${fmt(c.value, c.dec)} ${esc(c.unit || "")} <span class="muted">(allowed ${rngTxt(c.lo, c.hi, c.dec)})</span></li>`).join("")}</ul>`
      : `<p class="muted">Every target is met.</p>`;
    return `<div class="ccard ${bad.length ? "bad" : "ok"}"><div class="cchead"><b>${ax === "front" ? "Front" : "Rear"} corner</b><span class="pill ${bad.length ? "bad" : "ok"}">${rows.length - bad.length}/${rows.length} targets</span></div>${list}
      <div class="ctabs"><span class="muted">Open the ${ax} details:</span>${CORNER_TABS.map(([t, lab]) => `<button class="btn small" type="button" data-goto="${attr(ax)}" data-tab-to="${attr(t)}">${lab}</button>`).join("")}</div></div>`;
  };
  return `<h3 class="sub-h">Corner checks</h3><div class="ccards">${card("front", F)}${card("rear", R)}</div>
    <p class="note">Curves, loads, packaging, joint misalignment and the influence tools are in the <b>Front</b> and <b>Rear</b> views (top right, or the buttons above).</p>`;
}
function wireCornerChecks(box) {
  $$("[data-goto]", box).forEach(b =>
    b.addEventListener("click", () => {
      const tab = b.dataset.tabTo;
      setView(b.dataset.goto);
      const t = $(`#tab_${cssq(tab)}`);
      if (t) {
        t.click();
        t.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }
    })
  );
}
function renderCarBox() {
  const box = $("#carBox");
  if (!box || !car) return;
  const r = carRes || evalCar(),
    B = r.bal,
    F = r.F.ev,
    R = r.R.ev;
  const met = e => {
    if (!e) return "–";
    const n = e.checks.filter(c => c.status !== "n/a");
    return `${n.filter(c => c.status === "PASS").length}/${n.length}`;
  };
  const cm = B ? B.checks.filter(c => c.status === "PASS").length : 0;
  $("#status").innerHTML =
    (B ? `<span class="pill ${cm === 3 ? "ok" : "bad"}"><span class="big">${cm}/3</span> car targets</span>` : "") +
    `<span class="pill neutral">Front ${met(F)}</span><span class="pill neutral">Rear ${met(R)}</span>` +
    (B
      ? `<span class="pill neutral">Roll ${fmt(B.grad, 2)} deg/g</span><span class="pill neutral">Front LLTD ${fmt(B.lltd * 100, 1)} %</span>`
      : "");
  if (!F || !R) {
    box.innerHTML = `<div class="banner bad">${!F ? "The front" : "The rear"} corner does not solve: ${esc((!F ? r.F : r.R).err || "")}</div>`;
    return;
  }
  const L = S.CAR_LABELS,
    row = (lab, f, rr, unit, dec = 1) =>
      `<tr><td>${lab}</td><td class="n">${fmt(f, dec)}</td><td class="n">${fmt(rr, dec)}</td><td class="muted">${unit}</td></tr>`;
  const mF = F.metrics,
    mR = R.metrics;
  let html = cornerChecksHtml(F, R);
  if (B)
    html += `<div class="tbl-wrap"><table class="data"><thead><tr><th>Car target</th><th class="n">Value</th><th>Allowed range</th><th>Status</th></tr></thead><tbody>
    ${B.checks
      .map(c => {
        const [lab, unit, dec] = L[c.key];
        return `<tr><td>${lab}</td><td class="n">${fmt(c.value, dec)} <span class="muted">${unit}</span></td><td>${c.lo ?? "–"} to ${c.hi ?? "–"}</td><td>${c.status === "PASS" ? `<span class="pill ok">Met</span>` : `<span class="pill bad">Not met</span>`}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
  else html += `<div class="banner warn">${esc(r.why)}</div>`;
  html += rulesHtml(F, R, B);
  html += `<h3 class="sub-h">Front and rear</h3><div class="tbl-wrap"><table class="data"><thead><tr><th></th><th class="n">Front</th><th class="n">Rear</th><th></th></tr></thead><tbody>
    <tr><td>Targets met</td><td class="n">${met(F)} <button class="btn small" type="button" data-edit="front">Edit</button></td><td class="n">${met(R)} <button class="btn small" type="button" data-edit="rear">Edit</button></td><td></td></tr>
    ${row("Ride frequency", mF.ride_freq, mR.ride_freq, "Hz", 2)}${row("Wheel rate", mF.wheel_rate, mR.wheel_rate, "N/mm")}${row("Motion ratio", mF.motion_ratio, mR.motion_ratio, "", 3)}
    ${row("Damping ratio, bump / low-speed", mF.zeta_bump_low, mR.zeta_bump_low, "", 2)}${row("Damping ratio, rebound / low-speed", mF.zeta_rebound_low, mR.zeta_rebound_low, "", 2)}
    ${row("Roll center height", mF.roll_center, mR.roll_center, "mm")}${row("Roll center sideways shift", mF.rc_lat, mR.rc_lat, "mm/deg")}
    ${row("Camber gain", mF.camber_gain, mR.camber_gain, "deg/in", 3)}${row("Roll camber (outer, to ground)", mF.roll_camber, mR.roll_camber, "deg/deg", 3)}
    ${row("Roll steer (outer)", mF.roll_steer, mR.roll_steer, "deg/deg", 3)}
    <tr><td>Anti-dive / anti-squat</td><td class="n">${fmt(mF.antidive, 1)} <span class="muted">dive</span></td><td class="n">${fmt(mR.antisquat, 1)} <span class="muted">squat</span></td><td class="muted">%</td></tr>
    ${
      B
        ? row("Roll stiffness: springs", B.Ksf, B.Ksr, "Nm/deg", 0) +
          row("Roll stiffness: anti-roll bar", B.arb_in_f, B.arb_in_r, "Nm/deg", 0) +
          row("Roll stiffness: axle, with tires", B.Kf, B.Kr, "Nm/deg", 0) +
          row("Load transfer per wheel per g", B.dFz_f, B.dFz_r, "N/g", 0) +
          row("…of which through the links", B.geo_f, B.geo_r, "N/g", 0)
        : ""
    }
    </tbody></table></div>`;
  if (B) {
    const und = B.lltd * 100 - B.wf * 100;
    const bar = (v, have) =>
      (v === Infinity
        ? "not reachable (the tires alone are softer than that)"
        : v > 0
          ? `about <b>${fmt(v, 0)} Nm/deg</b> in total`
          : `no bar (the springs alone are ${fmt(-v, 0)} Nm/deg stiffer than this needs)`) + ` · you have ${fmt(have, 0)}`;
    html += `<h3 class="sub-h">Roll balance</h3><div class="kv">
      <div><span>Roll gradient (body to ground)</span><b>${fmt(B.grad, 2)} <small>deg/g</small></b></div>
      <div><span>Roll on the springs, front / rear <small>(what damper pots see)</small></span><b>${fmt(B.roll_susp_f, 2)} / ${fmt(B.roll_susp_r, 2)} <small>deg/g</small></b></div>
      <div><span>Front LLTD (front weight ${fmt(B.wf * 100, 0)} %)</span><b>${fmt(B.lltd * 100, 1)} <small>%</small></b></div>
      <div><span>Sprung mass / CG height</span><b>${fmt(B.ms, 0)} <small>kg</small> / ${fmt(B.hs, 0)} <small>mm</small></b></div>
      <div><span>Roll axis height at the CG</span><b>${fmt(B.z_ra, 0)} <small>mm</small></b></div>
      <div><span>Roll moment arm</span><b>${fmt(B.arm, 0)} <small>mm</small></b></div>
      <div><span>Ride frequency ratio, rear/front</span><b>${fmt(B.freq_r / B.freq_f, 2)}</b></div>
      ${B.ay_lim_f != null ? `<div><span>Lateral limit front / rear axle</span><b>${fmt(B.ay_lim_f, 2)} / ${fmt(B.ay_lim_r, 2)} <small>g</small></b></div><div><span>Front LLTD for both axles to let go together</span><b>${fmt(B.lltd_neutral * 100, 1)} <small>%</small></b></div>` : ""}</div>
      ${B.ay_lim_f != null ? `<p class="note">With tire load sensitivity k = ${fmt(B.tire_load_sens, 2)}: load transfer costs the front ${fmt(B.grip_loss_f, 1)} % and the rear ${fmt(B.grip_loss_r, 1)} % of their grip. ${Math.abs(B.limit_balance) < 0.005 ? "Both axles reach their limit together (neutral)." : B.limit_balance > 0 ? `The front lets go ${fmt(B.limit_balance, 2)} g before the rear: understeer at the limit.` : `The rear lets go ${fmt(-B.limit_balance, 2)} g before the front: oversteer at the limit.`}</p>` : ""}
      <p class="note">${und >= 0 ? `Front LLTD is ${fmt(und, 1)} points above the front weight share: the car leans toward understeer at the limit.` : `Front LLTD is ${fmt(-und, 1)} points below the front weight share: the car leans toward oversteer at the limit.`}
      Most teams start a few points above the front weight share and tune from driver feedback.</p>
      <div class="banner neutral-b"><b>Anti-roll bars for ${fmt(B.target_grad, 2)} deg/g and ${fmt(B.target_lltd * 100, 0)} % front LLTD</b> (the middle of your car targets):
<br>Front: ${bar(B.arb_f, B.arb_in_f)}.<br>Rear: ${bar(B.arb_r, B.arb_in_r)}.
      ${B.lltd_fix ? `<br>To fix only the balance, keep the ${B.lltd_fix[0] === "front" ? "rear" : "front"} as it is and change the ${B.lltd_fix[0]} bar by about <b>${B.lltd_fix[1] > 0 ? "+" : ""}${fmt(B.lltd_fix[1], 0)} Nm/deg</b> (to about ${fmt((B.lltd_fix[0] === "front" ? B.arb_in_f : B.arb_in_r) + B.lltd_fix[1], 0)}).` : ""}
      <br><small class="muted">Rigid chassis, steady state, roll centers at ride height, bars quoted at the wheels.</small></div>`;
  }
  const S2 = (rows, x, y, ax) => ({
    name: ax,
    x: rows.map(x),
    y: rows.map(y),
    color: ax === "front" ? "var(--s1)" : "var(--s2)",
    dash: ax === "front" ? null : "5 3",
  });
  html += `<h3 class="sub-h">Front vs rear</h3><div class="charts">
    ${chart({
      title: "Roll center height, mm",
      xlabel: "wheel travel, mm",
      series: [
        S2(
          F.rows,
          r => r.dz,
          r => r.roll_center,
          "front"
        ),
        S2(
          R.rows,
          r => r.dz,
          r => r.roll_center,
          "rear"
        ),
      ],
    })}
    ${chart({
      title: "Outer wheel camber to ground, deg",
      xlabel: "body roll, deg",
      series: [
        S2(
          F.roll,
          r => r.roll,
          r => r.camber_outer,
          "front"
        ),
        S2(
          R.roll,
          r => r.roll,
          r => r.camber_outer,
          "rear"
        ),
      ],
    })}
    ${chart({
      title: "Roll center sideways, mm",
      xlabel: "body roll, deg",
      series: [
        S2(
          F.roll,
          r => r.roll,
          r => r.rc_lateral,
          "front"
        ),
        S2(
          R.roll,
          r => r.roll,
          r => r.rc_lateral,
          "rear"
        ),
      ],
    })}
    ${
      F.spring && R.spring
        ? chart({
            title: "Motion ratio",
            xlabel: "wheel travel, mm",
            series: [
              S2(
                F.rows,
                r => r.dz,
                r => r.motion_ratio,
                "front"
              ),
              S2(
                R.rows,
                r => r.dz,
                r => r.motion_ratio,
                "rear"
              ),
            ],
          })
        : ""
    }
  </div>`;
  box.innerHTML = html;
  wireCornerChecks(box);
  $$("[data-edit]", box).forEach(b => b.addEventListener("click", () => setView(b.dataset.edit)));
}

// ---------------------------------------------------------------- the rulebook (schema/rules/)
let rulesOpen = store.get("susp.rulesOpen") === "1";
function rulesHtml(F, R, B) {
  const id = "fsae_2027_ic",
    rs = S.RULESETS[id];
  if (!rs) return "";
  let rows;
  try {
    rows = S.checkRules(rs, S.ruleValues(F.cfg, F, R.cfg, R, B, car.layout || null));
  } catch (e) {
    return `<div class="banner warn">Rules check: ${esc(e.message)}</div>`;
  }
  const n = s => rows.filter(r => r.status === s).length,
    fail = n("fail");
  const val = r =>
    r.value == null || typeof r.value === "boolean" || Array.isArray(r.value)
      ? esc(r.note || "")
      : r.id === "track_ratio"
        ? `${fmt(r.value * 100, 1)} % <span class="muted">(min ${fmt(r.limit * 100, 0)} %)</span>`
        : `${fmt(r.value, 1)} ${esc(r.unit)} <span class="muted">(${r.kind === "max" ? "max" : "min"} ${fmt(r.limit, r.limit % 1 ? 1 : 0)}${r.estimate ? ", estimate" : ""})</span>${r.note ? " · " + esc(r.note) : ""}`;
  const pill = s =>
    s === "pass"
      ? `<span class="pill ok">Pass</span>`
      : s === "fail"
        ? `<span class="pill bad">Fail</span>`
        : s === "unknown"
          ? `<span class="pill neutral" title="An input this check needs is missing">Can't check</span>`
          : `<span class="pill neutral" title="The solver can't measure this: check it on the car or the CAD">Check yourself</span>`;
  const auto = rows.filter(r => r.status !== "manual"),
    man = rows.filter(r => r.status === "manual");
  const tr = r =>
    `<tr><td class="nowrap"><b>${esc(r.rule)}</b></td><td>${esc(r.summary)}</td><td>${val(r)}</td><td>${pill(r.status)}</td></tr>`;
  return `<details class="rulesbox" id="rulesBox"${rulesOpen || fail ? " open" : ""}><summary><h3 class="sub-h">Rules: ${esc(rs.name)}</h3>
      <span class="pill ${fail ? "bad" : "ok"}">${n("pass")} pass${fail ? ` · ${fail} fail` : ""}</span>${n("unknown") ? `<span class="pill neutral">${n("unknown")} can't check</span>` : ""}<span class="pill neutral">${man.length} to check yourself</span></summary>
    <div class="tbl-wrap"><table class="data rtab"><thead><tr><th>Rule</th><th>What it asks</th><th>This car</th><th></th></tr></thead><tbody>${auto.map(tr).join("")}</tbody></table></div>
    <p class="note">The solver can't measure these; check them on the car or in CAD:</p>
    <div class="tbl-wrap"><table class="data rtab"><tbody>${man.map(tr).join("")}</tbody></table></div>
    <p class="note">${esc(rs.version)}. Rule numbers with short paraphrases: read the rulebook for the exact wording, and check later versions and the official Q&amp;A. The tilt is a static estimate from the CG (use the tallest driver and full fluids in the layout). Usable travel comes from the damper's stroke and length. The keep-out check needs a layout; tires against the chassis model come from the clearance check.</p></details>`;
}
document.addEventListener(
  "toggle",
  e => {
    if (e.target && e.target.id === "rulesBox") {
      rulesOpen = e.target.open;
      store.set("susp.rulesOpen", rulesOpen ? "1" : "0");
    }
  },
  true
);

// ---------------------------------------------------------------- car 3D scene
function rad0e(e, dz) {
  if (!e.ride) return 0;
  let best = e.rows[0];
  for (const q of e.rows) if (Math.abs(q.dz - dz) < Math.abs(best.dz - dz)) best = q;
  return ((best.rocker_deg || 0) * Math.PI) / 180;
}
function updateCarScene() {
  const { T, dyn, scene } = three,
    col = themeColors(),
    r = carRes || evalCar();
  scene.background = new T.Color(col.bg || "#dfe5ea");
  while (dyn.children.length) {
    const o = dyn.children.pop();
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        if (n.material.map) n.material.map.dispose();
        n.material.dispose();
      }
    });
  }
  three.pickables = [];
  three.labels = [];
  if (!r || !r.F.ev || !r.R.ev) {
    three.need = true;
    return;
  }
  const WB = car.vehicle.wheelbase,
    D = drawKit(dyn, col),
    DT = drawKit(dyn, col, true),
    pts = {};
  for (const ax of ["front", "rear"]) {
    const e = ax === "front" ? r.F.ev : r.R.ev,
      s = e.susp,
      rk = ax === "front" ? pose.rack : 0,
      dx = ax === "front" ? 0 : -WB;
    let x, o, st;
    try {
      x = s.pose(pose.dz, rk);
      o = s.observe(x, pose.dz, rk);
      st = e.spring ? e.spring.state(x, rad0e(e, pose.dz)) : null;
    } catch (er) {
      continue;
    }
    const n0 = three.pickables.length,
      g = buildCorner(e, o, st, { col });
    g.position.x = dx;
    dyn.add(g);
    for (let i = n0; i < three.pickables.length; i++) three.pickables[i].userData.axle = ax;
    let oL = o,
      sL = st;
    if (rk) {
      try {
        const xl = s.pose(pose.dz, -rk);
        oL = s.observe(xl, pose.dz, -rk);
        sL = e.spring ? e.spring.state(xl, rad0e(e, pose.dz)) : null;
      } catch (er) {
        /* keep */
      }
    }
    const gm = buildCorner(e, oL, sL, { col, mirror: true, solid: true });
    gm.position.x = dx;
    dyn.add(gm);
    pts[ax] = { cp: [o._pts.cp[0] + dx, o._pts.cp[1], o._pts.cp[2]], rc: o.roll_center, R: s.R };
  }
  const xf = pts.front ? pts.front.cp[0] : 0,
    xr = pts.rear ? pts.rear.cp[0] : -WB,
    half = Math.max(pts.front ? pts.front.cp[1] : 600, pts.rear ? pts.rear.cp[1] : 600);
  const grid = new T.GridHelper(Math.max(4000, WB + 2400), 32, new T.Color(col.muted || "#5a6876"), new T.Color(col.line || "#cfd7de"));
  grid.position.set((xf + xr) / 2, 0, 0);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  dyn.add(grid);
  D.line(
    [
      [xf + 500, 0, 0.5],
      [xr - 500, 0, 0.5],
    ],
    col.muted,
    true
  );
  if (pts.front && pts.rear && Number.isFinite(pts.front.rc) && Number.isFinite(pts.rear.rc)) {
    const a = [xf, 0, pts.front.rc],
      b = [xr, 0, pts.rear.rc],
      u = V.unit(V.sub(a, b));
    DT.line([V.add(a, V.mul(u, 350)), V.sub(b, V.mul(u, 350))], col.accent, false);
    DT.dot(a, col.accent, 12);
    DT.dot(b, col.accent, 12);
    DT.label(V.add(b, V.mul(u, -380)), "roll axis", col.accent);
  }
  const wf = car.vehicle.weight_front,
    cgx = xf - (xf - xr) * (1 - wf),
    cg = [cgx, 0, car.vehicle.cg_height];
  DT.dot(cg, col.ink, 14);
  DT.line([cg, [cgx, 0, 0]], col.muted, true);
  DT.label(V.add(cg, [0, 0, 70]), "CG", col.ink);
  DT.label([xf, half + 260, 40], "FRONT", col.s1);
  DT.label([xr, half + 260, 40], "REAR", col.s2);
  if (!view.target) {
    view.target = toT([(xf + xr) / 2, 0, 120]);
    view.r = fitR(Math.abs(xf - xr) + 700, 900);
    setMode("iso");
  }
  const B = r.bal;
  $("#hud").innerHTML =
    legKey() +
    `<span><b>travel</b> ${fmt(pose.dz, 1)} mm · <b>rack</b> ${fmt(pose.rack, 1)} mm</span><span><b>RC</b> front ${fmt(r.F.ev.metrics.roll_center, 0)} / rear ${fmt(r.R.ev.metrics.roll_center, 0)} mm</span>` +
    (B ? `<span><b>roll</b> ${fmt(B.grad, 2)} deg/g</span><span><b>front LLTD</b> ${fmt(B.lltd * 100, 1)} %</span>` : "");
  const hb = ($("#hud").offsetHeight || 30) + 18 + "px";
  for (const id of ["#ovcap", "#pvbar", "#vhint"]) $(id).style.bottom = hb;
  drawLayout(dyn, 0);
  placeChassis();
  three.need = true;
}
