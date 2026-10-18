// 20_panels_loads.js - Loads tab: tire forces, member forces, strength, mount bending, rod ends and bolts, compliance.
function panelLoads() {
  if (!loads)
    return `<p class="note">Loads need the pushrod and damper (they carry the vertical load). Turn on "Model the spring and damper".</p>`;
  const L = loads,
    I = L.info,
    mem = ev.cfg.members,
    names = Object.keys(L.results);
  // legs named by where they physically are (larger X = front), matching the blue / gold legs in 3D
  const label = k => {
    const h = ev.susp.h,
      fr = (a, b) => (a[0] >= b[0] ? "front" : "rear");
    return {
      upper_front: `Upper ${fr(h.uif, h.uir)} leg`,
      upper_rear: `Upper ${fr(h.uir, h.uif)} leg`,
      lower_front: `Lower ${fr(h.lif, h.lir)} leg`,
      lower_rear: `Lower ${fr(h.lir, h.lif)} leg`,
      tie_rod: ev.cfg.axle === "rear" ? "Toe link" : "Tie rod",
      pushrod: "Pushrod",
    }[k];
  };
  const ty = names
    .map(
      n =>
        `<tr><td>${esc(n)}</td><td class="n">${fmt(L.tire[n][0], 0)}</td><td class="n">${fmt(L.tire[n][1], 0)}</td><td class="n">${fmt(L.tire[n][2], 0)}</td><td class="mono" style="font-size:12px">${esc(L.fz_parts[n])}</td></tr>`
    )
    .join("");
  const mrow = (lab, get) =>
    `<tr><td>${lab}</td>${names
      .map(n => {
        const v = get(L.results[n]);
        return `<td class="n">${v > 0 ? "+" : ""}${fmt(v, 0)}</td>`;
      })
      .join("")}</tr>`;
  const mr =
    S.MEMBERS.map(k => mrow(label(k), r => r[k])).join("") +
    mrow("Damper / spring", r => r.damper) +
    (ev.spring.direct
      ? ""
      : `<tr><td>Rocker pivot (resultant)</td>${names.map(n => `<td class="n">${fmt(L.results[n].rocker_pivot, 0)}</td>`).join("")}</tr>`) +
    (ev.spring.on !== "upright"
      ? `<tr><td class="muted">Pushrod-arm bending load</td>${names.map(n => `<td class="n muted">${fmt(L.results[n].bending, 0)}</td>`).join("")}</tr>`
      : "");
  const ck = L.checks
    .map(r => {
      const fos = Math.min(r.sf_buckle, r.sf_yield),
        ok = fos >= mem.sf_target;
      return `<tr><td>${label(r.member)}</td><td class="n">${fmt(r.od, 2)} × ${fmt(r.wall, 3)}</td><td class="n">${fmt(r.length, 0)}</td>
      <td class="n">${fmt(r.compression, 0)}${r.compression ? ` <span class="muted">(${esc(r.c_case)})</span>` : ""}</td><td class="n">${fmt(r.Pcr, 0)}</td><td class="n">${fmt(r.sf_buckle, 1)}</td>
      <td class="n">${fmt(r.peak, 0)} <span class="muted">(${esc(r.p_case)})</span></td><td class="n">${fmt(r.Py, 0)}</td><td class="n">${fmt(r.sf_yield, 1)}</td>
      <td>${ok ? `<span class="pill ok">OK</span>` : `<span class="pill bad">Below FOS</span>`}</td></tr>`;
    })
    .join("");
  return `<p class="note">One config covers both corners of this axle. The solved wheel is the outer wheel in a left turn and the inner wheel in a right turn, so both are checked.
  Static wheel load ${fmt(I.Fz0, 0)} N; longitudinal transfer ${fmt(I.long_per_g, 0)} N/g; lateral transfer ${fmt(I.lat_per_g, 0)} N/g per wheel
  (front LLTD ${fmt(I.lltd * 100, 1)} %, ${ev.cfg.loads.lltd_front ? "your override" : I.lltd_from_car ? "from the car's roll balance" : "the front weight share: open a car file to use its roll balance"}).
  Side force = g level × that wheel's load; brake force ${I.brake_split === "bias" ? `= g × car weight × brake share (${fmt(I.brake_share * 100, 0)} % on this axle) / 2` : "= g level × that wheel's load"}.
  ${
    Object.keys(L.deflect || {}).length
      ? `Bump and pothole are also solved where the wheel actually is under that load, (load − static) ÷ wheel rate (${fmt(I.wheel_rate, 1)} N/mm), capped at full bump: ${Object.entries(
          L.deflect
        )
          .map(([n, z]) => `${esc(n)} at +${fmt(z, 1)} mm`)
          .join(", ")}.`
      : ""
  }</p>
  <h3 class="sub-h">Tire forces on the wheel, N</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Case</th><th class="n">Fx</th><th class="n">Fy</th><th class="n">Fz</th><th>Fz built from</th></tr></thead><tbody>${ty}</tbody></table></div>
  ${loadNotesHtml(L, ev)}
  <h3 class="sub-h">Member axial forces, N (+ tension, − compression)</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Member</th>${names.map(n => `<th class="n">${esc(n)}</th>`).join("")}</tr></thead><tbody>${mr}</tbody></table></div>
  <h3 class="sub-h">Strength check · ${esc(mem.material || "steel")} · E ${fmt(mem.E, 0)} MPa · yield ${fmt(mem.yield, 0)} MPa · required FOS ${fmt(mem.sf_target, 1)}</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Member</th><th class="n">Tube, mm</th><th class="n">Length</th><th class="n">Worst compression, N</th><th class="n">Buckling load, N</th><th class="n">FOS buckling</th><th class="n">Worst |force|, N</th><th class="n">Yield force, N</th><th class="n">FOS yield</th><th></th></tr></thead><tbody>${ck}</tbody></table></div>
  <p class="note">Buckling load = π²EI/L² with pinned ends. Yield force = yield stress × tube area. Tabs, welds and fatigue: below. Inserts and rod-end threads are not checked.</p>
  ${partsHtml(L, label, mem)}`;
}
// notes under the tire forces: a deflected case that couldn't be solved, and design loads beyond the tire's grip
function loadNotesHtml(L, ev) {
  const out = [],
    sk = (L.info && L.info.skipped) || [];
  if (sk.length)
    out.push(
      `<b>Not solved where the wheel would be:</b> ${sk.map(([n, z]) => `${esc(n)} at +${fmt(z, 1)} mm`).join(", ")}. The suspension can't reach that travel (it locks up or a link runs out first), so only the ride-height version of the case is checked. Look at the Motion tab's bump end, or reduce the travel.`
    );
  const g = gripAsked(L);
  const mu = +(ev.cfg.vehicle.tire_mu || 1.5);
  if (g && g.ratio > mu + 0.05)
    out.push(
      `The ${esc(g.case)} case asks the tire for ${fmt(g.ratio, 2)} × its load sideways and fore-aft combined, more than its grip (μ ${fmt(mu, 2)}). That's on purpose: these are design loads with margin, not a corner the car can really take, so don't try to match them to data.`
    );
  return out.length ? `<p class="lockmsg">${out.join(" ")}</p>` : "";
}
// the driving case asking the most grip: |(Fx, Fy)| / Fz, impacts left out
function gripAsked(L) {
  let best = null;
  for (const [n, f] of Object.entries(L.tire || {})) {
    if (/pothole|curb|bump/.test(n) || !(f[2] > 1e-9)) continue;
    const r = Math.hypot(f[0], f[1]) / f[2];
    if (!best || r > best.ratio) best = { case: n, ratio: r };
  }
  return best;
}
function gussetTxt(g) {
  if (!g) return "bare tube";
  if (g.type === "to_node") return "bracket into the ball-joint node";
  return `gusset ${fmt(g.thickness, 1)} × ${fmt(g.height, 0)} mm, ${fmt(g.length_in, 0)} + ${fmt(g.length_out, 0)} mm long`;
}
function partsHtml(L, label, mem) {
  let h = "";
  const b = L.bending_check;
  if (b) {
    const ok = b.sf >= mem.sf_target,
      legName = label(b.leg).toLowerCase();
    h += `<h3 class="sub-h">Pushrod mount bending the wishbone</h3>
    <div class="kv"><div><span>Leg carrying the mount</span><b style="font-size:15px">${esc(label(b.leg))}</b></div>
      <div><span>Mount position along the leg</span><b>${fmt(b.a, 0)} <small>of ${fmt(b.length, 0)} mm</small></b></div>
      <div><span>Mount offset from the leg's centerline</span><b>${fmt(b.offset, 0)} <small>mm</small></b></div>
      <div><span>Reinforcement</span><b style="font-size:15px">${esc(gussetTxt(b.gusset))}</b></div>
      <div><span>Worst case (${esc(b.case)})</span><b>${fmt(b.moment / 1000, 1)} <small>N m</small> · ${fmt(b.stress, 0)} <small>MPa</small></b></div>
      <div><span>Where</span><b style="font-size:15px">${esc(b.where)}${b.gusset && b.gusset.type === "to_node" ? "" : `, ${fmt(b.x, 0)} mm from the pivot`}</b></div>
      <div><span>FOS (bending + axial vs yield)</span><b class="${attr(ok ? "ok-t" : "bad-t")}">${fmt(b.sf, 2)}</b></div></div>
    <p class="note">The ${esc(legName)} treated as a beam pinned at its inboard pivot and the ball joint, loaded across by the pushrod at the mount: M = P·a·(L−a)/L, stress = M·c/I + axial/A${b.gusset && b.gusset.type === "along_leg" ? "; with the gusset the section is the tube plus the plate (a triangle from its full height at the mount to nothing at each end), searched along the whole leg" : ""}.
    ${b.gusset && b.gusset.type === "to_node" ? `<b>The bracket itself is not checked here:</b> model it in CAD and check it with FEA using <b>Export ▾ → Part loads for FEA</b>. ` : ""}
    ${ok ? "" : `<b>Overloaded here.</b> ${b.gusset && b.gusset.type === "along_leg" ? (b.where === "gusset end" ? "The gusset moves the peak to where it ends: a longer gusset, or a bracket into the ball-joint node, works better than a taller one. " : "Make the gusset taller or thicker, or carry the load into the ball-joint node with a bracket. ") : "Add a gusset (inputs → Loads & materials → Pushrod mount), carry the load into the ball-joint node with a bracket, move the mount closer to the ball joint, or use a stiffer leg. "}`}
    ${b.offset > 5 ? `The mount sits ${fmt(b.offset, 0)} mm off the leg's centerline, so its bracket also twists the leg (not modeled).` : ""}</p>`;
  }
  h += rockerHtml(L, mem);
  h += arbLoadsHtml(L, mem);
  const P = L.parts || [];
  if (P.length) {
    const cap = P[0].bolt_capacity,
      need = mem.sf_target;
    const cell = v => (v == null ? `<td class="n muted">–</td>` : `<td class="n ${v >= need ? "" : "bad-t"}">${fmt(v, 1)}</td>`);
    h += `<h3 class="sub-h">Rod ends and bolts · ${esc(String(mem.bolt_dia))} mm grade ${esc(String(mem.bolt_grade))} bolt, ${mem.bolt_shear_planes == 1 ? "single" : "double"} shear${cap ? ` (capacity ${fmt(cap, 0)} N)` : ""}</h3>
    <div class="tbl-wrap"><table class="data"><thead><tr><th>Member</th><th class="n">Worst |force|, N</th><th class="n">Bolt FOS</th><th class="n">Rod-end FOS</th></tr></thead><tbody>
    ${P.map(r => `<tr><td>${esc(label(r.member))}</td><td class="n">${fmt(r.peak, 0)} <span class="muted">(${esc(r.p_case)})</span></td>${cell(r.sf_bolt)}${r.sf_rod_end == null ? `<td class="n muted">enter rating</td>` : cell(r.sf_rod_end)}</tr>`).join("")}</tbody></table></div>
    <p class="note">Bolt shear capacity = shear planes × bolt area × 0.6 × tensile strength. Enter your rod end's catalog radial rating (inputs → Loads &amp; materials → Rod ends and bolts) to check it.</p>`;
  }
  const BR = L.bearings || [];
  if (BR.length) {
    const need = mem.sf_target,
      cell = v => (v == null ? `<td class="n muted">enter rating</td>` : `<td class="n ${v >= need ? "" : "bad-t"}">${fmt(v, 1)}</td>`);
    h += `<h3 class="sub-h">Ball joints, damper eyes and rocker bearing</h3>
    <div class="tbl-wrap"><table class="data"><thead><tr><th>Part</th><th class="n">Worst |force|, N</th><th class="n">Rating, N</th><th class="n">FOS</th></tr></thead><tbody>
    ${BR.map(b => `<tr><td>${esc(b.label)}</td><td class="n">${fmt(b.peak, 0)} <span class="muted">(${esc(b.case)})</span></td><td class="n">${b.rating ? fmt(b.rating, 0) : "–"}</td>${cell(b.sf)}</tr>`).join("")}</tbody></table></div>
    <p class="note">A ball joint carries what its wishbone passes to the upright (both legs together); the damper's eyes carry the damper's force; the rocker's pivot carries the pushrod, damper${L.arb_check && L.arb_check.on === "rocker" ? ", bar link" : ""} forces' resultant, shared by its bearings. Enter each part's catalog radial static rating (inputs → Loads &amp; materials → Rod ends and bolts); for two bearings in the rocker, enter both together.</p>`;
  }
  h += durabilityHtml(L, label, mem);
  const C = L.compliance;
  if (C) {
    const lim = (v, l) => (l == null ? "" : Math.abs(v) <= l ? "" : "bad-t");
    h += `<h3 class="sub-h">Compliance · how far the wheel moves when the links and mounts flex</h3>
    <div class="kv"><div><span>Worst toe change, cornering / braking</span><b class="${attr(C.toe_ok ? "ok-t" : "bad-t")}">${fmt(C.worst_toe.toe, 3)}° <small>${esc(C.worst_toe.case)}${C.toe_limit != null ? ` · limit ${fmt(C.toe_limit, 2)}` : ""}</small></b></div>
      <div><span>Worst camber change, cornering / braking</span><b class="${attr(C.camber_ok ? "ok-t" : "bad-t")}">${fmt(C.worst_camber.camber, 3)}° <small>${esc(C.worst_camber.case)}${C.camber_limit != null ? ` · limit ${fmt(C.camber_limit, 2)}` : ""}</small></b></div>
      <div><span>Link stiffness (two rod ends + tube + mount)</span><b>${fmt(Math.min(...Object.values(C.stiffness)), 0)}–${fmt(Math.max(...Object.values(C.stiffness)), 0)} <small>N/mm</small></b></div></div>
    <div class="tbl-wrap"><table class="data"><thead><tr><th>Case</th><th class="n">Camber change, °</th><th class="n">Toe-in change, °</th><th class="n">Contact patch moves sideways, mm</th><th class="n">Largest link stretch, mm</th></tr></thead><tbody>
    ${C.cases
      .map(
        x => `<tr${x.driving ? "" : ` class="muted"`}><td>${esc(x.case)}${x.driving ? "" : " *"}</td><td class="n ${x.driving ? lim(x.camber, C.camber_limit) : ""}">${x.camber > 0 ? "+" : ""}${fmt(x.camber, 3)}</td>
      <td class="n ${x.driving ? lim(x.toe, C.toe_limit) : ""}">${x.toe > 0 ? "+" : ""}${fmt(x.toe, 3)}</td><td class="n">${x.cp_y > 0 ? "+" : ""}${fmt(x.cp_y, 2)}</td><td class="n">${fmt(x.worst_stretch, 2)}</td></tr>`
      )
      .join("")}</tbody></table></div>
    <p class="note">These changes come on top of the kinematic curves. Each link is a spring: two rod ends, the tube (E·A/L) and the chassis tab in series, with the rack and damper held. Toe-in +, camber − = top in.
    * Bump and impact cases are shown but not held to the limits. The rod-end and tab stiffnesses are estimates (inputs → Loads &amp; materials → Compliance); a stiffer tab or rod end helps most.</p>`;
  }
  return h;
}
// the anti-roll bar in the cornering cases (mirrors loads/arb.py)
const ARB_ON = { rocker: "the rocker", lower: "the lower wishbone", upper: "the upper wishbone", upright: "the upright" };
function arbLoadsHtml(L, mem) {
  const A = L.arb_check;
  if (!A) return "";
  const need = mem.sf_target,
    sfl = Math.min(A.sf_buckle, A.sf_yield),
    c = v => `<span class="${v >= need ? "ok-t" : "bad-t"}">${fmt(v, 2)}</span>`;
  return `<h3 class="sub-h">Anti-roll bar in the corners · link on ${ARB_ON[A.on]} · the bar takes ${fmt(A.share * 100, 0)} % of the roll</h3>
    <div class="tbl-wrap"><table class="data"><thead><tr><th>Case</th><th class="n">Bar's share at the wheel, N</th><th class="n">Drop link, N</th><th class="n">Bar torque, N m</th><th class="n">Bar shear, MPa</th></tr></thead><tbody>
    ${A.rows.map(r => `<tr><td>${esc(r.case)}</td><td class="n">${r.wheel > 0 ? "+" : ""}${fmt(r.wheel, 0)}</td><td class="n">${r.link > 0 ? "+" : ""}${fmt(r.link, 0)}</td><td class="n">${fmt(r.torque / 1000, 1)}</td><td class="n">${fmt(r.tau, 0)}</td></tr>`).join("")}</tbody></table></div>
    <div class="kv"><div><span>Drop link ${fmt(A.link_od, 2)} × ${fmt(A.link_wall, 2)} mm, ${fmt(A.link_length, 0)} mm long</span><b>FOS ${c(sfl)}</b></div>
      <div><span>Drop link rod ends</span><b>${A.sf_rod_end == null ? `<small>enter the rod-end rating</small>` : `FOS ${c(A.sf_rod_end)}`}</b></div>
      <div><span>Bar in torsion (${esc(A.tau_case)})</span><b>FOS ${c(A.sf_bar)}</b></div></div>
    <p class="note">In a corner the spring and the bar share the roll by their wheel rates (bar ${fmt(A.k_bar, 1)} N/mm, spring ${fmt(A.k_wheel, 1)} N/mm). The roll part of the spring path's load is half the difference between this wheel as the outer and as the inner one; the bar takes its share through the drop link (+ = tension). ${A.on === "rocker" ? "With the link on the rocker, the damper and the rocker's pivot carry the rest, and the rocker check includes the link's pin." : "The pushrod still carries the whole load in these cases (a little conservative). The link's pull on the " + ARB_ON[A.on] + " isn't in the arm checks or the part loads yet: check that mount in FEA with the link force above."}</p>`;
}
// the rocker's plates (mirrors loads.rocker_check)
const RK_END = { pushrod: "Pushrod end", damper: "Damper end", arb: "Bar link", pivot: "Pivot" };
function rockerHtml(L, mem) {
  const R = L.rocker_check,
    need = mem.sf_target;
  if (!R) {
    if (!cfg.spring || cfg.spring.rocker_pivot == null) return "";
    return `<h3 class="sub-h">Rocker</h3><p class="note">Not checked. Describe its plates (inputs → Loads &amp; materials → Rocker plates) to check the holes and the arms here, or check it in FEA with <b>Export ▾ → Part loads for FEA</b>.</p>`;
  }
  const rk = R.rocker,
    c = v => `<td class="n ${v >= need ? "" : "bad-t"}">${fmt(v, 2)}</td>`;
  const rows =
    Object.entries(R.holes)
      .map(
        ([k, v]) =>
          `<tr><td>${RK_END[k]} hole, ${fmt(v.d, 1)} mm</td><td class="n">${fmt(v.force, 0)} <span class="muted">(${esc(v.case)})</span></td><td class="n">bearing ${fmt(v.stress.bearing, 0)} · tear-out ${fmt(v.stress.tearout, 0)}</td>${c(v.sf)}<td class="muted">${v.governs === "bearing" ? "bearing" : "tear-out"}</td></tr>`
      )
      .join("") +
    Object.entries(R.arms)
      .map(
        ([k, v]) =>
          `<tr><td>${RK_END[k]} arm, ${fmt(v.length, 0)} mm</td><td class="n">${fmt(v.across, 0)} across <span class="muted">(${esc(v.case)})</span></td><td class="n">${fmt(v.moment / 1000, 1)} N m → ${fmt(v.stress, 0)}</td>${c(v.sf)}<td class="muted">bending + axial</td></tr>`
      )
      .join("");
  return `<h3 class="sub-h">Rocker · ${rk.plates} × ${fmt(rk.thickness, 2)} mm plate${rk.plates > 1 ? "s" : ""} · yield ${fmt(rk.yield, 0)} MPa · FOS <span class="${attr(R.sf >= need ? "ok-t" : "bad-t")}">${fmt(R.sf, 2)}</span></h3>
    <div class="tbl-wrap"><table class="data"><thead><tr><th>Where</th><th class="n">Force in its plane, N</th><th class="n">Stress, MPa</th><th class="n">FOS</th><th>Governs</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Each hole like a lug: bearing F/(n·t·d) against yield, tear-out F/(2·n·t·(e − d/2)) against 0.577 × yield, e from the hole's center to the plate's edge. Each arm as a beam built in at the hub's edge (${fmt(rk.pivot_edge, 0)} mm from the pivot), the pin force across it bending it: 6M/(n·t·w²) + axial/(n·t·w), w the arm's narrowest depth (${fmt(rk.width, 0)} mm). The worst case for each; forces in the rocker's plane.
    ${R.out_of_plane > 0.1 ? `<b>${fmt(R.out_of_plane * 100, 0)} % of a pin force runs along the rocker's axis</b> (${esc(R.oop_case)}): it bends the plates sideways, which this check leaves out. ` : ""}
    ${R.sf >= need ? "" : "<b>Below the target:</b> thicker plates or a stronger alloy (7075-T6), deeper arms, more material around the holes. "}A rocker with pockets or a shaped outline: check the final part in FEA with <b>Export ▾ → Part loads for FEA</b>. Fatigue is not screened here (aluminum has no endurance limit): keep the FOS up.</p>`;
}
// pickup tabs (static) and the fatigue screen (mirrors loads/durability.py)
const DUR_END = { damper: "Damper chassis end", rocker_pivot: "Rocker pivot" };
function durItem(r, label) {
  if (r.item.startsWith("tab:")) {
    const k = r.item.slice(4);
    return `Tab weld, ${(DUR_END[k] || label(k)).toLowerCase()}`;
  }
  if (r.item.startsWith("leg:")) return `${label(r.item.slice(4))} with the pushrod mount (bending)`;
  if (r.item.startsWith("gusset:")) return `${label(r.item.slice(7))}, weld where the gusset ends`;
  return `${label(r.item)}, ${r.kind === "tube" ? "tube" : "end weld"}`;
}
const durLife = v => (Number.isFinite(v) ? (v >= 1e4 ? v.toExponential(1).replace("e+", "e") : fmt(v, 0)) : "no limit");
function durabilityHtml(L, label, mem) {
  const D = L.durability;
  if (!D) return "";
  const tb = D.tab,
    need = mem.sf_target,
    c = v => `<td class="n ${v >= need ? "" : "bad-t"}">${fmt(v, 1)}</td>`;
  const en = D.endurance,
    rows = D.fatigue.slice().sort((a, b) => a.n - b.n),
    fails = rows.filter(r => !r.ok);
  return `<h3 class="sub-h">Pickup tabs · ${fmt(tb.count, 0)} × ${fmt(tb.thickness, 2)} mm, ${fmt(tb.width, 1)} mm wide, hole ${fmt(D.bolt, 2)} mm, ${fmt(tb.edge, 1)} mm to the end · weld ${fmt(tb.weld_leg, 1)} × ${fmt(tb.weld_length, 0)} mm per tab</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Link end</th><th class="n">Worst |force|, N</th><th class="n">FOS bearing</th><th class="n">FOS tear-out</th><th class="n">FOS net section</th><th class="n">FOS weld</th><th></th></tr></thead><tbody>
  ${D.tabs
    .map(
      r =>
        `<tr><td>${esc(DUR_END[r.member] || label(r.member))}</td><td class="n">${fmt(r.force, 0)} <span class="muted">(${esc(r.case)})</span></td>${["bearing", "tearout", "net", "weld"].map(k => c(r.fos[k])).join("")}<td>${r.sf >= need ? `<span class="pill ok">OK</span>` : `<span class="pill bad">Below FOS</span>`}</td></tr>`
    )
    .join("")}</tbody></table></div>
  <p class="note">Bearing F/(n·t·d) and net section F/(n·t·(W−d)) against yield (${fmt(D.tab_yield, 0)} MPa); tear-out F/(2·n·t·(e−d/2)) and the weld throat F/(n·L·0.707·leg) against 0.577 × yield. A simplified lug check (no hole stress concentration, fine for ductile steel under static load). <b>The tab sizes are inputs</b> (inputs → Loads &amp; materials → Pickup tabs): the defaults are a typical 1/8 in tab, so put in yours.</p>
  <h3 class="sub-h">Fatigue screen · driving cases × ${Number(D.cycles).toLocaleString("en-US")}, bump × ${Number(D.bump_cycles).toLocaleString("en-US")}${fails.length ? ` · <span class="bad-t">${fails.length} to look at</span>` : ""}</h3>
  <div class="tbl-wrap"><table class="data fatab"><thead><tr><th>Part</th><th>Worst cycle</th><th class="n">Cycles</th><th class="n">Applied, MPa</th><th class="n">Mean, MPa</th><th class="n">Allowed, MPa</th><th class="n">Life, cycles</th><th class="n">Margin</th></tr></thead><tbody>
  ${rows
    .map(
      r =>
        `<tr><td>${esc(durItem(r, label))}</td><td>${esc(r.case).replace(" ↔ ", " ↔<br>")}</td><td class="n">${Number(r.cycles).toLocaleString("en-US")}</td><td class="n">${fmt(r.kind === "weld" ? 2 * r.s_a : r.s_a, 1)}</td><td class="n">${r.kind === "weld" ? "–" : fmt(r.s_m, 1)}</td><td class="n">${fmt(r.allow, 0)}</td><td class="n">${durLife(r.life)}</td><td class="n"><span class="pill ${r.ok ? "ok" : "bad"}" title="${r.ok ? "passes" : "below the required margin: look at this part"}">${fmt(r.n, 2)}</span></td></tr>`
    )
    .join("")}</tbody></table></div>
  <p class="note">Each driving case is a load that repeats, from the car at rest to that case and back, and so does each swing between opposite cases (left and right turns, braking and accelerating, marked ↔); the impact cases are one-offs and are left out. Tubes: modified Goodman on the Shigley S-N line (S<sub>ut</sub> ${fmt(en.sut, 0)} MPa, endurance limit ${fmt(en.se_axial, 0)} MPa axial; applied = amplitude). Welds: the stress range against the weld's IIW fatigue class (FAT ${fmt(D.weld_fat_tube, 0)} at tube ends, ${fmt(D.weld_fat_tab, 0)} at tab throats; applied = range). Margin = allowed ÷ applied, required ${fmt(D.fatigue_sf, 1)}. <b>A screen at the design g levels, not a life prediction:</b> a failing row is a part to look at closely; loads logged on the car make it exact. Weld classes depend on the weld detail: look yours up.</p>`;
}
