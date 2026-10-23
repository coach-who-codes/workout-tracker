// Dependency-free SVG line chart for strength progress. Theme colours come from CSS variables.

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Axis bounds rounded to tidy steps so gridlines land on readable numbers. */
export function axisRange(values, step = 5) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  let lo = Math.floor((min - step / 2) / step) * step;
  let hi = Math.ceil((max + step / 2) / step) * step;
  if (lo < 0) lo = 0;
  if (hi === lo) hi = lo + step;
  return [lo, hi];
}

const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);

/**
 * @param {HTMLElement} container
 * @param {{date: string, e1rm: number, top: {kg:number, reps:number}}[]} points
 * @param {Set<string>} prDates dates that set a PR (drawn in the accent colour)
 */
export function renderLineChart(container, points, prDates = new Set()) {
  if (points.length < 2) {
    container.innerHTML = `<p class="chart-empty">Log this lift in at least two sessions to see a trend.</p>`;
    return;
  }
  const W = Math.max(300, Math.round(container.clientWidth || 640));
  const H = W < 480 ? 220 : 260;
  const pad = { top: 16, right: 16, bottom: 28, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const values = points.map((p) => p.e1rm);
  const spread = Math.max(...values) - Math.min(...values);
  const step = spread > 60 ? 20 : spread > 25 ? 10 : 5;
  const [lo, hi] = axisRange(values, step);
  const t0 = toDate(points[0].date).getTime();
  const t1 = toDate(points.at(-1).date).getTime();
  const x = (iso) => pad.left + ((toDate(iso).getTime() - t0) / (t1 - t0 || 1)) * innerW;
  const y = (v) => pad.top + innerH - ((v - lo) / (hi - lo)) * innerH;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "line-chart", role: "img", "aria-label": "Estimated one-rep max over time" });

  // Gridlines on whole steps (5, 10, 20 kg...) with at most six of them.
  let tickStep = step;
  while ((hi - lo) / tickStep > 6) tickStep *= 2;
  for (let v = lo; v <= hi + 1e-9; v += tickStep) {
    svg.append(el("line", { x1: pad.left, x2: W - pad.right, y1: y(v), y2: y(v), class: v === lo ? "axis" : "grid" }));
    svg.append(el("text", { x: pad.left - 8, y: y(v) + 4, "text-anchor": "end", class: "tick" }, Math.round(v)));
  }

  // x labels: first, last and a couple in between, skipping any that would collide
  const labelCount = Math.min(points.length, W < 480 ? 3 : 5);
  let lastX = -Infinity;
  for (let i = 0; i < labelCount; i++) {
    const p = points[Math.round((i / (labelCount - 1)) * (points.length - 1))];
    const px = x(p.date);
    if (px - lastX < 56) continue;
    lastX = px;
    const anchor = i === 0 ? "start" : i === labelCount - 1 ? "end" : "middle";
    svg.append(el("text", { x: px, y: H - 6, "text-anchor": anchor, class: "tick" }, shortDate.format(toDate(p.date))));
  }

  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.e1rm).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.at(-1).date).toFixed(1)},${y(lo)} L${x(points[0].date).toFixed(1)},${y(lo)} Z`;
  svg.append(el("path", { d: area, class: "area" }));
  svg.append(el("path", { d: path, class: "line" }));

  for (const p of points) {
    const isPR = prDates.has(p.date);
    const dot = el("circle", { cx: x(p.date), cy: y(p.e1rm), r: isPR ? 5 : 3.5, class: isPR ? "dot dot--pr" : "dot" });
    dot.append(el("title", {}, `${shortDate.format(toDate(p.date))}: ${p.e1rm} kg est. 1RM (top set ${p.top.kg} kg × ${p.top.reps})${isPR ? " · PR" : ""}`));
    svg.append(dot);
  }

  container.replaceChildren(svg);
}
