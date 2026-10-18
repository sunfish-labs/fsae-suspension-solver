// 03_team.js - Team settings: learning mode, released designs and a banner, set by the team's admin.
// The settings live in team/settings.enc in the repo (AES-GCM, key from the team passphrase by PBKDF2-SHA256), built
// into the page as TEAM_ENC, so the public site carries them but only the team can read them. Nothing here is a lock:
// anyone can clear their browser or skip the passphrase. It keeps the team's own copy calm and the official design
// safe from slips, and that is all it is meant to do.
//   learning mode: the one-click Apply buttons (fix tables, preview bar) are hidden for the team; hints, "What moves
//                  this?", the influence drawer and Preview stay. Challenges and the admin keep everything.
//   released designs: a design whose content matches one the admin released opens read-only, with "Make a copy to
//                  experiment". Anything else is an experiment, and its exports say so.
const TEAM_ITER = 200000;
const TEAM = { data: null, enc: null, pass: null, admin: false, unlockedHash: null, state: null, rel: null, msg: "" };
const TEAM_STAMP = "EXPERIMENT — not released";
const u8b64 = u8 => {
  let s = "";
  for (const c of u8) s += String.fromCharCode(c);
  return btoa(s);
};
const b64u8 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const teamCryptoOk = () => !!(window.crypto && crypto.subtle);
async function pbkdf2Bits(pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, 256));
}
const aesKey = (bits, use) => crypto.subtle.importKey("raw", bits, "AES-GCM", false, [use]);
async function teamDecrypt(enc, pass) {
  const key = await aesKey(await pbkdf2Bits(pass, b64u8(enc.salt), +enc.iter), "decrypt");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u8(enc.iv) }, key, b64u8(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function teamEncrypt(data, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    key = await aesKey(await pbkdf2Bits(pass, salt, TEAM_ITER), "encrypt"),
    ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: TEAM_ITER,
    saved: new Date().toISOString(),
    salt: u8b64(salt),
    iv: u8b64(iv),
    ct: u8b64(new Uint8Array(ct)),
  };
}
const adminHash = async (pass, salt) => u8b64(await pbkdf2Bits("admin:" + pass, b64u8(salt), TEAM_ITER));
// the settings in force: the copy built into the page, or the admin's newer local one (not yet committed)
function teamEncSource() {
  const built = typeof TEAM_ENC !== "undefined" && TEAM_ENC && TEAM_ENC.ct ? TEAM_ENC : null;
  let local = null;
  try {
    local = JSON.parse(store.get("susp.teamenc") || "null");
  } catch (e) {
    local = null;
  }
  if (local && local.ct && (!built || String(local.saved) > String(built.saved))) return { enc: local, local: true };
  return built ? { enc: built, local: false } : null;
}
// a design's identity: its content (everything the file holds but its name), so a renamed copy is still the same design
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .filter(k => v[k] !== undefined && !k.startsWith("_"))
        .sort()
        .map(k => JSON.stringify(k) + ":" + canon(v[k]))
        .join(",") +
      "}"
    );
  if (typeof v === "number") return String(+v.toFixed(6) + 0);
  return JSON.stringify(v);
}
function hash53(str) {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
function designHash() {
  if (chal || !car) return null;
  const d = exportCar();
  delete d.name;
  for (const ax of ["front", "rear"]) if (d[ax]) delete d[ax].name;
  return hash53(canon(d));
}
const teamStamp = () => (TEAM.state === "experiment" ? TEAM_STAMP : "");
const stampFile = name => (teamStamp() ? name.replace(/(\.[A-Za-z0-9]+)?$/, m => "_EXPERIMENT" + m) : name);

// boot: read the settings with the passphrase this browser remembers
async function teamBoot() {
  busyN++;
  try {
    await teamBootInner();
  } finally {
    busyN--;
  }
}
async function teamBootInner() {
  const src = teamEncSource();
  TEAM.enc = src;
  TEAM.pass = store.get("susp.teampass");
  TEAM.data = null;
  TEAM.admin = false;
  if (src && TEAM.pass && teamCryptoOk()) {
    try {
      TEAM.data = await teamDecrypt(src.enc, TEAM.pass);
      TEAM.admin = !!TEAM.data.admin_hash && store.get("susp.admin") === TEAM.data.admin_hash;
    } catch (e) {
      TEAM.msg = "The saved team passphrase no longer opens the team settings: enter the new one.";
    }
  }
  applyTeam();
}
function applyTeam() {
  const d = TEAM.data;
  document.body.classList.toggle("team", !!d);
  document.body.classList.toggle("learning", !!(d && d.learning && !TEAM.admin));
  const bn = $("#teamBanner");
  if (bn) {
    bn.textContent = d && d.banner ? d.banner : "";
    bn.hidden = !(d && d.banner);
  }
  teamCheck();
  renderTeamSec();
  if ($("#trkDlg") && !$("#trkDlg").hidden) renderTracker();
}
// after every solve: is the design on screen a released one?
function teamCheck() {
  const d = TEAM.data,
    h = d && !chal && car ? designHash() : null,
    rel = h ? (d.released || []).find(r => r.hash === h) : null;
  TEAM.hash = h;
  TEAM.rel = rel || null;
  TEAM.state = !d || chal || !car ? null : rel && TEAM.unlockedHash !== h ? "released" : "experiment";
  const lock = TEAM.state === "released";
  document.body.classList.toggle("rel-lock", lock);
  for (const id of ["cardsIn", "carIn", "layBox"]) {
    const el = document.getElementById(id);
    if (el) el.inert = lock;
  }
  const bar = $("#relBar");
  if (!bar) return;
  if (lock) {
    bar.innerHTML = `<span><b>Released design${rel.name ? ": " + esc(rel.name) : ""}</b>${rel.date ? " · released " + esc(rel.date) : ""} · read-only, so the official numbers stay as they are.</span><button class="btn small" type="button" id="relCopy">Make a copy to experiment</button>`;
    bar.className = "relbar rel";
    bar.hidden = false;
    $("#relCopy").onclick = makeExperiment;
  } else if (TEAM.state === "experiment") {
    bar.innerHTML = `<span><b>Experiment</b> · not a released design: exports from it are marked “${esc(TEAM_STAMP)}”.</span>`;
    bar.className = "relbar exp";
    bar.hidden = false;
  } else bar.hidden = true;
}
function makeExperiment() {
  if (!car || !TEAM.hash) return;
  pushHistory();
  TEAM.unlockedHash = TEAM.hash;
  if (!/\(experiment\)$/.test(car.name || "")) car.name = (car.name || "Design") + " (experiment)";
  for (const ax of ["front", "rear"]) if (car[ax] && car[ax].name && !/\(experiment\)$/.test(car[ax].name)) car[ax].name += " (experiment)";
  fillForm();
  run();
  flash("A copy to experiment with: save it under its own name. The released file is unchanged.");
}
// a newly opened file starts locked again if it is a released design
const teamFileOpened = () => (TEAM.unlockedHash = null);

// ---- admin: change the settings, then download settings.enc to commit
async function teamSave(data, pass) {
  const enc = await teamEncrypt(data, pass || TEAM.pass);
  store.set("susp.teamenc", JSON.stringify(enc));
  if (pass) {
    TEAM.pass = pass;
    store.set("susp.teampass", pass);
  }
  TEAM.data = data;
  TEAM.enc = { enc, local: true };
  applyTeam();
}
async function teamCreate(teamPass, adminPass, keep) {
  const salt = u8b64(crypto.getRandomValues(new Uint8Array(16))),
    data = Object.assign({ learning: true, banner: "", released: [] }, keep || {}, {
      admin_salt: salt,
      admin_hash: await adminHash(adminPass, salt),
    });
  store.set("susp.admin", data.admin_hash);
  TEAM.admin = true;
  await teamSave(data, teamPass);
}
function teamDownload() {
  if (!TEAM.enc) return;
  download("settings.enc", new Blob([JSON.stringify(TEAM.enc.enc, null, 1) + "\n"], { type: "application/json" }), { plain: true });
}
function teamEdit(fn) {
  if (!TEAM.admin || !TEAM.data) return Promise.resolve();
  const d = JSON.parse(JSON.stringify(TEAM.data));
  fn(d);
  busyN++;
  return teamSave(d)
    .catch(e => (TEAM.msg = "Could not save: " + e.message))
    .finally(() => busyN--);
}

// ---- the Team section of the Settings dialog
function renderTeamSec() {
  const el = $("#teamBody");
  if (!el) return;
  const d = TEAM.data,
    src = TEAM.enc,
    msg = TEAM.msg ? `<p class="note bad-t" id="teamMsg">${esc(TEAM.msg)}</p>` : "";
  const createForm = (lab, keep) => `<details class="teamnew"${src ? "" : " open"}><summary>${esc(lab)}</summary>
      <div class="fields"><div class="field wide"><label for="tmNewTeam">Team passphrase (for everyone)</label><input id="tmNewTeam" type="text" autocomplete="off" spellcheck="false"></div>
      <div class="field wide"><label for="tmNewAdmin">Admin passphrase (only you)</label><input id="tmNewAdmin" type="password" autocomplete="new-password"></div></div>
      <div class="laybtns"><button class="btn small primary" type="button" id="tmCreate" data-keep="${keep ? 1 : 0}">${keep ? "Change the passphrases" : "Create team settings"}</button></div>
      <p class="note">Use something long that isn't used anywhere else. Then download settings.enc and commit it as team/settings.enc.</p></details>`;
  let h;
  if (!teamCryptoOk()) h = `<p class="note">Team settings need a browser with Web Crypto (open the page over https or from a file).</p>`;
  else if (!src)
    h = `<p class="note">No team settings in this copy of the app, so everything is on. To add them (the team's admin): ${createForm("Create team settings…")}</p>`;
  else if (!d)
    h = `<p class="note">This copy has team settings. Enter the team passphrase once on this browser.</p>
      <div class="fields"><div class="field wide"><label for="tmPass">Team passphrase</label><input id="tmPass" type="password" autocomplete="current-password"></div></div>
      <div class="laybtns"><button class="btn small primary" type="button" id="tmUnlock">Unlock</button></div>`;
  else if (!TEAM.admin)
    h = `<p class="note">Team settings are on${src.local ? " (a local copy, not yet committed)" : ""}. Learning mode: <b>${d.learning ? "on" : "off"}</b> (${d.learning ? "the Apply buttons are hidden: type changes into the tables" : "everything shows"}). Released designs: <b>${(d.released || []).length}</b>.</p>
      <div class="fields"><div class="field wide"><label for="tmAdmin">Admin passphrase</label><input id="tmAdmin" type="password" autocomplete="current-password"></div></div>
      <div class="laybtns"><button class="btn small" type="button" id="tmAdminGo">Sign in as admin</button><button class="btn small" type="button" id="tmForget">Forget the team passphrase here</button></div>`;
  else {
    const rel = d.released || [];
    h = `<p class="note"><b>Admin</b> on this browser: these change what the team sees once settings.enc is committed. You keep every feature.</p>
      <label class="small-check"><input type="checkbox" id="tmLearning"${d.learning ? " checked" : ""}> Learning mode: hide the one-click Apply buttons for the team (hints, Preview and challenges stay)</label>
      <div class="fields"><div class="field wide"><label for="tmBanner">Banner for the team (blank = none)</label><input id="tmBanner" type="text" value="${attr(d.banner || "")}" maxlength="240"></div></div>
      <h4>Released designs</h4>
      ${rel.length ? `<ul class="tmrel">${rel.map((r, i) => `<li><b>${esc(r.name || "design")}</b> · ${esc(r.date || "")} <button class="btn small" type="button" data-unrelease="${i}">Remove</button></li>`).join("")}</ul>` : `<p class="note">None yet.</p>`}
      <div class="laybtns"><button class="btn small" type="button" id="tmRelease"${TEAM.state === "experiment" && TEAM.unlockedHash !== TEAM.hash ? "" : " disabled"}>Release the design on screen</button></div>
      <p class="note">Releasing records the design's content (not the file): anyone who opens that exact file sees it read-only. Change one number and it is a different design.</p>
      <h4>Publish</h4>
      <div class="laybtns"><button class="btn small primary" type="button" id="tmDownload">Download settings.enc</button><button class="btn small" type="button" id="tmSignOut">Sign out of admin</button></div>
      <p class="note">${src.local ? "<b>Changes not yet committed.</b> " : ""}Put the file in the repo at <code>team/settings.enc</code>, commit and push: the site picks it up on its next build. Until then only this browser sees the change.</p>
      ${createForm("Change the passphrases…", true)}`;
  }
  el.innerHTML = msg + h;
  wireTeamSec();
}
function wireTeamSec() {
  const on = (id, fn) => {
    const b = document.getElementById(id);
    if (b) b.onclick = fn;
  };
  const busy = async (fn, label) => {
    TEAM.msg = "";
    busyN++;
    try {
      await fn();
    } catch (e) {
      TEAM.msg = label + (e && e.message ? ": " + e.message : "");
    } finally {
      busyN--;
    }
    renderTeamSec();
  };
  on("tmUnlock", () =>
    busy(async () => {
      const p = $("#tmPass").value;
      try {
        TEAM.data = await teamDecrypt(TEAM.enc.enc, p);
      } catch (e) {
        throw new Error("that passphrase doesn't open them");
      }
      TEAM.pass = p;
      store.set("susp.teampass", p);
      TEAM.admin = store.get("susp.admin") === TEAM.data.admin_hash;
      applyTeam();
    }, "Not unlocked")
  );
  on("tmAdminGo", () =>
    busy(async () => {
      const h = await adminHash($("#tmAdmin").value, TEAM.data.admin_salt);
      if (h !== TEAM.data.admin_hash) throw new Error("wrong admin passphrase");
      store.set("susp.admin", h);
      TEAM.admin = true;
      applyTeam();
    }, "Not signed in")
  );
  on("tmForget", () => {
    store.set("susp.teampass", "");
    store.set("susp.admin", "");
    TEAM.pass = null;
    TEAM.data = null;
    TEAM.admin = false;
    applyTeam();
  });
  on("tmSignOut", () => {
    store.set("susp.admin", "");
    TEAM.admin = false;
    applyTeam();
  });
  on("tmCreate", () =>
    busy(async () => {
      const tp = $("#tmNewTeam").value.trim(),
        ap = $("#tmNewAdmin").value;
      if (tp.length < 8 || ap.length < 8) throw new Error("use at least 8 characters for each");
      if (tp === ap) throw new Error("the two passphrases must differ");
      const keep =
        $("#tmCreate").dataset.keep === "1" && TEAM.data
          ? { learning: TEAM.data.learning, banner: TEAM.data.banner, released: TEAM.data.released }
          : null;
      await teamCreate(tp, ap, keep);
    }, "Not created")
  );
  const lc = $("#tmLearning");
  if (lc) lc.onchange = () => teamEdit(d => (d.learning = lc.checked)).then(renderTeamSec);
  const bn = $("#tmBanner");
  if (bn) bn.onchange = () => teamEdit(d => (d.banner = bn.value.trim()));
  on("tmRelease", () => {
    if (!TEAM.hash) return;
    const name = car.name || "design";
    teamEdit(d => {
      d.released = (d.released || []).filter(r => r.hash !== TEAM.hash);
      d.released.push({ hash: TEAM.hash, name, date: new Date().toISOString().slice(0, 10) });
    });
  });
  $$("#teamBody [data-unrelease]").forEach(b => (b.onclick = () => teamEdit(d => d.released.splice(+b.dataset.unrelease, 1))));
  on("tmDownload", teamDownload);
}
