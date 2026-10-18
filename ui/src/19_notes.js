// 19_notes.js - Long explanatory notes in the result panels start folded to two lines, with "More" to open them, so the
// tables come first. A note stays open across re-solves (keyed by its opening words).
const NOTE_FOLD_AT = 300,
  notesOpen = new Set();
const noteKey = el => el.textContent.trim().slice(0, 60);
function foldNotes() {
  for (const el of $$("#panels p.note, #carBox p.note, #layBox p.note")) {
    if (el.dataset.fold || el.closest(".ovcap, .pvbar")) continue;
    if (el.textContent.length < NOTE_FOLD_AT) continue;
    el.dataset.fold = "1";
    const k = noteKey(el),
      btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lnk notemore";
    const set = open => {
      el.classList.toggle("folded", !open);
      btn.textContent = open ? "Less" : "More";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    set(notesOpen.has(k));
    btn.addEventListener("click", () => {
      const open = el.classList.contains("folded");
      if (open) notesOpen.add(k);
      else notesOpen.delete(k);
      set(open);
    });
    el.after(btn);
  }
}
{
  let t = null;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(foldNotes, 0);
  }).observe(document.body, { childList: true, subtree: true });
}
