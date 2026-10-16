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
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });

  console.log("\nStart and car view");
  let p = await newPage(browser);
  check("welcome card shows on first visit", await p.$eval("#welcome", d => !d.hidden));
  await closeWelcome(p);
  check("car view is the default", (await pressed(p)) === "car");
  check("example car meets its car targets", /3\/3 car targets/.test(await text(p, "#status")), await text(p, "#status"));
  check("front and rear corners meet all targets", /Front (\d+)\/\1/.test(await text(p, "#status")) && /Rear (\d+)\/\1/.test(await text(p, "#status")), await text(p, "#status"));
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
  check("Loads tab shows compliance toe and camber per case", /Compliance/.test(ld) && /Toe-in change/.test(ld) && /Worst toe change/.test(ld));
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

  console.log("\nTheme");
  await p.click("#themeMenu summary"); await p.click('[data-theme-set="dark"]'); await settle(p);
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
