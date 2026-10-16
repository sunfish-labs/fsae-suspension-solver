// ------------------------------------------------------------------ export: design report (HTML) and Excel workbook
// Works for one corner (Front / Rear view) or the whole car (Car view). Everything is built in the browser; the
// Excel writer: SheetJS, built into the page.
function exportScope() {
  const isCar = !!(car && axleView === "car" && !chal),
    r = isCar ? carRes || evalCar() : null;
  const withLoads = e => {
    try {
      return e && e.spring ? S.runLoads(e.cfg, e.susp, e.spring, carLltdFor(e)) : null;
    } catch (x) {
      return null;
    }
  };
  const corners = isCar
    ? [
        ["Front", r.F.ev, car.front],
        ["Rear", r.R.ev, car.rear],
      ].filter(c => c[1])
    : ev && !err
      ? [[cfg.axle === "rear" ? "Rear" : "Front", ev, cfg]]
      : [];
  return {
    isCar,
    bal: isCar ? r.bal : null,
    name: (isCar ? car.name : cfg.name) || "design",
    corners: corners.map(([lab, e, c]) => ({ lab, e, c, L: withLoads(e) })),
  };
}
const fileBase = n => (n || "design").replace(/[^\w.-]+/g, "_");
function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const rngTxt = (lo, hi, d) =>
  lo == null && hi == null ? "–" : lo == null ? `≤ ${fmt(hi, d)}` : hi == null ? `≥ ${fmt(lo, d)}` : `${fmt(lo, d)} to ${fmt(hi, d)}`;
const checkRows = e =>
  e.checks
    .filter(c => c.status !== "n/a")
    .map(c => {
      const [lab, unit, dec] = c.label ? [c.label, c.unit, c.dec] : metricLabel(c.key);
      return { key: c.key, lab, unit, dec, value: c.value, lo: c.lo, hi: c.hi, status: c.status };
    });
// members named by where the pivot physically is (larger X = front)
const memLabel = (k, e) => {
  const h = e.susp.h,
    fr = (a, b) => (a[0] >= b[0] ? "front" : "rear");
  return (
    {
      upper_front: `Upper ${fr(h.uif, h.uir)} leg`,
      upper_rear: `Upper ${fr(h.uir, h.uif)} leg`,
      lower_front: `Lower ${fr(h.lif, h.lir)} leg`,
      lower_rear: `Lower ${fr(h.lir, h.lif)} leg`,
      tie_rod: e.cfg.axle === "rear" ? "Toe link" : "Tie rod",
      pushrod: "Pushrod / pullrod",
      damper: "Damper / spring",
      rocker_pivot: "Rocker pivot (resultant)",
      bending: "Pushrod-arm bending load",
    }[k] || k
  );
};

// ---------------------------------------------------------------- HTML report
const REPORT_CSS = `:root{--s1:#2F5D7C;--s2:#9E7E38;--s3:#4C7A5A;--base:#9a9ca0;--ok:#276b43;--bad:#b3261e;--line:#dcd9d1;--muted:#53565A;--ink:#1f1f1f;--panel:#fff;--accent:#9E7E38}
    body{font:13px/1.45 "IBM Plex Sans",system-ui,sans-serif;color:#15212b;margin:24px auto;max-width:1000px;padding:0 16px}
    h1{font-size:26px;margin:0}header p{color:#5a6876;margin:2px 0 10px}h2{font-size:19px;margin:26px 0 8px;border-bottom:2px solid #15212b;padding-bottom:3px}h3{font-size:14px;margin:16px 0 6px}
    table{border-collapse:collapse;width:100%;margin:6px 0 10px}th,td{border-bottom:1px solid #d9dee3;padding:4px 6px;text-align:left;vertical-align:top}.jtab td:nth-child(2){min-width:220px}th{font-size:11px;text-transform:uppercase;color:#5a6876}td.n{text-align:right;font-family:"IBM Plex Mono",ui-monospace,monospace}
    .ok{color:#1f7a46;font-weight:600}.bad{color:#b42318;font-weight:600}.pill{display:inline-block;border-radius:99px;padding:2px 10px;font-weight:600}.okb{background:#dcf1e4;color:#1f7a46}.badb{background:#fbe3df;color:#b42318}
    .kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;margin:6px 0}.kv div{border:1px solid #d9dee3;border-radius:6px;padding:5px 8px}.kv span{display:block;font-size:11px;color:#5a6876}
    .charts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.chart{border:1px solid #d9dee3;border-radius:6px;padding:6px;break-inside:avoid}.chart h3{margin:0 0 2px;font-size:12px}.chart .cap{display:none}
    .note{color:#5a6876}footer{margin-top:24px;color:#5a6876;font-size:11.5px;border-top:1px solid #d9dee3;padding-top:8px}
    @media print{body{margin:0}.pb{break-before:page}}`;
const reportPage = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${REPORT_CSS}</style></head><body>${body}</body></html>`;
// the misalignment check as its own section: the last part of the design report, or a document on its own
function misalignSection(X, inReport) {
  const corners = X.corners.filter(k => k.e.joints);
  if (!corners.length) return "";
  let h = inReport ? `<h2 class="pb">Rod ends and bearings: misalignment</h2>` : "";
  h += `<p class="note">${esc(JOINT_NOTE)}</p>`;
  for (const k of corners) {
    const e = k.e,
      mem = e.cfg.members,
      worst = e.joints.worst;
    h += `<h3>${esc(k.lab)}${k.c.name ? ": " + esc(k.c.name) : ""}</h3>`;
    h += jointTable(e);
    h += `<p class="note">Searched over ${e.joints.n_poses} positions (${fmt(-S.travelRange(e.cfg)[0], 0)} to +${fmt(S.travelRange(e.cfg)[1], 0)} mm${e.cfg.axle === "front" ? `, rack ±${fmt(e.cfg.sweep.rack_travel, 0)} mm` : ""}). Limits: rod ends ${fmt(+mem.rod_end_misalign || 12, 1)}°, spherical bearings ${fmt(+mem.bearing_misalign || 10, 1)}°. Closest to its limit: <b class="${attr(worst.margin >= 0 ? "ok" : "bad")}">${esc(worst.label)}, ${fmt(worst.worst, 1)}° of ${fmt(worst.allow, 1)}°</b>.</p>`;
  }
  return h;
}
function misalignHtml() {
  const X = exportScope();
  const body =
    `<header><h1>${esc(X.name)}</h1><p>Rod-end and bearing misalignment · ${esc(new Date().toLocaleString())}</p></header>` +
    misalignSection(X, false) +
    `<footer>Rigid links; joints checked over the full travel and rack range. Generated by the FSAE Suspension Solver.</footer>`;
  return reportPage(`${X.name} · joint misalignment`, body);
}
function reportHtml() {
  const X = exportScope(),
    when = new Date().toLocaleString(),
    B = X.bal;
  const tbl = (head, rows) =>
    `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const st = s => (s === "PASS" ? `<span class="ok">Met</span>` : `<span class="bad">Not met</span>`);
  let body = `<header><h1>${esc(X.name)}</h1><p>Suspension design report · ${esc(when)}</p></header>`;
  const sumPills = X.corners.map(k => {
    const r = checkRows(k.e),
      p = r.filter(c => c.status === "PASS").length;
    return `<span class="pill ${p === r.length ? "okb" : "badb"}">${k.lab}: ${p}/${r.length} targets</span>`;
  });
  if (B)
    sumPills.unshift(
      `<span class="pill ${B.checks.every(c => c.status === "PASS") ? "okb" : "badb"}">Car: ${B.checks.filter(c => c.status === "PASS").length}/3 targets</span>`
    );
  body += `<p class="pills">${sumPills.join(" ")}</p>`;
  if (X.isCar) {
    const v = car.vehicle;
    body += `<h2>Car</h2><div class="kv"><div><span>Mass with driver</span><b>${fmt(v.mass, 0)} kg</b></div><div><span>Weight on front</span><b>${fmt(v.weight_front * 100, 1)} %</b></div>
      <div><span>CG height</span><b>${fmt(v.cg_height, 0)} mm</b></div><div><span>Wheelbase</span><b>${fmt(v.wheelbase, 0)} mm</b></div>
      <div><span>Anti-roll bars (at the wheels)</span><b>${fmt(car.arb.front, 0)} / ${fmt(car.arb.rear, 0)} Nm/deg</b></div><div><span>Brake balance (front)</span><b>${fmt(v.front_brake_share * 100, 0)} %</b></div></div>`;
    if (B) {
      body += tbl(
        ["Car target", "Value", "Range", "Status"],
        B.checks.map(c => {
          const [lab, unit, dec] = S.CAR_LABELS[c.key];
          return `<tr><td>${lab}</td><td class="n">${fmt(c.value, dec)} ${unit}</td><td>${rngTxt(c.lo, c.hi, dec)}</td><td>${st(c.status)}</td></tr>`;
        })
      );
      if (B.ay_lim_f != null)
        body += `<p class="note">Tires at the limit (μ ${fmt(B.tire_mu, 2)}, load sensitivity ${fmt(B.tire_load_sens, 2)}): front axle ${fmt(B.ay_lim_f, 2)} g, rear ${fmt(B.ay_lim_r, 2)} g; ${Math.abs(B.limit_balance) < 0.005 ? "neutral" : B.limit_balance > 0 ? "the front lets go first (understeer)" : "the rear lets go first (oversteer)"}. Both axles let go together at ${fmt(B.lltd_neutral * 100, 1)} % front LLTD.${B.arb_src_f === "geometry" || B.arb_src_r === "geometry" ? " Bar stiffness from the linkage geometry: " + [B.arb_src_f === "geometry" ? "front" : "", B.arb_src_r === "geometry" ? "rear" : ""].filter(Boolean).join(" and ") + "." : ""}</p>`;
      body += `<div class="kv"><div><span>Roll gradient</span><b>${fmt(B.grad, 2)} deg/g</b></div><div><span>Front LLTD</span><b>${fmt(B.lltd * 100, 1)} %</b></div>
        <div><span>Sprung mass / CG</span><b>${fmt(B.ms, 0)} kg / ${fmt(B.hs, 0)} mm</b></div><div><span>Roll axis at CG / moment arm</span><b>${fmt(B.z_ra, 0)} / ${fmt(B.arm, 0)} mm</b></div></div>`;
      const F = X.corners[0].e.metrics,
        R = X.corners[1].e.metrics,
        row = (l, a, b, u, d = 1) => `<tr><td>${l}</td><td class="n">${fmt(a, d)}</td><td class="n">${fmt(b, d)}</td><td>${u}</td></tr>`;
      body +=
        `<h3>Front and rear</h3>` +
        tbl(
          ["", "Front", "Rear", ""],
          [
            row("Ride frequency", F.ride_freq, R.ride_freq, "Hz", 2),
            row("Wheel rate", F.wheel_rate, R.wheel_rate, "N/mm"),
            row("Roll center height", F.roll_center, R.roll_center, "mm"),
            row("Camber gain", F.camber_gain, R.camber_gain, "deg/in", 3),
            row("Roll camber", F.roll_camber, R.roll_camber, "deg/deg", 3),
            row("Roll stiffness, springs", B.Ksf, B.Ksr, "Nm/deg", 0),
            row("Roll stiffness, axle with bar and tires", B.Kf, B.Kr, "Nm/deg", 0),
            row("Load transfer per wheel per g", B.dFz_f, B.dFz_r, "N/g", 0),
            row("…through the links", B.geo_f, B.geo_r, "N/g", 0),
          ]
        );
      const bar = v2 => (v2 === Infinity ? "not reachable" : v2 > 0 ? `about ${fmt(v2, 0)} Nm/deg` : "no bar needed");
      body += `<p class="note">Anti-roll bars for ${fmt(B.target_grad, 2)} deg/g and ${fmt(B.target_lltd * 100, 0)} % front LLTD (totals at the wheels): front: ${bar(B.arb_f)}; rear: ${bar(B.arb_r)}.${B.lltd_fix ? ` For balance only, change the ${B.lltd_fix[0]} bar by about ${B.lltd_fix[1] > 0 ? "+" : ""}${fmt(B.lltd_fix[1], 0)} Nm/deg.` : ""}</p>`;
    }
  }
  for (const k of X.corners) {
    const e = k.e,
      hp = e.cfg.hardpoints,
      sp = e.cfg.spring;
    body += `<h2 class="pb">${k.lab}: ${esc(k.c.name || "")}</h2>`;
    body += tbl(
      ["Target", "Value", "Range", "Status"],
      checkRows(e).map(
        c =>
          `<tr><td>${esc(c.lab)}</td><td class="n">${fmt(c.value, c.dec)} ${esc(c.unit)}</td><td>${rngTxt(c.lo, c.hi, c.dec)}</td><td>${st(c.status)}</td></tr>`
      )
    );
    const pts = S.HP_ORDER.map(p => [HP_LABELS[p][0], hp[p]]).concat(
      sp ? S.SPRING_POINTS.filter(p => sp[p]).map(p => [SP_LABELS[p][0], sp[p]]) : []
    );
    body +=
      `<h3>Hardpoints, mm</h3>` +
      tbl(
        ["Point", "X", "Y", "Z"],
        pts.map(([l, v]) => `<tr><td>${l}</td>${v.map(q => `<td class="n">${fmt(q, 1)}</td>`).join("")}</tr>`)
      );
    const rows = e.rows,
      toe0 = rows.reduce((a, r) => (Math.abs(r.dz) < Math.abs(a.dz) ? r : a)).toe,
      x = rows.map(r => r.dz),
      sr = (y, c = "#2F5D7C") => [{ x, y: rows.map(y), color: c }];
    body += `<h3>Curves</h3><div class="charts">${chart({ title: "Camber, deg", xlabel: "wheel travel, mm", series: sr(r => r.camber) })}${chart({ title: "Toe change, deg", xlabel: "wheel travel, mm", series: sr(r => r.toe - toe0) })}
      ${chart({ title: "Roll center height, mm", xlabel: "wheel travel, mm", series: sr(r => r.roll_center) })}${e.spring ? chart({ title: "Motion ratio", xlabel: "wheel travel, mm", series: sr(r => r.motion_ratio) }) : ""}
      ${e.steer ? chart({ title: "Ackermann, %", xlabel: "outer wheel angle, deg", series: [{ x: e.steer.filter(r => Number.isFinite(r.ackermann)).map(r => r.outer), y: e.steer.filter(r => Number.isFinite(r.ackermann)).map(r => r.ackermann), color: "#2F5D7C" }] }) : ""}
      ${chart({
        title: "Camber to ground in roll, deg",
        xlabel: "body roll, deg",
        series: [
          { name: "outer", x: e.roll.map(r => r.roll), y: e.roll.map(r => r.camber_outer), color: "#2F5D7C" },
          { name: "inner", x: e.roll.map(r => r.roll), y: e.roll.map(r => r.camber_inner), color: "#9E7E38", dash: "5 3" },
        ],
      })}</div>`;
    if (e.ride) {
      const r = e.ride,
        z = q => (r[q] == null ? "–" : fmt(r[q], 2));
      body +=
        `<h3>Springs and damping</h3>` +
        tbl(
          ["", "Value"],
          [
            ["Motion ratio", fmt(r.motion_ratio, 3)],
            ["Wheel rate at ride / full bump, N/mm", `${fmt(r.wheel_rate, 1)} / ${fmt(r.wheel_rate_bump, 1)}`],
            ...(r.bumpstop_travel != null ? [["Wheel travel to the bump stop, mm", fmt(r.bumpstop_travel, 1)]] : []),
            ...(r.arb_roll != null
              ? [
                  ["Anti-roll bar: twist per wheel travel, deg/mm", fmt(r.arb_twist, 3)],
                  ["Anti-roll bar: roll stiffness (this axle), Nm/deg", fmt(r.arb_roll, 0)],
                  [
                    `Anti-roll bar: shear stress at ${fmt(e.cfg.sweep.roll_deg, 1)}° roll, MPa / FOS`,
                    `${fmt(r.arb_tau, 0)} / ${fmt(r.arb_fos, 2)}`,
                  ],
                ]
              : []),
            ["Ride frequency, Hz", fmt(r.ride_freq, 2)],
            ["Critical damping at the wheel (body / wheel hop), N s/m", `${fmt(r.c_crit, 0)} / ${fmt(r.c_crit_hop, 0)}`],
            ["Damping ratio bump: low / high speed", `${z("zeta_bump_low")} / ${z("zeta_bump_high")}`],
            ["Damping ratio rebound: low / high speed", `${z("zeta_rebound_low")} / ${z("zeta_rebound_high")}`],
            [
              `Damper rates for ζ ${fmt(+e.cfg.spring.target_zeta_low || 0.7, 2)} / ${fmt(+e.cfg.spring.target_zeta_high || 0.35, 2)}, N s/m`,
              `${fmt(r.damper_c_low_target, 0)} / ${fmt(r.damper_c_high_target, 0)}`,
            ],
          ].map(([a, b2]) => `<tr><td>${a}</td><td class="n">${b2}</td></tr>`)
        );
    }
    if (k.L) {
      const mem = e.cfg.members;
      body +=
        `<h3>Member strength (${esc(mem.material || "steel")}, yield ${fmt(mem.yield, 0)} MPa, required FOS ${fmt(mem.sf_target, 1)})</h3>` +
        tbl(
          ["Member", "Tube", "Worst compression, N", "FOS buckling", "Worst |force|, N", "FOS yield", ""],
          k.L.checks.map(q => {
            const fos = Math.min(q.sf_buckle, q.sf_yield);
            return `<tr><td>${memLabel(q.member, e)}</td><td class="n">${fmt(q.od, 2)} × ${fmt(q.wall, 3)}</td><td class="n">${fmt(q.compression, 0)}</td><td class="n">${fmt(q.sf_buckle, 1)}</td><td class="n">${fmt(q.peak, 0)}</td><td class="n">${fmt(q.sf_yield, 1)}</td><td>${fos >= mem.sf_target ? `<span class="ok">OK</span>` : `<span class="bad">Below FOS</span>`}</td></tr>`;
          })
        );
      const b = k.L.bending_check;
      if (b)
        body += `<p class="note"><b>Pushrod mount bending:</b> ${esc(memLabel(b.leg, e).toLowerCase())} as a beam pinned at both ends, mount ${fmt(b.a, 0)} of ${fmt(b.length, 0)} mm from the pivot and ${fmt(b.offset, 0)} mm off its centerline. Worst case ${esc(b.case)}: ${fmt(b.moment / 1000, 1)} N m, ${fmt(b.stress, 0)} MPa, FOS <b class="${attr(b.sf >= mem.sf_target ? "ok" : "bad")}">${fmt(b.sf, 2)}</b>${b.sf >= mem.sf_target ? "" : " (needs a gusset or bracket at the node, or a stiffer leg)"}.</p>`;
      body += tbl(
        [
          "Member",
          "Worst |force|, N",
          `Bolt FOS (${esc(String(mem.bolt_dia))} mm ${esc(String(mem.bolt_grade))}, ${mem.bolt_shear_planes == 1 ? "single" : "double"} shear)`,
          "Rod-end FOS",
        ],
        k.L.parts.map(
          q =>
            `<tr><td>${memLabel(q.member, e)}</td><td class="n">${fmt(q.peak, 0)}</td><td class="n">${q.sf_bolt == null ? "–" : fmt(q.sf_bolt, 1)}</td><td class="n">${q.sf_rod_end == null ? "rating not entered" : fmt(q.sf_rod_end, 1)}</td></tr>`
        )
      );
      const D = k.L.durability;
      if (D) {
        const lb = m => DUR_END[m] || memLabel(m, e);
        body +=
          `<h3>Pickup tabs (${fmt(D.tab.count, 0)} × ${fmt(D.tab.thickness, 2)} mm, ${fmt(D.tab.width, 1)} mm wide, ${fmt(D.tab.edge, 1)} mm to the end; weld ${fmt(D.tab.weld_leg, 1)} × ${fmt(D.tab.weld_length, 0)} mm per tab)</h3>` +
          tbl(
            ["Link end", "Worst |force|, N", "FOS bearing", "FOS tear-out", "FOS net", "FOS weld", ""],
            D.tabs.map(
              q =>
                `<tr><td>${esc(lb(q.member))}</td><td class="n">${fmt(q.force, 0)}</td>${["bearing", "tearout", "net", "weld"].map(f => `<td class="n">${fmt(q.fos[f], 1)}</td>`).join("")}<td>${q.sf >= mem.sf_target ? `<span class="ok">OK</span>` : `<span class="bad">Below FOS</span>`}</td></tr>`
            )
          ) +
          `<h3>Fatigue screen (driving cases × ${fmt(D.cycles, 0)}, bump × ${fmt(D.bump_cycles, 0)}; required margin ${fmt(D.fatigue_sf, 1)})</h3>` +
          tbl(
            ["Part", "Worst cycle", "Applied, MPa", "Allowed, MPa", "Margin", "Life, cycles", ""],
            D.fatigue
              .slice()
              .sort((a, b2) => a.n - b2.n)
              .map(
                q =>
                  `<tr><td>${esc(durItem(q, m => memLabel(m, e)))}</td><td>${esc(q.case)}</td><td class="n">${fmt(q.kind === "weld" ? 2 * q.s_a : q.s_a, 1)}</td><td class="n">${fmt(q.allow, 0)}</td><td class="n">${fmt(q.n, 2)}</td><td class="n">${durLife(q.life)}</td><td>${q.ok ? `<span class="ok">OK</span>` : `<span class="bad">Look at this</span>`}</td></tr>`
              )
          ) +
          `<p class="note">Tubes: Goodman on the Shigley S-N line (applied = amplitude). Welds: IIW stress range against FAT ${fmt(D.weld_fat_tube, 0)} (tube ends) and ${fmt(D.weld_fat_tab, 0)} (tab throats). A screen at the design g levels, not a life prediction; tab sizes and weld classes are inputs.</p>`;
      }
      const C = k.L.compliance;
      if (C)
        body +=
          `<h3>Compliance (rod ends ${fmt(+mem.rod_end_k || 0, 0)} N/mm each, tabs ${fmt(+mem.mount_k || 0, 0)} N/mm, estimates)</h3>` +
          tbl(
            ["Case", "Camber change, deg", "Toe-in change, deg", "Contact patch sideways, mm"],
            C.cases.map(
              x =>
                `<tr><td>${esc(x.case)}${x.driving ? "" : " (impact, not limited)"}</td><td class="n">${fmt(x.camber, 3)}</td><td class="n">${fmt(x.toe, 3)}</td><td class="n">${fmt(x.cp_y, 2)}</td></tr>`
            )
          ) +
          `<p class="note">Worst driving-case toe change ${fmt(C.worst_toe.toe, 3)}° (${esc(C.worst_toe.case)})${C.toe_limit != null ? `, limit ${fmt(C.toe_limit, 2)}: <b class="${attr(C.toe_ok ? "ok" : "bad")}">${C.toe_ok ? "OK" : "too soft"}</b>` : ""}; camber ${fmt(C.worst_camber.camber, 3)}° (${esc(C.worst_camber.case)})${C.camber_limit != null ? `, limit ${fmt(C.camber_limit, 2)}: <b class="${attr(C.camber_ok ? "ok" : "bad")}">${C.camber_ok ? "OK" : "too soft"}</b>` : ""}.</p>`;
    }
  }
  body += misalignSection(X, true);
  body += `<footer>Rigid links, quasi-static, no tire model; the car balance assumes a rigid chassis and roll centers at ride height. Confirm the final design in CAD. Generated by the FSAE Suspension Solver.</footer>`;

  return reportPage(`${X.name} · design report`, body);
}

// ---------------------------------------------------------------- Excel workbook
// SheetJS is built into the page (ui/vendor/xlsx.full.min.js), so Excel export works offline
function loadXlsx() {
  return window.XLSX ? Promise.resolve(window.XLSX) : Promise.reject(new Error("the Excel writer is missing from this page"));
}
async function exportXlsx() {
  const XL = await loadXlsx(),
    X = exportScope(),
    wb = XL.utils.book_new(),
    r4 = v => (v == null ? "" : typeof v === "number" ? (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : "") : v);
  const clean = rows => rows.map(r => r.map(v => (typeof v === "number" && !Number.isFinite(v) ? "" : v)));
  const add = (name, rows, widths) => {
    const ws = XL.utils.aoa_to_sheet(clean(rows));
    if (widths) ws["!cols"] = widths.map(w => ({ wch: w }));
    XL.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };
  const sum = [["Design", X.name], ["Exported", new Date().toLocaleString()], []];
  if (X.isCar) {
    const v = car.vehicle;
    sum.push(
      ["Vehicle"],
      ["Mass with driver, kg", v.mass],
      ["Weight on front, %", r4(v.weight_front * 100)],
      ["CG height, mm", v.cg_height],
      ["Wheelbase, mm", v.wheelbase],
      ["Brake balance front, %", r4(v.front_brake_share * 100)],
      ["Front anti-roll bar, Nm/deg", car.arb.front],
      ["Rear anti-roll bar, Nm/deg", car.arb.rear],
      []
    );
    if (X.bal) {
      const B = X.bal;
      sum.push(
        ["Car target", "Value", "Min", "Max", "Status"],
        ...B.checks.map(c => [
          S.CAR_LABELS[c.key][0] + (S.CAR_LABELS[c.key][1] ? `, ${S.CAR_LABELS[c.key][1]}` : ""),
          r4(c.value),
          c.lo,
          c.hi,
          c.status === "PASS" ? "Met" : "Not met",
        ]),
        [],
        ["Roll balance", "Front", "Rear"],
        ["Ride frequency, Hz", r4(B.freq_f), r4(B.freq_r)],
        ["Roll center height, mm", r4(B.rc_f), r4(B.rc_r)],
        ["Roll stiffness springs, Nm/deg", r4(B.Ksf), r4(B.Ksr)],
        ["Roll stiffness axle (bar + tires), Nm/deg", r4(B.Kf), r4(B.Kr)],
        ["Load transfer per wheel per g, N", r4(B.dFz_f), r4(B.dFz_r)],
        ["  through the links, N", r4(B.geo_f), r4(B.geo_r)],
        [],
        ["Roll gradient (body to ground), deg/g", r4(B.grad)],
        ["Roll on the springs front / rear, deg/g", r4(B.roll_susp_f), r4(B.roll_susp_r)],
        ["Twist-test stiffness (axles in series), Nm/deg", r4(B.K_warp)],
        ["Front LLTD, %", r4(B.lltd * 100)],
        ["Sprung mass, kg", r4(B.ms)],
        ["Sprung CG height, mm", r4(B.hs)],
        ["Roll axis height at CG, mm", r4(B.z_ra)],
        ["Roll moment arm, mm", r4(B.arm)]
      );
    }
  }
  add("Summary", sum, [40, 14, 12, 12, 10]);
  for (const k of X.corners) {
    const e = k.e,
      L = k.lab,
      hp = e.cfg.hardpoints,
      sp = e.cfg.spring;
    add(
      `${L} targets`,
      [
        ["Target", "Value", "Unit", "Min", "Max", "Status"],
        ...checkRows(e).map(c => [c.lab, r4(c.value), c.unit, c.lo, c.hi, c.status === "PASS" ? "Met" : "Not met"]),
      ],
      [34, 12, 10, 10, 10, 10]
    );
    const pts = S.HP_ORDER.map(p => [p, ...hp[p]]).concat(sp ? S.SPRING_POINTS.filter(p => sp[p]).map(p => ["spring." + p, ...sp[p]]) : []);
    add(`${L} hardpoints`, [["Point", "X, mm", "Y, mm", "Z, mm"], ...pts.map(r => r.map(r4))], [26, 10, 10, 10]);
    const hc = [
      "dz",
      "camber",
      "toe",
      "caster",
      "kpi",
      "scrub",
      "trail",
      "roll_center",
      e.cfg.axle === "rear" ? "antisquat" : "antidive",
      "cp_y",
      "motion_ratio",
      "damper_len",
    ].filter(c => e.rows[0][c] !== undefined);
    add(`${L} heave`, [hc, ...e.rows.map(r => hc.map(c => r4(r[c])))]);
    const rc = ["roll", "camber_outer", "camber_inner", "rc_height", "rc_lateral"];
    add(`${L} roll`, [rc, ...e.roll.map(r => rc.map(c => r4(r[c])))]);
    if (e.ride) {
      const r = e.ride,
        sc = e.cfg.spring;
      add(
        `${L} springs & damping`,
        [
          ["Quantity", "Value", "Unit"],
          ["Motion ratio", r4(r.motion_ratio), ""],
          ["Wheel rate", r4(r.wheel_rate), "N/mm"],
          ["Ride rate (with tire)", r4(r.ride_rate), "N/mm"],
          ["Ride frequency", r4(r.ride_freq), "Hz"],
          ["Wheel-hop frequency", r4(r.hop_freq), "Hz"],
          ["Critical damping at the wheel, body", r4(r.c_crit), "N s/m"],
          ["Critical damping at the wheel, wheel hop", r4(r.c_crit_hop), "N s/m"],
          ["Damper bump low / high", `${sc.damper_bump_low ?? ""} / ${sc.damper_bump_high ?? ""}`, "N s/m"],
          ["Damper rebound low / high", `${sc.damper_rebound_low ?? ""} / ${sc.damper_rebound_high ?? ""}`, "N s/m"],
          ["Damping ratio bump low-speed", r4(r.zeta_bump_low), ""],
          ["Damping ratio rebound low-speed", r4(r.zeta_rebound_low), ""],
          ["Damping ratio bump high-speed", r4(r.zeta_bump_high), ""],
          ["Damping ratio rebound high-speed", r4(r.zeta_rebound_high), ""],
          ["Wheel-hop damping ratio", r4(r.zeta_hop), ""],
          ["Damper rate for low-speed target", r4(r.damper_c_low_target), "N s/m"],
          ["Damper rate for high-speed target", r4(r.damper_c_high_target), "N s/m"],
        ],
        [40, 14, 8]
      );
    }
    if (e.steer)
      add(`${L} steering`, [
        ["rack", "inner", "outer", "ackermann", "camber_inner", "camber_outer"],
        ...e.steer.map(r => ["rack", "inner", "outer", "ackermann", "camber_inner", "camber_outer"].map(c => r4(r[c]))),
      ]);
    if (k.L) {
      const cases = Object.keys(k.L.results),
        keys = S.MEMBERS.concat(["damper", "rocker_pivot", "bending"]);
      add(
        `${L} loads`,
        [
          ["Member force, N (+ tension)", ...cases],
          ...keys.map(m => [memLabel(m, e), ...cases.map(c => r4(k.L.results[c][m]))]),
          [],
          [
            "Strength check",
            "OD",
            "wall",
            "length",
            "worst compression",
            "buckling load",
            "FOS buckling",
            "worst |force|",
            "yield force",
            "FOS yield",
          ],
          ...k.L.checks.map(q => [
            memLabel(q.member, e),
            q.od,
            q.wall,
            r4(q.length),
            r4(q.compression),
            r4(q.Pcr),
            r4(q.sf_buckle),
            r4(q.peak),
            r4(q.Py),
            r4(q.sf_yield),
          ]),
          [],
          ["Rod ends and bolts", "worst |force|, N", "bolt capacity, N", "bolt FOS", "rod-end rating, N", "rod-end FOS"],
          ...k.L.parts.map(q => [
            memLabel(q.member, e),
            r4(q.peak),
            r4(q.bolt_capacity),
            r4(q.sf_bolt),
            r4(q.rod_end_rating),
            r4(q.sf_rod_end),
          ]),
          ...(k.L.bending_check
            ? [
                [],
                [
                  "Pushrod mount bending",
                  "leg",
                  "mount from pivot, mm",
                  "leg length, mm",
                  "offset, mm",
                  "worst case",
                  "moment, N m",
                  "stress, MPa",
                  "FOS",
                ],
                [
                  "",
                  memLabel(k.L.bending_check.leg, e),
                  r4(k.L.bending_check.a),
                  r4(k.L.bending_check.length),
                  r4(k.L.bending_check.offset),
                  k.L.bending_check.case,
                  r4(k.L.bending_check.moment / 1000),
                  r4(k.L.bending_check.stress),
                  r4(k.L.bending_check.sf),
                ],
              ]
            : []),
          ...(k.L.durability
            ? [
                [],
                ["Pickup tabs", "worst |force|, N", "worst case", "FOS bearing", "FOS tear-out", "FOS net", "FOS weld"],
                ...k.L.durability.tabs.map(q => [
                  DUR_END[q.member] || memLabel(q.member, e),
                  r4(q.force),
                  q.case,
                  r4(q.fos.bearing),
                  r4(q.fos.tearout),
                  r4(q.fos.net),
                  r4(q.fos.weld),
                ]),
                [],
                ["Fatigue screen", "worst cycle", "cycles", "applied, MPa", "mean, MPa", "allowed, MPa", "margin", "life, cycles"],
                ...k.L.durability.fatigue.map(q => [
                  durItem(q, m => memLabel(m, e)),
                  q.case,
                  q.cycles,
                  r4(q.kind === "weld" ? 2 * q.s_a : q.s_a),
                  q.kind === "weld" ? "" : r4(q.s_m),
                  r4(q.allow),
                  r4(q.n),
                  Number.isFinite(q.life) ? Math.round(q.life) : "no limit",
                ]),
              ]
            : []),
          ...(k.L.compliance
            ? [
                [],
                [
                  "Compliance",
                  "camber change, deg",
                  "toe-in change, deg",
                  "contact patch Y, mm",
                  "largest link stretch, mm",
                  "held to limits",
                ],
                ...k.L.compliance.cases.map(x => [
                  x.case,
                  r4(x.camber),
                  r4(x.toe),
                  r4(x.cp_y),
                  r4(x.worst_stretch),
                  x.driving ? "yes" : "no (impact)",
                ]),
                ["Link stiffness, N/mm", ...S.MEMBERS.map(m => `${memLabel(m, e)} ${Math.round(k.L.compliance.stiffness[m])}`)],
              ]
            : []),
        ],
        [30]
      );
    }
  }
  const jc = X.corners.filter(k => k.e.joints);
  if (jc.length)
    add(
      "Misalignment",
      [
        [
          "Corner",
          "Joint",
          "Type",
          "Mounting",
          "At ride, deg",
          "Worst, deg",
          "Worst at travel, mm",
          "Worst at rack, mm",
          "Limit, deg",
          "Margin, deg",
          "Status",
          "Better bolt direction (ride height)",
          "Worst with it, deg",
        ],
        ...jc.flatMap(k =>
          jointRows(k.e).map(r => [
            k.lab,
            r.label,
            r.kind === "bearing" ? "spherical bearing" : "rod end",
            boltText(r),
            r4(r.ride),
            r4(r.worst),
            r4(r.at[0]),
            r4(r.at[1]),
            r4(r.allow),
            r4(r.margin),
            r.ok ? "OK" : "Binds",
            r.best ? vecTxt(r.best.bolt) : "",
            r.best ? r4(r.best.worst) : "",
          ])
        ),
      ],
      [8, 34, 16, 60, 10, 10, 10, 10, 9, 10, 8, 28, 10]
    );
  XL.writeFile(wb, fileBase(X.name) + ".xlsx");
}

// ---------------------------------------------------------------- menu
function wireExport() {
  const menu = $("#xmenu");
  if (!menu) return;
  document.addEventListener("click", e => {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  const ex = $("#exMenu"),
    scopeTxt = () =>
      car && axleView === "car" && !chal ? "the whole car (front + rear)" : `this ${cfg.axle === "rear" ? "rear" : "front"} corner`;
  document.addEventListener("click", e => {
    if (ex.open && !ex.contains(e.target)) ex.open = false;
  });
  ex.addEventListener("toggle", () => {
    if (ex.open) {
      menu.open = false;
      $("#openMenu").open = false;
      $("#exScope").textContent = "Exports " + scopeTxt();
    }
  });
  $("#xReport").addEventListener("click", () => {
    ex.open = false;
    download(fileBase(exportScope().name) + "_report.html", new Blob([reportHtml()], { type: "text/html" }));
  });
  $("#xMis").addEventListener("click", () => {
    ex.open = false;
    download(fileBase(exportScope().name) + "_misalignment.html", new Blob([misalignHtml()], { type: "text/html" }));
  });
  $("#xXlsx").addEventListener("click", async () => {
    ex.open = false;
    const b = $("#xXlsx");
    b.disabled = true;
    try {
      await exportXlsx();
    } catch (ex) {
      $("#errBox").insertAdjacentHTML("afterbegin", `<div class="banner bad">Excel export failed: ${esc(ex.message)}</div>`);
    }
    b.disabled = false;
  });
  menu.addEventListener("toggle", () => {
    if (menu.open) {
      $("#openMenu").open = false;
      ex.open = false;
      $("#xScope").textContent =
        car && axleView === "car" && !chal
          ? "Saves the whole car (front + rear)"
          : `Saves this ${cfg.axle === "rear" ? "rear" : "front"} corner`;
    }
  });
  // Open menu: the examples, grouped, and "a file from your computer"
  const om = $("#openMenu");
  document.addEventListener("click", e => {
    if (om.open && !om.contains(e.target)) om.open = false;
  });
  om.addEventListener("toggle", () => {
    if (om.open) {
      menu.open = false;
      ex.open = false;
    }
  });
  const grp = (lab, f) => {
    const o = PRESETS.map((p, i) => [p, i]).filter(([p]) => f(p.cfg));
    return o.length
      ? `<p class="note">${lab}</p>${o.map(([p, i]) => `<button type="button" role="menuitem" data-pi="${attr(i)}"><b>${esc(p.label)}</b></button>`).join("")}`
      : "";
  };
  $("#openPop").innerHTML =
    `<button type="button" role="menuitem" id="omFile"><b>A file from your computer…</b><span>A design, a car file or a team targets file. Read in your browser, never uploaded.</span></button>` +
    `<button type="button" role="menuitem" id="omChassis"><b>Chassis model (STL / OBJ)…</b><span>Your frame from CAD, shown see-through around the suspension.</span></button><hr>` +
    grp("Example cars", isCarRaw) +
    grp("Front corners", c => c.hardpoints && c.axle !== "rear") +
    grp("Rear corners", c => c.hardpoints && c.axle === "rear");
  $("#omChassis").addEventListener("click", () => {
    om.open = false;
    openChassis();
  });
  $("#omFile").addEventListener("click", () => {
    om.open = false;
    $("#fileIn").click();
  });
  $$("#openPop [data-pi]").forEach(b =>
    b.addEventListener("click", () => {
      om.open = false;
      $("#preset").value = b.dataset.pi;
      $("#preset").dispatchEvent(new Event("change"));
    })
  );
}
