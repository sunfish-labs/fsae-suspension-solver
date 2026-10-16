// 26_influence.js - Influence drawer (click a hardpoint), and preview / apply of a move.
// ------------------------------------------------------------------ preview, apply, undo
function startPreview(nc, label) {
  try {
    preview = { cfg: nc, ev: S.evaluate(nc), label };
  } catch (e) {
    preview = null;
    $("#errBox").insertAdjacentHTML("afterbegin", `<div class="banner bad">That move cannot be solved: ${esc(e.message)}</div>`);
    return;
  }
  const fails0 = failSet(ev),
    fails1 = failSet(preview.ev),
    passN = preview.ev.checks.filter(r => r.status === "PASS").length,
    tot = preview.ev.checks.filter(r => r.status !== "n/a").length;
  const newly = [...fails1].filter(k => !fails0.has(k)),
    fixed = [...fails0].filter(k => !fails1.has(k));
  $("#pvbar").innerHTML =
    `<span><b>Preview:</b> ${esc(label)} · ${passN}/${tot} targets met${fixed.length ? ` · fixes ${fixed.map(k => esc(k === "link_clearance" ? "clearance" : metricLabel(k)[0])).join(", ")}` : ""}${newly.length ? ` · <span class="bad-t">breaks ${newly.map(k => esc(k === "link_clearance" ? "clearance" : metricLabel(k)[0])).join(", ")}</span>` : ""}</span>
    <span class="pvbtns"><button class="btn small primary" type="button" id="pvApply">Apply</button><button class="btn small" type="button" id="pvDiscard">Discard</button></span>`;
  $("#pvbar").hidden = false;
  $("#ovcap").hidden = true;
  $("#pvApply").onclick = () => applyCfg(preview.cfg, preview.label);
  $("#pvDiscard").onclick = () => endPreview();
  updateScene();
}
function endPreview() {
  preview = null;
  $("#pvbar").hidden = true;
  $("#ovcap").hidden = !view.overlay;
  updateScene();
}
function applyCfg(nc, label) {
  pushHistory();
  if (!err && ev && !chal) {
    base = ev;
    baseName = "before: " + label;
  }
  preview = null;
  $("#pvbar").hidden = true;
  cfg = JSON.parse(JSON.stringify(nc));
  $("#preset").value = "custom";
  fillForm();
  run();
  if (drawerPath) openInfluence(drawerPath);
}
// ------------------------------------------------------------------ influence drawer
let drawerPath = null;
function influenceMetrics() {
  const list = ["roll_center", "rc_lat", "camber_gain", "roll_camber", "bump_steer", "bump_steer_curve"];
  list.push(cfg.axle === "front" ? "antidive" : "antisquat");
  if (cfg.axle === "front") list.push("caster", "kpi", "scrub", "trail", "ackermann");
  list.push("track_change");
  if (cfg.spring) list.push("motion_ratio", "mr_progression", "trans_min");
  return list.filter(k => ev && ev.metrics[k] != null);
}
function openInfluence(path) {
  if (!ev || err || !path) return;
  if (typeof tipSeen === "function") tipSeen();
  if (!influenceAllowed(path)) {
    const hb = $("#chHints");
    if (hb) {
      hb.insertAdjacentHTML(
        "afterbegin",
        `<p class="chint lockmsg">The influence panel unlocks with the last hint. Try reasoning it out first!</p>`
      );
      hb.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  drawerPath = path;
  const dr = $("#drawer");
  dr.hidden = false;
  $("#vwrap").classList.add("open");
  const chalAx = chal ? (chal.def.unlock.includes(path) ? chal.def.axes : []) : [0, 1, 2];
  const pt = getPath(cfg, path),
    locked = (lockPack && PACKAGING.has(path) && !chal) || !chalAx.length,
    isSpring = path.startsWith("spring.");
  const dirs = [
    [2, "Up", "Raise"],
    [1, "Out", "Outboard"],
    [0, "Fwd", "Forward"],
  ];
  const front = cfg.axle === "front";
  let rows = "",
    qb,
    effects = [];
  try {
    qb = S.evaluate(cfg, { full: false, steer: front, pack: false });
    for (const [ax] of dirs) {
      const c = { pts: [path], axis: ax };
      try {
        effects.push(S.evaluate(movedCfg(cfg, c, 5), { full: false, steer: front, pack: false }));
      } catch (e) {
        effects.push(null);
      }
    }
  } catch (e) {
    dr.innerHTML = `<p class="note">${esc(e.message)}</p>`;
    return;
  }
  const fb = failSet(qb),
    keys = influenceMetrics();
  if (isSpring) keys.sort((a, b) => (SPRING_KEYS.has(b) ? 1 : 0) - (SPRING_KEYS.has(a) ? 1 : 0));
  const tg = S.defaultTargets(ev.cfg);
  for (const k of keys) {
    const [lab, , dec] = metricLabel(k),
      b0 = qb.metrics[k];
    const cells = effects
      .map(e => {
        if (!e) return `<td class="n muted">–</td>`;
        const d = e.metrics[k] - b0;
        if (!Number.isFinite(d)) return `<td class="n muted">–</td>`;
        const t = tg[k],
          span = t && t[0] != null && t[1] != null ? Math.abs(t[1] - t[0]) : Math.max(Math.abs(b0) * 0.5, 10 ** -dec * 20);
        const strength = Math.min(1, Math.abs(d) / (span * 0.25 || 1));
        const breaks = e.checks.some(r => r.key === k && r.status === "FAIL") && !fb.has(k);
        return `<td class="n${breaks ? " brk" : ""}" style="--s:${strength.toFixed(2)}" data-sign="${attr(d > 0 ? "+" : d < 0 ? "-" : "0")}">${Math.abs(d) < 10 ** -(dec + 1) ? "·" : (d > 0 ? "+" : "") + fmt(d, Math.max(dec, 1))}</td>`;
      })
      .join("");
    const tid = (TERM_BY_METRIC[k] || {}).id;
    rows += `<tr><td>${tid ? `<button class="lnk" type="button" data-term="${attr(tid)}">${esc(lab)}</button>` : esc(lab)}</td><td class="n muted">${fmt(ev.metrics[k], dec)}</td>${cells}</tr>`;
  }
  dr.innerHTML = `<div class="drhead"><div><h3>${esc(pointName(path))}</h3><p class="note mono">${esc(path.replace("hardpoints.", ""))} · ${pt.map(v => fmt(v, 1)).join(", ")}</p></div><button class="btn small" type="button" id="drClose" aria-label="Close">✕</button></div>
    ${locked ? (chal ? `<p class="lockmsg">This point is fixed in this challenge. The effects below are for learning.</p>` : `<p class="lockmsg">Locked: usually set by the ${isSpring ? "chassis" : "upright and wheel"} package. The effects below are for learning. <button class="lnk" type="button" id="drUnlock">Unlock</button></p>`) : ""}
    <p class="note">What moving this point <b>5 mm</b> does. Color strength = size of the change; red outline = a target that would start failing. Moving the other way does roughly the opposite.</p>
    <div class="tbl-wrap"><table class="data inf"><thead><tr><th>Metric</th><th class="n">Now</th>${dirs.map(([, lab]) => `<th class="n">${lab} 5</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    ${
      locked
        ? ""
        : `<div class="tact drpv"><span class="note">Preview a 5 mm move:</span>${dirs
            .filter(([ax]) => chalAx.includes(ax))
            .map(([ax, , long]) => `<button class="btn small" type="button" data-pv="${attr(ax)}">${long}</button>`)
            .join("")}</div>`
    }`;
  $("#drClose").onclick = closeInfluence;
  const ul = $("#drUnlock");
  if (ul) ul.onclick = () => setLock(false);
  $$("#drawer [data-pv]").forEach(b =>
    b.addEventListener("click", () => {
      const ax = +b.dataset.pv,
        c = { pts: [path], axis: ax, name: pointName(path) };
      startPreview(movedCfg(cfg, c, 5), describeMove(c, 5));
    })
  );
  $$("#drawer [data-term]").forEach(b =>
    b.addEventListener("click", () => {
      if (b.dataset.term) openTerm(b.dataset.term);
    })
  );
  view.hl = { path };
  updateScene();
}
function closeInfluence() {
  drawerPath = null;
  $("#drawer").hidden = true;
  $("#vwrap").classList.remove("open");
  view.hl = null;
  updateScene();
}
