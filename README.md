# PRISM — Field Ledger

A client-only, offline-first analytics tool for Primavera P6 `.xer` exports:
schedule health (the real DCMA 14-Point Assessment), cost-weighted WBS rollup,
Gantt, EVM cost curves, chainage/out-of-sequence review, resource histograms,
and baseline comparison. Built from scratch against the public XER format and
the published DCMA-14 / PMI-EVM formulas.

**The one rule everything serves: never fabricate a number.** Missing fields
render as an explicit `N/A — <reason>`, never a placeholder zero. A single XER
file carries one time-phased *plan* and one snapshot of *actuals* — PV is a
full curve; EV and AC are exactly one point each, at the data date.

## Run it

- **Single file:** open `dist/prism.html` in any browser. No server, no
  network, no telemetry. It boots with a bundled demo project; `Load .xer…`
  replaces it with yours.
- **Dev:** `npm run serve` and open `http://localhost:8080/app.html`
  (ES modules need HTTP, not `file://`).

## Layout

```
src/kernel/    pure functions — no DOM, no imports outside the kernel
  xer-parser   %T/%F/%R parsing; split tables append; '' ≠ 0
  calendar     clndr_data grammar, Lotus-serial exceptions, working-day math
  model        one in-memory model every view reads
  cpm          real forward/backward pass (drives DCMA check 12)
  dcma         the 14 checks; baseline-dependent ones return honest N/A
  evm          PV curve + single-point EV/AC, SPI/CPI/EAC/TCPI
  wbs          cost-weighted rollup at the data date
  chainage     KP extraction + out-of-sequence repair queue
  resource     demand buckets; over-allocation only where a ceiling exists
  compare      baseline diff matched by task_code
src/ui/        tokens.css (Field Ledger), modal (focus-trapped), components
src/views/     command, wbs, health, gantt, chainage, scurve, resource, compare
tools/         make-fixture.js · build.js · smoke.js
tests/         node --test unit suite, hand-derived expectations
```

Views never call `parseXER`/`buildModel` — only the store does, and views
subscribe to its change event.

## Documented conventions

- **Data date proxy:** XER has no `data_date` field. `last_schedule_date` is
  preferred; `last_recalc_date` is the fallback (it can be stamped at baseline
  creation, before the schedule starts). The source is shown in the UI.
- **Calendar fallback:** an unresolvable `clndr_id` falls back to Mon–Fri 8h,
  and says so.
- **CPM simplification:** the pass runs on logic alone (working-day units,
  original durations, lags at the project calendar's day length) — a logic
  integrity model for DCMA check 12, not a progress-retained reschedule.
  File float remains the source of truth for float-based checks.
- **Over-allocation tolerance:** breaches under 5% over the ceiling are not
  flagged (calendar half-days compress hour density slightly).
- **Chainage direction:** out-of-sequence assumes works advance in
  increasing-KP direction; the queue is reviewable, never auto-fixed.
- **Deferred, not faked:** Monte Carlo, Portfolio, Risk Register — a single
  XER carries none of that structure, so the views don't exist rather than
  pretending.

## Commands

```
npm test          # kernel unit tests (hand-derived expected values)
npm run fixtures  # regenerate the demo XER pair + embedded browser copy
npm run build     # bundle dist/prism.html (self-contained, offline)
npm run smoke     # real-browser click-through incl. 390×844 drawer test
```
