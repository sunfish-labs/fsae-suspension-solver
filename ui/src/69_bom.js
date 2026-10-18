// 69_bom.js - Bill of materials with costs (Car view → Bill of materials), saved in the car file as "bom".
// Phase 1: rows typed by the team, totals by system and by status, CSV export. Phase 2: rows the design fills in
// itself (tubes with cut lengths, rod ends, ball joints, rockers, dampers, springs, bolts from the corner files).
// Row: {system, part, pn, qty, unit_cost, source, status: "planned" | "ordered" | "received", note, mb,
//       auto?, key?, design_note?, ordered_qty?}   auto rows take qty from the design; the cost stays as typed
const BOM_SYSTEMS = [
  "Brakes",
  "Engine & drivetrain",
  "Frame & body",
  "Electrical",
  "Steering",
  "Suspension",
  "Wheels & tires",
  "Miscellaneous",
];
const BOM_STATUS = [
  ["planned", "Planned"],
  ["ordered", "Ordered"],
  ["received", "Received"],
];
// the FSAE cost report's systems, by their two-letter codes
const BOM_CODES = {
  Brakes: "BR",
  "Engine & drivetrain": "EN",
  "Frame & body": "FR",
  Electrical: "EL",
  Steering: "ST",
  Suspension: "SU",
  "Wheels & tires": "WT",
  Miscellaneous: "MS",
};
let bomOpen = false;
const bomCost = r => (+r.qty || 0) * (+r.unit_cost || 0);
const money = v => "$" + (Math.round(v * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function bomTotals(rows) {
  const by = (k, keys) => Object.fromEntries(keys.map(s => [s, rows.filter(r => r[k] === s).reduce((a, r) => a + bomCost(r), 0)]));
  return {
    total: rows.reduce((a, r) => a + bomCost(r), 0),
    system: by("system", BOM_SYSTEMS),
    status: by(
      "status",
      BOM_STATUS.map(s => s[0])
    ),
  };
}
function bomCsv(rows) {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return (
    ["System", "Part", "Part number", "Qty", "Unit cost", "Total", "Source", "Status", "Note"].join(",") +
    "\n" +
    rows
      .map(r =>
        [
          r.system,
          r.part,
          r.pn,
          r.qty,
          r.unit_cost,
          bomCost(r).toFixed(2),
          r.source,
          r.status,
          [r.note, r.design_note].filter(Boolean).join(" | "),
        ]
          .map(q)
          .join(",")
      )
      .join("\n") +
    "\n"
  );
}
// a CSV from a spreadsheet or this page's own download: columns found by their headers (Part, Part number or Choice,
// Qty, Unit cost or Unit price, Source or Link, Status, Note or Notes, System)
function csvRows(txt) {
  const out = [];
  let row = [],
    cur = "",
    q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"' && txt[i + 1] === '"') ((cur += '"'), i++);
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") (row.push(cur), (cur = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && txt[i + 1] === "\n") i++;
      row.push(cur);
      if (row.some(v => v.trim())) out.push(row);
      ((row = []), (cur = ""));
    } else cur += c;
  }
  row.push(cur);
  if (row.some(v => v.trim())) out.push(row);
  return out;
}
function bomFromCsv(txt) {
  const [head, ...rows] = csvRows(txt),
    h = head.map(x => x.trim().toLowerCase()),
    col = (...names) => h.findIndex(x => names.some(n => x.startsWith(n)));
  const c = {
    system: col("system"),
    part: col("part"),
    pn: col("part number", "part no", "choice", "pn"),
    qty: col("qty", "quantity"),
    unit: col("unit cost", "unit price", "price", "cost"),
    source: col("source", "link", "vendor"),
    status: col("status"),
    note: col("note"),
  };
  if (c.part < 0 || c.qty < 0) throw new Error("the first line needs at least Part and Qty columns");
  const num = v => +String(v || "").replace(/[$,\s]/g, "") || 0,
    g = (r, k) => (c[k] >= 0 ? (r[c[k]] || "").trim() : "");
  return rows.map(r => ({
    system: BOM_SYSTEMS.includes(g(r, "system")) ? g(r, "system") : "Suspension",
    part: g(r, "part"),
    pn: g(r, "pn"),
    qty: num(g(r, "qty")),
    unit_cost: num(g(r, "unit")),
    source: g(r, "source"),
    status: BOM_STATUS.some(s => s[0] === g(r, "status").toLowerCase()) ? g(r, "status").toLowerCase() : "planned",
    note: g(r, "note"),
  }));
}
// a cost report starter: the BOM by FSAE system, made or bought, with subtotals; purchase prices, not the cost tables
function costReportCsv(rows) {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`,
    f = v => (Math.round(v * 100) / 100).toFixed(2),
    out = [["System code", "System", "Part", "Part number", "Make / buy", "Qty", "Unit cost", "Extended cost"].join(",")];
  let made = 0,
    bought = 0;
  for (const sys of BOM_SYSTEMS) {
    const L = rows.filter(r => r.system === sys);
    if (!L.length) continue;
    for (const r of L) {
      out.push(
        [BOM_CODES[sys], sys, r.part, r.pn, r.mb === "make" ? "Make" : "Buy", r.qty, f(+r.unit_cost || 0), f(bomCost(r))].map(q).join(",")
      );
      if (r.mb === "make") made += bomCost(r);
      else bought += bomCost(r);
    }
    out.push(["", `${sys} subtotal`, "", "", "", "", "", f(L.reduce((a, r) => a + bomCost(r), 0))].map(q).join(","));
  }
  out.push(["", "Total", "", "", "", "", "", f(made + bought)].map(q).join(","));
  out.push(["", "of which made", "", "", "", "", "", f(made)].map(q).join(","));
  out.push(["", "of which bought", "", "", "", "", "", f(bought)].map(q).join(","));
  return out.join("\n") + "\n";
}
// ---- rows the design fills in (auto: true, key): quantities come from the corner files, costs are typed once.
// The files hold the left-hand corner, so every count is doubled for the right side. Tube cuts are joint to joint
// (the length between the hardpoints); trim them for the bungs and rod ends. A 6 ft stick with a 3 mm saw kerf.
const BOM_STOCK = 1829,
  BOM_KERF = 3;
const bomDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function bomTubeLabel(od, wall, material) {
  const oi = od / 25.4,
    n = Math.round(oi * 16),
    g = (a, b) => (b ? g(b, a % b) : a),
    d = g(n, 16),
    odTxt = Math.abs(oi - n / 16) < 1 / 500 ? (d === 16 ? String(n / 16) : `${n / d}/${16 / d}`) : oi.toFixed(3),
    wallTxt = (wall / 25.4).toFixed(3).replace(/^0/, "");
  return `${/4130/.test(material || "") ? "4130 " : ""}${odTxt} x ${wallTxt}`;
}
// sticks needed for the pieces: longest first, each into the first stick with room
function bomSticks(lens) {
  const used = [];
  for (const L of lens.slice().sort((a, b) => b - a)) {
    const i = used.findIndex(u => u + L + BOM_KERF <= BOM_STOCK);
    if (i < 0) used.push(L + BOM_KERF);
    else used[i] += L + BOM_KERF;
  }
  return used.length;
}
// what the design needs: Map key -> {part, pn, mb, qty, note}
function bomDesign() {
  const want = new Map(),
    tubes = new Map();
  const add = (key, ax, qty, o) => {
    if (!want.has(key)) want.set(key, { part: o.part, pn: o.pn || "", mb: o.mb || "buy", qty: 0, by: {}, per: o.per });
    const w = want.get(key);
    w.qty += qty;
    w.by[ax] = (w.by[ax] || 0) + qty;
  };
  for (const ax of ["front", "rear"]) {
    const c = car[ax];
    if (!c || !c.hardpoints) continue;
    const h = c.hardpoints,
      m = c.members || {},
      sp = c.spring || {},
      cut = (size, name, a, b) => {
        if (!size || !a || !b) return;
        const k = size.join("x");
        if (!tubes.has(k)) tubes.set(k, { size, pieces: [] });
        for (let s = 0; s < 2; s++) tubes.get(k).pieces.push({ name: `${ax} ${name}`, len: bomDist(a, b) });
      };
    cut(m.wishbone, "upper leg, front", h.upper_inboard_front, h.upper_outboard);
    cut(m.wishbone, "upper leg, rear", h.upper_inboard_rear, h.upper_outboard);
    cut(m.wishbone, "lower leg, front", h.lower_inboard_front, h.lower_outboard);
    cut(m.wishbone, "lower leg, rear", h.lower_inboard_rear, h.lower_outboard);
    cut(m.tie_rod, "tie rod", h.trackrod_inboard, h.trackrod_outboard);
    const push = !!(sp.rod_outboard && sp.rocker_rod);
    if (push) cut(m.pushrod, "pushrod", sp.rod_outboard, sp.rocker_rod);
    const wb = 4,
      tie = 2,
      pr = push ? 2 : 0,
      damper = sp.spring_rate != null ? 1 : 0,
      rocker = sp.rocker_pivot ? 1 : 0;
    add("rodend_wb", ax, wb * 2, { part: "Rod ends", per: "wishbone inboard ends" });
    add("rodend_tie", ax, tie * 2, { part: "Rod ends, tie rods", per: "tie rod ends" });
    add("rodend_push", ax, pr * 2, { part: "Rod ends, pushrods", per: "pushrod ends" });
    add("balljoint", ax, 4, { part: "Ball joint inserts", per: "upper and lower outboard joints" });
    add("weldcup", ax, 4, { part: "Weld cups", mb: "make", per: "one per ball joint" });
    add("bung", ax, (wb + tie + pr) * 2, { part: "Weld bungs", mb: "make", per: "one per rod end" });
    add("damper", ax, damper * 2, { part: "Dampers", per: "one per corner" });
    add("spring", ax, damper * 2, { part: "Springs", per: "one per corner" });
    add("rocker", ax, rocker * 2, { part: "Rockers", mb: "make", per: "one per corner" });
    add("rbearing", ax, rocker * 2, { part: "Rocker pivot bearings", per: "one per rocker" });
    add("bolt", ax, (wb + tie + pr + 2 + damper * 2 + rocker) * 2, {
      part: "Bolts",
      per: "one per rod end and ball joint, two per damper, one per rocker pivot",
    });
    add("nut", ax, (wb + tie + pr + 2 + damper * 2 + rocker) * 2, { part: "Nyloc nuts", per: "one per bolt" });
  }
  for (const [k, t] of want) {
    const by = Object.entries(t.by).filter(([, n]) => n);
    t.note = `${by.map(([a, n]) => `${a} ${n}`).join(", ")} (${t.per})`;
    if (!t.qty) want.delete(k);
  }
  const mat = ((car.front || car.rear || {}).members || {}).material;
  for (const [k, t] of tubes) {
    const label = bomTubeLabel(t.size[0], t.size[1], mat),
      groups = new Map();
    for (const p of t.pieces) {
      const g = `${p.name}|${Math.round(p.len)}`;
      groups.set(g, (groups.get(g) || 0) + 1);
    }
    const sticks = bomSticks(t.pieces.map(p => p.len)),
      long = t.pieces.filter(p => p.len + BOM_KERF > BOM_STOCK).length;
    const cuts = [...groups].map(([g, n]) => `${n}× ${g.split("|")[1]} mm ${g.split("|")[0]}`).join("; ");
    want.set("tube:" + k, {
      part: `Suspension tube ${label}`,
      pn: `${label}, 6 ft stick`,
      mb: "buy",
      qty: sticks,
      note: `6 ft sticks for ${t.pieces.length} pieces, joint to joint, trim for ends and bungs: ${cuts}${long ? `. ${long} piece(s) are longer than a stick` : ""}`,
    });
  }
  return want;
}
// the names a typed row can have to be taken over by the design's row
const BOM_ALIAS = {
  rodend_wb: ["rod ends"],
  balljoint: ["ball joint inserts", "ball joints"],
  weldcup: ["weld cups"],
  bung: ["weld bungs"],
  damper: ["dampers"],
  spring: ["springs"],
  bolt: ["bolts"],
  nut: ["nyloc nuts"],
  rocker: ["rockers"],
  rbearing: ["rocker pivot bearings"],
};
// adds the design's rows that are missing; a typed row with the same name becomes the design's row and keeps its cost
function bomFill(rows, want) {
  const out = rows.slice();
  for (const [key, w] of want) {
    let r = out.find(x => x.auto && x.key === key);
    if (!r) {
      const names = BOM_ALIAS[key] || [];
      r = out.find(x => !x.auto && x.system === "Suspension" && names.includes(String(x.part).trim().toLowerCase()));
      if (r) {
        if (r.status && r.status !== "planned") r.ordered_qty = +r.qty || 0;
        r.auto = true;
        r.key = key;
      }
    }
    if (!r)
      out.push({
        system: "Suspension",
        part: w.part,
        pn: w.pn,
        qty: w.qty,
        unit_cost: 0,
        source: "",
        status: "planned",
        note: "",
        mb: w.mb,
        auto: true,
        key,
      });
  }
  return out;
}
// called from run(): the design's rows follow the design, costs and notes stay
function syncBom() {
  if (!car || chal || !Array.isArray(car.bom) || !car.bom.some(r => r.auto)) return;
  let want;
  try {
    want = bomDesign();
  } catch (e) {
    return;
  }
  for (const r of car.bom) {
    if (!r.auto) continue;
    const w = want.get(r.key);
    r.qty = w ? w.qty : 0;
    r.design_note = w ? w.note : "Not in this design any more";
  }
}
const bomMoved = r => r.auto && r.ordered_qty != null && r.status !== "planned" && +r.ordered_qty !== +r.qty;
function renderBom() {
  const box = $("#bomBox");
  if (!box || !car || chal) return;
  if (box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return; // not under the cursor
  const rows = car.bom || [],
    T = bomTotals(rows);
  const sel = (i, k, opts, v) =>
    `<select data-bom="${i}" data-bk="${k}" aria-label="${attr(k)}">${opts.map(([o, t]) => `<option value="${attr(o)}"${o === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  const inp = (i, k, v, num, w) =>
    `<input class="${num ? "num lnum" : "ltext"}" ${num ? 'type="number" step="any" min="0"' : 'type="text"'} data-bom="${i}" data-bk="${k}" value="${attr(v ?? "")}" aria-label="${attr(k)}"${w ? ` style="width:${w}"` : ""}>`;
  const body = rows
    .map(
      (r, i) => `<tr${r.auto ? ' class="bomauto"' : ""}>
      <td>${sel(
        i,
        "system",
        BOM_SYSTEMS.map(s => [s, s]),
        r.system
      )}</td><td>${inp(i, "part", r.part)}${r.auto ? `<br><small class="note" title="Set by the design. Costs and notes stay.">${esc(r.design_note || "from the design")}</small>` : ""}</td><td>${inp(i, "pn", r.pn, false, "9em")}</td><td>${
        r.auto
          ? `<input class="num lnum" type="number" value="${attr(r.qty)}" readonly aria-label="Quantity, set by the design" title="Set by the design">${bomMoved(r) ? `<br><span class="pill warn">ordered ${esc(r.ordered_qty)}</span> <button class="btn small" type="button" data-bomack="${i}" title="Note that you know the design needs ${esc(r.qty)} now">Got it</button>` : ""}`
          : inp(i, "qty", r.qty, true)
      }</td><td>${inp(i, "unit_cost", r.unit_cost, true)}</td>
      <td class="n">${money(bomCost(r))}</td><td>${sel(
        i,
        "mb",
        [
          ["buy", "Buy"],
          ["make", "Make"],
        ],
        r.mb || "buy"
      )}</td><td>${inp(i, "source", r.source, false, "9em")}</td><td>${sel(i, "status", BOM_STATUS, r.status || "planned")}</td>
      <td><button class="btn small icon" type="button" data-bomdel="${i}" aria-label="Remove this row" title="Remove this row">✕</button>${r.auto ? ` <button class="btn small" type="button" data-bomown="${i}" title="Stop following the design: keep this quantity and type it yourself">Type it</button>` : ""}</td></tr>`
    )
    .join("");
  const nMoved = rows.filter(bomMoved).length,
    nNoCost = rows.filter(r => r.auto && !(+r.unit_cost > 0) && +r.qty > 0).length;
  const sys = BOM_SYSTEMS.filter(s => T.system[s] > 0)
    .map(s => `<div><span>${esc(s)}</span><b>${money(T.system[s])}</b></div>`)
    .join("");
  box.innerHTML = `<details class="laysec" id="bomSec"${bomOpen ? " open" : ""}><summary><h3 class="sub-h">Bill of materials</h3><span class="pill neutral">${rows.length} part${rows.length === 1 ? "" : "s"} · ${money(T.total)}</span>${nMoved ? `<span class="pill warn">${nMoved} changed since ordered</span>` : ""}</summary>
    <p class="note">What the car costs to build: one row per part, with quantity and unit cost, saved in the car file. Totals update as you type. Status tracks what is planned, ordered and received. <b>Fill from the design</b> adds the rows the design decides (tubes with cut lengths, rod ends, ball joints, rockers, dampers, springs, bolts). Their quantities follow the design from then on. Type each cost once.</p>
    ${nNoCost ? `<div class="banner warn">${nNoCost} design row${nNoCost === 1 ? " needs" : "s need"} a unit cost.</div>` : ""}

    ${
      rows.length
        ? `<div class="kv"><div><span>Total</span><b>${money(T.total)}</b></div>${BOM_STATUS.map(([k, t]) => `<div><span>${t}</span><b>${money(T.status[k])}</b></div>`).join("")}</div>
      ${sys ? `<h4>By system</h4><div class="kv">${sys}</div>` : ""}
      <div class="tbl-wrap"><table class="data bomtab"><thead><tr><th>System</th><th>Part</th><th>Part no.</th><th class="n">Qty</th><th class="n">Unit $</th><th class="n">Total</th><th>Make / buy</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
        : `<p class="note">No parts yet.</p>`
    }
    <div class="laybtns"><button class="btn small" type="button" id="bomFill" title="Add the rows the design decides: tubes with cut lengths, rod ends, ball joints, rockers, dampers, springs, bolts. Typed rows with the same name are taken over and keep their cost.">Fill from the design</button><button class="btn small" type="button" id="bomAdd">Add a part</button><button class="btn small" type="button" id="bomImp">Import a CSV…</button><input type="file" id="bomFile" accept=".csv,text/csv" hidden>${rows.length ? `<button class="btn small" type="button" id="bomCsv">Download CSV</button><button class="btn small" type="button" id="bomCost" title="By FSAE cost-report system, make / buy, with subtotals">Cost report starter (CSV)</button>` : ""}</div></details>`;
  wireBom(box);
}
function wireBom(box) {
  const edit = fn => {
    pushHistory();
    fn();
    if (car.bom && !car.bom.length) car.bom = null;
    run();
  };
  $("#bomSec", box).addEventListener("toggle", e => (bomOpen = e.target.open));
  $("#bomFill", box).addEventListener("click", () =>
    edit(() => {
      const before = (car.bom || []).length;
      car.bom = bomFill(car.bom || [], bomDesign());
      flash(`Added ${car.bom.length - before} rows from the design`);
    })
  );
  $$("[data-bomown]", box).forEach(b =>
    b.addEventListener("click", () =>
      edit(() => {
        const r = car.bom[+b.dataset.bomown];
        delete r.auto;
        delete r.key;
        delete r.design_note;
        delete r.ordered_qty;
      })
    )
  );
  $$("[data-bomack]", box).forEach(b =>
    b.addEventListener("click", () => edit(() => (car.bom[+b.dataset.bomack].ordered_qty = car.bom[+b.dataset.bomack].qty)))
  );
  $("#bomAdd", box).addEventListener("click", () =>
    edit(
      () =>
        (car.bom = (car.bom || []).concat([
          { system: "Suspension", part: "", pn: "", qty: 1, unit_cost: 0, source: "", status: "planned", note: "" },
        ]))
    )
  );
  $("#bomImp", box).addEventListener("click", () => $("#bomFile", box).click());
  $("#bomFile", box).addEventListener("change", async e => {
    try {
      const add = bomFromCsv(await e.target.files[0].text());
      edit(() => (car.bom = (car.bom || []).concat(add)));
      flash(`Added ${add.length} parts from the CSV`);
    } catch (x) {
      box.insertAdjacentHTML("afterbegin", `<div class="banner bad">That CSV doesn't load: ${esc(x.message)}</div>`);
    }
  });
  const cr = $("#bomCost", box);
  if (cr)
    cr.addEventListener("click", () =>
      download(fileBase(car.name) + "_cost_report.csv", new Blob([costReportCsv(car.bom || [])], { type: "text/csv" }))
    );
  const csv = $("#bomCsv", box);
  if (csv)
    csv.addEventListener("click", () => download(fileBase(car.name) + "_bom.csv", new Blob([bomCsv(car.bom || [])], { type: "text/csv" })));
  $$("[data-bomdel]", box).forEach(b => b.addEventListener("click", () => edit(() => car.bom.splice(+b.dataset.bomdel, 1))));
  $$("[data-bom]", box).forEach(el =>
    el.addEventListener("change", () =>
      edit(() => {
        const r = car.bom[+el.dataset.bom],
          k = el.dataset.bk;
        r[k] = el.type === "number" ? (el.value === "" ? 0 : Math.max(0, +el.value)) : el.value;
        if (k === "status" && r.auto) {
          if (r.status === "planned") delete r.ordered_qty;
          else if (r.ordered_qty == null) r.ordered_qty = r.qty;
        }
      })
    )
  );
}
