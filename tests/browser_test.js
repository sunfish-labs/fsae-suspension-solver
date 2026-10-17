/* global Susp, SW_MACRO */
// End-to-end checks of the web app in a real (headless) browser. Run from the repo root:
//     python3 ui/build.py && node tests/browser_test.js
// Needs `npm ci` in tests/ (playwright, three, xlsx) and a Chromium that Playwright can find
// (`npx playwright install chromium` once, or PLAYWRIGHT_BROWSERS_PATH pointing at one).
// Exits non-zero if any check fails. Network is blocked: the page must work offline.
const path = require("path"), fs = require("fs"), os = require("os");
const { chromium } = require("playwright");
const XLSX = require("xlsx");
const ROOT = path.resolve(__dirname, ".."), PAGE = "file://" + path.join(ROOT, "ui", "index.html");
let failures = 0, passes = 0;
// wait until the app has nothing left to do (no pending solve, file read or move search), then two frames
async function settle(p) {
  await p.waitForFunction(() => typeof window.__suspIdle === "function" && window.__suspIdle(), null, { timeout: 20000 });
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
function check(name, ok, detail = "") {
  if (ok) { passes++; console.log("  ok   " + name); }
  else { failures++; console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); }
}
async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1366, height: 768 }, colorScheme: opts.scheme || "light", acceptDownloads: true });
  const p = await ctx.newPage();
  // the page must work offline: three.js, SheetJS and the fonts are built in, so block (and count) every web request
  p.netRequests = [];
  await p.route(/^https?:/, r => { p.netRequests.push(r.request().url()); r.abort(); });
  p.errors = [];
  p.on("pageerror", e => p.errors.push("pageerror: " + e.message));
  p.on("console", m => { if (m.type() === "error" && !/ERR_FAILED|net::|Failed to load resource/.test(m.text())) p.errors.push("console: " + m.text()); });
  await p.goto(PAGE); await p.evaluate(() => localStorage.clear()); await p.reload(); await settle(p);
  return p;
}
const closeWelcome = async (p) => { if (await p.$("#welcome:not([hidden])")) await p.click("#wClose"); };
const text = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, " ").trim();
const pressed = (p) => p.$eval("#axleSeg [aria-pressed=\"true\"]", b => b.dataset.ax);

(async () => {
  // PW_CHROMIUM: use a Chromium already on the machine instead of the one Playwright downloads
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });

  console.log("\nStart and car view");
  let p = await newPage(browser);
  check("welcome card shows on first visit", await p.$eval("#welcome", d => !d.hidden));
  await closeWelcome(p);
  check("car view is the default", (await pressed(p)) === "car");
  check("example car meets its car targets", /3\/3 car targets/.test(await text(p, "#status")), await text(p, "#status"));
  check("front and rear corners meet all targets", /Front (\d+)\/\1/.test(await text(p, "#status")) && /Rear (\d+)\/\1/.test(await text(p, "#status")), await text(p, "#status"));
  check("the Car view summarizes each corner's checks", (await p.$$("#carBox .ccard")).length === 2 && /Every target is met/.test(await text(p, "#carBox")), await text(p, "#carBox"));
  await p.click('#carBox [data-goto="rear"][data-tab-to="pack"]'); await settle(p);
  check("a corner button opens that corner on the chosen tab", (await pressed(p)) === "rear" && (await p.getAttribute("#tab_pack", "aria-selected")) === "true" && /misalignment/.test(await text(p, "#pn_pack")));
  await p.click('#axleSeg [data-ax="car"]'); await settle(p);
  await p.fill('[data-cpath="arb.front"]', "0"); await settle(p);
  check("removing the front bar breaks the LLTD target", /2\/3 car targets/.test(await text(p, "#status")));
  await p.fill('[data-cpath="arb.front"]', "200"); await p.fill('[data-cpath="vehicle.mass"]', "300"); await settle(p);
  await p.click('#axleSeg [data-ax="rear"]'); await settle(p);
  check("vehicle settings are shared by both corners", (await p.inputValue("#in_vehicle_mass")) === "300");
  check("rear view shows the rear corner", /rear/i.test(await p.inputValue("#in_name")));

  console.log("\nFront corner tools");
  await p.click('#axleSeg [data-ax="front"]'); await settle(p);
  const tabs = await p.$$eval("#tabs button", bs => bs.map(b => b.textContent.trim()));
  check("six result tabs", tabs.join("|") === "Targets|Motion|Spring & damper|Loads|Packaging|Compare", tabs.join("|"));
  await p.click("#tab_spring"); await settle(p);
  const sp = await text(p, "#pn_spring");
  check("Spring & damper tab shows damping ratios and critical damping", /Damping ratio/.test(sp) && /Critical damping at the wheel/.test(sp) && /Damper force vs shaft speed/.test(sp));
  await p.click("#tab_loads"); await settle(p);
  const ld = await text(p, "#pn_loads");
  check("Loads tab has impact cases, mount bending and rod-end / bolt checks", /pothole/.test(ld) && /kerb strike/.test(ld) && /Pushrod mount bending/.test(ld) && /Rod ends and bolts/.test(ld));
  check("Loads tab says the design loads ask for more grip than the tire has, on purpose", /more than its grip/.test(ld) && /on purpose/.test(ld));
  check("the status bar and error box are announced to screen readers", (await p.getAttribute("#status", "role")) === "status" && (await p.getAttribute("#errBox", "role")) === "alert");
  check("Loads tab shows compliance toe and camber per case", /Compliance/.test(ld) && /Toe-in change/.test(ld) && /Worst toe change/.test(ld));
  check("Loads tab shows the pickup tabs and the fatigue screen", /Pickup tabs/.test(ld) && /FOS tear-out/.test(ld) && /Fatigue screen/.test(ld) && /end weld/.test(ld) && /Tab weld/.test(ld), ld.slice(-600));
  const tabFos = async () => p.evaluate(() => [...document.querySelectorAll("#pn_loads h3")].find(h => /Pickup tabs/.test(h.textContent)).nextElementSibling.querySelector("tbody tr").children[2].textContent);
  const fos0 = parseFloat(await tabFos());
  await p.evaluate(() => { const i = document.querySelector("#in_members_tab_thickness"); i.value = "1.5"; i.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(p);
  const fos1 = parseFloat(await tabFos());
  check("a thinner tab lowers its bearing FOS in proportion (3.175 -> 1.5 mm)", Math.abs(fos1 / fos0 - 1.5 / 3.175) < 0.02, `${fos0} -> ${fos1}`);
  await p.click("#btnUndo"); await settle(p);
  check("Undo restores the tab", Math.abs(parseFloat(await tabFos()) - fos0) < 0.05);
  // pushrod mount: a gusset along the leg, then a bracket into the node
  const bendFos = async () => p.evaluate(() => [...document.querySelectorAll("#pn_loads .kv div")].find(d => /FOS \(bending/.test(d.textContent)).querySelector("b").textContent);
  const bare = parseFloat(await bendFos());
  const pickMount = v => p.evaluate(v => { const s = document.querySelector("#in_members_gusset_type"); s.value = v; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  await pickMount("along_leg"); await settle(p);
  const gus = parseFloat(await bendFos()), gtxt = await text(p, "#pn_loads");
  check("a gusset along the leg raises the mount's bending FOS and says where the peak moved", gus > bare && /gusset 3(\.0)? × 30 mm/.test(gtxt) && /weld where the gusset ends/.test(gtxt)
    && !(await p.$eval("#in_members_gusset_height", el => el.closest(".field").hidden)), `${bare} -> ${gus}`);
  await pickMount("to_node"); await settle(p);
  check("a bracket into the node: no bending, and it points to the FEA export", parseFloat(await bendFos()) > gus && /Part loads for FEA/.test(await text(p, "#pn_loads"))
    && (await p.$eval("#in_members_gusset_height", el => el.closest(".field").hidden)));
  await p.click("#btnUndo"); await settle(p); // both picks in one burst on the same box: one Undo
  check("Undo goes back to the bare tube", Math.abs(parseFloat(await bendFos()) - bare) < 0.005 && (await p.inputValue("#in_members_gusset_type")) === "none");
  // the rocker's plates: off, then on with the starting sizes, then thinner plates
  check("without rocker sizes the Loads tab says the rocker isn't checked", /Rocker\s*Not checked/.test(await text(p, "#pn_loads")));
  const rkPick = v => p.evaluate(v => { const s = document.querySelector("#in_members_rocker_on"); s.value = v; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const rkFos = () => p.evaluate(() => parseFloat([...document.querySelectorAll("#pn_loads h3")].find(h => /^Rocker ·/.test(h.textContent)).textContent.split("FOS")[1]));
  await rkPick("1"); await settle(p);
  const rk0 = await rkFos(), rkt = await text(p, "#pn_loads");
  check("checking the rocker: its holes and arms with an FOS, in the summary bar too", rk0 > 0 && /Pushrod end arm/.test(rkt) && /Pivot hole/.test(rkt) && /Rocker FOS/.test(await text(p, "#status"))
    && !(await p.$eval("#in_members_rocker_width", el => el.closest(".field").hidden)), rkt.slice(0, 200));
  await p.evaluate(() => { const i = document.querySelector("#in_members_rocker_thickness"); i.value = "3.175"; i.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(p);
  const rk1 = await rkFos();
  check("half-thickness plates halve the rocker's FOS", Math.abs(rk1 / rk0 - 0.5) < 0.02, `${rk0} -> ${rk1}`);
  await p.click("#btnUndo"); await settle(p); await p.click("#btnUndo"); await settle(p);
  check("Undo takes the rocker check back off", /Rocker\s*Not checked/.test(await text(p, "#pn_loads")) && (await p.inputValue("#in_members_rocker_on")) === "0");
  await p.click("#tab_spring"); await settle(p);
  check("Spring tab shows the wheel rate with the preload term", /Wheel rate with the preload term/.test(await text(p, "#pn_spring")));
  await p.click("#tab_loads"); await settle(p);
  await p.click("#tab_motion"); await p.click('#pn_heave [data-msub="roll"]'); await settle(p);
  check("Motion → Roll switch", await p.$eval("#pn_roll", e => !e.hidden));
  const labels = await p.$$eval("#hpTable .hpbtn[data-leg]", bs => bs.map(b => b.dataset.leg + ":" + b.textContent));
  check("inboard pivots named by physical position", labels.some(s => s.startsWith("front:") && /front pivot/.test(s)) && labels.some(s => s.startsWith("rear:") && /rear pivot/.test(s)), labels.join(", "));
  await p.click('#hpTable [data-hp="hardpoints.trackrod_inboard"]'); await settle(p);
  check("clicking a hardpoint opens the influence panel", await p.$eval("#drawer", d => !d.hidden));
  await p.click("#drawer [data-pv]"); await settle(p);
  check("preview shows a summary bar", await p.$eval("#pvbar", d => !d.hidden));
  await p.click("#pvApply"); await settle(p);
  check("apply enables undo", await p.$eval("#btnUndo", b => !b.hidden));
  await p.click("#btnUndo"); await settle(p); await p.click("#drClose");
  const shows = await p.$$eval("#showSel option", o => o.map(x => x.value).filter(Boolean));
  for (const id of shows) { await p.selectOption("#showSel", id); await settle(p); }
  check(`all ${shows.length} "Show me" drawings run`, shows.length >= 15 && p.errors.length === 0, p.errors.slice(0, 3).join(" | "));
  await p.selectOption("#showSel", "");
  await p.fill("#poseZo", "12"); await p.dispatchEvent("#poseZo", "change"); await settle(p);
  check("typed travel moves the slider", (await p.inputValue("#poseZ")) === "12");
  await p.click("#poseZ0");
  await p.click("#btnLearn"); await settle(p);
  check("Learn opens the glossary", (await p.$$eval("#pn_learn .term", a => a.length)) >= 40);

  console.log("\nUndo and redo for every edit");
  const box = "#in_hardpoints_upper_outboard_2", orig = await p.inputValue(box);
  await p.click(box); await p.fill(box, ""); await p.type(box, "350", { delay: 40 }); await settle(p);
  await p.click("body", { position: { x: 5, y: 700 } });
  await p.click("#btnUndo"); await settle(p);
  check("one Undo reverts a whole typing burst", (await p.inputValue(box)) === orig, `${await p.inputValue(box)} vs ${orig}`);
  await p.click("#btnRedo"); await settle(p);
  check("Redo reapplies it", (await p.inputValue(box)) === "350");
  await p.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z"); await settle(p);
  check("Ctrl/Cmd+Z undoes outside text boxes", (await p.inputValue(box)) === orig);
  await p.click('#axleSeg [data-ax="car"]'); await settle(p);
  const arb0 = await p.inputValue('[data-cpath="arb.front"]');
  await p.fill('[data-cpath="arb.front"]', "123"); await settle(p); await p.click("body", { position: { x: 5, y: 700 } });
  await p.click("#btnUndo"); await settle(p);
  check("Undo works in the Car view (anti-roll bar edit)", (await p.inputValue('[data-cpath="arb.front"]')) === arb0, await p.inputValue('[data-cpath="arb.front"]'));
  await p.click('#axleSeg [data-ax="front"]'); await settle(p);

  console.log("\nChallenges solved by following the hints only");
  for (const id of ["rc", "bs"]) {
    await p.click("#btnStart"); await p.click("#wChal"); await p.click(`[data-ch="${id}"]`); await settle(p);
    for (let i = 0; i < 3; i++) await p.click("#chHint");
    let solved = false;
    for (let step = 0; step < 6 && !solved; step++) {
      if (await p.$("#chStepGo")) await p.click("#chStepGo");
      await p.waitForSelector("#chStep .chint", { timeout: 90000 });
      if (!(await p.$("#chStepPv:not([hidden])"))) break;
      await p.click("#chStepPv"); await settle(p); await p.click("#pvApply"); await settle(p);
      solved = /Solved/.test(await text(p, "#chDone"));
    }
    check(`challenge "${id}" solved from the hints`, solved);
    await p.click("#chExit"); await settle(p);
  }
  check("leaving a challenge returns to the previous view", ["car", "front"].includes(await pressed(p)));

  console.log("\nExports");
  await p.click('#axleSeg [data-ax="car"]'); await settle(p);
  const grab = async (sel, m = "#exMenu") => { await p.click(m + " summary"); await settle(p); const [d] = await Promise.all([p.waitForEvent("download"), p.click(sel)]);
    const f = path.join(os.tmpdir(), d.suggestedFilename()); await d.saveAs(f); return f; };
  const rep = fs.readFileSync(await grab("#xReport"), "utf8");
  check("design report has the car summary and both corners", /Car target/.test(rep) && /Front:/.test(rep) && /Rear:/.test(rep));
  const wb = XLSX.readFile(await grab("#xXlsx"));
  check("Excel workbook has summary, targets, sweeps and loads", ["Summary", "Front targets", "Front heave", "Front springs & damping", "Rear loads"].every(s => wb.SheetNames.includes(s)), wb.SheetNames.join(","));
  await p.click("#exMenu summary"); await p.click("#xCad"); await settle(p);
  check("3D for CAD dialog opens with the car scope", !(await p.$eval("#cadDlg", d => d.hidden)) && /whole car/.test(await text(p, "#cadScope")), await text(p, "#cadScope"));
  const cadGrab = async (fmt) => { await p.selectOption("#cadFmt", fmt); const [d] = await Promise.all([p.waitForEvent("download"), p.click("#cadGo")]);
    const f = path.join(os.tmpdir(), d.suggestedFilename()); await d.saveAs(f); return fs.readFileSync(f, "utf8"); };
  await p.selectOption("#cadFrame", "solver"); await p.selectOption("#cadOrigin", "solver"); await p.selectOption("#cadUnits", "mm");
  const csv = await cadGrab("csv"), carRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "designs", "example_car.json"), "utf8"));
  const bj = csv.split("\n").find(l => l.startsWith("FR_UCA_ball_joint,")).split(",").slice(2).map(Number);
  check("CAD CSV: ball joint at the JSON hardpoint, all four corners named", bj.every((v, i) => Math.abs(v - carRaw.front.hardpoints.upper_outboard[i]) < 1e-6)
    && ["FR_", "FL_", "RR_", "RL_"].every(t => csv.includes("\n" + t)), bj.join(","));
  const igs = await cadGrab("igs");
  check("CAD IGES file has all five sections", /S      1\n/.test(igs) && /G      1\n/.test(igs) && /D      1\n/.test(igs) && /P      1\n/.test(igs) && /T      1\n$/.test(igs));
  check("CAD STEP file is ISO-10303-21", /^ISO-10303-21;/.test(await cadGrab("step")));
  const fea = await cadGrab("fea"), feaRows = fea.trim().split("\n");
  check("Part loads for FEA: a row per force, both axles, upright, wishbones and rocker, every case", /^axle,case,part,point,x_mm/.test(feaRows[0]) && feaRows.length > 200
    && ["upright", "upper wishbone", "lower wishbone", "rocker"].every(s => fea.includes("," + s + ",")) && /^rear,/m.test(fea) && /,pothole,/.test(fea), feaRows.length);
  const sol = await cadGrab("solid");
  check("CAD STEP solids: closed solids and a named part per body", /MANIFOLD_SOLID_BREP/.test(sol) && /PRODUCT\('FR_tie_rod'/.test(sol) && /PRODUCT\('RL_tire'/.test(sol));
  await p.click("#cadClose");
  await p.evaluate(() => { window.showSaveFilePicker = undefined; });   // use the plain download path in the test
  const car = JSON.parse(fs.readFileSync(await grab("#btnDownload", "#xmenu"), "utf8"));
  check("car JSON carries both corners and every corner's targets", car.type === "car" && car.front.targets && Object.keys(car.front.targets).length > 10 && car.rear.targets && car.car_targets);

  console.log("\nTeam targets file and hostile input");
  const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), "susp-"));
  await p.click('#axleSeg [data-ax="front"]'); await settle(p);
  fs.writeFileSync(path.join(tmpd, "team.json"), JSON.stringify({ front: { trans_min: [70, null], camberr: [-2, -1] } }));
  await p.setInputFiles("#fileIn", path.join(tmpd, "team.json")); await settle(p);
  await p.click("#tab_checks"); await settle(p);
  check("a team targets file applies its ranges", (await p.inputValue('#pn_checks input[data-tkey="trans_min"][data-i="0"]')) === "70");
  check("a misspelled target key is reported with a suggestion", /"camberr".*Did you mean "camber"\?/.test(await text(p, "#errBox")), await text(p, "#errBox"));
  const saved = JSON.parse(fs.readFileSync(await grab("#btnDownload", "#xmenu"), "utf8"));
  check("Save JSON keeps the link to the team file, not its ranges", saved.targets_file === "team.json" && !(saved.targets || {}).trans_min, JSON.stringify(saved.targets));
  fs.writeFileSync(path.join(tmpd, "design.json"), JSON.stringify(saved));
  fs.writeFileSync(path.join(tmpd, "team.json"), JSON.stringify({ front: { trans_min: [99, null] } }));
  const py = require("child_process").execFileSync("python3", ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)})
from susp.config import load_config, default_targets
print(default_targets(load_config(${JSON.stringify(path.join(tmpd, "design.json"))}))["trans_min"])`]).toString().trim();
  check("a later change to the team file still applies to the saved design", py === "[99, None]", py);
  const evil = '<img src=x onerror="window.__pwn=1">', hc = JSON.parse(fs.readFileSync(path.join(ROOT, "designs", "example_car.json"), "utf8"));
  hc.name = evil; hc.front.name = '"' + evil; hc.front.targets = Object.assign({}, hc.front.targets, { ['"><img src=x onerror="window.__pwn=2">']: [0, 1] });
  hc.car_targets = Object.assign({}, hc.car_targets, { [evil]: [0, 1] });
  fs.writeFileSync(path.join(tmpd, "hostile.json"), JSON.stringify(hc));
  await p.setInputFiles("#fileIn", path.join(tmpd, "hostile.json")); await settle(p);
  for (const v of ["car", "front"]) { await p.click(`#axleSeg [data-ax="${v}"]`); await settle(p); }
  await p.click("#tab_checks"); await settle(p);
  check("a design file with hostile names and keys runs no script", (await p.evaluate(() => window.__pwn)) === undefined && (await p.evaluate(() => document.querySelectorAll("img[onerror]").length)) === 0);
  await p.click('#axleSeg [data-ax="car"]'); await settle(p);

  console.log("\nTravel, caliper and halfshaft inputs");
  const setIn = (sel, v) => p.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
  await p.click('#axleSeg [data-ax="front"]'); await settle(p);
  await setIn("#in_sweep_bump_travel", "35"); await setIn("#in_sweep_droop_travel", "20"); await settle(p);
  check("separate bump and droop travel set the pose slider range", (await p.$eval("#poseZ", e => [e.min, e.max].join(","))) === "-20,35", await p.$eval("#poseZ", e => [e.min, e.max].join(",")));
  await setIn("#in_wheel_caliper_size", "60"); await settle(p);
  await p.click("#tab_pack"); await settle(p);
  check("a caliper size adds the caliper check to Packaging", /Caliper: its outer edge/.test(await text(p, "#pn_pack")), (await text(p, "#pn_pack")).slice(-300));
  await setIn("#in_wheel_caliper_size", ""); await settle(p);
  check("clearing a caliper field removes the caliper", !/Caliper: its outer edge/.test(await text(p, "#pn_pack")));
  await setIn("#in_sweep_bump_travel", ""); await setIn("#in_sweep_droop_travel", ""); await settle(p);
  await p.click('#axleSeg [data-ax="rear"]'); await settle(p);
  await setIn("#in_halfshaft_diff_output_1", "160"); await settle(p);
  await p.click("#tab_pack"); await settle(p);
  check("a diff output point adds the halfshaft check (rear)", /Halfshaft: plunge/.test(await text(p, "#pn_pack")), (await text(p, "#pn_pack")).slice(-300));
  await setIn("#in_halfshaft_diff_output_1", ""); await settle(p);
  await p.click('#axleSeg [data-ax="car"]'); await settle(p);

  console.log("\nLayout and drivetrain");
  await p.setInputFiles("#fileIn", path.join(ROOT, "designs", "example_car_layout.json")); await settle(p);
  await p.click('#axleSeg [data-ax="car"]'); await settle(p);
  const pyLay = JSON.parse(require("child_process").execFileSync("python3", ["-c", `import sys, json; sys.path.insert(0, ${JSON.stringify(ROOT)})
from susp.config import load_car
from susp.layout import accel_run
f, r, i = load_car(${JSON.stringify(path.join(ROOT, "designs", "example_car_layout.json"))})
a = accel_run(i["drivetrain"], f["vehicle"], r["wheel"]["tire_radius"], f["vehicle"]["wheelbase"])
print(json.dumps([i["layout_res"]["mass"], i["layout_res"]["cg_height"], a["time"]]))`]).toString());
  const lb = await text(p, "#layBox");
  check("layout: totals match the Python solver (mass, CG height) and the vehicle block takes them",
    lb.includes(pyLay[0].toFixed(1)) && lb.includes(pyLay[1].toFixed(0)) && /from the layout/.test(await text(p, "#carIn")), lb.slice(0, 300));
  check("drivetrain: the 75 m time matches the Python solver", lb.includes(pyLay[2].toFixed(2) + " s") || new RegExp(pyLay[2].toFixed(2) + "\\s*s").test(lb), pyLay[2]);
  const massCell = () => p.evaluate(() => document.querySelector('#layBox [data-lay="0"][data-lk="mass"]').value);
  await p.fill('#layBox [data-lay="0"][data-lk="mass"]', "95"); await settle(p); await p.click("#layBox h3"); await settle(p);
  const lb2 = await text(p, "#layBox");
  check("a heavier driver raises the total by 20 kg", lb2.includes((pyLay[0] + 20).toFixed(1)), lb2.slice(0, 200));
  await p.click("#btnUndo"); await settle(p);
  check("Undo puts the driver back", (await massCell()) === "75");
  await p.click("#layCheck");
  await p.waitForFunction(() => /Closest/.test((document.querySelector("#layClear") || {}).textContent || ""), null, { timeout: 60000 });
  const lc = await text(p, "#layClear");
  check("clearance to the layout parts runs with no chassis model and names what each link comes closest to", /Closest to/i.test(lc) && /(Driver|Engine|Exhaust|Differential)/.test(lc), lc.slice(0, 300));
  check("the parts are drawn as boxes and the toggle shows in Display", await p.evaluate(() => { let n = 0; window.__suspView().three.dyn.traverse(o => { if (o.userData && o.userData.layName) n++; }); return n; }) >= 8 && !(await p.$eval("#tgLayout", e => e.hidden)));

  const ckb = await text(p, "#ckBox");
  check("driver template: the side view draws the hoops and template and shows the example's helmet clearances", !!(await p.$("#ckBox svg.cksvg circle")) && /68 mm/.test(ckb.replace(/\s+/g, " ")) && /93 mm/.test(ckb.replace(/\s+/g, " ")), ckb.slice(0, 300));
  await p.evaluate(() => { const i = document.querySelector('#ckBox [data-ck="main_hoop_top"][data-cj="1"]'); i.value = "1060"; i.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(p);
  check("lowering the Main Hoop 100 mm fails the helmet line (F.5.6.4 a)", /fail/i.test(await text(p, "#rulesBox")) && /F\.5\.6\.4/.test(await text(p, "#rulesBox")));
  await p.click("#btnUndo"); await settle(p);
  check("Undo puts the hoop back", (await p.$eval('#ckBox [data-ck="main_hoop_top"][data-cj="1"]', e => e.value)) === "1160");
  const clearCk = (k, j) => p.evaluate(([k, j]) => { const i = document.querySelector(`#ckBox [data-ck="${k}"][data-cj="${j}"]`); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); }, [k, j]);
  await clearCk("hip", "0"); await settle(p);
  await clearCk("back_angle", "n"); await settle(p);
  const ckf = (await text(p, "#ckBox")).replace(/\s+/g, " ");
  check("frame only: without a seat hip point and back angle the template isn't drawn but the frame rules still are", /No seat hip point/.test(ckf) && /Brace attachment below the top/.test(ckf) && !/Helmet below the hoop line/.test(ckf), ckf.slice(0, 300));
  await p.click("#btnUndo"); await settle(p); await p.click("#btnUndo"); await settle(p);
  check("Undo brings the seat back", /Helmet below the hoop line/.test(await text(p, "#ckBox")));

  const gpb = await text(p, "#gpBox");
  check("ground clearance: the example's lowest points in motion, the tightest named with the body position", /Tightest point in motion/.test(gpb) && /26\.5/.test(gpb) && /Lower side impact tube/.test(gpb), gpb.slice(0, 300));
  await p.evaluate(() => { const i = document.querySelector('#gpBox [data-gp="2"][data-gj="2"]'); i.value = "20"; i.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(p);
  check("a side impact tube 20 mm off the ground fails V.1.4.1 in motion", /V\.1\.4\.1/.test(await text(p, "#rulesBox")) && /1 fail/.test(await text(p, "#rulesBox")));
  await p.click("#btnUndo"); await settle(p);

  const fk = await text(p, "#carBox");
  check("frame stiffness: the car view compares it with the suspension and shows its effect on the balance", /Frame vs suspension roll stiffness/.test(fk) && /rigid frame → this frame/.test(fk) && /bar change that still reaches/.test(fk), fk.slice(0, 200));

  console.log("\nRules check");
  const rb = await text(p, "#rulesBox");
  check("the Car view checks the car against the FSAE 2027 rules by rule number", /Formula SAE 2027/.test(rb) && /V\.1\.2/.test(rb) && /30 pass/.test(rb) && /Check yourself/.test(rb), rb.slice(0, 200));
  await p.evaluate(() => { const i = document.querySelector('#carIn [data-cpath="vehicle.wheelbase"]'); i.value = "1500"; i.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(p);
  check("a 1500 mm wheelbase fails V.1.2 and opens the rules list", /1 fail/.test(await text(p, "#rulesBox")) && (await p.$eval("#rulesBox", d => d.open)));
  await p.click("#btnUndo"); await settle(p);

  console.log("\nPoints from CAD");
  // the example car as a SolidWorks point table: X forward, Y up, Z right, meters, left-hand corners, the CAD's
  // origin 500 mm behind the front axle and 100 mm above the ground
  await p.setInputFiles("#fileIn", path.join(ROOT, "designs", "example_car.json")); await settle(p);
  await p.click('#axleSeg [data-ax="front"]'); await settle(p);
  const swCar = JSON.parse(fs.readFileSync(path.join(ROOT, "designs", "example_car.json"), "utf8"));
  const swNames = { upper_inboard_front: "upper inboard rear", upper_inboard_rear: "upper inboard front", lower_inboard_front: "LCA rear", lower_inboard_rear: "LCA front",
    upper_outboard: "upper ball joint", lower_outboard: "lower BJ", trackrod_inboard: "tie rod inboard", trackrod_outboard: "tie rod outboard", contact_patch: "contact patch",
    rod_outboard: "pushrod outboard", rocker_pivot: "rocker pivot", rocker_rod: "rocker pushrod", rocker_damper: "rocker damper", damper_chassis: "damper chassis" };
  const swTable = (fwdSign = 1) => ["name,x,y,z", ...["front", "rear"].flatMap(ax => {
    const c = swCar[ax], dx = ax === "front" ? 0 : -swCar.vehicle.wheelbase, pre = ax === "front" ? "FL" : "RL";
    const pts = Object.entries(swNames).map(([k, n]) => [n, c.hardpoints[k] || c.spring[k]]);
    pts.push(["rocker axis", c.spring.rocker_pivot.map((v, i) => v + 20 * c.spring.rocker_axis[i])]);
    return pts.map(([n, q]) => `${pre} ${n},${(fwdSign * (q[0] + dx + 500) / 1000).toFixed(6)},${((q[2] - 100) / 1000).toFixed(6)},${(-q[1] / 1000).toFixed(6)}`);
  })].join("\n");
  const frontBefore = JSON.parse(await p.inputValue("#jsonBox"));
  await p.evaluate(() => { const i = document.querySelector('#hpTable input'); i.value = String(+i.value + 40); i.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(p);
  await p.click("#openMenu summary"); await p.click("#omPoints");
  await p.fill("#impText", swTable()); await p.waitForTimeout(400);
  const ichk = await text(p, "#impChecks");
  check("CAD points: units, axes (SolidWorks Y up, left-hand points) and the ground are worked out", (await p.inputValue("#impUnits")) === "m" && (await p.inputValue("#impUp")) === "+Y"
    && (await p.inputValue("#impRight")) === "+Z" && /left-hand points/.test(ichk) && /100 mm below/.test(ichk) && /Wheelbase from the CAD: 1550/.test(ichk), ichk.slice(0, 400));
  check("CAD points: every name matched, and the result's roll center shown before applying", !(await p.$("#impTable td.unmatched")) && /15 points imported/i.test(ichk) && /roll center/.test(ichk));
  await p.click("#impApply"); await settle(p);
  const frontAfter = JSON.parse(await p.inputValue("#jsonBox"));
  const hpDiff = Math.max(...Object.entries(frontBefore.hardpoints).flatMap(([k, v]) => v.map((x, i) => Math.abs(x - frontAfter.hardpoints[k][i]))),
    ...["rod_outboard", "rocker_pivot", "rocker_rod", "rocker_damper", "damper_chassis", "rocker_axis"].flatMap(k => frontBefore.spring[k].map((x, i) => Math.abs(x - frontAfter.spring[k][i]))));
  check("CAD points: applying gives back the car's own hardpoints, spring points and rocker axis (the edit undone)", hpDiff < 1e-3, hpDiff);
  await p.click("#btnUndo"); await settle(p);
  check("Undo goes back to before the import", JSON.parse(await p.inputValue("#jsonBox")).hardpoints.upper_inboard_front[0] !== frontAfter.hardpoints.upper_inboard_front[0]);
  await p.click("#btnUndo"); await settle(p);
  // forward reversed: the names and both axles say so, and the guess follows them
  await p.click("#openMenu summary"); await p.click("#omPoints");
  await p.fill("#impText", swTable(-1)); await p.waitForTimeout(400);
  check("CAD points: a model facing −X is read as forward −X (from the front wheels ahead of the rear)", (await p.inputValue("#impFwd")) === "-X");
  await p.selectOption("#impFwd", "+X"); await p.waitForTimeout(300);
  const rev = await text(p, "#impChecks");
  check("CAD points: forward set the wrong way is caught (named pivots, wheelbase, caster)", /Forward is probably the other way/.test(rev) && /other way/.test(rev), rev.slice(0, 300));
  await p.click("#impCancel");
  check("CAD points: a semicolon table with decimal commas and inches, and free text, read right", await p.evaluate(() => {
    const a = Susp.parsePointTable("name;x;y;z\nUpper BJ;1,5;2,25;-3\n"), b = Susp.parsePointTable("Lower ball joint  X 12.5  Y 45  Z -6 mm");
    return a.rows.length === 1 && a.rows[0].v.join() === "1.5,2.25,-3" && b.rows[0].name === "Lower ball joint" && b.rows[0].v.join() === "12.5,45,-6" && Susp.guessUnits([{ v: [10, 24, 15] }]) === "in";
  }));
  check("the SolidWorks macro is built into the page", await p.evaluate(() => /RefPoint/.test(SW_MACRO) && /GetCoordinateSystemTransformByName/.test(SW_MACRO)).catch(() => false));

  console.log("\nDesign check");
  await p.setInputFiles("#fileIn", path.join(ROOT, "designs", "example_car_layout.json")); await settle(p);
  await p.click("#btnCheck"); await p.waitForFunction(() => /pass/.test(document.querySelector("#chkBody").textContent), null, { timeout: 30000 });
  const ck1 = await text(p, "#chkBody");
  check("the design check covers setup, geometry, packaging, strength, balance and rules for the whole car", ["Setup", "Geometry", "Packaging", "Strength", "Car balance", "Rules", "Check yourself"].every(g => new RegExp(g, "i").test(ck1)) && /The whole car/.test(ck1), ck1.slice(0, 300));
  check("it lists what needs input with why it matters (rod-end rating, default tabs)", /Rod ends against their rating/.test(ck1) && /catalog rating/.test(ck1) && /default 1\/8 in tab/.test(ck1));
  await p.click("#chkRunClear"); await p.waitForFunction(() => !/Not run yet/.test(document.querySelector("#chkBody").textContent), null, { timeout: 60000 });
  await p.uncheck("#chkOnly"); await settle(p);
  check("the frame and parts clearance runs from the check and fills its row", /clear the frame and parts/.test(await text(p, "#chkBody")) && /Closest:/.test(await text(p, "#chkBody")));
  const [ckDl] = await Promise.all([p.waitForEvent("download"), p.click("#chkReport")]);
  const ckRep = fs.readFileSync(await ckDl.path(), "utf8");
  check("the sign-off report has every check, passes included, and lines to sign", /Sign-off/.test(ckRep) && /Checked by/.test(ckRep) && /✓ Pass/.test(ckRep) && /Suspension Solver \d+\.\d+\.\d+/.test(ckRep));
  await p.check("#chkOnly"); await settle(p);
  await p.click('#chkBody [data-chk-go]'); await settle(p);
  check("Go there closes the check and opens that place", (await p.$eval("#chkDlg", d => d.hidden)));

  console.log("\nSprings as fitted, bar linkage, tires at the limit");
  await p.setInputFiles("#fileIn", path.join(ROOT, "designs", "example_car_bars.json")); await settle(p);
  await p.click('#axleSeg [data-ax="car"]'); await settle(p);
  const cb = await text(p, "#carIn") + " " + await text(p, "#carBox");
  check("car with bar linkages: the bars come from the geometry", /from the linkage/.test(cb), cb.slice(0, 300));
  check("tires at the limit: each axle's limit and the neutral LLTD", /Lateral limit front \/ rear axle/.test(cb) && /let go together/.test(cb) && /(understeer|oversteer) at the limit|neutral/.test(cb));
  await p.click('#axleSeg [data-ax="front"]'); await settle(p);
  await p.click("#tab_spring"); await settle(p);
  const spt = await text(p, "#pn_spring");
  await p.click("#tab_loads"); await settle(p);
  const arbL = await text(p, "#pn_loads");
  check("bar on the rocker: the Loads tab shows its share, drop link force and twist in the corners", /Anti-roll bar in the corners/.test(arbL) && /link on the rocker/.test(arbL) && /Drop link/.test(arbL) && /Bar in torsion/.test(arbL), arbL.slice(0, 200));
  await p.click("#tab_spring"); await settle(p);
  check("Spring tab: wheel rate at full bump, bump stop travel and the bar's numbers", /Wheel rate at full bump/.test(spt) && /Wheel travel to the bump stop/.test(spt) && /Bar roll stiffness, this axle/.test(spt) && /Wheel rate, N\/mm/.test(spt), spt.slice(0, 300));
  const bsT = parseFloat((spt.match(/Wheel travel to the bump stop\s*([\d.]+)/) || [])[1]);
  await setIn("#in_spring_bumpstop_gap", "20"); await settle(p);
  const bsT2 = parseFloat(((await text(p, "#pn_spring")).match(/Wheel travel to the bump stop\s*([\d.]+)/) || [])[1]);
  check("a bigger bump-stop gap moves the touch point further up", bsT2 > bsT + 5, `${bsT} -> ${bsT2}`);
  await p.click("#btnUndo"); await settle(p);
  const lltdOf = async () => { await p.click('#axleSeg [data-ax="car"]'); await settle(p); const t = await text(p, "#carBox"); await p.click('#axleSeg [data-ax="front"]'); await settle(p); return parseFloat((t.match(/Front LLTD \(front weight[^)]*\)\s*([\d.]+)/) || [])[1]); };
  const l0 = await lltdOf();
  await setIn("#in_arb_bar_od", "18"); await settle(p);
  const l1 = await lltdOf();
  check("a thicker front bar moves load transfer forward", l1 > l0 + 0.5, `${l0} -> ${l1}`);
  await p.$eval("#arbOn", e => e.click()); await settle(p);
  check("turning the linkage off falls back to the typed bar number", !(await p.$eval("#arbOn", e => e.checked)) && (await p.$eval("#arbBody", e => e.hidden)));
  await p.setInputFiles("#fileIn", path.join(ROOT, "designs", "example_car.json")); await settle(p);

  console.log("\nJoint misalignment");
  await p.click('#axleSeg [data-ax="front"]'); await settle(p);
  await p.click("#tab_pack"); await settle(p);
  const jt = await text(p, "#pn_pack");
  check("Packaging lists every rod end and bearing with its worst angle and limit", /Rod ends and bearings: misalignment/.test(jt) && /Upper ball joint/.test(jt) && /Pushrod, rocker end/.test(jt) && /Tie rod, outboard/.test(jt), jt.slice(-400));
  const worstOf = async key => p.evaluate(k => { const r = [...document.querySelectorAll("#pn_pack .jbolt")].find(s => s.dataset.joint === k).closest("tr"); return parseFloat(r.children[3].textContent); }, key);
  const before = await worstOf("trackrod_outboard");
  await p.selectOption('#pn_pack .jbolt[data-joint="trackrod_outboard"]', "best"); await settle(p);
  const after = await worstOf("trackrod_outboard");
  check("choosing the best bolt direction lowers that joint's worst angle", after < before - 0.4, `${before} -> ${after}`);
  await p.click("#btnUndo"); await settle(p);
  check("Undo puts the bolt back", Math.abs((await worstOf("trackrod_outboard")) - before) < 0.05);
  const rowOf = async key => p.evaluate(k => [...document.querySelector(`#pn_pack .jbolt[data-joint="${k}"]`).closest("tr").children].map(c => c.textContent.trim().replace(/\u2212/g, "-")), key);
  await p.fill('#pn_pack .jallow[data-joint="upper_outboard"]', "3"); await p.press('#pn_pack .jallow[data-joint="upper_outboard"]', "Enter"); await settle(p);
  const ru = await rowOf("upper_outboard");
  check("a joint's own limit typed in its row sets its margin (limit - worst)", Math.abs(parseFloat(ru[6]) - (3 - parseFloat(ru[3]))) < 0.06
    && (await p.inputValue('#pn_pack .jallow[data-joint="upper_outboard"]')) === "3", ru.join(" | "));
  const rideBefore = parseFloat((await rowOf("lower_outboard"))[2]);
  await p.fill('#pn_pack .jalign[data-joint="lower_outboard"]', "20"); await p.press('#pn_pack .jalign[data-joint="lower_outboard"]', "Enter"); await settle(p);
  const rl = await rowOf("lower_outboard");
  check("a ball joint aligned at +20 mm of travel: says so, and is no longer square at ride height", /aligned at \+20 mm of wheel travel/.test(rl[1]) && rideBefore < 0.05 && parseFloat(rl[2]) > 0.05, rl.join(" | "));
  await p.click("#btnUndo"); await settle(p); await p.click("#btnUndo"); await settle(p);
  check("Undo takes both back out", (await p.inputValue('#pn_pack .jallow[data-joint="upper_outboard"]')) === "" && /aligned at ride height/.test((await rowOf("lower_outboard"))[1]));
  await p.click("#exMenu summary"); await settle(p);
  const [md] = await Promise.all([p.waitForEvent("download"), p.click("#xMis")]);
  const mf = path.join(os.tmpdir(), md.suggestedFilename()); await md.saveAs(mf); const mis = fs.readFileSync(mf, "utf8");
  check("Joint misalignment sheet downloads as its own document", /joint misalignment<\/title>/.test(mis) && /Upper ball joint/.test(mis) && !/Member strength/.test(mis), md.suggestedFilename());
  await p.click("#exMenu summary"); await settle(p);
  const [rd] = await Promise.all([p.waitForEvent("download"), p.click("#xReport")]);
  const rf = path.join(os.tmpdir(), rd.suggestedFilename()); await rd.saveAs(rf);
  check("the design report has it as its own section", /<h2 class="pb">Rod ends and bearings: misalignment<\/h2>/.test(fs.readFileSync(rf, "utf8")));

  console.log("\nChassis model");
  {
    // a 2000 x 600 x 400 mm box, bottom 50 mm off the ground, drawn in SolidWorks axes (X forward, Y up, Z right), mm,
    // front axle origin; written as binary STL
    const box = [[-2200, 50, -300], [-200, 450, 300]], [a, b] = box, tris = [];
    const c = (i, j, k) => [[a[0], b[0]][i], [a[1], b[1]][j], [a[2], b[2]][k]];
    const quad = (p, q, r, s_) => tris.push([p, q, r], [p, r, s_]);
    quad(c(0,0,0), c(1,0,0), c(1,1,0), c(0,1,0)); quad(c(0,0,1), c(0,1,1), c(1,1,1), c(1,0,1));
    quad(c(0,0,0), c(0,1,0), c(0,1,1), c(0,0,1)); quad(c(1,0,0), c(1,0,1), c(1,1,1), c(1,1,0));
    quad(c(0,0,0), c(0,0,1), c(1,0,1), c(1,0,0)); quad(c(0,1,0), c(1,1,0), c(1,1,1), c(0,1,1));
    const buf = Buffer.alloc(84 + tris.length * 50); buf.writeUInt32LE(tris.length, 80);
    tris.forEach((t, i) => t.forEach((v, j) => v.forEach((x, k) => buf.writeFloatLE(x, 84 + i * 50 + 12 + j * 12 + k * 4))));
    fs.writeFileSync(path.join(tmpd, "frame.stl"), buf);
  }
  await p.click("#openMenu summary"); await p.click("#omChassis"); await settle(p);
  await p.selectOption("#fmFrame", "sw"); await p.selectOption("#fmUnits", "mm"); await p.selectOption("#fmOrigin", "axle");
  await p.setInputFiles("#fmFile", path.join(tmpd, "frame.stl")); await settle(p);
  const fmInfo = await text(p, "#fmInfo");
  check("a binary STL chassis loads and reads back at its real size and place", /2000 mm long, 600 mm wide, 400 mm tall; lowest point 50 mm/.test(fmInfo) && /centered 0 mm/.test(fmInfo), fmInfo);
  check("the chassis is drawn in the 3D view", await p.evaluate(() => { const v = window.__suspView(); return !!v.three.scene.getObjectByName("chassis"); }));
  await p.selectOption("#fmUnits", "in"); await settle(p);
  check("changing the units rescales it (and warns when the size looks wrong)", /very large/.test(await text(p, "#fmInfo")), await text(p, "#fmInfo"));
  await p.selectOption("#fmUnits", "mm"); await settle(p);
  await p.selectOption("#fmStep", "100"); await p.click('[data-chn="off0"][data-sg="1"]'); await settle(p);
  await p.fill("#fmm_off1", "25"); await settle(p);
  const moved = await text(p, "#fmInfo");
  check("move: +100 mm in X and 25 mm in Y move the model (its numbers follow)", /centered 25 mm right/.test(moved) && (await p.$eval("#fmm_off0", e => e.value)) === "100", moved);
  await p.click("#fmCenter"); await p.fill("#fmGap", "30"); await p.click("#fmGround"); await settle(p);
  const placed = await text(p, "#fmInfo");
  check("Center and Lowest point put it on the centerline and 30 mm off the ground", /lowest point 30 mm/.test(placed) && /centered 0 mm/.test(placed), placed);
  await p.click('[data-chn="rot2"][data-sg="1"]'); await settle(p);
  check("yaw 90 deg swaps its length and width", /600 mm long, 2000 mm wide/.test(await text(p, "#fmInfo")), await text(p, "#fmInfo"));
  const mpos = await p.evaluate(() => { const m = window.__suspView().three.scene.getObjectByName("chassis"); return [m.rotation.y, m.rotation.order]; });
  check("the drawn model turns with it (about the vertical axis)", Math.abs(mpos[0] + Math.PI / 2) < 1e-9 && mpos[1] === "YZX", mpos);
  await p.fill("#fmm_rot0", "17"); await p.fill("#fmm_rot1", "-23"); await p.fill("#fmm_rot2", "41"); await settle(p);
  const drawErr = await p.evaluate(() => {
    // every drawn vertex (three.js world) must sit where the move puts it in the car frame
    const m = window.__suspView().three.scene.getObjectByName("chassis"), T = window.THREE, P = window.__suspChassis().moved(), pos = m.geometry.attributes.position;
    m.updateMatrixWorld(true);
    let worst = 0;
    for (let i = 0; i < pos.count; i++) {
      const w = new T.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld);
      worst = Math.max(worst, Math.hypot(w.x - m.userData.dx - P[3 * i], w.z - P[3 * i + 1], w.y - P[3 * i + 2]));
    }
    return worst;
  });
  check("roll, pitch and yaw together: the drawn model matches the moved coordinates", drawErr < 1e-3, drawErr);
  await p.click("#fmZero"); await settle(p);
  check("Reset move puts it back", /2000 mm long, 600 mm wide/.test(await text(p, "#fmInfo")));
  await p.reload(); await settle(p); await p.waitForFunction(() => { const v = window.__suspView && window.__suspView(); return v && v.three && v.three.scene.getObjectByName("chassis"); }, null, { timeout: 5000 }).catch(() => null);
  check("the chassis model is remembered after a reload", await p.evaluate(() => !!window.__suspView().three.scene.getObjectByName("chassis")));
  await closeWelcome(p);
  await p.click("#openMenu summary"); await p.click("#omChassis"); await settle(p);
  // round trip: the app's own STL tube export, saved in SolidWorks axes, loaded back as the chassis, must land on the links
  await p.click('#axleSeg [data-ax="car"]'); await settle(p); await p.click("#fmClose");
  await p.click("#exMenu summary"); await p.click("#xCad"); await settle(p);
  await p.selectOption("#cadFrame", "sw"); await p.selectOption("#cadOrigin", "axle"); await p.selectOption("#cadUnits", "mm");
  const stlText = await cadGrab("stl");
  await p.selectOption("#cadFrame", "solver"); await p.selectOption("#cadOrigin", "solver");
  const ptsCsv = await cadGrab("csv"); await p.click("#cadClose");
  fs.writeFileSync(path.join(tmpd, "tubes.stl"), stlText);
  await p.click("#openMenu summary"); await p.click("#omChassis"); await settle(p);
  await p.selectOption("#fmFrame", "sw"); await p.selectOption("#fmOrigin", "axle"); await p.selectOption("#fmUnits", "mm");
  await p.setInputFiles("#fmFile", path.join(tmpd, "tubes.stl")); await settle(p);
  const ends = ptsCsv.split("\n").slice(ptsCsv.split("\n").indexOf("") + 2).filter(Boolean).map(r => r.split(",")).filter(r => r.length >= 8 && /(leg|tie_rod|toe_link|pushrod|damper)$/.test(r[0]))
    .flatMap(r => [r.slice(2, 5).map(Number), r.slice(5, 8).map(Number)]);
  const bb = await p.evaluate(() => { const P = window.__suspChassis().chassis.base, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < P.length; i += 3) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], P[i + j]); hi[j] = Math.max(hi[j], P[i + j]); } return [lo, hi]; });
  const want = [0, 1, 2].map(j => [Math.min(...ends.map(e => e[j])), Math.max(...ends.map(e => e[j]))]);
  const off = Math.max(...[0, 1, 2].flatMap(j => [Math.abs(bb[0][j] - want[j][0]), Math.abs(bb[1][j] - want[j][1])]));
  check("round trip: the tube STL saved in SolidWorks axes loads back onto the links (no swapped axes, no shift)", off < 30, JSON.stringify({ bb, want }));
  // clearance: a vertical plate at Y = +100 mm (solver frame) beside the right-hand links
  {
    const tri = [[[-3000, 100, -500], [1000, 100, -500], [1000, 100, 1500]], [[-3000, 100, -500], [1000, 100, 1500], [-3000, 100, 1500]]];
    const buf = Buffer.alloc(84 + tri.length * 50); buf.writeUInt32LE(tri.length, 80);
    tri.forEach((t, i) => t.forEach((v, j) => v.forEach((x, k) => buf.writeFloatLE(x, 84 + i * 50 + 12 + j * 12 + k * 4))));
    fs.writeFileSync(path.join(tmpd, "plate.stl"), buf);
  }
  await p.selectOption("#fmFrame", "solver"); await p.selectOption("#fmOrigin", "solver"); await p.selectOption("#fmUnits", "mm");
  await p.setInputFiles("#fmFile", path.join(tmpd, "plate.stl")); await settle(p);
  await p.click("#fmCheck"); await settle(p);
  const gaps = await p.evaluate(() => Object.fromEntries(window.__suspChassis().chassis.clear.rows.map(r => [r.key, r.gap])));
  // the tie rod's inner end is 193 mm out, 158 mm at full rack inward; tubes 16 and 25.4 mm OD
  check("clearance to a plate: tie rod = 193 - 35 - 100 - 8 mm (worst at full rack)", Math.abs(gaps["FR tie rod"] - 50) < 1e-6, gaps["FR tie rod"]);
  check("clearance to a plate: lower leg = pivot Y - 100 - 12.7 mm", Math.abs(gaps["FR lower leg to pivot X=230"] - (166.1 - 100 - 12.7)) < 1e-6, gaps["FR lower leg to pivot X=230"]);
  check("clearance table lists the closest links with a status", /Too close|Clear/.test(await text(p, "#fmClear")) && /FR tie rod/.test(await text(p, "#fmClear")));
  // the tire against a tilted plane over the tires: the gap is the plane's offset from the drawn tire's support point
  // (tilted down to the right, then to the left, so each side's tires come within reach once)
  const tireCmp = [];
  for (const s of [0.35, -0.35]) {
    const D = 820, tri = [[[-3000, -1500, D + s * 1500], [1000, -1500, D + s * 1500], [1000, 1500, D - s * 1500]], [[-3000, -1500, D + s * 1500], [1000, 1500, D - s * 1500], [-3000, 1500, D - s * 1500]]];
    const buf = Buffer.alloc(84 + tri.length * 50); buf.writeUInt32LE(tri.length, 80);
    tri.forEach((t3, i) => t3.forEach((v, j) => v.forEach((x, k) => buf.writeFloatLE(x, 84 + i * 50 + 12 + j * 12 + k * 4))));
    fs.writeFileSync(path.join(tmpd, "tilt.stl"), buf);
    await p.setInputFiles("#fmFile", path.join(tmpd, "tilt.stl")); await settle(p);
    tireCmp.push(...(await p.evaluate(async ({ s, D }) => {
      const C = window.__suspChassis(), S = window.Susp, res = await C.clearance(), got = Object.fromEntries(res.rows.map(r => [r.key, r.gap]));
      const m = [0, s, 1], mn = Math.hypot(s, 1), dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], want = {};
      for (const { ax, e, dx } of C.corners()) {
        const sw = e.cfg.sweep, [Dd, B] = S.travelRange(e.cfg), hv = S.heavePoints(Dd, B, +(sw.pack_heave_steps || 9)),
          rk = ax === "F" ? S.heavePoints(sw.rack_travel, sw.rack_travel, +(sw.pack_rack_steps || 7)) : [0];
        for (const [hz, r, x] of e.susp.grid(hv, rk)) for (const side of ["R", "L"]) {
          const T = C.tireShape(e, e.susp.observe(x, hz, r)._pts, side), c = [T.c[0] + dx, T.c[1], T.c[2]], ma = dot(m, T.a);
          const h = dot(m, c) + T.rc * Math.hypot(...m.map((v, i) => v - ma * T.a[i])) + T.hc * Math.abs(ma) + T.rnd * mn;
          const k = `${ax}${side} tire`;
          want[k] = Math.min(want[k] ?? Infinity, (D - h) / mn);
        }
      }
      return Object.keys(want).filter(k => want[k] < 150).map(k => [k, got[k], want[k]]);
    }, { s, D })));
  }
  check("tire clearance to a tilted plane equals the drawn tire's support distance, all four tires, over travel and steer",
    tireCmp.length === 4 && new Set(tireCmp.map(r => r[0])).size === 4 && tireCmp.every(([, g, w]) => w > 0 && Math.abs(g - w) < 1e-3), JSON.stringify(tireCmp));
  await p.setInputFiles("#fmFile", path.join(tmpd, "plate.stl")); await settle(p);
  await p.click("#fmCheck"); await settle(p);
  const rowKeys = await p.evaluate(() => window.__suspChassis().chassis.clear.rows.map(r => r.key));
  check("clearance also covers the tire, the upright and the rocker as drawn", ["FR tire", "FR upright (as drawn)", "FR rocker (as drawn)"].every(k => rowKeys.includes(k)), rowKeys.join(", "));
  await p.click('#fmClear [data-chhit="0"]'); await settle(p);
  check("clicking a row shows that pose and marks the closest points", await p.evaluate(() => { const v = window.__suspView(); return !!(v.three.chHit && v.three.chHit.visible); }));
  await p.click("#fmClose");
  await p.click("#openMenu summary"); await p.click("#omChassis"); await settle(p);
  // the grid search must find exactly what checking every triangle finds
  await p.setInputFiles("#fmFile", path.join(tmpd, "frame.stl")); await settle(p);
  await p.selectOption("#fmFrame", "sw"); await p.selectOption("#fmOrigin", "axle"); await settle(p);
  const cmpBrute = await p.evaluate(async () => {
    const C = window.__suspChassis(), a = await C.clearance(), b = await C.clearance({ brute: true });
    const B = Object.fromEntries(b.rows.map(r => [r.key, r.gap]));
    return [a.rows.length, Math.max(...a.rows.map(r => (Number.isFinite(r.gap) || Number.isFinite(B[r.key]) ? Math.abs(r.gap - B[r.key]) : 0)))];
  });
  check("the fast search finds the same gaps as checking every triangle", cmpBrute[0] > 20 && cmpBrute[1] < 1e-9, cmpBrute);
  await p.click("#fmRemove"); await settle(p);
  check("Remove takes it out of the view", await p.evaluate(() => !window.__suspView().three.scene.getObjectByName("chassis")));
  await p.click("#fmClose");

  console.log("\nAxes and coordinates");
  await p.click('#axleSeg [data-ax="front"]'); await settle(p);
  check("an XYZ triad is drawn in the 3D view", await p.evaluate(() => !!window.__suspView().three.triad));
  const at = await p.evaluate(() => {
    const v = window.__suspView(), o = v.three.pickables[0], w = o.getWorldPosition(new v.three.T.Vector3()), q = w.clone().project(v.three.cam), r = v.three.cv.getBoundingClientRect();
    return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height, w.x, w.z, w.y];
  });
  await p.mouse.move(at[0] + 40, at[1] + 40); await p.mouse.move(at[0], at[1]); await settle(p);
  const tip = await text(p, "#vtip");
  const nums = (tip.replace(/\u2212/g, "-").match(/-?\d+\.\d/g) || []).map(Number);
  check("hovering a joint shows its name and X Y Z", !(await p.$eval("#vtip", e => e.hidden)) && nums.length >= 3 && nums.slice(0, 3).every((v, i) => Math.abs(v - at[2 + i]) < 0.06), tip);
  await p.mouse.move(5, 5);

  console.log("\nSettings");
  await p.setInputFiles("#fileIn", path.join(ROOT, "designs", "example_car.json")); await settle(p);
  await p.click('#axleSeg [data-ax="front"]'); await settle(p);
  const exCar = JSON.parse(fs.readFileSync(path.join(ROOT, "designs", "example_car.json"), "utf8"));
  const hpVal = (k, j) => p.inputValue(`#in_hardpoints_${k}_${j}`).then(Number);
  await p.click("#btnSettings"); await settle(p);
  check("Settings opens from the top bar", !(await p.$eval("#setDlg", d => d.hidden)));
  await p.selectOption("#setAxes", "iso"); await settle(p);
  check("ISO axes: the right-hand corner's Y shows negative, X and Z unchanged", (await hpVal("upper_outboard", 1)) === -exCar.front.hardpoints.upper_outboard[1]
    && (await hpVal("upper_outboard", 0)) === exCar.front.hardpoints.upper_outboard[0] && /Y left/.test(await text(p, "#hpHint")));
  await p.evaluate(() => { const i = document.querySelector("#in_hardpoints_upper_outboard_1"); i.value = "-570"; i.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(p);
  const savedY = await p.evaluate(() => JSON.parse(document.querySelector("#jsonBox").value).hardpoints.upper_outboard[1]);
  check("typing -570 in the ISO frame stores Y = +570 in the solver frame (the files don't change frame)", savedY === 570, savedY);
  await p.evaluate(() => document.querySelector("#btnUndo").click()); await settle(p);
  await p.selectOption("#setAxes", "sw"); await p.selectOption("#setOrigin", "car"); await settle(p);
  await p.click("#setClose"); await p.click('#axleSeg [data-ax="rear"]'); await settle(p);
  const wbE = exCar.vehicle.wheelbase, rh = exCar.rear.hardpoints;
  check("SolidWorks axes, car origin: the rear ball joint shows X - wheelbase, its height as Y and its Y as Z",
    (await hpVal("upper_outboard", 0)) === rh.upper_outboard[0] - rh.contact_patch[0] - wbE && (await hpVal("upper_outboard", 1)) === rh.upper_outboard[2]
    && (await hpVal("upper_outboard", 2)) === rh.upper_outboard[1]);
  await p.click("#btnSettings"); await p.selectOption("#setAxes", "solver"); await p.selectOption("#setOrigin", "corner"); await settle(p);
  await p.uncheck("#setAdv"); await settle(p);
  check("simple inputs: the detailed sections hide and a line says how to show them",
    (await p.$eval("#in_members_weld_fat_tube", e => e.offsetParent === null)) && !(await p.$eval("#advHint", e => e.hidden)));
  await p.check("#setAdv"); await settle(p);
  check("detailed inputs come back", (await p.$eval("#advHint", e => e.hidden)));
  await p.uncheck('[data-settab="compare"]'); await settle(p);
  check("a result tab can be hidden", !(await p.$("#tab_compare")));
  await p.check('[data-settab="compare"]'); await settle(p);
  console.log("\nTheme");
  await p.click('#setDlg [data-theme-set="dark"]'); await settle(p);
  await p.reload(); await settle(p);
  check("dark theme is remembered", (await p.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
  check("no script errors on the desktop pass", p.errors.length === 0, p.errors.slice(0, 5).join(" | "));
  check("the page makes no web requests (works offline)", p.netRequests.length === 0, p.netRequests.slice(0, 3).join(", "));
  check("the 3D view runs with the built-in three.js", await p.evaluate(() => typeof THREE !== "undefined" && !!document.querySelector("canvas")));
  await p.context().close();

  console.log("\nPhone width");
  p = await newPage(browser, { viewport: { width: 400, height: 850 } }); await closeWelcome(p);
  for (const v of ["car", "front"]) {
    await p.click(`#axleSeg [data-ax="${v}"]`); await settle(p);
    check(`no sideways scrolling on a phone (${v} view)`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= 400);
  }
  await p.click("#exMenu summary"); await settle(p);
  check("Export menu fits on a phone", (await p.evaluate(() => document.documentElement.scrollWidth)) <= 400);
  await p.click("#exMenu summary");
  check("no script errors on the phone pass", p.errors.length === 0, p.errors.slice(0, 5).join(" | "));
  await browser.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
