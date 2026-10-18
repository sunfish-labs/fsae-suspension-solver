// Encrypt the built web app behind the team passphrase, for the published site.
//     TEAM_PASSPHRASE=... node tools/encrypt_page.js ui/index.html _site/ui/index.html
// The page is gzipped, then encrypted with AES-GCM under a key from the passphrase (PBKDF2-SHA256, 200,000 rounds),
// and wrapped in a small page that asks for the passphrase and decrypts it in the browser. Without the passphrase the
// published page holds nothing readable: not the app, not the team settings. The passphrase is the team passphrase,
// so one entry opens the app and the team settings (it is remembered in the browser as susp.teampass).
// Before writing, it checks that the passphrase opens team/settings.enc, so the two can't drift apart
// (--no-check skips that, for tests). Plain Node, no packages.
"use strict";
const fs = require("fs"),
  path = require("path"),
  zlib = require("zlib"),
  { webcrypto } = require("crypto");
const subtle = webcrypto.subtle,
  ITER = 200000;
const args = process.argv.slice(2).filter(a => !a.startsWith("--")),
  noCheck = process.argv.includes("--no-check");
const [src, dst] = args;
const pass = process.env.TEAM_PASSPHRASE || "";
if (!src || !dst) {
  console.error("usage: TEAM_PASSPHRASE=... node tools/encrypt_page.js <in.html> <out.html> [--no-check]");
  process.exit(2);
}
if (pass.length < 8) {
  console.error("TEAM_PASSPHRASE is not set (or under 8 characters): add it as a repository secret. Refusing to publish the app unencrypted.");
  process.exit(1);
}
const b64 = u8 => Buffer.from(u8).toString("base64");
async function key(salt, use) {
  const base = await subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, base, 256);
  return subtle.importKey("raw", bits, "AES-GCM", false, [use]);
}
(async () => {
  if (!noCheck) {
    const sp = path.join(__dirname, "..", "team", "settings.enc");
    if (fs.existsSync(sp)) {
      const enc = JSON.parse(fs.readFileSync(sp, "utf8"));
      try {
        const base = await subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
        const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(enc.salt, "base64"), iterations: +enc.iter }, base, 256);
        const k = await subtle.importKey("raw", bits, "AES-GCM", false, ["decrypt"]);
        await subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(enc.iv, "base64") }, k, Buffer.from(enc.ct, "base64"));
      } catch (e) {
        console.error("TEAM_PASSPHRASE does not open team/settings.enc: update the repository secret to the current team passphrase.");
        process.exit(1);
      }
    }
  }
  const html = fs.readFileSync(src);
  const gz = zlib.gzipSync(html, { level: 9 });
  const salt = webcrypto.getRandomValues(new Uint8Array(16)),
    iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, await key(salt, "encrypt"), gz));
  const payload = JSON.stringify({ iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
  const font = fs.readFileSync(path.join(__dirname, "..", "ui", "vendor", "fonts", "barlow-condensed-latin-600-normal.woff2")).toString("base64");
  const gate = fs
    .readFileSync(path.join(__dirname, "gate.html"), "utf8")
    .replace("/*FONT_B64*/", () => font)
    .replace("/*PAYLOAD*/null", () => payload);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, gate);
  console.log(`wrote ${dst} (${Math.round(gate.length / 1024)} KB, encrypted from ${Math.round(html.length / 1024)} KB)`);
})();
