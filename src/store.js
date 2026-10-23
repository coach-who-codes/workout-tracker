// localStorage persistence plus a realistic 8-week demo programme.
import { addDays, parseDate, weekStart } from "./lifts.js";

const KEYS = { workouts: "liftlog.workouts.v1", draft: "liftlog.draft.v1", demo: "liftlog.demo.v1" };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the app keeps working in memory */
  }
}

export const loadWorkouts = () => read(KEYS.workouts, null);
export const saveWorkouts = (w) => write(KEYS.workouts, w);
export const loadDraft = () => read(KEYS.draft, null);
export const saveDraft = (d) => write(KEYS.draft, d);
export const isDemo = () => read(KEYS.demo, false);
export const setDemo = (flag) => write(KEYS.demo, flag || null);

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const PRESET_EXERCISES = [
  "Bench Press", "Squat", "Deadlift", "Overhead Press", "Barbell Row", "Pull-up",
  "Incline Dumbbell Press", "Romanian Deadlift", "Leg Press", "Lat Pulldown",
  "Dumbbell Shoulder Press", "Triceps Pushdown", "Biceps Curl", "Calf Raise", "Hip Thrust",
];

// Push / Pull / Legs, three days a week. [exercise, start kg, kg added per step, reps, sets]
const PROGRAMME = {
  "Push day": [
    ["Bench Press", 70, 2.5, 6, 4],
    ["Overhead Press", 42.5, 1.25, 8, 3],
    ["Incline Dumbbell Press", 24, 2, 10, 3],
    ["Triceps Pushdown", 30, 2.5, 12, 3],
  ],
  "Pull day": [
    ["Deadlift", 120, 5, 5, 3],
    ["Barbell Row", 60, 2.5, 8, 4],
    ["Lat Pulldown", 55, 2.5, 10, 3],
    ["Biceps Curl", 12, 1, 12, 3],
  ],
  "Leg day": [
    ["Squat", 95, 2.5, 6, 4],
    ["Romanian Deadlift", 80, 2.5, 8, 3],
    ["Leg Press", 160, 10, 10, 3],
    ["Calf Raise", 60, 5, 15, 3],
  ],
};

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Eight weeks of Mon/Wed/Fri sessions ending today, with steady progressive overload. */
export function demoWorkouts(today, weeks = 8) {
  const rand = mulberry32(7);
  const firstMonday = addDays(weekStart(today), -7 * (weeks - 1));
  const days = ["Push day", "Pull day", "Leg day"];
  const workouts = [];

  for (let week = 0; week < weeks; week++) {
    [0, 2, 4].forEach((offset, i) => {
      const date = addDays(firstMonday, week * 7 + offset);
      if (date > today) return;
      if (rand() < 0.08) return; // the odd missed session
      const name = days[i];
      const exercises = PROGRAMME[name].map(([exercise, startKg, step, reps, sets], idx) => {
        // Add weight roughly every ten days; a deload-ish dip in week 5 keeps the chart honest.
        const steps = Math.floor((week * 7 + offset) / 10) - (week === 4 && idx === 0 ? 1 : 0);
        const kg = startKg + step * Math.max(0, steps);
        return {
          name: exercise,
          sets: Array.from({ length: sets }, (_, s) => ({
            kg,
            reps: Math.max(1, reps - (s === sets - 1 && rand() < 0.45 ? 1 + Math.floor(rand() * 2) : 0)),
          })),
        };
      });
      workouts.push({ id: `demo-${date}`, date, name, exercises });
    });
  }
  return workouts;
}

export function exportJSON(workouts) {
  return JSON.stringify({ app: "LiftLog", version: 1, exportedAt: new Date().toISOString(), workouts }, null, 2);
}

/** Accepts the export format (or a bare array) and drops anything malformed. */
export function parseImport(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.workouts;
  if (!Array.isArray(list)) throw new Error("No workouts found in this file");
  return list
    .filter((w) => w && typeof w.date === "string" && !Number.isNaN(parseDate(w.date).getTime()) && Array.isArray(w.exercises))
    .map((w) => ({
      id: String(w.id ?? newId()),
      date: w.date,
      name: String(w.name ?? ""),
      exercises: w.exercises
        .filter((ex) => ex && typeof ex.name === "string" && Array.isArray(ex.sets))
        .map((ex) => ({ name: ex.name, sets: ex.sets.map((s) => ({ kg: Number(s.kg) || 0, reps: Number(s.reps) || 0 })) })),
    }));
}
