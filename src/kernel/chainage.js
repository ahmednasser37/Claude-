// chainage.js — KP-pattern extraction + out-of-sequence detection. Pure.

// Extract a KP/chainage value (in km) from an activity code or name.
// Matches e.g. 'KP515+000' (515.0 km), 'KP 512', 'KP0524+500' (524.5 km).
// No match => null, never a fabricated 0.
export function extractChainage(str) {
  if (!str) return null;
  const m = /KP\s?0*(\d{2,4})(?:\+(\d{3}))?/i.exec(str);
  if (!m) return null;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 1000 : 0);
}

export function taskChainage(task) {
  const fromCode = extractChainage(task.code);
  if (fromCode !== null) return fromCode;
  return extractChainage(task.name);
}

// For every predecessor->successor relationship where both sides carry a
// chainage, flag pairs where the successor sits BEHIND the predecessor
// (assumes the works advance in increasing-KP direction — stated, reviewable
// assumption; this is a repair queue, never an auto-fix).
export function findOutOfSequence(model) {
  const out = [];
  for (const p of model.preds) {
    const pred = model.taskById.get(p.predTaskId);
    const succ = model.taskById.get(p.taskId);
    if (!pred || !succ) continue;
    if (pred.chainage === null || succ.chainage === null) continue;
    if (succ.chainage < pred.chainage) {
      out.push({
        pred, succ, rel: p,
        predKp: pred.chainage, succKp: succ.chainage,
        deltaKm: +(pred.chainage - succ.chainage).toFixed(3),
      });
    }
  }
  out.sort((a, b) => b.deltaKm - a.deltaKm);
  return out;
}
