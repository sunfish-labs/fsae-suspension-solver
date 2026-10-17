// 66_check.js - The design check: every check on the car (or the open corner) on one page, each with what it means,
// where to fix it, and a printable sign-off report. It reads the same results the tabs show; nothing new is solved.
const CHK = {
  fail: ["✕", "Fail", "bad"],
  warn: ["!", "Look at it", "warn"],
  input: ["?", "Needs input", "neutral"],
  notrun: ["…", "Not run yet", "neutral"],
  manual: ["☐", "Check yourself", "neutral"],
  pass: ["✓", "Pass", "ok"],
};
const CHK_ORDER = Object.keys(CHK);
// the corners to check: both of an open car file, or the open corner, each evaluated with its loads
function checkScope() {
  const isCar = !!(car && !chal);
  const withLoads = e => {
    try {
      return e && e.spring ? S.runLoads(e.cfg, e.susp, e.spring, carLltdFor(e)) : null;
    } catch (x) {
      return { err: x.message };
    }
  };
  let corners,
    bal = null,
    why = "";
  if (isCar) {
    const r = evalCar();
    bal = r.bal;
    why = r.why;
    corners = [
      ["front", r.F.ev, r.F.err],
      ["rear", r.R.ev, r.R.err],
    ];
  } else corners = [[cfg.axle === "rear" ? "rear" : "front", err ? null : ev, err && err.message]];
  return {
    isCar,
    bal,
    why,
    name: (isCar ? car.name : cfg.name) || "design",
    corners: corners.map(([ax, e, er]) => ({ ax, e, err: er, L: e ? withLoads(e) : null })),
  };
}
const AX = { front: "Front", rear: "Rear" };
// every check as {group, axle, title, status, detail, why, go: [view, tab], term}
function checkList(X) {
  const out = [],
    add = (group, axle, title, status, detail, why, go = null, term = null) =>
      out.push({ group, axle, title, status, detail, why, go, term });
  const need = X.corners[0] && X.corners[0].e ? +X.corners[0].e.cfg.members.sf_target : 2;
  for (const { ax, e, err: er, L } of X.corners) {
    const A = AX[ax],
      view = X.isCar ? ax : null;
    // ---- setup
    if (!e) {
      add(
        "Setup",
        A,
        "The corner solves",
        "fail",
        er || "It doesn't solve.",
        "Nothing else can be checked until the geometry solves: look at the message and the hardpoints.",
        [view, "checks"]
      );
      continue;
    }
    const iss = S.validate(e.cfg),
      errs = iss.filter(([lv]) => lv === "error"),
      warns = iss.filter(([lv]) => lv === "warn");
    add(
      "Setup",
      A,
      "Input sanity checks",
      errs.length ? "fail" : warns.length ? "warn" : "pass",
      iss.length ? iss.map(([, m]) => m).join(" · ") : "No swapped points, axes or units found.",
      "Catches the usual CAD-import mistakes (swapped ball joints, a flipped axis, the ground not at Z = 0) before you trust any number.",
      [view, "checks"]
    );
    // ---- geometry targets (the packaging rows go to their own group)
    const rows = checkRows(e),
      geo = rows.filter(c => c.key !== "link_clearance" && c.key !== "rim_margin"),
      bad = geo.filter(c => c.status !== "PASS");
    add(
      "Geometry",
      A,
      `Targets met (${geo.length - bad.length} of ${geo.length})`,
      bad.length ? "fail" : "pass",
      bad.length
        ? bad.map(c => `${c.lab} ${fmt(c.value, c.dec)} ${c.unit || ""} (allowed ${rngTxt(c.lo, c.hi, c.dec)})`).join(" · ")
        : "Every target range is met.",
      "Your team's ranges for camber, roll center, bump steer and the rest (Targets tab, or the team targets file): the kinematics you designed for.",
      [view, "checks"],
      "camber_gain"
    );
    // ---- packaging
    for (const c of rows.filter(c => c.key === "link_clearance" || c.key === "rim_margin"))
      add(
        "Packaging",
        A,
        c.key === "link_clearance" ? "Links clear each other over travel and steer" : "Links clear the rim",
        c.status === "PASS" ? "pass" : "fail",
        `${c.lab}: ${fmt(c.value, 1)} mm (needs ${rngTxt(c.lo, c.hi, 1)})`,
        c.key === "link_clearance"
          ? "Tubes that touch at full bump or full lock bend or wear through; this is the closest pair over the whole travel and rack range, tube sizes included."
          : "The links, ball joints and tie rod end must stay inside the rim barrel at every wheel position.",
        [view, "pack"]
      );
    const m = e.metrics;
    if (m.caliper_rim_margin != null)
      add(
        "Packaging",
        A,
        "Brake caliper inside the rim",
        m.caliper_rim_margin >= 0 ? "pass" : "fail",
        `${fmt(m.caliper_rim_margin, 1)} mm margin`,
        "The caliper envelope must clear the rim barrel.",
        [view, "pack"]
      );
    else
      add(
        "Packaging",
        A,
        "Brake caliper inside the rim",
        "input",
        "No caliper envelope described.",
        "Describe the caliper's envelope (Wheel inputs) to check it against the rim and the links.",
        [view, "pack"]
      );
    if (ax === "rear") {
      if (m.hs_clearance_margin != null)
        add(
          "Packaging",
          A,
          "Halfshaft clears the links",
          m.hs_clearance_margin >= 0 ? "pass" : "fail",
          `${fmt(m.hs_clearance_margin, 1)} mm margin`,
          "The driveshaft must clear the wishbones and toe link over the travel.",
          [view, "pack"]
        );
      else
        add(
          "Packaging",
          A,
          "Halfshaft clears the links",
          "input",
          "No halfshaft described.",
          "Describe the halfshaft (diff output and outboard CV) to check it.",
          [view, "pack"]
        );
    }
    if (e.joints) {
      const w = e.joints.rows.slice().sort((a, b) => a.margin - b.margin)[0];
      add(
        "Packaging",
        A,
        "Rod ends and spherical bearings within their angle",
        e.joints.margin >= 0 ? "pass" : "fail",
        w ? `Tightest: ${w.label}, ${fmt(w.worst, 1)}° of ${fmt(w.allow, 0)}°` : "",
        "A joint pushed past its misalignment angle binds and bends the bolt; spacers or a high-misalignment part fix it.",
        [view, "pack"],
        "rod_end"
      );
    }
    // ---- strength
    if (!e.spring) {
      add(
        "Strength",
        A,
        "Link forces and strength",
        "input",
        "The spring and damper aren't modeled.",
        "Loads need the pushrod or pullrod: turn on Model the spring and damper.",
        [view, "spring"]
      );
      continue;
    }
    if (!L || L.err) {
      add(
        "Strength",
        A,
        "Link forces and strength",
        "fail",
        (L && L.err) || "The load cases don't solve.",
        "Look at the message in the Loads tab.",
        [view, "loads"]
      );
      continue;
    }
    const mem = e.cfg.members,
      worstM = L.checks.reduce((b, r) => (!b || Math.min(r.sf_buckle, r.sf_yield) < Math.min(b.sf_buckle, b.sf_yield) ? r : b), null),
      mf = Math.min(worstM.sf_buckle, worstM.sf_yield);
    add(
      "Strength",
      A,
      "Tubes: buckling and yield",
      mf >= need ? "pass" : "fail",
      `Lowest FOS ${fmt(mf, 2)} (${memLabel(worstM.member, e)}, ${worstM.sf_buckle <= worstM.sf_yield ? "buckling" : "yield"}), target ${fmt(need, 1)}`,
      "Each link's worst force over all the load cases against the tube's buckling load and yield; pushrods and tie rods usually buckle first.",
      [view, "loads"],
      "buckling"
    );
    const re = L.parts.map(p => p.sf_rod_end),
      bo = L.parts.map(p => p.sf_bolt);
    if (re.some(v => v == null))
      add(
        "Strength",
        A,
        "Rod ends against their rating",
        "input",
        "No catalog rating entered.",
        "Enter your rod end's radial rating from its catalog (Loads & materials → Rod ends and bolts).",
        [view, "loads"],
        "rod_end"
      );
    else
      add(
        "Strength",
        A,
        "Rod ends against their rating",
        Math.min(...re) >= need ? "pass" : "fail",
        `Lowest FOS ${fmt(Math.min(...re), 2)}`,
        "The rod end's catalog rating against its worst force.",
        [view, "loads"],
        "rod_end"
      );
    if (bo.some(v => v == null))
      add(
        "Strength",
        A,
        "Bolts in shear",
        "input",
        "No bolt size or grade.",
        "Enter the bolt diameter and grade (Loads & materials → Rod ends and bolts).",
        [view, "loads"]
      );
    else
      add(
        "Strength",
        A,
        "Bolts in shear",
        Math.min(...bo) >= need ? "pass" : "fail",
        `Lowest FOS ${fmt(Math.min(...bo), 2)}`,
        "Each link end's bolt in shear (single or double) against its worst force.",
        [view, "loads"]
      );
    const BR = L.bearings || [];
    if (BR.length) {
      const rated = BR.filter(b => b.sf != null),
        low = rated.reduce((m, b) => (!m || b.sf < m.sf ? b : m), null),
        missing = BR.filter(b => b.sf == null).map(b => b.label.toLowerCase());
      add(
        "Strength",
        A,
        "Ball joints, damper eyes and rocker bearing against their ratings",
        low && low.sf < need ? "fail" : missing.length ? "input" : "pass",
        `${low ? `Lowest FOS ${fmt(low.sf, 2)} (${low.label.toLowerCase()})` : ""}${low && missing.length ? "; " : ""}${missing.length ? `no rating for the ${missing.join(", ")}` : ""}`,
        "Each bought bearing's catalog radial rating against its worst force (Loads & materials → Rod ends and bolts).",
        [view, "loads"],
        "rod_end"
      );
    }
    const D = L.durability;
    if (D) {
      const dflt = JSON.stringify(mem.tab) === JSON.stringify(S.DEFAULTS.members.tab),
        ok = D.tab_sf_min >= need;
      add(
        "Strength",
        A,
        "Pickup tabs (bearing, tear-out, net section, weld)",
        !ok ? "fail" : dflt ? "input" : "pass",
        `Lowest FOS ${fmt(D.tab_sf_min, 2)}${dflt ? " with the default 1/8 in tab: enter yours" : ""}`,
        "The chassis tabs each link end bolts to: crushing at the hole, tearing out to the edge, and the weld holding the tab on.",
        [view, "loads"]
      );
      add(
        "Strength",
        A,
        "Fatigue screen (tubes and welds)",
        D.fatigue_n_min >= +(mem.fatigue_sf || 1.5) ? "pass" : "fail",
        `Lowest margin ${fmt(D.fatigue_n_min, 2)}, target ${fmt(+(mem.fatigue_sf || 1.5), 1)}`,
        "Welds crack long before a tube yields if the loads repeat; this checks the stated number of cycles of each driving case.",
        [view, "loads"]
      );
    }
    if (L.bending_check)
      add(
        "Strength",
        A,
        "Pushrod mount bending its wishbone leg",
        L.bending_check.sf >= need ? "pass" : "fail",
        `FOS ${fmt(L.bending_check.sf, 2)} (${gussetTxt(L.bending_check.gusset)})`,
        "A pushrod that lands off the ball joint bends the wishbone leg; a gusset or a bracket into the node fixes it.",
        [view, "loads"]
      );
    if (e.cfg.spring && e.cfg.spring.rocker_pivot != null) {
      if (L.rocker_check)
        add(
          "Strength",
          A,
          "Rocker plates (holes and arms)",
          L.rocker_check.sf >= need ? "pass" : "fail",
          `FOS ${fmt(L.rocker_check.sf, 2)}`,
          "The rocker's pin holes and arms against the pushrod and damper forces.",
          [view, "loads"],
          "rocker"
        );
      else
        add(
          "Strength",
          A,
          "Rocker plates (holes and arms)",
          "input",
          "Plate sizes not entered.",
          "Enter the rocker's plate thickness and sizes (Loads & materials → Rocker plates), or check it in FEA.",
          [view, "loads"],
          "rocker"
        );
    }
    const AB = L.arb_check;
    if (AB) {
      const sfl = Math.min(AB.sf_buckle, AB.sf_yield, AB.sf_bar, AB.sf_rod_end ?? Infinity);
      add(
        "Strength",
        A,
        "Anti-roll bar and its drop link in the corners",
        sfl >= need ? (AB.sf_rod_end == null ? "input" : "pass") : "fail",
        `Bar FOS ${fmt(AB.sf_bar, 2)}, link FOS ${fmt(Math.min(AB.sf_buckle, AB.sf_yield), 1)}${AB.sf_rod_end == null ? ", link rod ends: enter the rating" : `, rod ends ${fmt(AB.sf_rod_end, 1)}`}; the bar takes ${fmt(AB.share * 100, 0)} % of the roll`,
        "The bar shares the roll with the springs, so its link, its twist and (on a rocker) the rocker's extra pin carry real load in every corner.",
        [view, "loads"],
        "arb"
      );
    } else if (X.isCar && +((car.arb || {})[ax] || 0) > 0)
      add(
        "Strength",
        A,
        "Anti-roll bar and its drop link in the corners",
        "input",
        `The ${ax} bar is a number (${fmt(+car.arb[ax], 0)} Nm/deg at the wheels) without its linkage.`,
        "Describe the bar's linkage (link point, arm tip, bar axis and size) to check its link, its twist and what it adds to the rocker or arm; until then the pushrod carries the whole load (a little conservative).",
        [view, "spring"],
        "arb"
      );

    const C = L.compliance;
    if (C && (C.toe_limit != null || C.camber_limit != null))
      add(
        "Strength",
        A,
        "Compliance: toe and camber under load",
        C.toe_ok && C.camber_ok ? "pass" : "fail",
        `Worst toe ${fmt(C.worst_toe.toe, 3)}°, camber ${fmt(C.worst_camber.camber, 3)}°`,
        "Links and tabs stretch under load and steer the wheel; too soft and the car feels vague.",
        [view, "loads"],
        "compliance"
      );
    if (L.info && L.info.skipped && L.info.skipped.length)
      add(
        "Strength",
        A,
        "Bump cases solved where the wheel would be",
        "warn",
        L.info.skipped.map(([n]) => n).join(", ") + " only at ride height",
        "The suspension can't reach that travel, so those cases use the ride-height geometry.",
        [view, "loads"]
      );
  }
  // ---- the whole car
  if (X.isCar) {
    const B = X.bal;
    if (B)
      for (const c of B.checks) {
        const [lab, unit, dec] = S.CAR_LABELS[c.key];
        add(
          "Car balance",
          "Car",
          lab,
          c.status === "PASS" ? "pass" : "fail",
          `${fmt(c.value, dec)} ${unit} (allowed ${rngTxt(c.lo, c.hi, dec)})`,
          CAR_WHY[c.key] || "",
          ["car", null],
          c.key === "roll_gradient" ? "roll_gradient" : "lltd"
        );
      }
    if (B)
      add(
        "Car balance",
        "Car",
        "Frame stiff enough for the suspension",
        !B.frame_k ? "input" : B.frame_ratio >= 3 ? "pass" : "warn",
        B.frame_k
          ? `Frame ${fmt(B.frame_k, 0)} Nm/deg = ${fmt(B.frame_ratio, 1)} × the suspension's roll stiffness; ${fmt(B.frame_bar_effect * 100, 0)} % of a bar change reaches the balance; front LLTD ${fmt(B.lltd_rigid * 100, 1)} % rigid → ${fmt(B.lltd * 100, 1)} %`
          : "No frame stiffness: the balance assumes a rigid frame.",
        B.frame_k
          ? "A frame that twists lets the ends roll apart, so tuning with springs and bars does less than planned; three or more times the suspension's roll stiffness is the usual aim."
          : "Enter the frame's torsional stiffness (Car view → Frame stiffness), from SolidWorks Simulation or a twist test, to see how much of the suspension tuning reaches the load transfer.",
        ["car", null],
        "lltd"
      );
    else
      add(
        "Car balance",
        "Car",
        "Roll balance",
        "input",
        X.why || "Needs both corners solved with springs.",
        "The roll gradient and LLTD need both axles' springs.",
        ["car", null],
        "lltd"
      );
    const F = X.corners[0].e,
      R = X.corners[1] && X.corners[1].e;
    if (F && R && S.RULESETS.fsae_2027_ic) {
      const rs = S.RULESETS.fsae_2027_ic;
      let rr = [],
        rvals = null;
      try {
        rr = S.checkRules(
          rs,
          (rvals = S.ruleValues(
            F.cfg,
            F,
            R.cfg,
            R,
            B,
            car.layout || null,
            car.cockpit || null,
            groundPointsFor(F, R),
            car.brake_system || null
          ))
        );
      } catch (x) {
        add("Rules", "Car", "Rules check", "fail", x.message, "", ["car", null]);
      }
      for (const r of rr) {
        if (r.status === "na") continue;
        const st = { pass: "pass", fail: "fail", unknown: "input", manual: "manual" }[r.status] || "manual";
        let v =
          typeof r.value === "number" && r.unit !== undefined
            ? r.id === "track_ratio"
              ? `${fmt(r.value * 100, 1)} % (min ${fmt(r.limit * 100, 0)} %)`
              : `${fmt(r.value, 1)} ${r.unit} (${r.kind === "between" ? `${fmt(r.limit[0], 0)} to ${fmt(r.limit[1], 0)}` : `${r.kind === "max" ? "max" : "min"} ${fmt(r.limit, r.limit % 1 ? 1 : 0)}`}${r.estimate ? ", estimate" : ""})${r.note ? " · " + r.note : ""}`
            : r.note || (st === "input" ? "An input it needs is missing." : "");
        if (r.id.startsWith("brake_") && st === "input") v = "Add the brake system (Car view → Layout → Brakes).";
        const g = r.id === "ground" && rvals && rvals._ground;
        if (r.id === "ground")
          v =
            g && st !== "input"
              ? `Tightest: ${g.point}, ${fmt(g.value, 1)} mm, with the body down ${fmt(g.drop, 1)} mm there (${Object.entries(g.state)
                  .map(([k, s]) => `${k} ${s}`)
                  .join(", ")})`
              : "Add the car's lowest points (Car view → Layout → Lowest points) or load the frame model.";
        add(
          "Rules",
          "Car",
          `${r.rule} ${r.summary}`,
          st,
          v,
          st === "manual" ? "The solver can't measure this one: check it on the CAD or the car." : "",
          ["car", "rules"]
        );
      }
    }
    // the frame and layout parts against the suspension (the chassis model's clearance check)
    const hasFrame = !!chassis.base,
      hasLay = !!(car.layout && (car.layout.components || []).some(c => c.solid !== false && c.size));
    if (!hasFrame && !hasLay)
      add(
        "Packaging",
        "Car",
        "Suspension and tires clear the frame and parts",
        "input",
        "No frame model or layout parts.",
        "Load your frame (Open → Chassis model, an STL from SolidWorks) and run its clearance check: links and tires against the tubes.",
        ["car", null]
      );
    else if (chassis.clear && chassis.clear.sig === chSignature() && chassis.clear.worst) {
      const w = chassis.clear.worst,
        nd = chassis.clear.need;
      add(
        "Packaging",
        "Car",
        "Suspension and tires clear the frame and parts",
        w.gap >= nd ? "pass" : "fail",
        `Closest: ${w.corner} ${w.name} to ${w.with || "the frame"}, ${w.gap === Infinity ? "over 150" : fmt(w.gap, 1)} mm (needs ${fmt(nd, 0)})`,
        "Every link and both tires over the whole travel and steer against your frame and the layout's solid parts.",
        ["car", null]
      );
    } else
      add(
        "Packaging",
        "Car",
        "Suspension and tires clear the frame and parts",
        "notrun",
        chassis.clear ? "The design or the model changed since the last check." : "Not run yet.",
        "Run it with the button at the top of this check (a second or so); it uses your frame model and the layout's solid parts.",
        ["car", null],
        null
      );
  } else
    add(
      "Rules",
      AX[X.corners[0].ax] || "Corner",
      "Rules and the roll balance",
      "input",
      "They need both axles.",
      "Open a car file (front, rear and the shared vehicle) to check the rules and the roll balance.",
      null
    );
  // ---- things only CAD, FEA or the car can answer
  add(
    "Check yourself",
    "Car",
    "FEA of the upright, wishbone brackets and rocker",
    "manual",
    "Export ▾ → Part loads for FEA gives every force per load case in your CAD axes.",
    "This tool checks tubes, tabs and simple plates; machined and welded parts need FEA with these loads.",
    null
  );
  add(
    "Check yourself",
    "Car",
    "Other bought parts against their catalog ratings",
    "manual",
    "Wheel bearings, the steering rack, CV joints, the anti-roll bar's bushings.",
    "The rod ends, ball joints, damper eyes and rocker bearing are checked above; these aren't modeled.",
    null
  );
  return out;
}
const CAR_WHY = {
  roll_gradient: "How far the body rolls per g of cornering: too much and the camber and the driver's feel suffer.",
  lltd: "How the front and rear share the load transfer in a corner: it sets the balance between understeer and oversteer.",
  lltd_vs_weight: "Front LLTD against the front weight share: a few points above is the usual start (mild understeer).",
  freq_ratio: "The rear's ride frequency against the front's: a little higher at the rear keeps the car flat over bumps.",
};
function chkCounts(items) {
  const n = Object.fromEntries(CHK_ORDER.map(s => [s, 0]));
  for (const i of items) n[i.status]++;
  return n;
}
const chkPill = s =>
  `<span class="pill ${CHK[s][2]} chkpill" title="${attr(CHK[s][1])}"><span aria-hidden="true">${CHK[s][0]}</span> ${CHK[s][1]}</span>`;
function chkSummary(n) {
  return CHK_ORDER.filter(s => n[s])
    .map(s => `<span class="pill ${CHK[s][2]}"><span class="big">${n[s]}</span> ${CHK[s][1].toLowerCase()}</span>`)
    .join(" ");
}
// the check page (dialog): grouped, the ones that need attention first in each group
let chkOnly = store.get("susp.chkOnly") !== "0";
function renderCheck() {
  const box = $("#chkBody");
  let X, items;
  try {
    X = checkScope();
    items = checkList(X);
  } catch (e) {
    box.innerHTML = `<div class="banner bad">The check couldn't run: ${esc(e.message)}</div>`;
    return;
  }
  chkState = { X, items };
  const n = chkCounts(items),
    groups = [...new Set(items.map(i => i.group))];
  let h = `<p class="chksum">${chkSummary(n)}</p>
    <p class="note">${X.isCar ? `The whole car: <b>${esc(X.name)}</b>, both corners, the roll balance and the ${esc((S.RULESETS.fsae_2027_ic || {}).name || "rules")}.` : `The open ${esc(X.corners[0].ax)} corner, <b>${esc(X.name)}</b>. Open a car file to add the roll balance and the rules.`} Click a row's button to go where it's fixed; <b>?</b> opens the term in Learn.</p>
    <label class="small-check"><input type="checkbox" id="chkOnly"${chkOnly ? " checked" : ""}> Show only what needs attention</label>`;
  if (X.isCar && (chassis.base || (car.layout && car.layout.components)))
    h += ` <button class="btn small" type="button" id="chkRunClear">Run the frame and parts clearance check</button>`;
  for (const g of groups) {
    const gi = items.filter(i => i.group === g).sort((a, b) => CHK_ORDER.indexOf(a.status) - CHK_ORDER.indexOf(b.status)),
      shown = chkOnly ? gi.filter(i => i.status !== "pass") : gi,
      gn = chkCounts(gi);
    h += `<h3 class="sub-h">${esc(g)} <span class="muted chkgn">${gn.pass} of ${gi.length} pass</span></h3>`;
    if (!shown.length) {
      h += `<p class="muted">All ${gi.length} pass.</p>`;
      continue;
    }
    h += `<div class="tbl-wrap"><table class="data chktab"><tbody>${shown
      .map((it, j) => {
        const idx = items.indexOf(it);
        return `<tr class="chk-${it.status}"><td class="chkst">${chkPill(it.status)}</td><td><b>${esc(it.axle)}: ${esc(it.title)}</b>${it.detail ? `<div class="chkdet">${esc(it.detail)}</div>` : ""}${it.why ? `<div class="muted chkwhy">${esc(it.why)}</div>` : ""}</td>
        <td class="chkgo">${it.go ? `<button class="btn small" type="button" data-chk-go="${idx}">Go there</button>` : ""}${it.term ? ` <button class="btn small" type="button" data-chk-term="${attr(it.term)}" aria-label="What this means">?</button>` : ""}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
  }
  box.innerHTML = h;
  $("#chkOnly").addEventListener("change", e => {
    chkOnly = e.target.checked;
    store.set("susp.chkOnly", chkOnly ? "1" : "0");
    renderCheck();
  });
  const rc = $("#chkRunClear");
  if (rc)
    rc.addEventListener("click", async () => {
      rc.disabled = true;
      rc.textContent = "Checking…";
      try {
        chassis.clear = await busy(chClearance());
      } catch (x) {
        flash("The clearance check failed: " + x.message);
      }
      renderCheck();
    });
  $$("[data-chk-go]", box).forEach(b =>
    b.addEventListener("click", () => {
      const it = items[+b.dataset.chkGo],
        [v, t] = it.go;
      closeCheck();
      if (v) setView(v);
      if (t === "rules") {
        const rb = $("#rulesBox");
        if (rb) {
          rb.open = true;
          rb.scrollIntoView({ block: "start" });
        }
      } else if (t) {
        const tb = $(`#tab_${cssq(t)}`);
        if (tb) {
          tb.click();
          tb.scrollIntoView({ block: "start" });
        }
      }
    })
  );
  $$("[data-chk-term]", box).forEach(b =>
    b.addEventListener("click", () => {
      closeCheck();
      openTerm(b.dataset.chkTerm);
    })
  );
}
let chkState = null;
function openCheck() {
  $("#chkDlg").hidden = false;
  $("#chkBody").innerHTML = `<p class="muted">Checking…</p>`;
  setTimeout(renderCheck, 30);
}
function closeCheck() {
  $("#chkDlg").hidden = true;
}
// the sign-off report: every check, passes included, and lines to sign
function checkReportHtml() {
  const X = chkState ? chkState.X : checkScope(),
    items = chkState ? chkState.items : checkList(X),
    n = chkCounts(items),
    when = new Date().toLocaleString();
  const st = s => `<span class="${s === "pass" ? "ok" : s === "fail" ? "bad" : ""}">${CHK[s][0]} ${CHK[s][1]}</span>`;
  let body = `<header><h1>${esc(X.name)}</h1><p>Design check · ${esc(when)} · Suspension Solver ${esc(APP_VERSION)}</p></header>
    <p class="pills">${CHK_ORDER.filter(s => n[s])
      .map(s => `<span class="pill ${s === "pass" ? "okb" : s === "fail" ? "badb" : ""}">${n[s]} ${CHK[s][1].toLowerCase()}</span>`)
      .join(" ")}</p>
    <p class="note">${X.isCar ? "The whole car: both corners, the roll balance and the rules." : `One corner (${esc(X.corners[0].ax)}); the roll balance and the rules need a car file.`} Needs input = the check couldn't run without a number you haven't entered. Check yourself = outside what this tool can measure.</p>`;
  for (const g of [...new Set(items.map(i => i.group))]) {
    const gi = items.filter(i => i.group === g).sort((a, b) => CHK_ORDER.indexOf(a.status) - CHK_ORDER.indexOf(b.status));
    body += `<h2>${esc(g)}</h2><table><thead><tr><th>Status</th><th>Check</th><th>Result</th></tr></thead><tbody>${gi
      .map(
        i =>
          `<tr><td style="white-space:nowrap">${st(i.status)}</td><td><b>${esc(i.axle)}:</b> ${esc(i.title)}<br><small>${esc(i.why || "")}</small></td><td>${esc(i.detail || "")}</td></tr>`
      )
      .join("")}</tbody></table>`;
  }
  body += `<h2>Sign-off</h2><table class="sign"><tbody>
    <tr><td>Checked by</td><td></td><td>Date</td><td></td></tr>
    <tr><td>Reviewed by</td><td></td><td>Date</td><td></td></tr>
    <tr><td>Open items and who owns them</td><td colspan="3" style="height:5em"></td></tr></tbody></table>
    <p class="note">Statuses are what the solver computes from the design file at the time above. Rules are paraphrased by rule number: read the rulebook for the exact wording.</p>`;
  return reportPage(`${X.name} · design check`, body);
}
$("#btnCheck").addEventListener("click", openCheck);
$("#chkClose").addEventListener("click", closeCheck);
$("#chkDlg").addEventListener("click", e => {
  if (e.target.id === "chkDlg") closeCheck();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#chkDlg").hidden) closeCheck();
});
$("#chkReport").addEventListener("click", () => {
  const X = chkState ? chkState.X : checkScope();
  download(fileBase(X.name) + "_check.html", new Blob([checkReportHtml()], { type: "text/html" }));
});
