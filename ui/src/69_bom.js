// 69_bom.js - Bill of materials with costs (Car view → Bill of materials), saved in the car file as "bom".
// Phase 1: rows typed by the team, totals by system and by status, CSV export. Planned next: rows the design
// fills in itself (tubes, rod ends, bolts, tabs, dampers from the corner files), and the FSAE cost-report categories.
// Row: {system, part, pn, qty, unit_cost, source, status: "planned" | "ordered" | "received", note}
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
      .map(r => [r.system, r.part, r.pn, r.qty, r.unit_cost, bomCost(r).toFixed(2), r.source, r.status, r.note].map(q).join(","))
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
      (r, i) => `<tr>
      <td>${sel(
        i,
        "system",
        BOM_SYSTEMS.map(s => [s, s]),
        r.system
      )}</td><td>${inp(i, "part", r.part)}</td><td>${inp(i, "pn", r.pn, false, "9em")}</td><td>${inp(i, "qty", r.qty, true)}</td><td>${inp(i, "unit_cost", r.unit_cost, true)}</td>
      <td class="n">${money(bomCost(r))}</td><td>${inp(i, "source", r.source, false, "9em")}</td><td>${sel(i, "status", BOM_STATUS, r.status || "planned")}</td>
      <td><button class="btn small icon" type="button" data-bomdel="${i}" aria-label="Remove this row" title="Remove this row">✕</button></td></tr>`
    )
    .join("");
  const sys = BOM_SYSTEMS.filter(s => T.system[s] > 0)
    .map(s => `<div><span>${esc(s)}</span><b>${money(T.system[s])}</b></div>`)
    .join("");
  box.innerHTML = `<details class="laysec" id="bomSec"${bomOpen ? " open" : ""}><summary><h3 class="sub-h">Bill of materials</h3><span class="pill neutral">${rows.length} part${rows.length === 1 ? "" : "s"} · ${money(T.total)}</span></summary>
    <p class="note">What the car costs to build: one row per part, with quantity and unit cost, saved in the car file. Totals update as you type. Status tracks what is planned, ordered and received.</p>
    ${
      rows.length
        ? `<div class="kv"><div><span>Total</span><b>${money(T.total)}</b></div>${BOM_STATUS.map(([k, t]) => `<div><span>${t}</span><b>${money(T.status[k])}</b></div>`).join("")}</div>
      ${sys ? `<h4>By system</h4><div class="kv">${sys}</div>` : ""}
      <div class="tbl-wrap"><table class="data bomtab"><thead><tr><th>System</th><th>Part</th><th>Part no.</th><th class="n">Qty</th><th class="n">Unit $</th><th class="n">Total</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
        : `<p class="note">No parts yet.</p>`
    }
    <div class="laybtns"><button class="btn small" type="button" id="bomAdd">Add a part</button><button class="btn small" type="button" id="bomImp">Import a CSV…</button><input type="file" id="bomFile" accept=".csv,text/csv" hidden>${rows.length ? `<button class="btn small" type="button" id="bomCsv">Download CSV</button>` : ""}</div></details>`;
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
      })
    )
  );
}
