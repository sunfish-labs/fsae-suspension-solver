// End-to-end checks of the web app in a real (headless) browser. Run from the repo root:
//     python3 ui/build.py && node tests/browser_test.js
// Needs `npm ci` in tests/ (playwright, three, xlsx) and a Chromium that Playwright can find
// (`npx playwright install chromium` once, or PLAYWRIGHT_BROWSERS_PATH pointing at one).
// Exits non-zero if any check fails. Network is not needed: three.js and SheetJS are served from node_modules.
const path = require("path"), fs = require("fs"), os = require("os");
const { chromium } = require("playwright");
const XLSX = require("xlsx");
const ROOT = path.resolve(__dirname, ".."), PAGE = "file://" + path.join(ROOT, "ui", "index.html");
const NM = path.join(__dirname, "node_modules");
let failures = 0, passes = 0;
function check(name, ok, detail = "") {
  if (ok) { passes++; console.log("  ok   " + name); }
  else { failures++; console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); }
}
async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1366, height: 768 }, colorScheme: opts.scheme || "light", acceptDownloads: true });
  const p = await ctx.newPage();
  await p.route("**/three.min.js", r => r.fulfill({ path: path.join(NM, "three/build/three.min.js"), contentType: "application/javascript" }));
  await p.route("**/xlsx.full.min.js", r => r.fulfill({ path: path.join(NM, "xlsx/dist/xlsx.full.min.js"), contentType: "application/javascript" }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  p.errors = [];
  p.on("pageerror", e => p.errors.push("pageerror: " + e.message));
  p.on("console", m => { if (m.type() === "error" && !/ERR_FAILED|net::|Failed to load resource/.test(m.text())) p.errors.push("console: " + m.text()); });
  await p.goto(PAGE); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1500);
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
  check("front and rear corners meet all targets", /Front 20\/20/.test(await text(p, "#status")) && /Rear 15\/15/.test(await text(p, "#status")));
  await p.fill('[data-cpath="arb.front"]', "0"); await p.waitForTimeout(700);
  check("removing the front bar breaks the LLTD target", /2\/3 car targets/.test(await text(p, "#status")));
  await p.fill('[data-cpath="arb.front"]', "200"); await p.fill('[data-cpath="vehicle.mass"]', "300"); await p.waitForTimeout(700);
  await p.click('#axleSeg [data-ax="rear"]'); await p.waitForTimeout(700);
  check("vehicle settings are shared by both corners", (await p.inputValue("#in_vehicle_mass")) === "300");
  check("rear view shows the rear corner", /rear/i.test(await p.inputValue("#in_name")));

  console.log("\nFront corner tools");
  await p.click('#axleSeg [data-ax="front"]'); await p.waitForTimeout(700);
  const tabs = await p.$$eval("#tabs button", bs => bs.map(b => b.textContent.trim()));
  check("six result tabs", tabs.join("|") === "Targets|Motion|Spring & damper|Loads|Packaging|Compare", tabs.join("|"));
  await p.click("#tab_motion"); await p.click('#pn_heave [data-msub="roll"]'); await p.waitForTimeout(300);
  check("Motion → Roll switch", await p.$eval("#pn_roll", e => !e.hidden));
  const labels = await p.$$eval("#hpTable .hpbtn[data-leg]", bs => bs.map(b => b.dataset.leg + ":" + b.textContent));
  check("inboard pivots named by physical position", labels.some(s => s.startsWith("front:") && /front pivot/.test(s)) && labels.some(s => s.startsWith("rear:") && /rear pivot/.test(s)), labels.join(", "));
  await p.click('#hpTable [data-hp="hardpoints.trackrod_inboard"]'); await p.waitForTimeout(800);
  check("clicking a hardpoint opens the influence panel", await p.$eval("#drawer", d => !d.hidden));
  await p.click("#drawer [data-pv]"); await p.waitForTimeout(600);
  check("preview shows a summary bar", await p.$eval("#pvbar", d => !d.hidden));
  await p.click("#pvApply"); await p.waitForTimeout(900);
  check("apply enables undo", await p.$eval("#btnUndo", b => !b.hidden));
  await p.click("#btnUndo"); await p.waitForTimeout(700); await p.click("#drClose");
  const shows = await p.$$eval("#showSel option", o => o.map(x => x.value).filter(Boolean));
  for (const id of shows) { await p.selectOption("#showSel", id); await p.waitForTimeout(150); }
  check(`all ${shows.length} "Show me" drawings run`, shows.length >= 15 && p.errors.length === 0, p.errors.slice(0, 3).join(" | "));
  await p.selectOption("#showSel", "");
  await p.fill("#poseZo", "12"); await p.dispatchEvent("#poseZo", "change"); await p.waitForTimeout(300);
  check("typed travel moves the slider", (await p.inputValue("#poseZ")) === "12");
  await p.click("#poseZ0");
  await p.click("#btnLearn"); await p.waitForTimeout(400);
  check("Learn opens the glossary", (await p.$$eval("#pn_learn .term", a => a.length)) >= 40);

  console.log("\nChallenges solved by following the hints only");
  for (const id of ["rc", "bs"]) {
    await p.click("#btnStart"); await p.click("#wChal"); await p.click(`[data-ch="${id}"]`); await p.waitForTimeout(900);
    for (let i = 0; i < 3; i++) await p.click("#chHint");
    let solved = false;
    for (let step = 0; step < 6 && !solved; step++) {
      if (await p.$("#chStepGo")) await p.click("#chStepGo");
      await p.waitForSelector("#chStep .chint", { timeout: 90000 });
      if (!(await p.$("#chStepPv:not([hidden])"))) break;
      await p.click("#chStepPv"); await p.waitForTimeout(400); await p.click("#pvApply"); await p.waitForTimeout(1200);
      solved = /Solved/.test(await text(p, "#chDone"));
    }
    check(`challenge "${id}" solved from the hints`, solved);
    await p.click("#chExit"); await p.waitForTimeout(700);
  }
  check("leaving a challenge returns to the previous view", ["car", "front"].includes(await pressed(p)));

  console.log("\nExports");
  await p.click('#axleSeg [data-ax="car"]'); await p.waitForTimeout(600);
  const grab = async (sel) => { await p.click("#xmenu summary"); await p.waitForTimeout(150); const [d] = await Promise.all([p.waitForEvent("download"), p.click(sel)]);
    const f = path.join(os.tmpdir(), d.suggestedFilename()); await d.saveAs(f); return f; };
  const rep = fs.readFileSync(await grab("#xReport"), "utf8");
  check("design report has the car summary and both corners", /Car target/.test(rep) && /Front:/.test(rep) && /Rear:/.test(rep));
  const wb = XLSX.readFile(await grab("#xXlsx"));
  check("Excel workbook has summary, targets, sweeps and loads", ["Summary", "Front targets", "Front heave", "Rear loads"].every(s => wb.SheetNames.includes(s)), wb.SheetNames.join(","));
  await p.evaluate(() => { window.showSaveFilePicker = undefined; });   // use the plain download path in the test
  const car = JSON.parse(fs.readFileSync(await grab("#btnDownload"), "utf8"));
  check("car JSON carries both corners and every corner's targets", car.type === "car" && car.front.targets && Object.keys(car.front.targets).length > 10 && car.rear.targets && car.car_targets);

  console.log("\nTheme");
  await p.click("#themeMenu summary"); await p.click('[data-theme-set="dark"]'); await p.waitForTimeout(300);
  await p.reload(); await p.waitForTimeout(1200);
  check("dark theme is remembered", (await p.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
  check("no script errors on the desktop pass", p.errors.length === 0, p.errors.slice(0, 5).join(" | "));
  await p.context().close();

  console.log("\nPhone width");
  p = await newPage(browser, { viewport: { width: 400, height: 850 } }); await closeWelcome(p);
  for (const v of ["car", "front"]) {
    await p.click(`#axleSeg [data-ax="${v}"]`); await p.waitForTimeout(500);
    check(`no sideways scrolling on a phone (${v} view)`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= 400);
  }
  check("no script errors on the phone pass", p.errors.length === 0, p.errors.slice(0, 5).join(" | "));
  await browser.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
