// Pure training logic: strength estimates, PR detection and weekly stats.
// No DOM access, so everything here is covered by unit tests in /tests.

const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, "0");

// ---------- dates (ISO yyyy-mm-dd, calculated in UTC) ----------

export const parseDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const toISO = (date) => date.toISOString().slice(0, 10);
export const todayISO = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const addDays = (iso, n) => toISO(new Date(parseDate(iso).getTime() + n * DAY_MS));
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY_MS);

/** Monday of the week that contains `iso`. */
export function weekStart(iso) {
  const day = parseDate(iso).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((day + 6) % 7));
}

// ---------- sets ----------

/** A set counts only when both weight and reps are positive numbers. */
export const isValidSet = (s) => Number(s.kg) > 0 && Number(s.reps) > 0;

/**
 * Estimated one-rep max using the Epley formula: kg × (1 + reps / 30).
 * Rounded to the nearest 0.5 kg, the smallest plate jump most gyms have.
 */
export function e1rm(kg, reps) {
  kg = Number(kg);
  reps = Number(reps);
  if (!(kg > 0) || !(reps > 0)) return 0;
  const raw = reps === 1 ? kg : kg * (1 + reps / 30);
  return Math.round(raw * 2) / 2;
}

export const setVolume = (s) => (isValidSet(s) ? Number(s.kg) * Number(s.reps) : 0);
export const exerciseVolume = (ex) => ex.sets.reduce((sum, s) => sum + setVolume(s), 0);
export const workoutVolume = (w) => w.exercises.reduce((sum, ex) => sum + exerciseVolume(ex), 0);
export const workingSets = (w) => w.exercises.reduce((n, ex) => n + ex.sets.filter(isValidSet).length, 0);

export function bestSet(sets) {
  let best = null;
  for (const s of sets) {
    if (!isValidSet(s)) continue;
    const est = e1rm(s.kg, s.reps);
    if (!best || est > best.e1rm || (est === best.e1rm && Number(s.kg) > best.kg)) {
      best = { kg: Number(s.kg), reps: Number(s.reps), e1rm: est };
    }
  }
  return best;
}

// ---------- history & records ----------

const byDate = (a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id));
export const sortWorkouts = (workouts) => [...workouts].sort(byDate);

/** One point per session for an exercise, oldest first. */
export function exerciseHistory(workouts, name) {
  const points = [];
  for (const w of sortWorkouts(workouts)) {
    const sets = w.exercises.filter((ex) => ex.name === name).flatMap((ex) => ex.sets);
    const best = bestSet(sets);
    if (!best) continue;
    points.push({
      workoutId: w.id,
      date: w.date,
      e1rm: best.e1rm,
      top: best,
      heaviest: Math.max(...sets.filter(isValidSet).map((s) => Number(s.kg))),
      volume: sets.reduce((sum, s) => sum + setVolume(s), 0),
    });
  }
  return points;
}

/** Best estimated 1RM for an exercise from sessions strictly before `beforeDate` (or all, if omitted). */
export function bestE1rm(workouts, name, beforeDate) {
  const history = exerciseHistory(workouts, name).filter((p) => !beforeDate || p.date < beforeDate);
  return history.reduce((max, p) => Math.max(max, p.e1rm), 0);
}

/**
 * Walks history in order and returns a Map of workoutId -> exercise names that beat
 * every earlier session. The first time an exercise appears is a baseline, not a PR.
 */
export function detectPRs(workouts) {
  const best = new Map();
  const prs = new Map();
  for (const w of sortWorkouts(workouts)) {
    const hits = [];
    for (const ex of w.exercises) {
      const top = bestSet(ex.sets);
      if (!top) continue;
      const previous = best.get(ex.name);
      if (previous !== undefined && top.e1rm > previous) hits.push(ex.name);
      if (previous === undefined || top.e1rm > previous) best.set(ex.name, top.e1rm);
    }
    if (hits.length) prs.set(w.id, hits);
  }
  return prs;
}

/** Exercise names ordered by how often they were trained. */
export function exerciseNames(workouts) {
  const counts = new Map();
  for (const w of workouts) for (const ex of w.exercises) counts.set(ex.name, (counts.get(ex.name) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
}

// ---------- weekly stats ----------

/**
 * Consecutive weeks (Mon-Sun) with at least one workout. The current week only
 * breaks the streak once it is over, so a Monday with no session yet keeps it alive.
 */
export function weekStreak(workouts, today) {
  const weeks = new Set(workouts.map((w) => weekStart(w.date)));
  let cursor = weekStart(today);
  if (!weeks.has(cursor)) cursor = addDays(cursor, -7);
  let streak = 0;
  while (weeks.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

export function weeklySummary(workouts, today) {
  const start = weekStart(today);
  const thisWeek = workouts.filter((w) => w.date >= start && w.date <= today);
  return {
    sessions: thisWeek.length,
    volume: thisWeek.reduce((sum, w) => sum + workoutVolume(w), 0),
    streak: weekStreak(workouts, today),
  };
}

// ---------- formatting ----------

export function formatKg(kg) {
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1)} kg`;
}

export function formatVolume(kg) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(kg >= 100_000 ? 0 : 1)} t`;
  return `${Math.round(kg)} kg`;
}
