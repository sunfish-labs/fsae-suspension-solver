// ------------------------------------------------------------------ challenges
// Challenge mode swaps the inputs column for a "challenge rail" of the same size, so nothing new competes for
// screen space: the brief, live goal meters, only the points you may move, a hint ladder and the score.
const presetCfg = prefix => {
  const p = PRESETS.find(q => (q.label || "").startsWith(prefix));
  return p ? JSON.parse(JSON.stringify(p.cfg)) : null;
};
const CHALLENGES = [
  {
    id: "rc",
    n: 1,
    title: "Lift the roll center",
    stage: "Stage 1 · inboard pivots",
    start: "Case study 1",
    ref: "Case study 2",
    tab: "roll",
    overlay: "roll_center",
    par: 130,
    brief:
      "This first-draft front corner has its roll center 5 mm off the ground, and it slides almost 400 mm sideways for every degree of body roll. Move only the four inboard pivots, up/down (Z) and in/out (Y), until the roll center is 25–60 mm high, stays put in roll, and the camber gain is reasonable.",
    unlock: [
      "hardpoints.upper_inboard_front",
      "hardpoints.upper_inboard_rear",
      "hardpoints.lower_inboard_front",
      "hardpoints.lower_inboard_rear",
    ],
    axes: [1, 2],
    goals: ["roll_center", "rc_lat", "camber_gain"],
    bonus: { key: "antidive", text: "Anti-dive 5–20 %" },
    concept: [
      "Click Show me below: the view turns to face the front of the car and builds the roll center in three steps. The dashed blue lines are your upper and lower wishbones, extended inboard. Where they cross is the instant center (blue dot): the wheel moves as if it swings about that point.",
      "The orange line runs from the tire's contact patch through the instant center. The same line is drawn from the other side of the car (shown faintly). Where the two orange lines cross on the car's centerline is the roll center (orange dot).",
      "Two rules: a higher instant center gives a higher roll center, and a closer instant center (a shorter swing arm) gives more camber gain. No single pivot move raises it without pulling it closer, so you will need to combine moves.",
    ],
    show: "roll_center",
    step: 5,
    levers: [
      {
        name: "Lower arm up",
        mv: [
          ["hardpoints.lower_inboard_front", 2, 1],
          ["hardpoints.lower_inboard_rear", 2, 1],
        ],
      },
      {
        name: "Upper arm up",
        mv: [
          ["hardpoints.upper_inboard_front", 2, 1],
          ["hardpoints.upper_inboard_rear", 2, 1],
        ],
      },
      {
        name: "Lower arm inboard",
        mv: [
          ["hardpoints.lower_inboard_front", 1, -1],
          ["hardpoints.lower_inboard_rear", 1, -1],
        ],
      },
      {
        name: "Upper arm outboard",
        mv: [
          ["hardpoints.upper_inboard_front", 1, 1],
          ["hardpoints.upper_inboard_rear", 1, 1],
        ],
      },
      {
        name: "Tilt lower arm (front down, rear up)",
        mv: [
          ["hardpoints.lower_inboard_rear", 2, -0.5],
          ["hardpoints.lower_inboard_front", 2, 0.5],
        ],
        bonusOnly: true,
      },
    ],
  },
  {
    id: "bs",
    n: 2,
    title: "Kill the bump steer",
    stage: "Stage 2 · tie rod",
    start: "Case study 2",
    tab: "heave",
    overlay: "bump_steer",
    par: 18,
    brief:
      "The pivots are done, but this wheel steers itself 0.09° per inch of bump and its toe wanders 0.18° over the travel. A car like that darts over every bump. Move only the tie-rod ends, in/out (Y) and up/down (Z), until bump steer is within ±0.03 deg/in and toe never changes by more than 0.05°, without wrecking the Ackermann.",
    unlock: ["hardpoints.trackrod_inboard", "hardpoints.trackrod_outboard"],
    axes: [1, 2],
    goals: ["bump_steer", "bump_steer_max", "ackermann"],
    bonus: {
      fn: (c, c0) => V.norm(V.sub(c.hardpoints.trackrod_outboard, c0.hardpoints.trackrod_outboard)) < 0.05,
      text: "Leave the outer end alone (it is on the upright, which is already made)",
    },
    concept: [
      "Click Show me below: the wheel moves through bump in the top view, and the orange line shows which way it points (drawn 25× larger). If the line swings, the car has bump steer.",
      "It happens because the tie rod's outer end swings on an arc around its inner end, while the upright moves on arcs set by the wishbones. If those arcs differ, the tie rod pushes or pulls the steering arm and the wheel steers itself.",
      "Rule of thumb: the inner end's height (Z) sets the slope of the toe curve (a straight sloped line in the toe chart, Motion → Heave), and the tie rod's length (Y) sets its curvature (a U or arch shape). Moving the outer end in or out also changes the steering-arm geometry, so watch Ackermann.",
    ],
    show: "bump_steer",
    step: 2,
    levers: [
      { name: "Inner end up", mv: [["hardpoints.trackrod_inboard", 2, 1]] },
      { name: "Inner end outboard", mv: [["hardpoints.trackrod_inboard", 1, 1]] },
      { name: "Outer end up", mv: [["hardpoints.trackrod_outboard", 2, 1]] },
      { name: "Outer end outboard", mv: [["hardpoints.trackrod_outboard", 1, 1]] },
    ],
  },
  {
    id: "axis",
    n: 3,
    title: "Set the steering axis",
    stage: "Stage 3 · upright ball joints",
    start: "Case study 4",
    mods: [
      ["hardpoints.lower_outboard", 0, 10],
      ["hardpoints.lower_outboard", 1, -10],
    ],
    tab: "checks",
    overlay: "kingpin",
    par: 16,
    brief:
      "The upright designer moved the lower ball joint to clear the brake caliper, and now the steering axis is off everywhere: KPI 2°, scrub radius 35 mm, caster 8° and 34 mm of trail. The steering will be heavy and kick back over bumps. Move only the two ball joints, fore/aft (X) and in/out (Y), until KPI, scrub, caster and trail are all in range.",
    unlock: ["hardpoints.upper_outboard", "hardpoints.lower_outboard"],
    axes: [0, 1],
    goals: ["kpi", "scrub", "caster", "trail"],
    bonus: {
      fn: (c, c0, e) => !!e && e.metrics.scrub <= 15,
      text: "Scrub radius 15 mm or less (lighter steering, less kickback)",
    },
    concept: [
      "Click Show me below: the steering axis is the line through the two ball joints. The wheel turns about it, so its tilt decides how the steering feels.",
      "Seen from the front, the axis leans in at the top: that is KPI. Where it meets the ground, measured to the middle of the tire, is the scrub radius. Seen from the side, the axis leans back at the top: that is caster, and the distance on the ground from the axis to the contact patch is the trail.",
      "So the side-view (X) moves set caster and trail, and the front-view (Y) moves set KPI and scrub, almost independently. Moving the top and the bottom joint the same way slides the whole axis (mostly scrub or trail); moving them opposite ways tilts it (mostly KPI or caster).",
    ],
    show: "kingpin",
    step: 2,
    levers: [
      { name: "Lower ball joint forward", neg: "Lower ball joint rearward", mv: [["hardpoints.lower_outboard", 0, 1]] },
      { name: "Lower ball joint outboard", mv: [["hardpoints.lower_outboard", 1, 1]] },
      { name: "Upper ball joint forward", neg: "Upper ball joint rearward", mv: [["hardpoints.upper_outboard", 0, 1]] },
      { name: "Upper ball joint outboard", mv: [["hardpoints.upper_outboard", 1, 1]] },
    ],
  },
  {
    id: "dive",
    n: 4,
    title: "Stop the nose dive",
    stage: "Stage 4 · side view",
    start: "Case study 4",
    mods: [
      ["hardpoints.lower_inboard_front", 2, -10],
      ["hardpoints.lower_inboard_rear", 2, 10],
      ["hardpoints.upper_inboard_front", 2, 5],
      ["hardpoints.upper_inboard_rear", 2, -5],
    ],
    tab: "heave",
    overlay: "anti",
    par: 26,
    brief:
      "This corner's front view is good (the roll center is where you put it in challenge 1), but its anti-dive is −20 %: under braking the nose dives even harder than a car with no anti geometry at all. Move only the four inboard pivots, up and down (Z), until anti-dive is 5–20 %, without losing the roll center or adding bump steer.",
    unlock: [
      "hardpoints.upper_inboard_front",
      "hardpoints.upper_inboard_rear",
      "hardpoints.lower_inboard_front",
      "hardpoints.lower_inboard_rear",
    ],
    axes: [2],
    goals: ["antidive", "roll_center", "bump_steer"],
    bonus: {
      fn: (c, c0, e) => !!e && !!chal && !!chal.rc0 && Math.abs(e.metrics.roll_center - chal.rc0) <= 2,
      text: "Keep the roll center within 2 mm of where it started",
    },
    concept: [
      "Click Show me below: the view turns to the side. Extend the two wishbones' pivot axes (side view) until they cross: that is the side-view instant center. A line from the tire's contact patch through it, compared with the line to the car's CG, gives the anti-dive.",
      "Anti-dive comes from the pivot axes' tilt in the side view, not from their height. Raising both pivots of one arm by the same amount mostly moves the roll center; raising one end and lowering the other tilts the axis and mostly changes the anti-dive.",
      "So tilt the arms. Tilting them so the axes converge toward the car's middle raises anti-dive. Then check the roll center and the bump steer: a tilt that isn't quite equal and opposite moves them a little.",
    ],
    show: "anti",
    step: 2,
    levers: [
      {
        name: "Tilt lower arm (front down, rear up)",
        neg: "Tilt lower arm (front up, rear down)",
        mv: [
          ["hardpoints.lower_inboard_rear", 2, -1],
          ["hardpoints.lower_inboard_front", 2, 1],
        ],
      },
      {
        name: "Tilt upper arm (front up, rear down)",
        neg: "Tilt upper arm (front down, rear up)",
        mv: [
          ["hardpoints.upper_inboard_rear", 2, 1],
          ["hardpoints.upper_inboard_front", 2, -1],
        ],
      },
      {
        name: "Lower arm up",
        mv: [
          ["hardpoints.lower_inboard_front", 2, 1],
          ["hardpoints.lower_inboard_rear", 2, 1],
        ],
      },
      {
        name: "Upper arm up",
        mv: [
          ["hardpoints.upper_inboard_front", 2, 1],
          ["hardpoints.upper_inboard_rear", 2, 1],
        ],
      },
    ],
  },
  {
    id: "rocker",
    n: 5,
    title: "Fit the cheap spring",
    stage: "Stage 5 · rocker and damper",
    start: "Case study 4",
    mods: [
      ["spring.rocker_damper", 2, 15],
      ["spring.rocker_rod", 1, -5],
      ["spring.rocker_rod", 2, -5],
    ],
    targets: { ride_freq: [3.3, 3.7], mr_progression: [0, 10] },
    tab: "spring",
    overlay: "motion_ratio",
    par: 20,
    brief:
      "The team bought the cheapest coil-over in the catalog, and its 300 lb/in (52.5 N/mm) spring can't change. On this rocker the corner rides at 4.2 Hz (target 3.3–3.7) and the damper runs out of stroke at both ends. Move only the rocker's two pin holes, the pushrod end and the damper end, in their plane (Y and Z), until the ride frequency is in range, the damper keeps 2 mm spare at full bump and full droop, and the pushrod still pushes at a good angle.",
    unlock: ["spring.rocker_rod", "spring.rocker_damper"],
    axes: [1, 2],
    goals: ["ride_freq", "damper_bottomout", "damper_topout", "trans_min"],
    bonus: { key: "mr_progression", text: "Motion ratio rising 0–10 % over the travel" },
    concept: [
      "Click Show me below: the rocker turns as the wheel moves, and the damper is squeezed by the damper-end pin. The motion ratio is damper travel per wheel travel.",
      "The wheel feels the spring as spring rate × motion ratio², so a 10 % smaller motion ratio makes the wheel rate about 20 % softer and the ride frequency about 10 % lower. A damper pin closer to the rocker's pivot (shorter lever) gives a smaller motion ratio; a pushrod pin closer to the pivot gives a larger one.",
      "The same ratio sets how much of the damper's stroke the wheel travel uses, so a smaller ratio also gives more spare stroke. How the ratio changes over the travel (progression) comes from the angles between the rocker arms and the pushrod and damper.",
    ],
    show: "motion_ratio",
    step: 2,
    levers: [
      { name: "Damper pin up", mv: [["spring.rocker_damper", 2, 1]] },
      { name: "Damper pin outboard", mv: [["spring.rocker_damper", 1, 1]] },
      { name: "Pushrod pin up", mv: [["spring.rocker_rod", 2, 1]] },
      { name: "Pushrod pin outboard", mv: [["spring.rocker_rod", 1, 1]] },
    ],
  },
];
// a challenge's starting design: a case study, then the challenge's moves and target changes
function chalStart(def) {
  const c = presetCfg(def.start);
  if (!c) return null;
  for (const [p, ax, d] of def.mods || []) {
    const pt = getPath(c, p);
    pt[ax] = +(pt[ax] + d).toFixed(2);
  }
  if (def.targets) c.targets = { ...(c.targets || {}), ...def.targets };
  return c;
}
// the move's name the other way round
const SWAP = { " up": " down", " inboard": " outboard", " outboard": " inboard", " forward": " rearward", " rearward": " forward" };
const leverNeg = lv =>
  lv.neg || lv.name.replace(/ (up|inboard|outboard|forward|rearward)/, m => SWAP[m]).replace("front down, rear up", "front up, rear down");
let chal = null; // { def, start, prev, hint, done }
const chalStore = () => {
  try {
    return JSON.parse(store.get("susp.chal") || "{}");
  } catch (e) {
    return {};
  }
};
const starsHtml = n =>
  `<span class="stars" aria-label="${n} of 3 stars">${[0, 1, 2].map(i => `<span class="${attr(i < n ? "on" : "")}">★</span>`).join("")}</span>`;
function chalPar(def) {
  if (def.par) return def.par;
  const a = presetCfg(def.start),
    b = presetCfg(def.ref);
  if (!a || !b) return null;
  return def.unlock.reduce((s, p) => s + V.norm(V.sub(getPath(b, p), getPath(a, p))), 0);
}
function chalMoved() {
  return chal.def.unlock.reduce((s, p) => s + V.norm(V.sub(getPath(cfg, p), getPath(chal.start, p))), 0);
}

function openChallenges() {
  // the chooser, shown in the rail
  $("#cardsIn").hidden = true;
  $("#carIn").hidden = true;
  $("#crail").hidden = false;
  const best = chalStore();
  $("#crail").innerHTML =
    `<div class="card crail-card"><div class="crhead"><h2>Challenges</h2><button class="btn small" type="button" id="chClose">Close</button></div>
    <p class="note">Short exercises on real geometry. Only the points named in each challenge can move, the goals update live, and hints unlock one at a time. Your current design is put back when you leave.</p>
    <p class="note"><b>Challenge mode turns the helpers off:</b> no "What moves this?", no influence panel (clicking a joint) and no design check. The hints are the only help: hint 1 explains the idea, hint 2 shows what each move does, and hint 3 suggests a step but limits you to 2 stars.</p>
    ${CHALLENGES.map(d => `<button class="chpick" type="button" data-ch="${attr(d.id)}"><span class="chn">${d.n}</span><span><b>${esc(d.title)}</b><small>${esc(d.stage)}</small></span>${starsHtml(best[d.id] || 0)}</button>`).join("")}
    <p class="note">Stars: ★ goals met · ★ bonus · ★ moved no more than par (the total millimeters of a good solution), without hint 3.</p></div>`;
  $("#chClose").onclick = closeRail;
  $$("#crail [data-ch]").forEach(b => b.addEventListener("click", () => startChallenge(b.dataset.ch)));
  $("#crail").scrollIntoView({ block: "nearest" });
}
function closeRail() {
  if (chal) return exitChallenge();
  $("#crail").hidden = true;
  applyViewClasses();
}
function startChallenge(id) {
  const def = CHALLENGES.find(d => d.id === id),
    start = chalStart(def);
  if (!start) return;
  const prev = chal ? chal.prev : JSON.parse(JSON.stringify(cfg));
  const prevView = chal ? chal.prevView : axleView;
  chal = { def, start: JSON.parse(JSON.stringify(start)), prev, prevView, hint: 0, done: false, par: chalPar(def), rc0: null };
  axleView = "front";
  applyViewClasses();
  document.body.classList.add("chal", "focus");
  closeInfluence();
  showMe(null);
  fixRows.clear();
  openRows.clear();
  view.target = null;
  loadCfg(start);
  $("#preset").value = "custom";
  resetHistory();
  base = ev;
  baseName = "challenge start";
  chal.rc0 = ev && ev.metrics ? ev.metrics.roll_center : null;
  tab = def.tab;
  buildRail();
  renderAll(0);
}
function exitChallenge(keep = false) {
  if (!chal) return;
  const prev = chal.prev,
    pv = chal.prevView;
  chal = null;
  document.body.classList.remove("chal", "focus");
  $("#focusBox").hidden = true;
  axleView = pv || "car";
  store.set("susp.view", axleView);
  $("#crail").hidden = true;
  $("#cardsIn").hidden = false;
  closeInfluence();
  showMe(null);
  base = null;
  if (!keep) {
    view.target = null;
    loadCfg(prev, "your edits", { toView: axleView });
    $("#preset").value = "custom";
  } else {
    if (car) {
      car.front = cfg;
    }
    loadCfg(cfg, "challenge result", { toView: "front" });
  }
  applyViewClasses();
  resetHistory();
}
function buildRail() {
  const d = chal.def,
    lab = p => pointName(p);
  $("#crail").innerHTML = `<div class="card crail-card">
    <div class="crhead"><span class="chip neutral">Challenge ${d.n} of ${CHALLENGES.length}</span><button class="btn small" type="button" id="chExit">Exit</button></div>
    <h2 class="chtitle">${esc(d.title)}</h2><p class="note">${esc(d.stage)}</p>
    <details class="chbrief" open><summary>The brief</summary><p>${esc(d.brief)}</p></details>
    <div class="sub-h">Goals</div><div id="chGoals" class="meters"></div><div id="chDone"></div>
    <div class="sub-h">Points you can move <span class="muted">(X is fixed)</span></div>
    <table class="pt chpts"><thead><tr><th>Point</th><th class="x">X</th><th class="y">Y</th><th class="z">Z</th></tr></thead><tbody>
    ${d.unlock
      .map(
        p =>
          `<tr><td class="lab"><button class="lnk" type="button" data-chhp="${attr(p)}">${esc(lab(p))}</button></td>${[0, 1, 2]
            .map(i =>
              d.axes.includes(i)
                ? `<td class="c"><input class="num" type="number" step="0.5" inputmode="decimal" data-chpath="${p}.${i}" aria-label="${esc(lab(p))} ${"XYZ"[i]}"></td>`
                : `<td class="c"><span class="num ro">${fmt(getPath(cfg, p)[i], 1)}</span></td>`
            )
            .join("")}</tr>`
      )
      .join("")}</tbody></table>
    <div class="chmove" id="chMove"></div>
    <div class="tact"><button class="btn small" type="button" id="chReset">Start over</button><button class="btn small" type="button" id="chShow">Show me ${esc(OVERLAYS[d.overlay].name.toLowerCase())}</button></div>
    <div class="sub-h">Hints</div><div id="chHints"></div></div>`;
  $$("#crail [data-chpath]").forEach(inp =>
    inp.addEventListener("input", () => {
      const v = +inp.value;
      if (inp.value === "" || !Number.isFinite(v)) return;
      setPath(cfg, inp.dataset.chpath, v);
      $("#preset").value = "custom";
      schedule();
    })
  );
  $$("#crail [data-chhp]").forEach(b => b.addEventListener("click", () => openInfluence(b.dataset.chhp)));
  $("#chExit").onclick = () => exitChallenge();
  $("#chReset").onclick = () => {
    chal.done = false;
    chal.hint = 0; // a clean start, so the third star is back on offer
    view.target = null;
    loadCfg(JSON.parse(JSON.stringify(chal.start)));
    base = ev;
    baseName = "challenge start";
    renderAll(0);
  };
  $("#chShow").onclick = () => showMe(d.overlay);
  updateRail();
}
function meter(key, c, lab, unit, dec) {
  const lo = c.lo,
    hi = c.hi,
    v = c.value,
    ok = c.status === "PASS";
  const a = lo ?? hi - Math.abs(hi) - 1,
    b = hi ?? lo + Math.abs(lo) + 1,
    w = b - a || 1;
  const d0 = Math.min(a - w * 0.6, v - w * 0.15),
    d1 = Math.max(b + w * 0.6, v + w * 0.15),
    X = x => (((x - d0) / (d1 - d0)) * 100).toFixed(2);
  const vs = Math.max(0, Math.min(100, +X(v)));
  const rng = `${lo == null ? "≤ " : fmt(lo, dec)}${lo != null && hi != null ? " to " : ""}${hi == null ? " or more" : fmt(hi, dec)}`;
  const can = !!meterChart(key, true),
    open = can && chal && chal.open && chal.open.has(key);
  return `<div class="meter ${ok ? "ok" : "bad"}"><div class="mtop"><span>${can ? `<button class="lnk mexp" type="button" data-mexp="${attr(key)}" aria-expanded="${attr(open)}">${open ? "▾" : "▸"} ${esc(lab)}</button>` : esc(lab)} <small class="muted">target ${rng}</small></span><b>${fmt(v, dec)} <small>${esc(unit)}</small> ${ok ? "✓" : "✗"}</b></div>
    <div class="mbar" title="green band = target ${rng} ${esc(unit)}"><span class="mband" style="left:${lo == null ? 0 : X(lo)}%;right:${hi == null ? 0 : 100 - X(hi)}%"></span><span class="mdot" style="left:${vs}%"></span></div>${open ? `<div class="mchart">${meterChart(key)}</div>` : ""}</div>`;
}
// the curve behind each goal, with the target band, so an abstract number becomes "flatten this line"
function meterChart(key, probe = false) {
  const R = ev.rows,
    B = base && base.rows,
    Ro = ev.roll,
    Bo = base && base.roll,
    tg = S.defaultTargets(ev.cfg)[key] || [null, null];
  const ser = (rows, x, y, cur) => ({
    x: rows.map(x),
    y: rows.map(y),
    color: cur ? "var(--s1)" : "var(--base)",
    dash: cur ? null : "4 3",
    w: cur ? 2 : 1.4,
    name: cur ? "now" : "start",
  });
  const two = (rs, bs, x, y) => [...(bs ? [ser(bs, x, y, false)] : []), ser(rs, x, y, true)];
  const toe = rs => {
    const r0 = rs.reduce((a, r) => (Math.abs(r.dz) < Math.abs(a.dz) ? r : a));
    return r => r.toe - r0.toe;
  };
  const spec = {
    roll_center: () => ({
      title: "Roll center height vs wheel travel, mm",
      xlabel: "wheel travel, mm",
      band: tg,
      series: two(
        R,
        B,
        r => r.dz,
        r => r.roll_center
      ),
    }),
    rc_lat: () =>
      Ro && {
        title: "Roll center sideways position vs roll, mm",
        cap: "a flat line = the roll center stays put",
        xlabel: "body roll, deg",
        series: two(
          Ro,
          Bo,
          r => r.roll,
          r => r.rc_lateral
        ),
      },
    camber_gain: () => ({
      title: "Camber vs wheel travel, deg",
      cap: "slope = camber gain",
      xlabel: "wheel travel, mm",
      series: two(
        R,
        B,
        r => r.dz,
        r => r.camber
      ),
    }),
    antidive: () => ({
      title: "Anti-dive vs wheel travel, %",
      xlabel: "wheel travel, mm",
      band: tg,
      series: two(
        R,
        B,
        r => r.dz,
        r => r.antidive
      ),
    }),
    bump_steer: () => ({
      title: "Toe change vs wheel travel, deg",
      cap: "slope = bump steer; flatten the line",
      xlabel: "wheel travel, mm",
      series: [...(B ? [{ ...ser(B, r => r.dz, toe(B), false) }] : []), ser(R, r => r.dz, toe(R), true)],
    }),
    bump_steer_max: () => ({
      title: "Toe change vs wheel travel, deg",
      cap: "the whole line must stay inside the green band",
      xlabel: "wheel travel, mm",
      band: tg[1] != null ? [-tg[1], tg[1]] : null,
      series: [...(B ? [{ ...ser(B, r => r.dz, toe(B), false) }] : []), ser(R, r => r.dz, toe(R), true)],
    }),
    ...Object.fromEntries(
      [
        ["kpi", "KPI vs wheel travel, deg"],
        ["scrub", "Scrub radius vs wheel travel, mm"],
        ["caster", "Caster vs wheel travel, deg"],
        ["trail", "Mechanical trail vs wheel travel, mm"],
      ].map(([k, title]) => [
        k,
        () => ({
          title,
          cap: "the value at 0 mm (ride height) is the one checked",
          xlabel: "wheel travel, mm",
          band: tg,
          series: two(
            R,
            B,
            r => r.dz,
            r => r[k]
          ),
        }),
      ])
    ),
    mr_progression: () => ({
      title: "Motion ratio vs wheel travel",
      cap: "damper travel per wheel travel; its rise over the travel is the progression",
      xlabel: "wheel travel, mm",
      series: two(
        R,
        B,
        r => r.dz,
        r => r.motion_ratio
      ),
    }),
    ride_freq: () => ({
      title: "Wheel rate vs wheel travel, N/mm",
      cap: "spring rate × motion ratio²: the ride frequency follows its square root",
      xlabel: "wheel travel, mm",
      series: two(
        R,
        B,
        r => r.dz,
        r => r.wheel_rate
      ),
    }),
    damper_bottomout: () => {
      const sp = ev.cfg.spring || {},
        L = sp.damper_eye_to_eye,
        st = sp.damper_stroke;
      return {
        title: "Damper length vs wheel travel, mm",
        cap: "stay inside the damper's stroke, 2 mm clear of each end",
        xlabel: "wheel travel, mm",
        band: L && st ? [L - st + 2, L - 2] : null,
        series: two(
          R,
          B,
          r => r.dz,
          r => r.damper_len
        ),
      };
    },
    ackermann: () =>
      ev.steer && {
        title: "Ackermann vs outer wheel angle, %",
        xlabel: "outer wheel angle, deg",
        band: tg,
        series: two(
          ev.steer.filter(r => Number.isFinite(r.ackermann)),
          base && base.steer ? base.steer.filter(r => Number.isFinite(r.ackermann)) : null,
          r => r.outer,
          r => r.ackermann
        ),
      },
  }[key];
  if (probe) return !!spec;
  const s = spec && spec();
  return s ? chart({ ...s, h: 150 }) : "";
}
// focus layout: in a challenge, the results area shows only the goal curves; "Show full results" brings back the tabs
function renderFocus() {
  const fb = $("#focusBox"),
    focus = document.body.classList.contains("focus");
  fb.hidden = false;
  if (!focus) {
    fb.innerHTML = `<div class="focushd"><span class="note">Showing all results.</span><button class="btn small" type="button" id="fbLearn">Glossary</button><button class="btn small" type="button" id="fbToggle">Back to focus view</button></div>`;
  } else
    fb.innerHTML = `<div class="focushd"><h3>Your goals as curves</h3><button class="btn small" type="button" id="fbLearn">Glossary</button><button class="btn small" type="button" id="fbToggle">Show full results</button></div>
    <div class="charts">${chal.def.goals
      .concat(chal.def.bonus.key ? [chal.def.bonus.key] : [])
      .filter((k, i, a) => meterChart(k, true) && !(k === "bump_steer" && a.includes("bump_steer_max")) && k !== "damper_topout")
      .map(k => meterChart(k))
      .join("")}</div>
    <p class="note">Dashed = where you started. Drag the Travel slider to see the corner move along these curves.</p>`;
  $("#fbLearn").onclick = openLearn;
  $("#fbToggle").onclick = () => {
    document.body.classList.toggle("focus");
    renderFocus();
  };
}
function updateRail() {
  if (!chal || err || !ev || !$("#chGoals")) return;
  const d = chal.def,
    row = k => ev.checks.find(r => r.key === k);
  $$("#crail [data-chpath]").forEach(inp => {
    if (document.activeElement !== inp) inp.value = getPath(cfg, inp.dataset.chpath);
  });
  const goalsOk = d.goals.every(k => (row(k) || {}).status === "PASS"),
    goalsOkPre = goalsOk;
  let bonusOk = false,
    bonusHtml = "";
  if (d.bonus.key) {
    const c = row(d.bonus.key);
    bonusOk = c && c.status === "PASS";
    if (c) {
      const [lab, unit, dec] = metricLabel(d.bonus.key);
      bonusHtml = meter(d.bonus.key, c, "Bonus · " + lab, unit, dec);
    }
  } else {
    bonusOk = d.bonus.fn(cfg, chal.start, ev);
    bonusHtml = `<div class="meter ${bonusOk ? "ok" : "neutral"}"><div class="mtop"><span>Bonus · ${esc(d.bonus.text)}</span><b>${bonusOk ? (goalsOkPre ? "✓" : "✓ so far") : "✗"}</b></div></div>`;
  }
  $("#chGoals").innerHTML =
    d.goals
      .map(k => {
        const c = row(k);
        if (!c) return "";
        const [lab, unit, dec] = metricLabel(k);
        return meter(k, c, lab, unit, dec);
      })
      .join("") + bonusHtml;
  const moved = chalMoved(),
    par = chal.par;
  $("#chMove").innerHTML = `Moved <b>${fmt(moved, 1)} mm</b> in total${par ? ` · par ${fmt(par, 0)} mm` : ""}`;
  renderFocus();
  $$("#chGoals [data-mexp]").forEach(b =>
    b.addEventListener("click", () => {
      chal.open = chal.open || new Set();
      const k = b.dataset.mexp;
      chal.open.has(k) ? chal.open.delete(k) : chal.open.add(k);
      updateRail();
    })
  );
  renderHints();
  // the suggested step (hint 3) does part of the thinking for you, so it costs the third star
  const stars = goalsOk ? Math.min(chal.hint >= 3 ? 2 : 3, 1 + (bonusOk ? 1 : 0) + (par && moved <= par + 0.5 ? 1 : 0)) : 0;
  if (goalsOk) {
    const best = chalStore();
    if ((best[d.id] || 0) < stars) {
      best[d.id] = stars;
      store.set("susp.chal", JSON.stringify(best));
    }
    const next = CHALLENGES.find(q => q.n === d.n + 1);
    $("#chDone").innerHTML = `<div class="chwin"><div class="chwinh">Solved ${starsHtml(stars)}</div>
      <p>${bonusOk ? "Bonus met." : `Bonus not yet: ${esc(d.bonus.key ? metricLabel(d.bonus.key)[0] : d.bonus.text)}.`} ${par ? (moved <= par + 0.5 ? `You moved ${fmt(moved, 0)} mm, within par.` : `You moved ${fmt(moved, 0)} mm; par is ${fmt(par, 0)} mm. Can you get there with smaller moves?`) : ""}${chal.hint >= 3 ? " Hint 3 was used, so the best here is 2 stars: Start over without it for the third." : ""}</p>
      <div class="tact"><button class="btn small" type="button" id="chCmp">Compare start vs. yours</button>${next ? `<button class="btn small primary" type="button" id="chNext">Next challenge</button>` : ""}<button class="btn small" type="button" id="chKeep">Finish and keep this design</button></div></div>`;
    $("#chCmp").onclick = () => {
      cmpAdd(`${d.title}: start`, chal.start);
      cmpAdd(`${d.title}: yours`, cfg);
      tab = "compare";
      renderAll(0);
    };
    if (next) $("#chNext").onclick = () => startChallenge(next.id);
    $("#chKeep").onclick = () => exitChallenge(true);
  } else $("#chDone").innerHTML = "";
}
const influenceAllowed = () => !chal; // in a challenge the hints are the only help

// Hints are computed by the solver from the student's current geometry, so they cannot point the wrong way.
// 1 = the concept (text checked against the solver) + Show me; 2 = live lever table; 3 = a suggested next step.
function leverCfg(c, lv, k) {
  const nc = JSON.parse(JSON.stringify(c));
  for (const [p, ax, s] of lv.mv) {
    const pt = getPath(nc, p);
    pt[ax] = +(pt[ax] + s * k).toFixed(2);
  }
  return nc;
}
function chalViol(e, keys) {
  let t = 0;
  for (const k of keys) {
    const c = e.checks.find(r => r.key === k);
    if (!c || c.value == null) continue;
    const w = c.lo != null && c.hi != null ? c.hi - c.lo : Math.abs(c.lo ?? c.hi) || 1;
    t += c.lo != null && c.value < c.lo ? (c.lo - c.value) / w : c.hi != null && c.value > c.hi ? (c.value - c.hi) / w : 0;
  }
  return t;
}
const chalQuick = c => S.evaluate(c, { full: false, steer: cfg.axle === "front" && chal.def.goals.includes("ackermann"), pack: false });
const chalFull = c => S.evaluate(c, { steer: cfg.axle === "front" && chal.def.goals.includes("ackermann"), pack: false });
function leverTable() {
  // Option A: every move is shown in the direction that helps, ranked by how few millimeters it needs to bring the
  // goal that is furthest from its target into range, with the other goals' resulting values as side effects.
  const d = chal.def,
    keys = d.goals.concat(d.bonus.key ? [d.bonus.key] : []),
    st = d.step;
  let e0;
  try {
    e0 = chalFull(cfg);
  } catch (x) {
    return `<p class="note">The current geometry does not solve.</p>`;
  }
  const chk = (e, k) => e.checks.find(r => r.key === k);
  const goalsLeft = d.goals.filter(k => chalViol(e0, [k]) > 0);
  const focus = goalsLeft.length
    ? goalsLeft.reduce((a, k) => (chalViol(e0, [k]) > chalViol(e0, [a]) ? k : a))
    : d.bonus.key && chalViol(e0, [d.bonus.key]) > 0
      ? d.bonus.key
      : null;
  if (!focus) return `<p class="note">Every goal is met. Nothing left to fix.</p>`;
  const fc = chk(e0, focus),
    [fLab, fUnit, fDec] = metricLabel(focus);
  const w = fc.lo != null && fc.hi != null ? fc.hi - fc.lo : Math.abs(fc.lo ?? fc.hi) || 1;
  const aim = fc.lo != null && fc.value < fc.lo ? fc.lo + 0.1 * w : fc.hi - 0.1 * w;
  const rows = [];
  for (const lv of d.levers) {
    let ep, em;
    try {
      ep = chalFull(leverCfg(cfg, lv, st));
      em = chalFull(leverCfg(cfg, lv, -st));
    } catch (x) {
      continue;
    }
    const slope = (chk(ep, focus).value - chk(em, focus).value) / (2 * st); // focus metric per mm
    const tot = e => chalViol(e, d.goals) + (lv.bonusOnly ? chalViol(e, [d.bonus.key]) : 0);
    let sgn = Math.abs(slope) > 1e-12 ? Math.sign((aim - fc.value) * slope) : tot(ep) <= tot(em) ? 1 : -1;
    const e1 = sgn > 0 ? ep : em;
    // walk along this move (helpful direction) with the solver until the goal is in range, or record the best it gets
    let need = Infinity,
      best = { v: chalViol(e0, [focus]), mm: 0, val: fc.value },
      prevMm = 0,
      prevV = best.v;
    for (const k of [1, 2, 3, 4, 6, 8, 10, 13, 16, 20]) {
      const mm = k * st;
      let ek;
      try {
        ek = chalQuick(leverCfg(cfg, lv, sgn * mm));
      } catch (x) {
        break;
      }
      const vk = chalViol(ek, [focus]);
      if (vk < best.v - 1e-12) best = { v: vk, mm, val: chk(ek, focus).value };
      if (vk <= 0) {
        need = prevV > 0 ? prevMm + ((mm - prevMm) * prevV) / (prevV - vk + 1e-12) : mm;
        break;
      }
      prevMm = mm;
      prevV = vk;
    }
    const nm = sgn > 0 ? lv.name : leverNeg(lv);
    rows.push({ nm, e1, need, best });
  }
  rows.sort((a, b) => a.need - b.need || a.best.v - b.best.v);
  const head = keys.map(k => `<th class="n${k === focus ? " lv-focus" : ""}">${esc(metricLabel(k)[0])}</th>`).join("");
  const now = keys
    .map(k => `<td class="n${k === focus ? " lv-focus" : ""}"><b>${fmt(chk(e0, k).value, metricLabel(k)[2])}</b></td>`)
    .join("");
  const body = rows
    .map(r => {
      const cells = keys
        .map(k => {
          const v0 = chalViol(e0, [k]),
            v1 = chalViol(r.e1, [k]),
            dv = v1 - v0;
          const cls = dv < -1e-9 ? "lv-good" : dv > 1e-9 ? "lv-bad" : "",
            s = Math.min(1, (Math.abs(dv) / Math.max(v0, 0.05)) * 2);
          return `<td class="n ${cls}${k === focus ? " lv-focus" : ""}" style="--s:${(0.25 + 0.75 * s).toFixed(2)}">${fmt(chk(r.e1, k).value, metricLabel(k)[2])}</td>`;
        })
        .join("");
      const needTxt = Number.isFinite(r.need)
        ? `<b>≈ ${fmt(r.need, r.need < 10 ? 1 : 0)} mm</b>`
        : r.best.mm
          ? `<span class="muted">not alone: best ${fmt(r.best.val, fDec)} at ${fmt(r.best.mm, 0)} mm</span>`
          : `<span class="muted">does not help</span>`;
      return `<tr><td>${esc(r.nm)} ${st} mm</td><td class="n">${needTxt}</td>${cells}</tr>`;
    })
    .join("");
  const alone = rows.some(r => Number.isFinite(r.need));
  return `<p class="lvlead">Furthest from target: <b>${esc(fLab)}</b> (${fmt(fc.value, fDec)} ${esc(fUnit)}). Moves are shown in the direction that helps it, best first.</p>
    ${alone ? "" : `<p class="lvlead"><b>No single move fixes it on its own.</b> Take the top move, then look at this table again: the next move usually finishes the job. Combining two moves is normal.</p>`}
    <div class="tbl-wrap"><table class="data lvt"><thead><tr><th>Move</th><th class="n">Fixes ${esc(fLab.toLowerCase())} after</th>${head}</tr></thead>
    <tbody><tr class="lv-now"><td>Now</td><td></td>${now}</tr>${body}</tbody></table></div>
    <p class="note">Values are re-solved from your current geometry after one ${st} mm step. <span class="lv-good lvk" style="--s:1">green</span> = that goal gets closer to its target, <span class="lv-bad lvk" style="--s:1">red</span> = further away; stronger color = bigger change. "Fixes … after" walks along each move with the solver: a number means that move alone gets the goal into range; "not alone" means it helps but stalls, so combine it with another move. A big number is not wrong; it just takes a large change.</p>`;
}
const stepCache = new Map();
// what a suggestion depends on: the points a challenge can move (hardpoints and the rocker's) and which challenge
const chalSig = () => JSON.stringify([cfg.hardpoints, cfg.spring]) + chal.def.id;
async function nextStep(box) {
  busyN++;
  try {
    const d = chal.def,
      sig = chalSig();
    if (stepCache.has(sig)) {
      box.innerHTML = stepCache.get(sig);
      wireStep(box);
      return;
    }
    const keys = d.goals,
      bonusKeys = d.bonus.key ? [d.bonus.key] : [],
      ks = [-4, -3, -2, -1, 1, 2, 3, 4],
      L = d.levers.filter(l => !l.bonusOnly);
    const score = (e, c) => chalViol(e, keys) + 0.25 * chalViol(e, bonusKeys) + (d.bonus.fn && !d.bonus.fn(c, chal.start, e) ? 1 : 0);
    let best = null,
      n = 0;
    const c0 = JSON.parse(JSON.stringify(cfg));
    try {
      const e0 = chalQuick(c0);
      best = { s: score(e0, c0), moves: [], e: e0 };
    } catch (x) {
      box.innerHTML = `<p class="note">The current geometry does not solve.</p>`;
      return;
    }
    const tries = [];
    L.forEach((a, i) => {
      ks.forEach(k => tries.push([[a, k]]));
      L.slice(i + 1).forEach(b =>
        ks.forEach(k =>
          ks.forEach(j =>
            tries.push([
              [a, k],
              [b, j],
            ])
          )
        )
      );
    });
    for (const t of tries) {
      if (++n % 40 === 0) {
        box.innerHTML = `<p class="note">Searching small combinations… ${Math.round((n / tries.length) * 100)} %</p>`;
        await new Promise(r => setTimeout(r, 0));
        if (!chal || chal.def !== d) return;
      }
      let c = c0;
      for (const [lv, k] of t) c = leverCfg(c, lv, k * d.step);
      let e;
      try {
        e = chalQuick(c);
      } catch (x) {
        continue;
      }
      const s = score(e, c) + 0.0004 * t.reduce((a, [, k]) => a + Math.abs(k), 0);
      if (s < best.s - 1e-9) best = { s, moves: t, e, c };
    }
    if (best.c) {
      try {
        best.e = chalFull(best.c);
      } catch (x) {
        /* keep the quick result */
      }
    }
    let html;
    if (!best.moves.length)
      html = `<p class="chint"><b>Hint 3.</b> No combination of two of these moves improves things from here. Try <b>Start over</b>, and change pairs of pivots together.</p>`;
    else {
      const txt = best.moves.map(([lv, k]) => `<b>${esc(k > 0 ? lv.name : leverNeg(lv))} ${Math.abs(k) * d.step} mm</b>`).join(" and ");
      const res = keys
        .map(k => {
          const c = best.e.checks.find(r => r.key === k),
            [lab, unit, dec] = metricLabel(k);
          return `${esc(lab)} ${fmt(c.value, dec)} ${esc(unit)} ${c.status === "PASS" ? "✓" : "✗"}`;
        })
        .join(" · ");
      html = `<div class="chint"><b>Hint 3.</b> From where you are now, try ${txt}. That gives: ${res}.
        ${chalViol(best.e, keys) > 0 ? " Not solved yet: take the step, then look at the lever table again." : ""}
        <div class="tact" style="margin-top:6px"><button class="btn small" type="button" id="chStepPv">Preview it</button></div></div>`;
      stepCfg.set(sig, best.c);
    }
    lruSet(stepCache, sig, html);
    box.innerHTML = html;
    wireStep(box);
  } finally {
    busyN--;
  }
}
function wireStep(box) {
  const b = $("#chStepPv", box),
    c = stepCfg.get(chalSig());
  if (b && c) b.onclick = () => startPreview(c, "suggested next step");
  else if (b) b.hidden = true;
}
const stepCfg = new Map();
function renderHints() {
  const d = chal.def,
    H = $("#chHints");
  if (!H) return;
  let html = "";
  if (chal.hint >= 1)
    html += `<div class="chint"><b>Hint 1.</b> ${d.concept.map(p => `<p>${esc(p)}</p>`).join("")}<button class="btn small" type="button" id="chHintShow">Show me ${esc(OVERLAYS[d.show].name.toLowerCase())}</button></div>`;
  if (chal.hint >= 2) html += `<div class="chint"><b>Hint 2. What each move does right now.</b>${leverTable()}</div>`;
  if (chal.hint >= 3) {
    const sig = chalSig();
    html += `<div id="chStep">${stepCache.get(sig) || `<button class="btn small primary" type="button" id="chStepGo">Hint 3: suggest a next step from here</button><p class="note">The solver tries every move in the table above, and every pair of them, at 1 to 4 steps either way (416 combinations). It scores how far each goal is from its target and shows the best one. It is a plain search, not AI: the same geometry always gets the same suggestion.</p>`}</div>`;
  }
  const labels = ["Show hint 1", "Show hint 2: what each move does", "Show hint 3: a suggested next step (best score 2 stars)"];
  if (chal.hint < 3) html += `<button class="btn small" type="button" id="chHint">${labels[chal.hint]}</button>`;
  if (chal.hint === 3 && !stepCache.has(chalSig())) {
    /* step search runs on request */
  }
  H.innerHTML = html;
  const hb = $("#chHint");
  if (hb)
    hb.onclick = () => {
      chal.hint++;
      renderHints();
      if (chal.hint === 3) {
        const st2 = $("#chStep");
        if (st2) nextStep(st2);
      }
    };
  const sb = $("#chHintShow");
  if (sb) sb.onclick = () => showMe(d.show);
  const st = $("#chStep");
  if (st) {
    wireStep(st);
    const g = $("#chStepGo");
    if (g) g.onclick = () => nextStep(st);
  }
}
