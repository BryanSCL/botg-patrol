# Server Sprint: Race the Risk

A fast-paced retro pixel-art **first-person** lane-runner built for a Google Data Centre
**BotG safety campaign** on **Bodily Contact** hazards. The player answers an urgent
server alert and sprints through five site zones, learning through play that
*different hazards demand different responses*.

The view is first-person: the corridor converges at a vanishing point, hazards grow as
they rush toward you, the camera rises when you jump, drops when you duck (the hard-hat
brim lowers over the view), and your hi-vis arms pump as you run.

**Languages:** English, 繁體中文 (Traditional Chinese), ไทย (Thai), 日本語 (Japanese) —
selectable on the menu screen; the choice is remembered per device. All gameplay text,
hazard coaching, rapid decisions, the video quiz, and the report are translated. To edit
translations, see the `I18N` dictionary at the top of `script.js` (section 4c).

No build step, no dependencies, no internet required — everything (art and audio) is
generated in code.

---

## How to run

1. Open `index.html` in **Google Chrome** (double-click it, or drag it into a Chrome window).
2. Enter an Operator ID (initials) and press **START SPRINT** (or Spacebar).
3. For a campaign booth: click the **⛶** button (top-right) for full screen. The game
   letterboxes itself to any 16:9 display automatically.

The **🔊** button mutes/unmutes all sound and music.

---

## Controls

| Input | Action |
|---|---|
| ← / A | Move one lane left |
| → / D | Move one lane right |
| ↑ / W | Jump |
| ↓ / S | Duck (hold) |
| 1 / 2 / 3 (or click) | Answer a Rapid Decision |
| Spacebar | Start / restart from menu and report screens |
| On-screen buttons | Appear automatically on touch devices |

---

## Game rules

- A run lasts **90 seconds maximum** and passes seamlessly through:
  **Warehouse → Server Hall → Loading Bay → Maintenance Area → Plant Room**.
- You have **3 lives** (hard hats, top-right). Each hazard contact costs one; on the
  third contact the run ends with your name and total score on the report screen.
- Speed and hazard density ramp up as you progress. Every hazard telegraphs itself
  (flashing icon, action label, shadow, horn, or beacon) before it can hit you.
- On contact the screen freezes and a **BotG Missed Observation** card shows the
  category, the missed cue, and the safer response. **The card waits for you** — tap
  or press any key to continue (auto-continues after 8 s so a booth never stalls).
  If lives remain, play rewinds about a second and resumes with brief invulnerability.
- **Forklifts and trolleys cannot be jumped or ducked** — the only safe response is
  to move aside and let them pass.
- Duck hazards show a flashing **▼ DUCK** label under a full-lane striped beam;
  jump hazards show **▲ JUMP** over a wide floor obstacle, so the required response
  is always readable.
- Collect hexagonal **BotG Observation Tokens** along safer routes — **tokens are the
  main source of points**, so score chasing means actively taking the safe route.
- Four times per run a **Rapid Decision** appears — the text stays on screen until you
  answer (1/2/3 or click/tap), with a generous 8-second timer.
- After the run (finished or out of lives), a **3-question video quiz** on
  *Precautions for Machinery Hazards* appears before the score is tabulated. Each
  correct answer adds 1,000 points. Answer with 1–4, A–D, or click/tap; the correct
  answer is highlighted after each attempt.

### Observation Streak
Each correctly avoided hazard (and correct decision) builds your streak:
**5 → ×2, 10 → ×3, 15 → ×4** multiplier on avoidance and token points.
Any contact or wrong/missed decision resets it to ×1.

---

## Hazard-to-BotG-category mapping (and the required response)

The core learning mechanic: **you cannot solve everything by jumping.**

| In-game hazard | BotG category | Required response |
|---|---|---|
| Wobbling box off a shelf edge | Falling Objects | **Switch lane** (drop-zone shadow shows where) |
| Unsecured items past the shelf edge | Falling Objects | **Switch lane** |
| Suspended overhead load (growing shadow) | Falling Objects | **Switch lane** — never walk under a load |
| Open rack door at head height | Struck By / Against | **Duck** under the strike line |
| Swinging cabinet door | Struck By / Against | **Switch lane** out of the swing path |
| Protruding server rail / sheet-metal edge | Sharp Objects | **Jump** clear |
| Damaged pallet with exposed nails | Sharp Objects | **Jump** clear |
| Forklift crossing (horn + flashing beacon) | Moving Vehicles | **Time it** — move to a lane outside its path |
| Loaded trolley entering the walkway | Moving Vehicles | **Time it / give way** |
| Barrier doors closing across lanes | Caught In / Between | **Never enter the closing gap** — take the one open lane (green ▼) |

Zone hazard pools are weighted so each area teaches its most relevant risks
(e.g. forklifts dominate the Loading Bay, pinch points the Plant Room).

---

## Scoring system

**Earned:**

| Source | Points |
|---|---|
| **BotG Token collected (main driver)** | **150 × streak multiplier** |
| Hazard avoided | 50 × streak multiplier |
| Correct Rapid Decision | 500 |
| Correct video-quiz answer (×3 at the end) | 1,000 |
| Distance travelled | 0.02 pt per pixel (small trickle) |
| Fast reaction (< 0.6 s after the cue) | +60 bonus |

**Deducted:**

| Event | Points |
|---|---|
| Hazard contact | −250 and streak reset |
| Wrong or missed Rapid Decision | −150 and streak reset |

**End-of-run report** shows: final score, observation accuracy
(avoided ÷ (avoided + contacts)), average reaction time, hazards avoided, contact
incidents, best streak, tokens, decision record, and a rating:

| Accuracy | Rating |
|---|---|
| ≥ 95% with **zero** contacts | Incident Zero Champion |
| ≥ 90% | BotG Specialist |
| ≥ 78% | Risk Spotter |
| ≥ 60% | Alert Operator |
| below | Developing Observer |

### Leaderboard
Top 10 scores (name, score, accuracy, best streak) are stored in the browser's
`localStorage` under the key `serverSprintLB`. Clearing site data resets it.

---

## How to edit the game

Everything lives in `script.js`, organised into numbered, commented sections.

**Speed, duration and pacing — `CONFIG` (top of file):**
- `RUN_DURATION` — run length in seconds (90 = 1.5 min).
- `LIVES` — contacts allowed before the run ends (3).
- `BASE_SPEED` / `MAX_SPEED` — scroll speed ramp (px/s).
- `SPAWN_GAP_EARLY` / `SPAWN_GAP_LATE` — seconds between hazard waves at start/end.
  Raise these to make the game easier.
- All scoring values (`SCORE_*`, `PENALTY_*`), streak thresholds (`STREAK_STEPS`),
  incident freeze/rewind timings, and the run fractions where Rapid Decisions fire
  (`DECISION_TIMES`).

**Zones — `ZONES` array:** name, floor/wall colours, accent colour, and a `pool`
object of `{hazardType: weight}` controlling what spawns there. Add, remove, or
reorder zones freely — segments divide the run equally.

**Hazards — `HAZARD_DEFS`:** each entry holds the BotG category, the incident-card
text (`cue`, `safe`), and its `evade` type (`lane`, `duck`, `jump`, `timing`, `gap`).
To add a new hazard: add an entry here, add its weight to a zone pool, and add a
drawing case in `drawHazard()`.

**Rapid Decisions — `DECISIONS` array:** scenario text, three options, the index of
the correct one, and the coaching line shown after answering. `DECISION_TIMES` in
`CONFIG` controls how many fire per run and when.

**Video quiz — `QUIZ` array:** question text, four options, and the index of the
correct one. `QUIZ_POINTS` in `CONFIG` sets the points per correct answer. Swap the
questions here whenever the pre-campaign video changes.

**Ratings** — edit `ratingFor()` in section 15.

The game fails soft: any runtime error is logged to the console and the loop keeps
running, so a glitch never freezes a booth display.

---

## Files

```
server-sprint/
├── index.html      — page shell, menu / quiz / report / leaderboard overlays
├── style.css       — retro UI styling (Google-inspired palette, no logos)
├── script.js       — the whole game (config, engine, art, audio, comments)
├── quiz-video.jpg  — title screen of the pre-campaign video, shown on the quiz
└── README.md       — this file
```
