// 00_state.js - Shared state and helpers: the Susp solver handle, number formatting, HTML escaping (esc / attr / cssq), storage.
"use strict";
const S = window.Susp,
  V = S.vec;
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (v, d = 1) =>
  v == null || Number.isNaN(v)
    ? "–"
    : !Number.isFinite(v)
      ? "∞"
      : (+v)
          .toFixed(d)
          .replace(/^-(0\.?0*)$/, "$1")
          .replace("-", "−");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// attr(): any value placed inside an HTML attribute (same escaping as esc; one name so every attribute is easy to audit).
// cssq(): a value placed inside a quoted CSS attribute selector.
const attr = esc;
const cssq = s => String(s).replace(/["\\]/g, "\\$&");

// one-line help for each target row, from the shared schema (schema/metrics.json)
const HELP = Object.fromEntries(
  Object.entries(S.SCHEMA.metrics.corner)
    .filter(([, d]) => d.help)
    .map(([k, d]) => [k, d.help])
);

// ------------------------------------------------------------------ state
let cfg = null,
  ev = null,
  loads = null,
  err = null,
  base = null,
  baseName = "";
let pose = { dz: 0, rack: 0 },
  savedSpring = null,
  savedRocker = null,
  tab = "checks";
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      /* storage blocked */
    }
  },
};

function getPath(o, path) {
  return path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
}
function setPath(o, path, v) {
  const ks = path.split(".");
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (a[ks[i]] == null) a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    a = a[ks[i]];
  }
  a[ks[ks.length - 1]] = v;
}

// work in flight (file reads, move searches): the browser tests wait for window.__suspIdle() instead of sleeping
let busyN = 0;
async function busy(p) {
  busyN++;
  try {
    return await p;
  } finally {
    busyN--;
  }
}
// a Map used as a small cache: the oldest entries go once it holds max of them
function lruSet(map, key, val, max = 40) {
  map.delete(key);
  map.set(key, val);
  while (map.size > max) map.delete(map.keys().next().value);
}
