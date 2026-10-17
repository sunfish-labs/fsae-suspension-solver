// ------------------------------------------------------------------ brakes (Car view): lock-up and balance
// car.brake_system, checked by S.brakeSizing (mirrors susp/brakes.py) and the brake rules (T.3.1.2 c, T.3.1.3, T.3.2.2, IN.14)
const BRAKE_START = {
  pedal_ratio: 5,
  mc_front: 15.9,
  mc_rear: 15.9,
  bias: 0.56,
  bias_range: [0.35, 0.65],
  caliper_front: [25.4, 25.4],
  caliper_rear: [25.4],
  rotor_front: 90,
  rotor_rear: 80,
  rear_calipers: 2,
  pad_mu: 0.4,
  driver_force: 450,
};
const BR_FIELDS = [
  ["pedal_ratio", "Pedal ratio", "", 0.1],
  ["mc_front", "Front master cylinder bore", "mm", 0.1],
  ["mc_rear", "Rear master cylinder bore", "mm", 0.1],
  ["bias", "Balance bar: front share of the pedal force", "0–1", 0.01],
  ["caliper_front", "Front caliper pistons, one side of the rotor", "mm, commas", null],
  ["caliper_rear", "Rear caliper pistons, one side of the rotor", "mm, commas", null],
  ["rotor_front", "Front rotor effective radius (axle to pad center)", "mm", 1],
  ["rotor_rear", "Rear rotor effective radius", "mm", 1],
  ["rear_calipers", "Rear calipers (2, or 1 on the differential)", "", 1],
  ["pad_mu", "Pad friction coefficient", "", 0.01],
  ["tire_mu", "Tire grip for the lock-up (blank = Tires at the limit)", "μ", 0.05],
  ["driver_force", "Pedal force you design the lock-up for", "N", 10],
  ["max_pressure", "Lowest pressure the master cylinders, calipers and lines take without failing (proof or burst)", "bar", 5],
];
function brakeResult() {
  const b = car.brake_system;
  if (!b) return null;
  try {
    S.checkBrakes(b);
    const R = (carRes && carRes.R && carRes.R.ev ? carRes.R.ev.cfg.wheel.tire_radius : car.rear.wheel.tire_radius) || 254;
    return S.brakeSizing(b, car.vehicle, R, car.vehicle.wheelbase);
  } catch (e) {
    return { err: e.message };
  }
}
function brakeResultsHtml(r) {
  if (!r) return "";
  if (r.err) return `<div class="banner bad">${esc(r.err)}</div>`;
  const ok = c => (c ? "ok-t" : "bad-t"),
    pct = x => fmt(x * 100, 0);
  return `<div class="kv">
      <div><span>Pedal force that locks all four wheels (${esc(r.first_lock)} locks first)</span><b class="${ok(r.lock_margin >= 0)}">${fmt(r.pedal_lock, 0)} <small>N (design ${fmt(r.driver_force, 0)})</small></b></div>
      <div><span>Line pressure at lock-up, front / rear</span><b>${fmt(r.p_lock_front, 0)} / ${fmt(r.p_lock_rear, 0)} <small>bar</small></b></div>
      <div><span>Balance bar for both axles to lock together</span><b class="${ok(r.bias_ok)}">${pct(r.bias_ideal)} <small>% front (set ${pct(r.bias)}, reaches ${pct(r.bias_range[0])}–${pct(r.bias_range[1])})</small></b></div>
      <div><span>Pedal force then</span><b>${fmt(r.pedal_lock_ideal, 0)} <small>N</small></b></div>
      <div><span>Brake force on the front, this setting / ideal</span><b>${pct(r.installed_front_share)} / ${pct(r.ideal_front_share)} <small>%</small></b></div>
      <div><span>Line pressure with 2000 N on the pedal (T.3.2.2)</span><b class="${r.max_pressure ? ok(r.pressure_margin >= 0) : ""}">${fmt(r.p_2000, 0)} <small>bar${r.max_pressure ? ` (parts take ${fmt(r.max_pressure, 0)})` : ""}</small></b></div></div>
    <p class="note">Braking at the tire's grip (μ ${fmt(r.tire_mu, 2)}, ${fmt(r.decel_g, 2)} g) moves load forward: front ${fmt(r.fz_front, 0)} N, rear ${fmt(r.fz_rear, 0)} N. Each axle locks when its brake force reaches μ × its load. A higher μ needs more pedal force, so check with your grippiest tire. The load cases use <i>Brake share to the front</i> (${pct(+(car.vehicle.front_brake_share || 0))} %): set it to the brake force on the front above so the braking loads match this hardware.</p>`;
}
function brakesHtml() {
  const b = car.brake_system;
  if (!b)
    return `<p class="note">Check that the driver can lock all four wheels (T.3.1.2 c and the Brake Test, IN.14) and that the balance bar reaches the right bias, from the pedal, master cylinders, calipers and rotors.</p>
      <div class="laybtns"><button class="btn small" type="button" id="brStart">Start from a typical FSAE brake system</button></div>`;
  const val = k => (Array.isArray(b[k]) ? b[k].join(", ") : (b[k] ?? ""));
  const fields = BR_FIELDS.map(
    ([k, lab, unit, step]) =>
      `<div class="field"><label>${esc(lab)} <i>${esc(unit)}</i></label><input class="${step ? "num" : "ltext"}" ${step ? `type="number" step="${attr(step)}"` : 'type="text"'} data-br="${attr(k)}" value="${attr(val(k))}" aria-label="${attr(lab)}"></div>`
  ).join("");
  return `<div class="fields">${fields}</div>
    <p class="note">Pistons: list the pistons on <b>one</b> side of the rotor (an opposed 4-piston caliper with 1 in pistons: 25.4, 25.4; a floating single-piston caliper: its one piston). Effective radius: from the axle to the middle of the pad.</p>
    <div id="brRes">${brakeResultsHtml(brakeResult())}</div>
    <div class="laybtns"><button class="btn small" type="button" id="brRemove">Remove the brake system</button></div>`;
}
function wireBrakes(box) {
  const edit = fn => {
    pushHistory();
    fn();
    schedule();
  };
  const st = $("#brStart", box);
  if (st) st.addEventListener("click", () => edit(() => (car.brake_system = JSON.parse(JSON.stringify(BRAKE_START)))));
  const rm = $("#brRemove", box);
  if (rm) rm.addEventListener("click", () => edit(() => (car.brake_system = null)));
  $$("[data-br]", box).forEach(el =>
    el.addEventListener("input", () => {
      const b = car.brake_system,
        k = el.dataset.br;
      if (!b) return;
      if (k === "caliper_front" || k === "caliper_rear") {
        const d = el.value
          .split(/[,;\s]+/)
          .filter(Boolean)
          .map(Number);
        if (d.length && d.every(v => Number.isFinite(v) && v > 0)) b[k] = d;
        else return;
      } else if (el.value === "") {
        if (["tire_mu", "max_pressure", "pad_mu", "driver_force", "bias", "rear_calipers"].includes(k)) delete b[k];
        else return;
      } else if (Number.isFinite(+el.value)) b[k] = +el.value;
      else return;
      schedule();
    })
  );
}
