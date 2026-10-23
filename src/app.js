// UI layer for LiftLog: state, rendering and events.
import {
  bestE1rm, bestSet, detectPRs, e1rm, exerciseHistory, exerciseNames, formatKg, formatVolume,
  isValidSet, sortWorkouts, todayISO, weeklySummary, workingSets, workoutVolume,
} from "./lifts.js";
import {
  PRESET_EXERCISES, demoWorkouts, exportJSON, isDemo, loadDraft, loadWorkouts, newId, parseImport,
  saveDraft, saveWorkouts, setDemo,
} from "./store.js";
import { renderLineChart } from "./chart.js";

const $ = (s, root = document) => root.querySelector(s);
const today = todayISO();
const emptyDraft = () => ({ name: "", date: today, exercises: [] });

const state = {
  workouts: [],
  draft: loadDraft() ?? emptyDraft(),
  tab: "log",
  progressExercise: null,
};

// First visit: show a populated app instead of an empty screen.
const stored = loadWorkouts();
if (stored) {
  state.workouts = stored;
} else {
  state.workouts = demoWorkouts(today);
  saveWorkouts(state.workouts);
  setDemo(true);
}

const longDate = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDate = (iso) => longDate.format(new Date(`${iso}T00:00:00Z`));

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function persistWorkouts() {
  saveWorkouts(state.workouts);
}

function persistDraft() {
  saveDraft(state.draft);
}

// ---------- stats ----------

function renderStats() {
  const s = weeklySummary(state.workouts, today);
  $("#stat-sessions").textContent = s.sessions;
  $("#stat-volume").textContent = formatVolume(s.volume);
  $("#stat-streak").textContent = `${s.streak} wk${s.streak === 1 ? "" : "s"}`;
  $("#demo-banner").hidden = !isDemo();
}

// ---------- log tab ----------

function previousBest(name) {
  return bestE1rm(state.workouts, name, state.draft.date);
}

function setRowHTML(set, i, prevBest) {
  const est = e1rm(set.kg, set.reps);
  const pr = prevBest > 0 && est > prevBest;
  return `
    <div class="set" data-set="${i}">
      <span class="set__num">${i + 1}</span>
      <input type="number" inputmode="decimal" min="0" step="0.5" value="${set.kg || ""}" data-field="kg" aria-label="Set ${i + 1} weight in kg" placeholder="0">
      <input type="number" inputmode="numeric" min="0" step="1" value="${set.reps || ""}" data-field="reps" aria-label="Set ${i + 1} reps" placeholder="0">
      <span class="set__est">${est ? formatKg(est) : "–"}${pr ? ' <b class="pr">PR</b>' : ""}</span>
      <button class="icon-btn icon-btn--sm" type="button" data-action="remove-set" aria-label="Remove set ${i + 1}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>
      </button>
    </div>`;
}

function renderDraft() {
  $("#session-name").value = state.draft.name;
  $("#session-date").value = state.draft.date;
  $("#session-date").max = today;

  const list = $("#exercise-list");
  const tpl = $("#exercise-template");
  list.replaceChildren();
  if (!state.draft.exercises.length) list.innerHTML = quickStartHTML();
  state.draft.exercises.forEach((ex, exIndex) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.ex = exIndex;
    const prev = previousBest(ex.name);
    $(".exercise__name", node).textContent = ex.name;
    $(".exercise__best", node).textContent = prev ? `Best ${formatKg(prev)}` : "First time logged";
    $(".sets__rows", node).innerHTML = ex.sets.map((s, i) => setRowHTML(s, i, prev)).join("");
    list.append(node);
  });
  renderDraftSummary();
}

/** Empty log: offer the most recent session of each workout type as a one-tap template. */
function quickStartHTML() {
  const seen = new Set();
  const recent = sortWorkouts(state.workouts).reverse().filter((w) => !seen.has(w.name) && seen.add(w.name)).slice(0, 3);
  if (!recent.length) return `<p class="empty">Add your first exercise below to start logging.</p>`;
  return `
    <div class="card quick">
      <h3>Start from a recent workout</h3>
      <div class="quick__list">
        ${recent.map((w) => `
          <button type="button" class="quick__item" data-repeat="${escapeHTML(w.id)}">
            <strong>${escapeHTML(w.name)}</strong>
            <span class="muted">${w.exercises.length} exercises · last ${fmtDate(w.date)}</span>
          </button>`).join("")}
      </div>
      <p class="muted quick__or">or add exercises one by one below</p>
    </div>`;
}

function renderDraftSummary() {
  const sets = workingSets(state.draft);
  const volume = workoutVolume(state.draft);
  $("#draft-summary").textContent = sets
    ? `${sets} working set${sets === 1 ? "" : "s"} · ${formatVolume(volume)} lifted`
    : state.draft.exercises.length ? "Enter weight and reps to count a set." : "No sets logged yet.";
  $("#finish-workout").disabled = sets === 0;
}

function updateSetRow(exIndex, setIndex) {
  const ex = state.draft.exercises[exIndex];
  const row = $(`[data-ex="${exIndex}"] [data-set="${setIndex}"]`);
  const set = ex.sets[setIndex];
  const est = e1rm(set.kg, set.reps);
  const prev = previousBest(ex.name);
  $(".set__est", row).innerHTML = `${est ? formatKg(est) : "–"}${prev > 0 && est > prev ? ' <b class="pr">PR</b>' : ""}`;
  renderDraftSummary();
}

function addExercise(rawName) {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) return;
  // Match an existing name case-insensitively so "bench press" joins "Bench Press" history.
  const known = [...exerciseNames(state.workouts), ...PRESET_EXERCISES].find((n) => n.toLowerCase() === name.toLowerCase());
  const finalName = known ?? name.replace(/\b\w/g, (c) => c.toUpperCase());
  // Pre-fill the first set with what was lifted last time.
  const last = exerciseHistory(state.workouts, finalName).at(-1);
  state.draft.exercises.push({ name: finalName, sets: [last ? { kg: last.top.kg, reps: last.top.reps } : { kg: 0, reps: 0 }] });
  persistDraft();
  renderDraft();
  const inputs = document.querySelectorAll(`[data-ex="${state.draft.exercises.length - 1}"] input`);
  inputs[0]?.focus();
}

function finishWorkout() {
  const exercises = state.draft.exercises
    .map((ex) => ({ name: ex.name, sets: ex.sets.filter(isValidSet).map((s) => ({ kg: Number(s.kg), reps: Number(s.reps) })) }))
    .filter((ex) => ex.sets.length);
  if (!exercises.length) return;

  const workout = {
    id: newId(),
    date: state.draft.date || today,
    name: state.draft.name.trim() || "Workout",
    exercises,
  };
  state.workouts = [...state.workouts, workout];
  const prs = detectPRs(state.workouts).get(workout.id) ?? [];
  persistWorkouts();
  state.draft = emptyDraft();
  persistDraft();
  renderDraft();
  renderStats();
  toast(prs.length ? `Saved · new PR on ${prs.join(", ")}` : "Workout saved");
  switchTab("history");
}

function repeatWorkout(id) {
  const w = state.workouts.find((x) => x.id === id);
  if (!w) return;
  state.draft = {
    name: w.name,
    date: today,
    exercises: w.exercises.map((ex) => ({ name: ex.name, sets: ex.sets.map((s) => ({ ...s })) })),
  };
  persistDraft();
  renderDraft();
  switchTab("log");
  toast(`Loaded ${w.name}. Adjust the numbers and save.`);
}

// ---------- history tab ----------

function renderHistory() {
  const prs = detectPRs(state.workouts);
  const list = sortWorkouts(state.workouts).reverse();
  $("#history-empty").hidden = list.length > 0;
  $("#history-list").innerHTML = list
    .map((w) => {
      const hits = prs.get(w.id) ?? [];
      const exercises = w.exercises
        .map((ex) => {
          const top = bestSet(ex.sets);
          const isPR = hits.includes(ex.name);
          const sets = ex.sets.map((s) => `${s.kg}×${s.reps}`).join(" · ");
          return `<li><span class="ex-name">${escapeHTML(ex.name)}${isPR ? ' <b class="pr">PR</b>' : ""}</span>
            <span class="ex-sets">${sets}</span>
            <span class="ex-top">${top ? formatKg(top.e1rm) : ""}</span></li>`;
        })
        .join("");
      return `
      <li class="card workout" data-id="${escapeHTML(w.id)}">
        <header class="workout__head">
          <div>
            <h3>${escapeHTML(w.name)}</h3>
            <p class="muted">${fmtDate(w.date)}</p>
          </div>
          <div class="chips">
            <span class="chip">${workingSets(w)} sets</span>
            <span class="chip">${formatVolume(workoutVolume(w))}</span>
            ${hits.length ? `<span class="chip chip--pr">${hits.length} PR${hits.length > 1 ? "s" : ""}</span>` : ""}
          </div>
        </header>
        <ul class="workout__exercises">${exercises}</ul>
        <div class="workout__actions">
          <button class="btn btn--small" type="button" data-action="repeat">Repeat workout</button>
          <button class="link link--danger" type="button" data-action="delete">Delete</button>
        </div>
      </li>`;
    })
    .join("");
}

// ---------- progress tab ----------

function renderProgress() {
  const names = exerciseNames(state.workouts);
  const select = $("#progress-exercise");
  if (!names.includes(state.progressExercise)) state.progressExercise = names[0] ?? null;
  select.innerHTML = names.map((n) => `<option ${n === state.progressExercise ? "selected" : ""}>${escapeHTML(n)}</option>`).join("");

  const chart = $("#progress-chart");
  if (!state.progressExercise) {
    chart.innerHTML = `<p class="chart-empty">Log a workout to see your progress here.</p>`;
    for (const id of ["best", "heaviest", "change", "sessions"]) $(`#kpi-${id}`).textContent = "–";
    return;
  }

  const name = state.progressExercise;
  const points = exerciseHistory(state.workouts, name);
  const prs = detectPRs(state.workouts);
  const prDates = new Set(points.filter((p) => prs.get(p.workoutId)?.includes(name)).map((p) => p.date));

  const best = Math.max(...points.map((p) => p.e1rm));
  const heaviest = points.reduce((a, p) => (p.top.kg > a.kg ? p.top : a), { kg: 0, reps: 0 });
  const first = points[0].e1rm;
  const last = points.at(-1).e1rm;
  const diff = last - first;

  $("#kpi-best").textContent = formatKg(best);
  $("#kpi-heaviest").textContent = `${formatKg(heaviest.kg)} × ${heaviest.reps}`;
  const change = $("#kpi-change");
  change.textContent = points.length > 1 ? `${diff >= 0 ? "+" : "−"}${formatKg(Math.abs(diff))} (${diff >= 0 ? "+" : "−"}${Math.round(Math.abs(diff / first) * 100)}%)` : "–";
  change.dataset.trend = diff > 0 ? "up" : diff < 0 ? "down" : "";
  $("#kpi-sessions").textContent = points.length;

  renderLineChart(chart, points, prDates);
}

// ---------- tabs ----------

function switchTab(tab) {
  state.tab = tab;
  for (const btn of document.querySelectorAll("[role=tab]")) {
    const on = btn.dataset.tab === tab;
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[role=tabpanel]")) panel.hidden = panel.id !== `panel-${tab}`;
  if (window.scrollY > 0) window.scrollTo({ top: 0 });
  if (tab === "history") renderHistory();
  if (tab === "progress") renderProgress();
}

// ---------- misc ----------

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-visible"), 2800);
}

/** Two-tap confirmation without a blocking browser dialog. Returns true on the second tap. */
function confirmTap(btn, label = "Tap again to confirm") {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = "1";
  const original = btn.textContent;
  btn.textContent = label;
  setTimeout(() => {
    delete btn.dataset.armed;
    btn.textContent = original;
  }, 3000);
  return false;
}

function replaceWorkouts(workouts, demo) {
  state.workouts = workouts;
  setDemo(demo);
  persistWorkouts();
  renderStats();
  renderDraft();
  switchTab(state.tab);
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try {
    localStorage.setItem("liftlog.theme", root.dataset.theme);
  } catch { /* ignore */ }
}

// ---------- events ----------

function init() {
  try {
    const theme = localStorage.getItem("liftlog.theme");
    if (theme) document.documentElement.dataset.theme = theme;
  } catch { /* ignore */ }

  $("#theme-toggle").addEventListener("click", toggleTheme);

  const tablist = $(".tabs");
  tablist.addEventListener("click", (e) => {
    const btn = e.target.closest("[role=tab]");
    if (btn) switchTab(btn.dataset.tab);
  });
  tablist.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const tabs = [...tablist.querySelectorAll("[role=tab]")];
    const i = tabs.findIndex((t) => t.dataset.tab === state.tab);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    switchTab(next.dataset.tab);
    next.focus();
  });

  // Log tab
  $("#session-name").addEventListener("input", (e) => { state.draft.name = e.target.value; persistDraft(); });
  $("#session-date").addEventListener("change", (e) => { state.draft.date = e.target.value || today; persistDraft(); renderDraft(); });

  $("#add-exercise-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addExercise($("#exercise-input").value);
    $("#exercise-input").value = "";
  });

  const list = $("#exercise-list");
  list.addEventListener("input", (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const exIndex = Number(e.target.closest("[data-ex]").dataset.ex);
    const setIndex = Number(e.target.closest("[data-set]").dataset.set);
    state.draft.exercises[exIndex].sets[setIndex][field] = e.target.value === "" ? 0 : Number(e.target.value);
    persistDraft();
    updateSetRow(exIndex, setIndex);
  });
  list.addEventListener("click", (e) => {
    const quick = e.target.closest("[data-repeat]");
    if (quick) return repeatWorkout(quick.dataset.repeat);
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const exIndex = Number(btn.closest("[data-ex]").dataset.ex);
    const ex = state.draft.exercises[exIndex];
    if (btn.dataset.action === "add-set") ex.sets.push({ ...(ex.sets.at(-1) ?? { kg: 0, reps: 0 }) });
    if (btn.dataset.action === "remove-set") ex.sets.splice(Number(btn.closest("[data-set]").dataset.set), 1);
    if (btn.dataset.action === "remove-exercise" || !ex.sets.length) state.draft.exercises.splice(exIndex, 1);
    persistDraft();
    renderDraft();
  });

  $("#finish-workout").addEventListener("click", finishWorkout);

  // History tab
  $("#history-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    if (btn.dataset.action === "repeat") repeatWorkout(id);
    if (btn.dataset.action === "delete" && confirmTap(btn, "Tap again to delete")) {
      state.workouts = state.workouts.filter((w) => w.id !== id);
      persistWorkouts();
      renderHistory();
      renderStats();
      toast("Workout deleted");
    }
  });

  // Progress tab
  $("#progress-exercise").addEventListener("change", (e) => { state.progressExercise = e.target.value; renderProgress(); });
  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.tab === "progress") renderProgress(); }, 120);
  }).observe($("#progress-chart"));

  // Data
  $("#clear-demo").addEventListener("click", () => {
    replaceWorkouts([], false);
    toast("Demo data cleared. Time to log your own.");
  });
  $("#load-demo").addEventListener("click", (e) => {
    if (!isDemo() && state.workouts.length && !confirmTap(e.currentTarget, "This replaces your data. Tap again")) return;
    replaceWorkouts(demoWorkouts(today), true);
    toast("Demo data loaded");
  });
  $("#export-json").addEventListener("click", () => {
    const blob = new Blob([exportJSON(state.workouts)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `liftlog-backup-${today}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#import-json").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const workouts = parseImport(await file.text());
      replaceWorkouts(workouts, false);
      toast(`Imported ${workouts.length} workout${workouts.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast(`Couldn't import: ${err.message}`);
    }
    e.target.value = "";
  });

  $("#exercise-options").innerHTML = [...new Set([...exerciseNames(state.workouts), ...PRESET_EXERCISES])]
    .map((n) => `<option value="${escapeHTML(n)}"></option>`).join("");

  renderStats();
  renderDraft();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ });
  }
}

init();
