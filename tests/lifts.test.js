import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestE1rm, bestSet, detectPRs, e1rm, exerciseHistory, exerciseNames, formatVolume, weekStart,
  weekStreak, weeklySummary, workoutVolume, workingSets,
} from "../src/lifts.js";
import { demoWorkouts, parseImport } from "../src/store.js";

const w = (id, date, exercises) => ({ id, date, name: "Session", exercises });
const ex = (name, ...sets) => ({ name, sets: sets.map(([kg, reps]) => ({ kg, reps })) });

test("e1rm follows Epley and rounds to 0.5 kg", () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(e1rm(100, 5), 116.5); // 116.67 -> 116.5
  assert.equal(e1rm(60, 10), 80);
  assert.equal(e1rm(0, 5), 0);
  assert.equal(e1rm(80, 0), 0);
  assert.equal(e1rm("70", "6"), 84, "accepts numeric strings from inputs");
});

test("volume and working sets ignore empty sets", () => {
  const session = w("a", "2026-10-20", [ex("Squat", [100, 5], [100, 5], [0, 5]), ex("Curl", [12, 12])]);
  assert.equal(workoutVolume(session), 100 * 5 * 2 + 12 * 12);
  assert.equal(workingSets(session), 3);
});

test("bestSet picks the highest estimated 1RM, heavier weight on a tie", () => {
  assert.deepEqual(bestSet([{ kg: 100, reps: 5 }, { kg: 105, reps: 3 }, { kg: 0, reps: 10 }]), { kg: 100, reps: 5, e1rm: 116.5 });
  assert.deepEqual(bestSet([{ kg: 90, reps: 10 }, { kg: 100, reps: 6 }]), { kg: 100, reps: 6, e1rm: 120 });
  assert.equal(bestSet([{ kg: 0, reps: 0 }]), null);
});

test("weekStart returns Monday, including for Sundays", () => {
  assert.equal(weekStart("2026-10-24"), "2026-10-19"); // Saturday
  assert.equal(weekStart("2026-10-25"), "2026-10-19"); // Sunday
  assert.equal(weekStart("2026-10-19"), "2026-10-19"); // Monday
});

const history = [
  w("1", "2026-10-05", [ex("Bench Press", [80, 5])]),
  w("2", "2026-10-08", [ex("Bench Press", [82.5, 5]), ex("Squat", [100, 5])]),
  w("3", "2026-10-12", [ex("Bench Press", [80, 5])]),
  w("4", "2026-10-15", [ex("Bench Press", [85, 5]), ex("Squat", [105, 5])]),
];

test("detectPRs flags sessions that beat every earlier one, not first appearances", () => {
  const prs = detectPRs(history);
  assert.equal(prs.has("1"), false);
  assert.deepEqual(prs.get("2"), ["Bench Press"]);
  assert.equal(prs.has("3"), false);
  assert.deepEqual(prs.get("4"), ["Bench Press", "Squat"]);
});

test("detectPRs does not depend on the order workouts were saved in", () => {
  assert.deepEqual([...detectPRs([...history].reverse())], [...detectPRs(history)]);
});

test("exerciseHistory and bestE1rm", () => {
  const bench = exerciseHistory(history, "Bench Press");
  assert.deepEqual(bench.map((p) => p.date), ["2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"]);
  assert.equal(bench[1].top.kg, 82.5);
  assert.equal(bestE1rm(history, "Bench Press"), e1rm(85, 5));
  assert.equal(bestE1rm(history, "Bench Press", "2026-10-15"), e1rm(82.5, 5), "only counts earlier sessions");
  assert.equal(bestE1rm(history, "Deadlift"), 0);
});

test("exerciseNames sorts by frequency", () => {
  assert.deepEqual(exerciseNames(history), ["Bench Press", "Squat"]);
});

test("weekStreak counts consecutive training weeks and tolerates an empty current week", () => {
  const sessions = [w("a", "2026-10-01", []), w("b", "2026-10-07", []), w("c", "2026-10-14", [])];
  assert.equal(weekStreak(sessions, "2026-10-17"), 3); // weeks of 28 Sep, 5 Oct, 12 Oct
  assert.equal(weekStreak(sessions, "2026-10-19"), 3, "Monday with no session yet keeps the streak");
  assert.equal(weekStreak(sessions, "2026-10-27"), 0, "a full missed week breaks it");
});

test("weeklySummary only counts this week up to today", () => {
  const sessions = [
    w("a", "2026-10-18", [ex("Squat", [100, 5])]), // last week (Sunday)
    w("b", "2026-10-20", [ex("Squat", [100, 5])]),
    w("c", "2026-10-22", [ex("Bench Press", [80, 5])]),
  ];
  assert.deepEqual(weeklySummary(sessions, "2026-10-24"), { sessions: 2, volume: 900, streak: 2 });
});

test("formatVolume switches to tonnes", () => {
  assert.equal(formatVolume(950), "950 kg");
  assert.equal(formatVolume(12_460), "12.5 t");
});

test("demo programme is consistent and progresses", () => {
  const demo = demoWorkouts("2026-10-24");
  assert.ok(demo.length >= 20);
  assert.ok(demo.every((d) => d.date <= "2026-10-24"));
  const squat = exerciseHistory(demo, "Squat");
  assert.ok(squat.at(-1).e1rm > squat[0].e1rm, "strength goes up over the block");
  assert.ok(detectPRs(demo).size > 5);
});

test("parseImport accepts the export format and drops malformed rows", () => {
  const text = JSON.stringify({
    workouts: [
      { id: "x", date: "2026-10-01", name: "Push", exercises: [{ name: "Bench Press", sets: [{ kg: "80", reps: 5 }] }] },
      { date: "not-a-date", exercises: [] },
      { id: "y", date: "2026-10-02" },
    ],
  });
  const result = parseImport(text);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].exercises[0].sets[0], { kg: 80, reps: 5 });
  assert.throws(() => parseImport('{"foo": 1}'), /No workouts/);
});
