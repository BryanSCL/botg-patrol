# BotG Patrol: Spot the Contact Risk

A self-contained, mobile-first browser game built for a Google Data Centre
safety campaign on **Bodily Contact** hazards. Built with plain HTML, CSS,
and JavaScript — no external libraries, fonts, or images.

## How to run

1. Open `index.html` directly in any modern browser (Chrome, Edge, Firefox) —
   desktop or mobile. Double-clicking the file works — the game has no
   build step and makes no network requests.
2. Click/tap **Start Patrol** and play.

If your browser blocks local-file features (rare, since this game uses no
`fetch`/modules), serve the folder with any static file server instead, e.g.
`npx serve .` or `python -m http.server`, and open the printed `localhost` URL.

Files:
- `index.html` — page structure, HUD, touch controls, start/hazard/end screens
- `style.css` — mobile-first styling, portrait stage, touch-control layout
- `script.js` — game logic (map, hazards, movement, scoring, rendering)

## Designed for phones

- The play area is a **portrait** canvas (480×760) sized for a phone held
  upright — no rotation needed.
- **Touch controls**: an on-screen D-pad (move) and a circular INSPECT
  button appear automatically on touch devices, overlaid on the bottom of
  the play field. Desktop keeps the clean keyboard-only UI (no on-screen
  buttons shown).
- Buttons and tap targets are sized for thumbs (44px+ touch targets).
- The stage scales to fit narrow screens and the whole session — briefing,
  patrol, and results — is designed to complete in **under 2 minutes**.

## Game mechanics

- **Goal:** patrol a data centre floor, find all 8 Bodily Contact hazards,
  and log the sharpest BotG observation for each before the 1-minute timer
  runs out.
- **Movement:** `WASD`/Arrow Keys on desktop, or the on-screen D-pad on
  touch devices — 8-directional, with collision against walls, server
  racks, crates, and equipment.
- **Inspect a hazard:** walk within range of a pulsing warning marker (it
  turns yellow once you're close enough) and press `SPACE`/`ENTER`, tap the
  INSPECT button, or click the marker directly.
- **Answer the question:** each hazard asks *"What should be logged in
  BotG?"* with 3 options:
  - Correct, specific observation → **+10**
  - Vague/partially correct observation → **+5**
  - Wrong/irrelevant observation → **+0**
  - Instant feedback explains *why* it's a Bodily Contact risk (or what the
    real risk was), plus which official sub-category it maps to.
  - Answered hazards turn into a green checkmark and can't be re-inspected.
- **Vehicle Pathway:** a forklift and a people-carrier continuously patrol a
  strip across the middle of the map. Walking into one costs 2 seconds off
  the clock — a small, on-theme penalty that reinforces "if energy can
  reach you, you're too close," with a brief invulnerability window so it
  never feels unfair.
- **Timer & scoring:** 1:00 countdown (pauses while a hazard card is open,
  so reading time isn't punished), live score, and hazards-found counter in
  the HUD.
- **Congratulations screen:** if you log all 8 hazards before time runs out,
  you get a dedicated 🎉 **Congratulations!** screen instead of the neutral
  "Time's Up" ending, along with your score, accuracy, and rating:
  - **80–100%** → BotG Safety Champion
  - **50–79%** → Sharp Observer
  - **Below 50%** → Needs More Floor Awareness

## Hazards included (8) and their Bodily Contact sub-category

Mapped from the BotG Guidance "Bodily Contact" reference. Trimmed from a
wider 12-hazard set down to the 8 most distinct, high-value scenarios for a
fast phone session — no two hazards teach the same lesson.

| # | Hazard (in-game) | Zone | Bodily Contact sub-category |
|---|---|---|---|
| H1 | Sharp edge on open server rack panel | Server Rack Aisle | Contact with Sharp Objects |
| H2 | Missing guard on cooling fan | Server Rack Aisle | Contact with Rotating Machinery/Parts |
| H3 | Worker standing under a suspended load | Loading Area | Falling Objects |
| H6 | Equipment not locked out (LOTO) before repair | Maintenance Area | Caught In/Between Objects |
| H7 | Hot exhaust pipe with no warning signage | Maintenance Area | Contact with Hot/Cold Objects |
| H9 | Chemical container missing a label | Chemical Storage Corner | Contact with Chemical |
| H11 | Pedestrian in a forklift's blind spot | Vehicle Pathway | Contact with Moving Equipment |
| H12 | Pedestrian crossing without checking traffic | Vehicle Pathway | Contact with Moving Vehicle |

## Educational goals reinforced

- Bodily Contact spans many distinct sub-categories, not just "getting hit by
  something."
- Hazards are usually visible *before* an incident — the game rewards
  noticing them early.
- A good BotG observation names the specific unsafe condition or behaviour,
  not a vague generality (reflected directly in the +10/+5/0 scoring).
- Small, easily-missed details (a missing label, an unmarked hot pipe, a
  blind spot) are exactly what serious incidents trace back to.

## Customizing

All game content lives in arrays near the top of `script.js`:
- `OBSTACLES` / `PEDESTRIANS` — the physical layout/props of the floor.
- `HAZARDS` — each hazard's scenario, zone, sub-category, and 3 answer
  options with feedback text.

`GAME_DURATION`, `PLAYER_SPEED`, and `COLLISION_PENALTY` are top-level
constants in `script.js` if you want to retune difficulty or pacing.
