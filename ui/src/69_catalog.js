// 69_catalog.js - Parts catalog (Car view → Parts catalog), saved in the car file as "catalog". Bought parts the team
// could use, with the maker's rating and the price, compared side by side on this design: what each costs for the car
// and the safety factor it gives (springs: the ride frequency on each axle). "Use" puts the part in the design (its
// rating, or the spring rate) and in the bill of materials (part number, unit cost, source); then every check re-runs.
// Entry: {role, part, pn, rating_lbf?, rate_lbin?, id_mm?, per?, unit_cost, source, note}
//   rating_lbf: the catalog radial static (ultimate) rating of one part, in lbf as US catalogs print it
//   rate_lbin: a spring's rate in lb/in; per: parts per joint (two bearings in a rocker: 2); unit_cost: one part
const CAT_LBF = 4.4482216,
  CAT_LBIN = 0.175127;
const CAT_ROLES = [
  { k: "spring", name: "Springs", bom: ["spring"] },
  { k: "rod_end", name: "Rod ends", key: "rod_end_rating", bom: ["rodend_wb", "rodend_tie", "rodend_push"] },
  { k: "ball_joint", name: "Ball joints", key: "ball_joint_rating", bom: ["balljoint"] },
  { k: "rocker_bearing", name: "Rocker pivot bearings", key: "rocker_bearing_rating", bom: ["rbearing"] },
  { k: "damper", name: "Dampers (rating: the eye bearings)", key: "damper_eye_rating", bom: ["damper"] },
];
const catRole = k => CAT_ROLES.find(r => r.k === k);
let catOpen = false,
  catEditOpen = false;
const catLoadsCache = new Map();
// a corner's evaluation and its load cases, as the design check solves them (cached: the cases take a moment)
function catCorner(ax) {
  const r = carRes || evalCar(),
    e = r && r[ax === "front" ? "F" : "R"].ev;
  if (!e) return { e: null, L: null };
  const key = JSON.stringify([car[ax], car.vehicle, car.arb, car[ax === "front" ? "rear" : "front"].spring]);
  if (!catLoadsCache.has(key)) {
    let L = null;
    try {
      L = e.spring ? S.runLoads(e.cfg, e.susp, e.spring, carLltdFor(e)) : null;
    } catch (x) {
      L = null;
    }
    if (catLoadsCache.size > 6) catLoadsCache.clear();
    catLoadsCache.set(key, L);
  }
  return { e, L: catLoadsCache.get(key) };
}
// the worst force on one part of this kind over every load case: {peak N, where}
function catPeak(L, role) {
  if (!L) return null;
  let b = null;
  if (role === "rod_end") {
    for (const p of L.parts || []) if (!b || p.peak > b.peak) b = { peak: p.peak, where: `${p.member}, ${p.p_case}` };
    return b;
  }
  const parts = role === "ball_joint" ? ["upper_ball_joint", "lower_ball_joint"] : [role === "damper" ? "damper_eye" : "rocker_bearing"];
  for (const x of L.bearings || [])
    if (parts.includes(x.part) && (!b || x.peak > b.peak)) b = { peak: x.peak, where: `${x.label}, ${x.case}` };
  return b;
}
// the corner's ride frequency with a spring of k N/mm (linear spring, the motion ratio at ride height, the tire in series)
function catFreq(e, k) {
  const MR = e.ride.motion_ratio,
    kt = +e.cfg.spring.tire_rate,
    ms = e.ride._m_sprung,
    kw = k * MR * MR,
    kr = (kw * kt) / (kw + kt);
  return Math.sqrt((kr * 1000) / ms) / (2 * Math.PI);
}
const catRatingN = c => (+c.rating_lbf > 0 ? +c.rating_lbf * CAT_LBF * (+c.per || 1) : null);
const catLbf = n => Math.round(n / CAT_LBF);
const catMoney = v => (v > 0 ? money(v) : '<span class="note">no price</span>');
// how many of this part the car takes (from the design's BOM rows), and what they cost
function catQty(role) {
  const want = bomDesign();
  return catRole(role).bom.reduce((a, k) => a + (want.get(k) ? want.get(k).qty : 0), 0);
}
// ---- putting a part in the design and the BOM
function catBomRows(keys) {
  const want = bomDesign(),
    sub = new Map(keys.filter(k => want.has(k)).map(k => [k, want.get(k)]));
  car.bom = bomFill(car.bom || [], sub);
  return car.bom.filter(r => r.auto && keys.includes(r.key));
}
function catUse(c, ax) {
  const R = catRole(c.role);
  if (c.role === "spring") {
    car[ax].spring.spring_rate = Math.round(+c.rate_lbin * CAT_LBIN * 100) / 100;
    const want = bomDesign().get("spring");
    for (const r of catBomRows(R.bom)) {
      r.picks = r.picks || {};
      const other = ax === "front" ? "rear" : "front";
      if (!r.picks[other] && (r.pn || +r.unit_cost)) r.picks[other] = { pn: r.pn, unit_cost: +r.unit_cost || 0, source: r.source || "" };
      r.picks[ax] = { pn: `${c.pn || c.part} ${fmt(+c.rate_lbin, 0)} lb/in`, unit_cost: +c.unit_cost || 0, source: c.source || "" };
      const by = (want && want.by) || {},
        axs = ["front", "rear"].filter(a => r.picks[a]),
        n = axs.reduce((s, a) => s + (by[a] || 0), 0);
      r.pn = axs.map(a => `${a}: ${r.picks[a].pn}`).join("; ");
      r.unit_cost = n ? Math.round((axs.reduce((s, a) => s + (by[a] || 0) * r.picks[a].unit_cost, 0) / n) * 100) / 100 : +c.unit_cost || 0;
      r.source = [...new Set(axs.map(a => r.picks[a].source).filter(Boolean))].join(" ");
    }
    return;
  }
  const N = catRatingN(c);
  if (N && R.key) for (const a of ["front", "rear"]) car[a].members[R.key] = Math.round(N);
  for (const r of catBomRows(R.bom)) {
    r.pn = c.pn || c.part;
    r.unit_cost = Math.round((+c.unit_cost || 0) * (+c.per || 1) * 100) / 100;
    r.source = c.source || "";
    delete r.picks;
  }
}
// the parts the design uses now, as catalog entries (so the options are compared with what is chosen)
function catFromDesign() {
  const out = [],
    rowOf = k => (car.bom || []).find(r => r.auto && r.key === k),
    mem = car.front.members || {};
  for (const R of CAT_ROLES) {
    const r = rowOf(R.bom[0]);
    if (R.k === "spring") {
      for (const ax of ["front", "rear"]) {
        const k = car[ax].spring && car[ax].spring.spring_rate;
        if (!k) continue;
        const p = r && r.picks && r.picks[ax];
        out.push({
          role: "spring",
          part: "Springs",
          pn: p ? p.pn.replace(/\s*\d+ lb\/in$/, "") : r ? r.pn : "",
          rate_lbin: Math.round(k / CAT_LBIN),
          unit_cost: p ? p.unit_cost : r ? +r.unit_cost || 0 : 0,
          source: p ? p.source : r ? r.source || "" : "",
          note: `in the design now (${ax})`,
        });
      }
      continue;
    }
    const N = R.key ? mem[R.key] : null;
    if (!r && !N) continue;
    out.push({
      role: R.k,
      part: r ? r.part : R.name,
      pn: r ? r.pn : "",
      ...(N ? { rating_lbf: catLbf(N) } : {}),
      unit_cost: r ? +r.unit_cost || 0 : 0,
      source: r ? r.source || "" : "",
      note: "in the design now",
    });
  }
  const have = new Set((car.catalog || []).map(c => [c.role, c.pn, c.rating_lbf, c.rate_lbin].join("|")));
  return out.filter(c => !have.has([c.role, c.pn, c.rating_lbf, c.rate_lbin].join("|")));
}
// ---- CSV in and out (columns found by their headers)
const CAT_CSV_HEAD = ["Role", "Part", "Part number", "Rating (lbf)", "Rate (lb/in)", "ID (mm)", "Per joint", "Unit cost", "Source", "Note"];
function catCsv(rows) {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return (
    CAT_CSV_HEAD.join(",") +
    "\n" +
    rows
      .map(c => [c.role, c.part, c.pn, c.rating_lbf, c.rate_lbin, c.id_mm, c.per, c.unit_cost, c.source, c.note].map(q).join(","))
      .join("\n") +
    "\n"
  );
}
function catRoleOf(s) {
  const t = String(s || "").toLowerCase();
  if (/spring/.test(t)) return "spring";
  if (/rocker/.test(t)) return "rocker_bearing";
  if (/ball|spherical|insert/.test(t)) return "ball_joint";
  if (/damper|shock/.test(t)) return "damper";
  if (/rod/.test(t)) return "rod_end";
  return CAT_ROLES.some(r => r.k === t) ? t : null;
}
function catFromCsv(txt) {
  const [head, ...rows] = csvRows(txt),
    h = head.map(x => x.trim().toLowerCase()),
    col = (...names) => h.findIndex(x => names.some(n => x.startsWith(n)));
  const c = {
    role: col("role", "kind", "type"),
    part: col("part"),
    pn: col("part number", "part no", "pn", "choice"),
    rating: col("rating"),
    rate: col("rate"),
    id: col("id", "inner"),
    per: col("per"),
    unit: col("unit cost", "unit price", "price", "cost"),
    source: col("source", "link", "vendor"),
    note: col("note"),
  };
  if (c.part < 0) throw new Error("the first line needs at least a Part column (and Role, unless the part names say what they are)");
  const num = v => {
      const x = +String(v || "").replace(/[$,\s]|lbf|lb\/in|lb/gi, "");
      return x > 0 ? x : null;
    },
    g = (r, k) => (c[k] >= 0 ? (r[c[k]] || "").trim() : "");
  const out = [];
  for (const r of rows) {
    const role = catRoleOf(g(r, "role")) || catRoleOf(g(r, "part"));
    if (!role) continue;
    const e = { role, part: g(r, "part"), pn: g(r, "pn"), unit_cost: num(g(r, "unit")) || 0, source: g(r, "source"), note: g(r, "note") };
    if (num(g(r, "rating"))) e.rating_lbf = num(g(r, "rating"));
    if (num(g(r, "rate"))) e.rate_lbin = num(g(r, "rate"));
    if (num(g(r, "id"))) e.id_mm = num(g(r, "id"));
    if (num(g(r, "per")) && num(g(r, "per")) !== 1) e.per = num(g(r, "per"));
    out.push(e);
  }
  if (!out.length) throw new Error("no rows with a role this catalog knows (spring, rod end, ball joint, rocker bearing, damper)");
  return out;
}
// ---- the panel
const catLocked = () => typeof TEAM !== "undefined" && TEAM.state === "released";
function catCompare(role, entries) {
  const R = catRole(role),
    useBtn = (i, ax, label) =>
      `<button class="btn small" type="button" data-catuse="${i}"${ax ? ` data-catax="${ax}"` : ""}${catLocked() ? ' disabled title="The design on screen is released: make a copy to experiment"' : ""}>${label}</button>`;
  if (role === "spring") {
    const C = ["front", "rear"].map(ax => ({ ax, ...catCorner(ax) })).filter(x => x.e && x.e.ride);
    if (!C.length) return `<p class="note">Turn on the spring and damper on the corners to compare springs.</p>`;
    const rng = x => {
        const t = x.e.checks.find(c => c.key === "ride_freq");
        return t ? [t.lo, t.hi] : [null, null];
      },
      inRng = (v, [lo, hi]) => (lo == null || v >= lo) && (hi == null || v <= hi);
    const head = C.map(x => {
      const [lo, hi] = rng(x),
        tf = x.e.cfg.spring.target_freq_hz,
        need = x.e.ride.spring_for_target;
      return `<li><b>${x.ax}</b>: motion ratio ${fmt(x.e.ride.motion_ratio, 3)}, ${fmt(x.e.ride.ride_freq, 2)} Hz now${lo != null ? `, target ${fmt(lo, 1)}–${fmt(hi, 1)} Hz` : ""}${tf && need > 0 ? `; <b>${fmt(tf, 2)} Hz needs ${fmt(need / CAT_LBIN, 0)} lb/in</b>` : ""}</li>`;
    }).join("");
    const best = {};
    for (const x of C) {
      const tf = x.e.cfg.spring.target_freq_hz;
      if (!tf) continue;
      let b = null;
      for (const [i, c] of entries) {
        const d = Math.abs(catFreq(x.e, +c.rate_lbin * CAT_LBIN) - tf);
        if (+c.rate_lbin > 0 && (!b || d < b[1])) b = [i, d];
      }
      if (b) best[x.ax] = b[0];
    }
    const rows = entries
      .filter(([, c]) => +c.rate_lbin > 0)
      .sort((a, b) => a[1].rate_lbin - b[1].rate_lbin || a[1].unit_cost - b[1].unit_cost)
      .map(([i, c]) => {
        const k = +c.rate_lbin * CAT_LBIN,
          cells = C.map(x => {
            const f = catFreq(x.e, k),
              now = Math.abs(x.e.cfg.spring.spring_rate - k) / k < 0.005;
            return `<td class="n"><span class="pill ${inRng(f, rng(x)) ? "ok" : "bad"}">${fmt(f, 2)} Hz</span>${best[x.ax] === i ? ' <span class="pill neutral" title="Closest to the target frequency">closest</span>' : ""}${now ? ' <span class="pill neutral">in use</span>' : ""}</td>`;
          }).join("");
        return `<tr><td>${esc(c.part)}<br><small class="note">${esc(c.pn)}</small></td><td class="n">${fmt(+c.rate_lbin, 0)} lb/in<br><small class="note">${fmt(k, 1)} N/mm</small></td><td class="n">${c.id_mm ? fmt(+c.id_mm, 1) + " mm" : "–"}</td><td class="n">${catMoney(+c.unit_cost || 0)}</td>${cells}<td>${C.map(x => useBtn(i, x.ax, `Use ${x.ax}`)).join(" ")}</td></tr>`;
      })
      .join("");
    return `<ul class="cathead">${head}</ul>${rows ? `<div class="tbl-wrap"><table class="data cattab"><thead><tr><th>Spring</th><th class="n">Rate</th><th class="n">ID</th><th class="n">Each</th>${C.map(x => `<th class="n">${x.ax}</th>`).join("")}<th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="note">No springs with a rate yet.</p>`}
      <p class="note">The frequency is the corner's at ride height with that spring (linear spring, the tire in series). A spring also changes the roll balance and the ground clearance in motion: after <b>Use</b>, look at the car checks. Check the spring's inner diameter and stroke against the damper.</p>`;
  }
  const C = ["front", "rear"]
    .map(ax => ({ ax, ...catCorner(ax) }))
    .map(x => ({ ...x, pk: catPeak(x.L, role), sf: +((x.e && x.e.cfg.members.sf_target) || 2) }));
  const known = C.filter(x => x.pk);
  if (!known.length) return `<p class="note">No load cases on the corners yet: turn on the spring and damper (the loads need them).</p>`;
  const qty = catQty(role);
  const head = `<ul class="cathead">${known.map(x => `<li><b>${x.ax}</b>: worst ${fmt(x.pk.peak, 0)} N (${esc(x.pk.where)}); <b>FOS ${fmt(x.sf, 1)} needs ${fmt(catLbf(x.pk.peak * x.sf), 0)} lbf</b>${role === "rocker_bearing" ? " (its bearings together)" : ""}</li>`).join("")}<li>${qty} on the car</li></ul>`;
  const now = (car.front.members || {})[R.key];
  let cheap = null;
  const list = entries.map(([i, c]) => {
    const N = catRatingN(c),
      fos = N ? Math.min(...known.map(x => N / x.pk.peak)) : null,
      ok = N ? known.every(x => N / x.pk.peak >= x.sf) : null,
      cost = (+c.unit_cost || 0) * (+c.per || 1) * qty;
    if (ok && cost > 0 && (!cheap || cost < cheap[1])) cheap = [i, cost];
    return { i, c, N, fos, ok, cost };
  });
  const rows = list
    .sort((a, b) => a.cost - b.cost)
    .map(
      ({ i, c, N, fos, ok, cost }) =>
        `<tr><td>${esc(c.part)}<br><small class="note">${esc(c.pn)}${c.note ? " · " + esc(c.note) : ""}</small></td><td class="n">${c.rating_lbf ? `${fmt(+c.rating_lbf, 0)} lbf${+c.per > 1 ? ` × ${c.per}` : ""}` : "–"}</td><td class="n">${catMoney((+c.unit_cost || 0) * (+c.per || 1))}</td><td class="n">${catMoney(cost)}</td><td class="n">${fos != null ? `<span class="pill ${ok ? "ok" : "bad"}">${fmt(fos, 1)}</span>` : '<span class="pill neutral">no rating</span>'}${cheap && cheap[0] === i ? ' <span class="pill neutral" title="The cheapest option that meets the FOS target on both axles">cheapest that passes</span>' : ""}${N && now && Math.abs(N - now) < 1 ? ' <span class="pill neutral">in use</span>' : ""}</td><td>${useBtn(i, null, "Use")}</td></tr>`
    )
    .join("");
  return `${head}<div class="tbl-wrap"><table class="data cattab"><thead><tr><th>Part</th><th class="n">Rating</th><th class="n">Each joint</th><th class="n">For the car</th><th class="n">Worst FOS</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderCatalog() {
  const box = $("#catBox");
  if (!box || !car || chal) return;
  if (box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return; // not under the cursor
  const cat = car.catalog || [];
  let cmp = "";
  if (catOpen)
    for (const R of CAT_ROLES) {
      const entries = cat.map((c, i) => [i, c]).filter(([, c]) => c.role === R.k);
      if (!entries.length) continue;
      let body;
      try {
        body = catCompare(R.k, entries);
      } catch (x) {
        body = `<p class="note">Can't compare: ${esc(x.message)}</p>`;
      }
      cmp += `<h4>${esc(R.name)}</h4>${body}`;
    }
  const sel = (i, v) =>
    `<select data-cat="${i}" data-ck="role" aria-label="Kind of part">${CAT_ROLES.map(r => `<option value="${r.k}"${r.k === v ? " selected" : ""}>${esc(r.name.replace(/ \(.*/, ""))}</option>`).join("")}</select>`;
  const inp = (i, k, v, num, w) =>
    `<input class="${num ? "num lnum" : "ltext"}" ${num ? 'type="number" step="any" min="0"' : 'type="text"'} data-cat="${i}" data-ck="${k}" value="${attr(v ?? "")}" aria-label="${attr(k)}"${w ? ` style="width:${w}"` : ""}>`;
  const edit = cat
    .map(
      (c, i) =>
        `<tr><td>${sel(i, c.role)}</td><td>${inp(i, "part", c.part)}</td><td>${inp(i, "pn", c.pn, false, "10em")}</td><td>${c.role === "spring" ? inp(i, "rate_lbin", c.rate_lbin, true) : inp(i, "rating_lbf", c.rating_lbf, true)}</td><td>${c.role === "spring" ? inp(i, "id_mm", c.id_mm, true) : inp(i, "per", c.per || 1, true)}</td><td>${inp(i, "unit_cost", c.unit_cost, true)}</td><td>${inp(i, "source", c.source, false, "9em")}</td><td>${inp(i, "note", c.note, false, "9em")}</td><td><button class="btn small icon" type="button" data-catdel="${i}" aria-label="Remove this part" title="Remove this part">✕</button></td></tr>`
    )
    .join("");
  box.innerHTML = `<details class="laysec" id="catSec"${catOpen ? " open" : ""}><summary><h3 class="sub-h">Parts catalog</h3><span class="pill neutral">${cat.length} option${cat.length === 1 ? "" : "s"}</span></summary>
    <p class="note">Parts the team could buy, with the maker's rating and the price, compared on this design: the cost for the whole car and the worst safety factor (FOS) over every load case on both axles; for springs, the ride frequency each one gives. <b>Use</b> puts the part in the design and in the bill of materials, then every check runs again. Ratings are the catalog's radial static (ultimate) load in lbf; prices are for one part. Only buy parts you can actually get: a spring rate that isn't made can't be bought.</p>
    ${cmp || (cat.length ? "" : `<p class="note">No parts yet. Start with <b>Add the parts the design uses now</b>, then add the other options (or import a CSV).</p>`)}
    <details class="catedit" id="catEdit"${catEditOpen ? " open" : ""}><summary>Edit the catalog</summary>
    ${cat.length ? `<div class="tbl-wrap"><table class="data bomtab"><thead><tr><th>Kind</th><th>Part</th><th>Part no.</th><th class="n">Rating lbf / rate lb/in</th><th class="n">Per joint / ID mm</th><th class="n">Unit $</th><th>Source</th><th>Note</th><th></th></tr></thead><tbody>${edit}</tbody></table></div>` : ""}
    </details>
    <div class="laybtns"><button class="btn small" type="button" id="catSeed" title="One entry per part the design and the bill of materials use now, so the options are compared with it">Add the parts the design uses now</button><button class="btn small" type="button" id="catAdd">Add a part</button><button class="btn small" type="button" id="catImp">Import a CSV…</button><input type="file" id="catFile" accept=".csv,text/csv" hidden>${cat.length ? `<button class="btn small" type="button" id="catCsv">Download CSV</button>` : ""}</div></details>`;
  wireCatalog(box);
}
function wireCatalog(box) {
  const edit = fn => {
    pushHistory();
    fn();
    if (car.catalog && !car.catalog.length) car.catalog = null;
    run();
  };
  $("#catSec", box).addEventListener("toggle", e => {
    if (e.target.id !== "catSec") return;
    const was = catOpen;
    catOpen = e.target.open;
    if (catOpen && !was) renderCatalog();
  });
  $("#catEdit", box).addEventListener("toggle", e => (catEditOpen = e.target.open));
  $("#catSeed", box).addEventListener("click", () =>
    edit(() => {
      const add = catFromDesign();
      car.catalog = (car.catalog || []).concat(add);
      flash(add.length ? `Added ${add.length} parts from the design` : "The design's parts are in the catalog already");
    })
  );
  $("#catAdd", box).addEventListener("click", () =>
    edit(() => {
      car.catalog = (car.catalog || []).concat([
        { role: "rod_end", part: "", pn: "", rating_lbf: null, unit_cost: 0, source: "", note: "" },
      ]);
      catEditOpen = true;
    })
  );
  $("#catImp", box).addEventListener("click", () => $("#catFile", box).click());
  $("#catFile", box).addEventListener("change", async e => {
    try {
      const add = catFromCsv(await e.target.files[0].text());
      edit(() => (car.catalog = (car.catalog || []).concat(add)));
      flash(`Added ${add.length} parts to the catalog`);
    } catch (x) {
      box.insertAdjacentHTML("afterbegin", `<div class="banner bad">That CSV doesn't load: ${esc(x.message)}</div>`);
    }
  });
  const csv = $("#catCsv", box);
  if (csv)
    csv.addEventListener("click", () =>
      download(fileBase(car.name) + "_catalog.csv", new Blob([catCsv(car.catalog || [])], { type: "text/csv" }))
    );
  $$("[data-catdel]", box).forEach(b => b.addEventListener("click", () => edit(() => car.catalog.splice(+b.dataset.catdel, 1))));
  $$("[data-catuse]", box).forEach(b =>
    b.addEventListener("click", () =>
      edit(() => {
        const c = car.catalog[+b.dataset.catuse];
        catUse(c, b.dataset.catax);
        flash(`Using ${c.pn || c.part}${b.dataset.catax ? " on the " + b.dataset.catax : ""}`);
      })
    )
  );
  $$("[data-cat]", box).forEach(el =>
    el.addEventListener("change", () =>
      edit(() => {
        const c = car.catalog[+el.dataset.cat],
          k = el.dataset.ck;
        if (el.type === "number") {
          const v = el.value === "" ? null : Math.max(0, +el.value);
          if (v == null || (k === "per" && v === 1)) delete c[k];
          else c[k] = v;
        } else c[k] = el.value;
      })
    )
  );
}
