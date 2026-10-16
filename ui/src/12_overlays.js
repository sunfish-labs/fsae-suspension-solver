// 12_overlays.js - "Show me" overlays: the construction drawings (roll center, instant centers, Ackermann, ...).
// --------------------------------------------------- "Show me" overlays
const OVERLAYS = {
  labels: { mode: "iso", name: "Hardpoint names" },
  kingpin: { mode: "iso", name: "Steering axis" },
  caster: { mode: "side", name: "Caster" },
  kpi: { mode: "front", name: "KPI" },
  scrub: { mode: "front", name: "Scrub radius" },
  trail: { mode: "side", name: "Mechanical trail" },
  camber: { mode: "front", name: "Camber" },
  toe: { mode: "top", name: "Toe" },
  steer_arm: { mode: "top", name: "Steering arm" },
  ackermann: { mode: "top", name: "Ackermann" },
  fvsa: { mode: "front", name: "Front-view instant center and swing arm" },
  roll_center: { mode: "front", name: "Roll center" },
  anti: { mode: "side", name: "Side-view instant center and anti geometry" },
  travel: { mode: "front", name: "Bump and droop", anim: true },
  camber_gain: { mode: "front", name: "Camber gain", anim: true },
  bump_steer: { mode: "top", name: "Bump steer", anim: true },
  track_change: { mode: "front", name: "Track change", anim: true },
  motion_ratio: { mode: "iso", name: "Motion ratio", anim: true },
};
$("#showSel").innerHTML =
  `<option value="">Show me…</option>` +
  Object.entries(OVERLAYS)
    .filter(([k]) => k !== "labels")
    .map(([k, o]) => `<option value="${attr(k)}">${esc(o.name)}</option>`)
    .join("");
function axisGround(p) {
  // steering axis through the ball joints, and where it meets the ground
  const k = V.unit(V.sub(p.ub, p.lb)),
    t = (p.cp[2] - p.lb[2]) / k[2];
  return { k, g: V.add(p.lb, V.mul(k, t)) };
}
// camera distance that fits a w × h (mm) region of the screen plane
function fitR(w, hh) {
  const asp = three ? three.cam.aspect || 2 : 2,
    t = Math.tan((17.5 * Math.PI) / 180);
  return (Math.max(hh, w / asp) / (2 * t)) * 1.12;
}
let savedCam = null;
function showMe(id) {
  stopAnim();
  if (id && !view.overlay && three && view.target)
    savedCam = { theta: view.theta, phi: view.phi, r: view.r, target: view.target.clone(), mode: view.mode, rack: pose.rack };
  view.overlay = id;
  $("#tgLabels").setAttribute("aria-pressed", String(id === "labels"));
  $("#showSel").value = id && id !== "labels" ? id : "";
  $("#vhint").hidden = !!id || store.get("susp.tipSeen") === "1";
  if (!id) {
    $("#ovcap").hidden = true;
    if (savedCam) {
      Object.assign(view, { theta: savedCam.theta, phi: savedCam.phi, r: savedCam.r, target: savedCam.target });
      setMode(savedCam.mode);
      setRack(savedCam.rack);
      if (three) three.need = true;
      savedCam = null;
    }
    if (Math.abs(pose.dz) > 0 && !view.anim) setTravel(0);
    updateScene();
    return;
  }
  const ov = OVERLAYS[id];
  if (ov.mode) setMode(ov.mode);
  if (savedCam && id !== "ackermann") setRack(savedCam.rack);
  // frame the view on what the overlay draws
  const s = ev.susp,
    o0 = s.observe(s.pose(pose.dz, pose.rack), pose.dz, pose.rack),
    p = o0._pts,
    D = 2 * s.R;
  if (id === "fvsa" || id === "roll_center") {
    const ic = o0.fv_ic,
      icy = ic ? Math.max(ic[0], p.cp[1] - 5000) : -p.cp[1];
    const lo = Math.min(icy, id === "roll_center" ? -p.cp[1] : p.cp[1]) - 150,
      hi = p.cp[1] + s.cfg.wheel.tire_width;
    frameOn([p.cp[0], (lo + hi) / 2, Math.max(250, (ic ? Math.min(ic[1], 1500) : 0) / 2) - 170], fitR(hi - lo, D + 650));
  } else if (id === "anti") {
    const Lr = s.WB * 0.7,
      dirx = cfg.axle === "front" ? -1 : 1;
    frameOn([p.cp[0] + (dirx * Lr) / 2, p.cp[1], 350], fitR(Lr + D + 200, D + 500));
  } else if (id === "ackermann") {
    if (cfg.axle === "front" && Math.abs(pose.rack) < 3) setRack(Math.round(cfg.sweep.rack_travel * 0.9));
    const ak = ackPoints(s),
      hy = ak ? ak.w.filter(q => q.hit && Math.abs(q.hit[1]) < s.track * 6).map(q => q.hit[1]) : [];
    const xs = [p.cp[0] + 450, p.cp[0] - s.WB - 450],
      ys = [-s.track / 2 - 350, s.track / 2 + 350, ...hy.map(y => y - 250), ...hy.map(y => y + 250)];
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    frameOn([(x0 + x1) / 2, (y0 + y1) / 2, 0], fitR(y1 - y0, (x1 - x0) * 1.45));
  } else if (id === "labels" || id === "motion_ratio") frameOn([p.cp[0], p.cp[1] * 0.55, 260], fitR(p.cp[1] * 1.3 + 500, D + 300));
  else if (id === "toe" || id === "bump_steer" || id === "steer_arm") frameOn([p.cp[0], p.cp[1] * 0.8, 0], fitR(p.cp[1] + 700, 1300));
  else frameOn([p.cp[0], p.cp[1] * 0.85, 280], fitR(p.cp[1] * 0.6 + 600, D + 480));
  clearTimeout(view.ovTimer);
  view.ovStage = 3;
  if (id === "roll_center" && !reduceMotion) {
    view.ovStage = 1;
    view.ovTimer = setTimeout(() => {
      view.ovStage = 2;
      updateScene();
      view.ovTimer = setTimeout(() => {
        view.ovStage = 3;
        updateScene();
      }, 1600);
    }, 1600);
  }
  if (ov.anim && !reduceMotion) view.anim = { t0: null, T: S.travelRange(cfg) };
  else if (ov.anim) setTravel(S.travelRange(cfg)[1]);
  else if (pose.dz) setTravel(0);
  $("#ovcap").hidden = false;
  updateScene();
  const vw = $("#viewer");
  if (vw.getBoundingClientRect().top < 0 || vw.getBoundingClientRect().top > window.innerHeight * 0.6)
    vw.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}
function drawOverlay(id, { D, o, p, h, s, x, sst, col }) {
  const A = col.accent,
    m = ev.metrics,
    cap = (name, val, note) => {
      $("#ovcap").innerHTML =
        `<span><b>${esc(name)}</b>${val ? ` <span class="mono">${val}</span>` : ""}${note ? ` · ${note}` : ""}</span>${OVERLAYS[id].anim || id === "roll_center" ? `<button class="btn small" type="button" id="ovReplay">Replay</button>` : ""}<button class="btn small" type="button" id="ovHide">Hide</button>`;
    };
  const { k, g } = axisGround(p);
  const axisRod = () => {
    D.rod(g, V.add(p.ub, V.mul(k, 140)), 3.2, A);
    D.dot(g, A, 9);
  };
  const wheelUp = () => V.unit(V.sub([0, 0, 1], V.mul(p.a, p.a[2])));
  switch (id) {
    case "labels": {
      const pts = [
        ["hardpoints.upper_inboard_front", h.uif],
        ["hardpoints.upper_inboard_rear", h.uir],
        ["hardpoints.lower_inboard_front", h.lif],
        ["hardpoints.lower_inboard_rear", h.lir],
        ["hardpoints.upper_outboard", p.ub],
        ["hardpoints.lower_outboard", p.lb],
        ["hardpoints.trackrod_inboard", p.tri],
        ["hardpoints.trackrod_outboard", p.tro],
        ["hardpoints.contact_patch", p.cp],
      ];
      if (sst) {
        pts.push(["spring.rod_outboard", sst.rod_out], ["spring.damper_chassis", ev.spring.dch]);
        if (!ev.spring.direct) pts.push(["spring.rocker_pivot", ev.spring.c]);
      }
      three.labels = pts.map(([path, pt]) => ({ path, pt, text: pointName(path) }));
      cap("Hardpoint names", "", "click any joint in the 3D view to see what moving it does");
      break;
    }
    case "kingpin":
      axisRod();
      D.dot(p.cp, col.s1, 8);
      D.label(V.add(p.ub, V.mul(k, 170)), "steering axis", A);
      D.label(g, "meets the ground here", A);
      cap("Steering axis", "", "the line through the ball joints; the wheel steers about it");
      break;
    case "caster":
      axisRod();
      D.line([g, [g[0], g[1], p.ub[2] + 140]], col.muted, true);
      D.label(V.add(g, [170, 0, 140]), `caster ${fmt(o.caster, 2)}°`, A);
      cap("Caster", `${fmt(o.caster, 2)}°`, "tilt of the steering axis seen from the side (dashed = vertical)");
      break;
    case "kpi":
      axisRod();
      D.line([g, [g[0], g[1], p.ub[2] + 140]], col.muted, true);
      D.label(V.add(g, [0, -190, 140]), `KPI ${fmt(o.kpi, 2)}°`, A);
      cap("KPI", `${fmt(o.kpi, 2)}°`, "tilt of the steering axis seen from the front (dashed = vertical)");
      break;
    case "scrub":
      axisRod();
      D.rod([p.cp[0], g[1], 2], [p.cp[0], p.cp[1], 2], 4, col.s1);
      D.dot(p.cp, col.s1, 9);
      D.label([p.cp[0], (g[1] + p.cp[1]) / 2, 60], `scrub ${fmt(o.scrub, 1)} mm`, col.s1);
      cap("Scrub radius", `${fmt(o.scrub, 1)} mm`, "sideways gap at the ground between the steering axis and the contact patch");
      break;
    case "trail":
      axisRod();
      D.rod([g[0], p.cp[1], 2], [p.cp[0], p.cp[1], 2], 4, col.s1);
      D.dot(p.cp, col.s1, 9);
      D.label([(g[0] + p.cp[0]) / 2, p.cp[1], 60], `trail ${fmt(o.trail, 1)} mm`, col.s1);
      cap("Mechanical trail", `${fmt(o.trail, 1)} mm`, "fore-aft gap at the ground: axis ahead of the contact patch = self-centering");
      break;
    case "camber":
    case "camber_gain": {
      const L = 2 * s.R + 80,
        u = wheelUp();
      D.line([p.cp, V.add(p.cp, [0, 0, L])], col.muted, true);
      D.rod(p.cp, V.add(p.cp, V.mul(u, L)), 3.2, A);
      D.label(V.add(p.cp, V.mul(u, L + 40)), `camber ${fmt(o.camber, 2)}°`, A);
      if (id === "camber") cap("Camber", `${fmt(o.camber, 2)}°`, "wheel lean from vertical (dashed); negative = top leans in");
      else cap("Camber gain", `${fmt(m.camber_gain, 3)} deg/in`, `camber now ${fmt(o.camber, 2)}° at ${fmt(pose.dz, 0)} mm travel`);
      break;
    }
    case "toe":
    case "bump_steer": {
      const toe0 = ev.metrics.toe,
        mag = id === "bump_steer" ? 25 : 10,
        ang = ((id === "bump_steer" ? (o.toe - toe0) * mag + toe0 : o.toe * mag) * Math.PI) / 180;
      const hd = [Math.cos(ang), -Math.sin(ang), 0]; // toe-in (+) points the front of the right wheel inboard (-Y)
      D.line([V.add(p.cp, [-520, 0, 2]), V.add(p.cp, [520, 0, 2])], col.muted, true);
      D.rod(V.add(p.cp, V.add(V.mul(hd, -480), [0, 0, 3])), V.add(p.cp, V.add(V.mul(hd, 480), [0, 0, 3])), 3.5, A);
      D.label(V.add(p.cp, [250, 260, 10]), id === "toe" ? `toe ${fmt(o.toe, 3)}°` : `toe change ${fmt(o.toe - toe0, 3)}°`, A);
      if (id === "toe") cap("Toe", `${fmt(o.toe, 3)}°`, "wheel heading vs straight ahead (dashed); angle drawn 10× larger to be visible");
      else cap("Bump steer", `${fmt(m.bump_steer, 3)} deg/in`, `toe change at ${fmt(pose.dz, 0)} mm travel, drawn 25× larger`);
      break;
    }
    case "steer_arm": {
      const f = V.add(p.lb, V.mul(k, V.dot(V.sub(p.tro, p.lb), k)));
      axisRod();
      D.rod(p.tro, f, 4, col.s1);
      D.label(V.mul(V.add(p.tro, f), 0.5), `steering arm ${fmt(m.steer_arm ?? V.norm(V.sub(p.tro, f)), 0)} mm`, col.s1);
      cap("Steering arm", `${fmt(V.norm(V.sub(p.tro, f)), 1)} mm`, "tie-rod joint to the steering axis, at right angles");
      break;
    }
    case "ackermann": {
      if (cfg.axle !== "front") {
        cap("Ackermann", "", "steering applies to the front axle");
        break;
      }
      if (!pose.rack) {
        cap("Ackermann", `${fmt(m.ackermann, 0)} %`, "drag Rack to steer; the lines appear once the wheels are turned");
        break;
      }
      const ak = ackPoints(s);
      if (!ak) {
        cap("Ackermann", "", "this rack position cannot be reached");
        break;
      }
      const { rx, w } = ak,
        lim = s.track * 6;
      D.line(
        [
          [rx, Math.min(-s.track * 0.7, ...w.map(q => (q.hit ? q.hit[1] : 0))) - 200, 3],
          [rx, Math.max(s.track * 0.7, ...w.map(q => (q.hit ? q.hit[1] : 0))) + 200, 3],
        ],
        col.muted,
        true
      );
      D.label([rx + 120, 0, 40], "rear axle line", col.muted);
      w.forEach((q, i) => {
        const c = i ? col.s1 : A;
        if (q.hit && Math.abs(q.hit[1]) < lim) {
          D.line([q.c, [q.hit[0], q.hit[1], 3]], c);
          D.dot([q.hit[0], q.hit[1], 3], c, 14);
        } else D.line([q.c, V.add(q.c, V.mul(V.unit(q.d), -Math.sign(q.d[0] || 1) * s.WB))], c);
      });
      const gap = w[0].hit && w[1].hit ? Math.abs(w[0].hit[1] - w[1].hit[1]) : null;
      cap(
        "Ackermann",
        `${fmt(m.ackermann, 0)} %`,
        `axle lines of both front wheels; at 100 % they meet the rear axle line at one point${gap != null ? ` (now ${fmt(gap, 0)} mm apart)` : ""}`
      );
      break;
    }
    case "fvsa":
    case "roll_center": {
      if (!o.fv_ic) {
        cap(OVERLAYS[id].name, "", "the arms are parallel in front view, so the instant center is at infinity");
        break;
      }
      const ic = [p.cp[0], o.fv_ic[0], o.fv_ic[1]];
      if (Math.abs(ic[1] - p.cp[1]) > 5200) {
        const u = V.unit(V.sub(ic, [p.cp[0], p.lb[1], p.lb[2]]));
        D.line(
          [[p.cp[0], p.ub[1], p.ub[2]], V.add([p.cp[0], p.ub[1], p.ub[2]], V.mul(V.unit(V.sub(ic, [p.cp[0], p.ub[1], p.ub[2]])), 4000))],
          col.s1,
          true
        );
        D.line([[p.cp[0], p.lb[1], p.lb[2]], V.add([p.cp[0], p.lb[1], p.lb[2]], V.mul(u, 4000))], col.s1, true);
        cap(
          OVERLAYS[id].name,
          id === "fvsa" ? `${fmt(o.fvsa, 0)} mm` : `${fmt(o.roll_center, 1)} mm`,
          `the wishbones (dashed blue) cross ${fmt(Math.abs(ic[1] - p.cp[1]) / 1000, 1)} m away, off screen: nearly parallel arms`
        );
        break;
      }
      const stg = id === "roll_center" ? view.ovStage || 3 : 3;
      D.line([[p.cp[0], p.ub[1], p.ub[2]], ic], col.s1, true);
      D.line([[p.cp[0], p.lb[1], p.lb[2]], ic], col.s1, true);
      if (stg === 1) {
        cap("Roll center · step 1 of 3", "", "extend both wishbones inboard (dashed blue) until they cross");
        break;
      }
      D.dot(ic, col.s1, 16);
      D.label(V.add(ic, [0, 0, 70]), "instant center", col.s1);
      if (stg === 2) {
        cap("Roll center · step 2 of 3", "", "where the extended wishbones cross is the instant center (blue dot)");
        break;
      }
      if (id === "fvsa") {
        D.rod([p.cp[0], p.cp[1], 2], [p.cp[0], ic[1], 2], 4, A);
        D.line([ic, [p.cp[0], ic[1], 0]], col.muted, true);
        D.label([p.cp[0], (p.cp[1] + ic[1]) / 2, -70], `FVSA ${fmt(o.fvsa, 0)} mm`, A);
        cap("Front-view swing arm", `${fmt(o.fvsa, 0)} mm`, "dashed blue = the wishbones extended until they cross");
      } else {
        const rc = [p.cp[0], 0, o.roll_center + p.cp[2]];
        D.line(
          [
            [p.cp[0], 0, 0],
            [p.cp[0], 0, Math.max(450, rc[2] + 250)],
          ],
          col.muted,
          true
        );
        D.label([p.cp[0], 0, Math.max(450, rc[2] + 250) + 30], "car centerline", col.muted);
        D.rod(p.cp, ic, 3, A);
        D.rod([p.cp[0], -p.cp[1], p.cp[2]], [p.cp[0], -ic[1], ic[2]], 3, A);
        D.dot([p.cp[0], -ic[1], ic[2]], col.s1, 10);
        D.dot(rc, A, 18);
        D.label(V.add(rc, [0, 0, 80]), `roll center ${fmt(o.roll_center, 1)} mm`, A);
        cap(
          "Roll center",
          `${fmt(o.roll_center, 1)} mm`,
          "orange: contact patch → instant center; where the lines from both sides cross the centerline is the roll center"
        );
      }
      break;
    }
    case "anti": {
      if (!o.sv_ic) {
        cap("Anti geometry", "", "the pivot axes are parallel in side view (no anti effect)");
        break;
      }
      const veh = cfg.vehicle,
        front = cfg.axle === "front";
      const ref = (front ? veh.brakes === "inboard" : veh.drive === "inboard") ? p.c : p.cp;
      const sv = [o.sv_ic[0], p.cp[1], o.sv_ic[1]],
        Lr = s.WB * 0.7,
        dirx = front ? -1 : 1;
      const dx = sv[0] - ref[0],
        mine = Math.abs(dx) > 1e-6 ? (sv[2] - ref[2]) / dx : 0;
      const slope = front ? s.CG / (s.WB * veh.front_brake_share) : s.CG / s.WB;
      const yours = [ref[0] + dirx * Lr, ref[1], ref[2] + mine * dirx * Lr],
        full = [ref[0] + dirx * Lr, ref[1], ref[2] + slope * Lr];
      D.rod(ref, yours, 3.2, A);
      D.label(yours, "your line", A);
      D.line([ref, full], col.ok, true);
      D.label(full, "100 % line", col.ok);
      if (Math.abs(dx) < Lr * 1.3) {
        D.dot(sv, A, 15);
        D.label(V.add(sv, [0, 0, 70]), "side-view instant center", A);
      }
      const val = front ? m.antidive : m.antisquat;
      cap(
        front ? "Anti-dive" : "Anti-squat",
        `${fmt(val, 1)} %`,
        `the line from the ${ref === p.c ? "wheel center" : "contact patch"} toward the side-view instant center (orange) vs the 100 % line (green); steeper = more anti`
      );
      break;
    }
    case "travel":
      cap("Bump and droop", `${fmt(pose.dz, 0)} mm`, "the wheel moving through its full travel");
      break;
    case "track_change":
      D.dot([h.cp[0], h.cp[1], 3], col.muted, 9);
      D.rod([h.cp[0], h.cp[1], 3], [p.cp[0], p.cp[1], 3], 3, A);
      cap(
        "Track change",
        `${fmt(p.cp[1] - h.cp[1], 2)} mm`,
        `sideways contact-patch shift at ${fmt(pose.dz, 0)} mm travel (gray = ride height)`
      );
      break;
    case "motion_ratio": {
      if (!sst) {
        cap("Motion ratio", "", "turn on the spring and damper to see it");
        break;
      }
      D.label(V.add(sst.damper_out, [0, 0, 70]), `damper ${fmt(sst.damper_len, 1)} mm`, A);
      cap("Motion ratio", fmt(m.motion_ratio, 3), `damper ${fmt(sst.damper_len, 1)} mm at ${fmt(pose.dz, 0)} mm wheel travel`);
      break;
    }
  }
  const hb = $("#ovHide");
  if (hb) hb.onclick = () => showMe(null);
  const rb = $("#ovReplay");
  if (rb) rb.onclick = () => showMe(view.overlay);
}
function ackPoints(s) {
  // where each front wheel's axle line crosses the rear axle line, at the current rack
  try {
    const q1 = s.observe(s.pose(pose.dz, pose.rack), pose.dz, pose.rack)._pts,
      q2 = s.observe(s.pose(pose.dz, -pose.rack), pose.dz, -pose.rack)._pts;
    const rx = q1.cp[0] - s.WB;
    const w = [
      [
        [q1.c[0], q1.c[1], 3],
        [q1.a[0], q1.a[1], 0],
      ],
      [
        [q2.c[0], -q2.c[1], 3],
        [q2.a[0], -q2.a[1], 0],
      ],
    ].map(([c, d]) => {
      const t = Math.abs(d[0]) > 1e-6 ? (rx - c[0]) / d[0] : NaN;
      return { c, d, hit: Number.isFinite(t) ? [rx, c[1] + t * d[1]] : null };
    });
    return { rx, w };
  } catch (e) {
    return null;
  }
}
