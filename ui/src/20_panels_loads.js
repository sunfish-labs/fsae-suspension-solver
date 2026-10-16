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
  <h3 class="sub-h">Member axial forces, N (+ tension, − compression)</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Member</th>${names.map(n => `<th class="n">${esc(n)}</th>`).join("")}</tr></thead><tbody>${mr}</tbody></table></div>
  <h3 class="sub-h">Strength check · ${esc(mem.material || "steel")} · E ${fmt(mem.E, 0)} MPa · yield ${fmt(mem.yield, 0)} MPa · required FOS ${fmt(mem.sf_target, 1)}</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Member</th><th class="n">Tube, mm</th><th class="n">Length</th><th class="n">Worst compression, N</th><th class="n">Buckling load, N</th><th class="n">FOS buckling</th><th class="n">Worst |force|, N</th><th class="n">Yield force, N</th><th class="n">FOS yield</th><th></th></tr></thead><tbody>${ck}</tbody></table></div>
  <p class="note">Buckling load = π²EI/L² with pinned ends. Yield force = yield stress × tube area. Tabs, welds and fatigue: below. Inserts and rod-end threads are not checked.</p>
  ${partsHtml(L, label, mem)}`;
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
      <div><span>Worst case (${esc(b.case)})</span><b>${fmt(b.moment / 1000, 1)} <small>N m</small> · ${fmt(b.stress, 0)} <small>MPa</small></b></div>
      <div><span>FOS (bending + axial vs yield)</span><b class="${attr(ok ? "ok-t" : "bad-t")}">${fmt(b.sf, 2)}</b></div></div>
    <p class="note">The ${esc(legName)} treated as a beam pinned at its inboard pivot and the ball joint, loaded across by the pushrod at the mount: M = P·a·(L−a)/L, stress = M·c/I + axial/A.
    ${ok ? "" : `<b>A bare tube is overloaded here.</b> Mount the pushrod on a gusset or bracket at the ball-joint node, move it closer to the ball joint, or use a stiffer leg; this check is conservative if a gusset carries the load. `}
    ${b.offset > 5 ? `The mount sits ${fmt(b.offset, 0)} mm off the leg's centerline, so its bracket also twists the leg (not modeled).` : ""}</p>`;
  }
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
// pickup tabs (static) and the fatigue screen (mirrors loads/durability.py)
const DUR_END = { damper: "Damper chassis end", rocker_pivot: "Rocker pivot" };
function durItem(r, label) {
  if (r.item.startsWith("tab:")) {
    const k = r.item.slice(4);
    return `Tab weld, ${(DUR_END[k] || label(k)).toLowerCase()}`;
  }
  if (r.item.startsWith("leg:")) return `${label(r.item.slice(4))} with the pushrod mount (bending)`;
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
