// 01_demo.js - The public demo (ui/demo.html, published at /demo/; built by ui/build.py with schema/demo.json).
// Every view, tab, chart and the 3D view work on the example cars, and the numbers can be edited; nothing is kept
// (the demo's storage lives in memory, so a reload starts fresh). Opening your own files, saving, exports, one-click
// fixes, challenges and the team tools are grayed out; clicking one opens "Join the waitlist". DEMO is null in the
// team build, and none of this runs there.
// The waitlist: with a form in schema/demo.json ("waitlist.form" = a Google Form's .../formResponse address and its
// entry ids), the sign-up is sent from the page. Without one, the team's feedback form opens in a new tab with the
// sign-up filled into its suggestions box; the visitor rates the app and submits it there.
const DEMO_LOCK = [
  "#btnTracker",
  "#btnChal",
  "#wChal",
  "#wOpen",
  "#omFile",
  "#omPoints",
  "#omChassis",
  "#xmenu .xpop button",
  "#exMenu .xpop button",
  "#chkReport",
  "#teamSec",
  "[data-apply]",
  "[data-apply-spring]",
  "#pvApply",
  "[data-catuse]",
  "#catImp",
  "#catCsv",
  "#bomImp",
  "#bomCsv",
  "#bomCost",
].join(", ");
const DEMO_WANT = [
  ["#omFile, #wOpen", "Opening your own design"],
  ["#omPoints", "Points from SolidWorks"],
  ["#omChassis", "Your frame from CAD"],
  ["#xmenu", "Saving designs"],
  ["#exMenu", "Exports (CAD, reports, SolidWorks)"],
  ["#chkReport", "The sign-off report"],
  ["#btnChal, #wChal", "Challenges"],
  ["#btnTracker", "The tech inspection tracker"],
  ["#teamSec", "Team settings"],
  ["#catBox", "The parts catalog"],
  ["#bomBox", "The bill of materials"],
  ["[data-apply], [data-apply-spring], #pvApply", "One-click fixes"],
];
const demoLocked = el => !!(DEMO && el && el.closest && !el.closest("#demoDlg, #demoBar") && el.closest(DEMO_LOCK));
const demoWant = el => (DEMO_WANT.find(([s]) => el.closest(s)) || [0, "The full workbench"])[1];
// mark the locked controls (grayed, with a lock) after every render
function demoMark() {
  if (!DEMO) return;
  for (const el of document.querySelectorAll(DEMO_LOCK)) {
    if (el.dataset.locked) continue;
    el.dataset.locked = "1";
    el.setAttribute("aria-disabled", "true");
    el.title = "In the full version: join the waitlist";
  }
}
function demoWaitlist(want) {
  $("#demoWant").textContent = want || "The full workbench";
  $("#demoMsg").textContent = "";
  $("#demoForm").hidden = false;
  $("#demoDone").hidden = true;
  $("#demoDlg").hidden = false;
  setTimeout(() => $("#demoEmail").focus(), 0);
}
const demoClose = () => ($("#demoDlg").hidden = true);
function demoSubmit(e) {
  e.preventDefault();
  const email = $("#demoEmail").value.trim(),
    team = $("#demoTeam").value.trim(),
    role = $("#demoRole").value,
    want = $("#demoWant").textContent,
    w = DEMO.waitlist || {},
    fb = DEMO.feedback || {};
  if ($("#demoHp").value) return demoDoneMsg("You're on the list."); // the hidden field only bots fill in
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    $("#demoMsg").textContent = "Please enter an email address.";
    return;
  }
  if (w.form && w.email) {
    const body = new URLSearchParams({ [w.email]: email });
    if (w.team && team) body.set(w.team, team);
    if (w.role && role) body.set(w.role, role);
    if (w.want) body.set(w.want, want);
    $("#demoGo").disabled = true;
    // a Google Form answers opaquely (no-cors): a request that went out counts as signed up
    fetch(w.form, { method: "POST", mode: "no-cors", body })
      .then(() => demoDoneMsg("You're on the list. We'll email you when the full version opens."))
      .catch(() => ($("#demoMsg").textContent = "That didn't go through. Check your connection and try again."))
      .finally(() => ($("#demoGo").disabled = false));
    return;
  }
  if (fb.form && fb.suggestions) {
    const u = new URL(fb.form);
    u.searchParams.set("usp", "pp_url");
    u.searchParams.set(fb.suggestions, `Waitlist: ${email}${team ? " · " + team : ""}${role ? " · " + role : ""} · wants: ${want}`);
    if (fb.name) u.searchParams.set(fb.name, email);
    window.open(u.toString(), "_blank", "noopener");
    return demoDoneMsg(
      "Almost there: the form opened in a new tab with your email filled in. Rate the app and press Submit there to join."
    );
  }
  $("#demoMsg").textContent = "Sign-ups open soon. Thanks for your interest!";
}
function demoDoneMsg(t) {
  $("#demoDoneTxt").textContent = t;
  $("#demoForm").hidden = true;
  $("#demoDone").hidden = false;
}
function demoBoot() {
  if (!DEMO) return;
  document.body.classList.add("demo");
  if (DEMO.brand) {
    document.title = DEMO.brand + " (demo)";
    const wt = $("#wTitle");
    if (wt) wt.textContent = DEMO.brand;
  }
  const keep = $("#welcome .note");
  if (keep) keep.textContent = "This is the demo: change anything you like. Nothing is kept, so a reload starts fresh.";
  document
    .querySelector("header")
    .insertAdjacentHTML(
      "afterend",
      `<div class="demobar" id="demoBar" role="note"><span><b>Demo</b> · example cars only. Edit anything and watch every target update; nothing is kept. Grayed-out tools are in the full version.</span><button class="btn small primary" type="button" id="demoJoin">Join the waitlist</button>${DEMO.repo ? `<a class="small" href="${attr(DEMO.repo)}" target="_blank" rel="noopener">About</a>` : ""}</div>`
    );
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="welcome" id="demoDlg" hidden><div class="wcard demodlg" role="dialog" aria-modal="true" aria-labelledby="demoTitle">
      <button class="btn small wclose" type="button" id="demoX" aria-label="Close">✕</button>
      <h2 id="demoTitle">Join the waitlist</h2>
      <p class="wsub">Full version only: <span id="demoWant"></span></p>
      <p>The full workbench checks <b>your</b> car: bring the hardpoints in from SolidWorks, size tubes, rod ends and tabs against the loads, check the FSAE rules, pick parts by cost and safety factor, and export the reports for the design event. Leave your email and we'll tell you when it opens.</p>
      <form id="demoForm" novalidate>
        <label class="dlab" for="demoEmail">Email</label>
        <input id="demoEmail" type="email" autocomplete="email" required placeholder="you@school.edu">
        <label class="dlab" for="demoTeam">Team or school <i>(optional)</i></label>
        <input id="demoTeam" type="text" autocomplete="organization">
        <label class="dlab" for="demoRole">You are <i>(optional)</i></label>
        <select id="demoRole"><option value="">–</option><option>Student</option><option>Faculty advisor</option><option>Industry</option><option>Other</option></select>
        <input id="demoHp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" class="demohp">
        <button class="btn primary" type="submit" id="demoGo">Join the waitlist</button>
        <p class="note" id="demoMsg" role="alert"></p>
        <p class="note">Only used to tell you when the full version opens. No spam, never shared.</p>
      </form>
      <div id="demoDone" hidden><p><b id="demoDoneTxt"></b></p><button class="btn" type="button" id="demoOk">Keep exploring</button></div>
    </div></div>`
  );
  $("#demoJoin").addEventListener("click", () => demoWaitlist("The full workbench"));
  $("#demoX").addEventListener("click", demoClose);
  $("#demoOk").addEventListener("click", demoClose);
  $("#demoForm").addEventListener("submit", demoSubmit);
  $("#demoDlg").addEventListener("click", e => e.target.id === "demoDlg" && demoClose());
  document.addEventListener("keydown", e => e.key === "Escape" && !$("#demoDlg").hidden && demoClose());
  // one guard for the whole page, ahead of every other handler (capture phase): a locked control does nothing but
  // open the waitlist
  for (const type of ["click", "mousedown", "pointerdown", "keydown", "change", "input"])
    document.addEventListener(
      type,
      e => {
        if (!demoLocked(e.target)) return;
        if (type === "keydown" && !["Enter", " "].includes(e.key)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (type === "click" || type === "keydown") demoWaitlist(demoWant(e.target));
      },
      true
    );
  // no files dropped onto the page
  for (const type of ["dragover", "drop"])
    document.addEventListener(
      type,
      e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (type === "drop") demoWaitlist("Opening your own design");
      },
      true
    );
  new MutationObserver(demoMark).observe(document.body, { childList: true, subtree: true });
  demoMark();
}
