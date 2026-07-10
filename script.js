/* ==========================================================================
   BotG PATROL — Spot the Contact Risk
   Self-contained canvas game for the Bodily Contact safety campaign.
   Mobile-first: portrait layout, on-screen touch controls, no external
   assets/libraries — all art is drawn with canvas primitives.

   Rendering approach: the environment (floor, zones, racks, shelves, props,
   shadows, painted lane markings) is drawn ONCE into an offscreen "static
   layer" at boot. Each frame only re-draws that image plus the animated
   details (LEDs, fan blades, conveyor belt, vehicles, people, markers),
   which keeps the scene rich without hurting frame rate on phones.

   File map:
     CONFIG        tunable constants
     STATE         mutable game state
     MAP DATA      obstacles / zones for the floor layout (portrait)
     HAZARD DATA   the 8 inspectable hazards + BotG quiz content
     ENTITIES      player + characters + moving forklift/vehicle
     INPUT         keyboard / touch / mouse handling
     UPDATE        per-frame simulation
     RENDER        static-layer builder + per-frame drawing
     UI / DOM      HUD, modal, start/end screens
     GAME FLOW     start / end / restart
   ========================================================================== */

(() => {
  "use strict";

  /* ============================== CONFIG ============================== */
  const CANVAS_W = 480;
  const CANVAS_H = 760;
  const GAME_DURATION = 40; // seconds — quick phone-friendly session
  const PLAYER_SPEED = 170; // px/sec
  const INTERACT_RADIUS = 48;
  const HAZARD_MARKER_R = 11;
  const COLLISION_PENALTY = 5; // seconds lost when struck by the forklift
  const TRAP_PENALTY = 5; // seconds lost stepping on a floor trap
  const COLLISION_COOLDOWN = 1.2; // seconds of invulnerability after a hit

  const COLORS = {
    blue: "#4285F4",
    red: "#EA4335",
    yellow: "#FBBC05",
    green: "#34A853",
    wall: "#0a0b0e",
    metal: "#5b6274"
  };

  /* ============================== STATE ================================ */
  const state = {
    started: false,
    over: false,
    paused: false, // true while a hazard modal is open
    timeLeft: GAME_DURATION,
    score: 0,
    lastTs: 0,
    keys: {},
    activeHazard: null
  };

  /* ============================== MAP DATA ==============================
     Portrait layout (480x760), built for a phone held upright:
       - Border walls all around
       - Top band   y:16-246  -> Server Rack Aisle (left) / Loading Area (right)
       - Path band  y:280-340 -> Moving Vehicle Pathway (full width, dangerous)
       - Bottom band y:380-744-> Maintenance Area (left) / Chemical Corner (right)
       - Center corridor x:216-264 stays open, connecting every zone
  ======================================================================== */
  const WALLS = [
    { x: 0, y: 0, w: CANVAS_W, h: 16 },
    { x: 0, y: CANVAS_H - 16, w: CANVAS_W, h: 16 },
    { x: 0, y: 0, w: 16, h: CANVAS_H },
    { x: CANVAS_W - 16, y: 0, w: 16, h: CANVAS_H }
  ];

  const ZONES = [
    { name: "SERVER RACKS", x: 16, y: 16, w: 200, h: 230, tint: "rgba(66,133,244,0.06)", edge: "rgba(66,133,244,0.35)" },
    { name: "LOADING AREA", x: 264, y: 16, w: 200, h: 230, tint: "rgba(251,188,5,0.05)", edge: "rgba(251,188,5,0.3)" },
    { name: "MAINTENANCE", x: 16, y: 380, w: 200, h: 364, tint: "rgba(180,139,224,0.06)", edge: "rgba(180,139,224,0.3)" },
    { name: "CHEMICAL STORAGE", x: 264, y: 380, w: 200, h: 364, tint: "rgba(52,168,83,0.06)", edge: "rgba(52,168,83,0.3)" },
    { name: "FORKLIFT ROUTE", x: 16, y: 280, w: 448, h: 60, tint: null, edge: null }
  ];
  const PATHWAY = ZONES[4];

  // Solid obstacles the player collides with. type drives the art drawn on top.
  const OBSTACLES = [
    // --- Server Rack Aisle ---
    { x: 40, y: 28, w: 54, h: 170, type: "rack" },
    { x: 118, y: 28, w: 54, h: 130, type: "rack-fan" }, // H2 sits here

    // --- Loading Area ---
    { x: 356, y: 30, w: 90, h: 55, type: "crateStack" },
    { x: 300, y: 170, w: 32, h: 26, type: "suspendedLoad" }, // H3 sits here (footprint only)

    // --- Maintenance Area ---
    { x: 30, y: 400, w: 100, h: 40, type: "workbench" },
    { x: 30, y: 470, w: 150, h: 50, type: "conveyor" }, // H6 sits here
    { x: 30, y: 560, w: 150, h: 20, type: "hotPipe" }, // H7 sits here

    // --- Chemical Storage Corner ---
    { x: 290, y: 420, w: 150, h: 50, type: "chemShelf" }, // H9 sits here
    { x: 380, y: 560, w: 50, h: 50, type: "eyewashClean" } // decorative — a station done right
  ];

  // Decorative-only figures (no collision) that help tell the story of a hazard.
  // Both stand at the edge of the forklift route, about to step in.
  const PEDESTRIANS = [
    { x: 196, y: 342, vest: "#c56f00", helmet: "#e8eaed", skin: "#c98a5b" }, // near forklift blind spot (H11)
    { x: 272, y: 252, vest: "#8a56c9", helmet: "#FBBC05", skin: "#f0c39a" }  // at the pedestrian crossing (H12)
  ];

  /* ------------------------------ FLOOR TRAPS ------------------------------
     Walk over one of these and lose time. Each is a classic Bodily Contact
     hazard found on data centre floors — the penalty message teaches the
     sub-category on contact. They are visible, avoidable, and non-solid.
  --------------------------------------------------------------------------- */
  const TRAPS = [
    { x: 178, y: 96, w: 30, h: 22, type: "sharpScrap",
      msg: "Sharp sheet-metal offcut — contact with sharp objects!" },
    { x: 272, y: 56, w: 36, h: 24, type: "nailPallet",
      msg: "Nails protruding from a pallet!" },
    { x: 300, y: 498, w: 38, h: 26, type: "chemSpill",
      msg: "Chemical spill — skin contact hazard!" },
    { x: 96, y: 636, w: 34, h: 24, type: "steamVent",
      msg: "Hot steam vent — contact with hot surface!" },
    { x: 222, y: 424, w: 38, h: 24, type: "toolsScatter",
      msg: "Tripped over scattered tools — struck-by risk!" }
  ];

  /* ============================ HAZARD DATA ==============================
     8 hazards, each mapped to an official Bodily Contact sub-category from
     the BotG Guidance reference document.
       type: "correct" (+10) | "partial" (+5) | "wrong" (0)
  ======================================================================== */
  const HAZARDS = [
    {
      id: "H1", name: "Sharp Edge on Server Rack",
      zone: "Server Rack Aisle", category: "Contact with Sharp Objects",
      x: 96, y: 54,
      scenario: "An open server rack panel has an exposed sharp metal edge at hand height, right where techs squeeze past in the aisle.",
      options: [
        { type: "correct", text: "Open rack panel has an exposed sharp metal edge at hand height — laceration risk to anyone reaching past or brushing by." },
        { type: "partial", text: "A rack panel has been left open in the aisle and should be closed once the work is finished." },
        { type: "wrong", text: "Cable management inside the rack is untidy and could slow down future maintenance work." }
      ],
      feedbackCorrect: "This is a Bodily Contact risk because exposed edges can cut skin during ordinary foot traffic or reaching — especially when attention is on a laptop, not the rack.",
      feedbackWrong: "Look again — the key risk is the exposed sharp edge at hand height, not the cable tidiness."
    },
    {
      id: "H2", name: "Missing Fan Guard",
      zone: "Server Rack Aisle", category: "Contact with Rotating Machinery / Parts",
      x: 145, y: 140,
      scenario: "A cooling fan at the end of the row is missing its protective guard — the blades are exposed and spinning within arm's reach.",
      options: [
        { type: "correct", text: "End-of-row cooling fan is running with its guard removed — exposed rotating blades within reach of passing staff." },
        { type: "partial", text: "A cooling fan at the end of the row looks faulty and should be checked by the facilities team." },
        { type: "wrong", text: "The end-of-row fan is running louder than normal, which points to worn bearings needing maintenance." }
      ],
      feedbackCorrect: "Bypassed or missing guards on fans, drills, and similar equipment can cause serious entanglement or laceration injuries.",
      feedbackWrong: "Look again — the real hazard is the missing guard exposing rotating blades, not how the fan sounds."
    },
    {
      id: "H3", name: "Standing Under a Suspended Load",
      zone: "Loading Area", category: "Falling Objects",
      x: 316, y: 148,
      scenario: "A pallet is raised overhead by a lift truck while a worker stands directly underneath it, looking at their phone.",
      options: [
        { type: "correct", text: "Worker is standing directly under a raised pallet — struck-by/crush risk if the load shifts or drops." },
        { type: "partial", text: "A worker in the loading area is distracted on their phone and should stay aware of their surroundings." },
        { type: "wrong", text: "The lift truck is parked at an angle across the dock lane and should be straightened to keep the area clear." }
      ],
      feedbackCorrect: "Working underneath suspended loads or inside a lift's working envelope is one of the most severe bodily contact hazards — a dropped load carries huge energy.",
      feedbackWrong: "Look again — the critical hazard is the person positioned directly under the suspended load, not how the lift truck is parked."
    },
    {
      id: "H6", name: "No LOTO Before Repair",
      zone: "Maintenance Area", category: "Caught In / Between Objects",
      x: 172, y: 460,
      scenario: "A technician is reaching into a conveyor mechanism to clear a jam while the equipment is still powered and has not been locked out.",
      options: [
        { type: "correct", text: "Technician is clearing a conveyor jam without LOTO applied — energy isn't isolated, caught-in/between risk if it restarts." },
        { type: "partial", text: "A technician is repairing the conveyor, so the area should be kept clear until the work is done." },
        { type: "wrong", text: "The conveyor's drive motor looks worn and should be added to the preventive maintenance schedule." }
      ],
      feedbackCorrect: "Working on equipment without Lockout/Tagout leaves stored or live energy in place, which can unexpectedly move and trap a hand, arm, or clothing.",
      feedbackWrong: "Look again — the real risk is reaching into powered machinery without LOTO, not the motor's maintenance schedule."
    },
    {
      id: "H7", name: "Unmarked Hot Pipe",
      zone: "Maintenance Area", category: "Contact with Hot / Cold Objects",
      x: 105, y: 560,
      scenario: "An exposed hot exhaust pipe near the maintenance bench carries no warning signage, and a technician's arm keeps brushing close to it.",
      options: [
        { type: "correct", text: "Hot exhaust pipe has no 'Hot Surface' warning signage — burn risk to staff brushing against it unknowingly." },
        { type: "partial", text: "The pipework runs close to the workbench, making the maintenance area a tight space to work in." },
        { type: "wrong", text: "The pipe's protective coating is fading and should be repainted to prevent long-term corrosion." }
      ],
      feedbackCorrect: "Missing signage (e.g. 'Warning - Hot Surface') removes the early visual cue that would normally keep people a safe distance away.",
      feedbackWrong: "Look again — the risk is the unmarked hot surface, not the condition of the paintwork."
    },
    {
      id: "H9", name: "Unlabeled Chemical Container",
      zone: "Chemical Storage Corner", category: "Contact with Chemical",
      x: 335, y: 424,
      scenario: "A container on the chemical storage shelf has no label identifying its contents.",
      options: [
        { type: "correct", text: "A container on the chemical shelf has no identifying label — unknown contents risk skin/eye exposure during handling." },
        { type: "partial", text: "One of the containers on the shelf looks different from the rest and may be worth checking." },
        { type: "wrong", text: "Chemical storage looks compliant — the drums sit on a spill tray with hazard diamonds displayed." }
      ],
      feedbackCorrect: "Missing labels mean anyone handling the container doesn't know what PPE or precautions are needed, which increases exposure risk.",
      feedbackWrong: "Look again — one drum has no label at all, so anyone handling it can't know the contents or the required PPE."
    },
    {
      id: "H11", name: "Blind Spot Near Moving Forklift",
      zone: "Forklift Route", category: "Contact with Moving Equipment",
      x: 208, y: 300,
      scenario: "A pedestrian is about to cross directly behind a reversing forklift, right inside the operator's blind spot.",
      options: [
        { type: "correct", text: "Pedestrian is stepping into the forklift's rear blind spot — the operator can't see them, high risk of being struck." },
        { type: "partial", text: "A pedestrian is walking close to the forklift route and should keep more distance from operations." },
        { type: "wrong", text: "The forklift's amber beacon is flashing correctly, showing its safety features are well maintained." }
      ],
      feedbackCorrect: "Blind spots between pedestrians and operators of forklifts, MEWPs, or lift trucks are a leading cause of struck-by incidents.",
      feedbackWrong: "Look again — a working beacon doesn't remove the blind spot the pedestrian is walking into."
    },
    {
      id: "H12", name: "Crossing Without Looking",
      zone: "Loading Dock Approach", category: "Contact with Moving Vehicle",
      x: 272, y: 302,
      scenario: "A staff member steps onto the pedestrian crossing without checking, just as a delivery truck rolls in from the loading dock with an obstructed view.",
      options: [
        { type: "correct", text: "Pedestrian stepped onto the dock crossing without checking while a delivery truck approached — struck-by-vehicle risk." },
        { type: "partial", text: "Delivery traffic is arriving at the dock, so pedestrians nearby need to take extra care when crossing." },
        { type: "wrong", text: "The pedestrian crossing markings are clearly painted, so the traffic route is set up correctly." }
      ],
      feedbackCorrect: "Failing to look before crossing a vehicle route is one of the most common precursors to vehicle-pedestrian incidents.",
      feedbackWrong: "Look again — clear markings only help if people check for traffic; this pedestrian crossed without looking."
    }
  ];
  HAZARDS.forEach(h => { h.answered = false; h.resultType = null; });
  const TOTAL_HAZARDS = HAZARDS.length;
  const MAX_POSSIBLE_SCORE = TOTAL_HAZARDS * 10;

  /* ============================== ENTITIES =============================== */
  // Selectable patrol officers — same silhouette, different vest/helmet/skin
  // colors so players can pick who they patrol as (chosen on the start screen).
  const CHARACTERS = [
    { name: "Amber", vest: "#FBBC05", helmet: "#4285F4", skin: "#f0c39a" },
    { name: "Crimson", vest: "#EA4335", helmet: "#e8eaed", skin: "#c98a5b" },
    { name: "Jade", vest: "#34A853", helmet: "#1a1a1a", skin: "#8d5a3c" }
  ];
  let selectedCharacter = 0;

  const player = {
    x: 232, y: 255, w: 16, h: 24,
    facing: "down",
    moving: false,
    animT: 0,
    hitCooldown: 0,
    vest: CHARACTERS[0].vest,
    helmet: CHARACTERS[0].helmet,
    skin: CHARACTERS[0].skin
  };

  const charOptionsEl = document.getElementById("charOptions");
  if (charOptionsEl) {
    charOptionsEl.querySelectorAll(".char-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedCharacter = Number(btn.dataset.char);
        charOptionsEl.querySelectorAll(".char-btn").forEach(b => {
          b.classList.toggle("selected", b === btn);
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        const c = CHARACTERS[selectedCharacter];
        player.vest = c.vest;
        player.helmet = c.helmet;
        player.skin = c.skin;
      });
    });
  }

  // The forklift patrols the full marked route. Colliding costs time.
  const movers = [
    { type: "forklift", x: 30, y: 300, w: 44, h: 30, minX: 30, maxX: 440, dir: 1, speed: 74 }
  ];

  /* ================================ INPUT ================================= */
  const KEY_MAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right"
  };

  window.addEventListener("keydown", (e) => {
    if (KEY_MAP[e.key]) { state.keys[KEY_MAP[e.key]] = true; e.preventDefault(); }
    if ((e.key === " " || e.key === "Enter") && state.started && !state.over) {
      e.preventDefault();
      tryInspectNearest();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (KEY_MAP[e.key]) { state.keys[KEY_MAP[e.key]] = false; }
  });

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  canvas.addEventListener("click", (e) => {
    if (!state.started || state.over || state.paused) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const hz = findHazardNear(player.x + player.w / 2, player.y + player.h / 2);
    if (hz && dist(cx, cy, hz.x, hz.y) <= HAZARD_MARKER_R * 2.4) {
      openHazard(hz);
    }
  });

  // --- On-screen touch controls (D-pad + Inspect button) ---
  const isTouchDevice = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  if (isTouchDevice) document.body.classList.add("touch-mode");

  function wireHoldButton(id, onDown, onUp) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = (e) => { e.preventDefault(); onDown(); };
    const end = (e) => { e.preventDefault(); onUp(); };
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", end);
  }
  wireHoldButton("btnUp", () => (state.keys.up = true), () => (state.keys.up = false));
  wireHoldButton("btnDown", () => (state.keys.down = true), () => (state.keys.down = false));
  wireHoldButton("btnLeft", () => (state.keys.left = true), () => (state.keys.left = false));
  wireHoldButton("btnRight", () => (state.keys.right = true), () => (state.keys.right = false));

  const btnInspect = document.getElementById("btnInspect");
  if (btnInspect) {
    btnInspect.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (state.started && !state.over) tryInspectNearest();
    });
  }

  function dist(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }

  function findHazardNear(px, py) {
    let best = null, bestD = Infinity;
    for (const h of HAZARDS) {
      if (h.answered) continue;
      const d = dist(px, py, h.x, h.y);
      if (d <= INTERACT_RADIUS && d < bestD) { best = h; bestD = d; }
    }
    return best;
  }

  function tryInspectNearest() {
    const hz = findHazardNear(player.x + player.w / 2, player.y + player.h / 2);
    if (hz) openHazard(hz);
  }

  /* ================================ UPDATE ================================= */
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function collidesAt(x, y) {
    const box = { x, y, w: player.w, h: player.h };
    for (const w of WALLS) if (rectsOverlap(box, w)) return true;
    for (const o of OBSTACLES) if (rectsOverlap(box, o)) return true;
    return false;
  }

  function updatePlayer(dt) {
    let vx = 0, vy = 0;
    if (state.keys.left) vx -= 1;
    if (state.keys.right) vx += 1;
    if (state.keys.up) vy -= 1;
    if (state.keys.down) vy += 1;

    player.moving = vx !== 0 || vy !== 0;

    if (vx !== 0 && vy !== 0) { vx *= 0.7071; vy *= 0.7071; }
    if (vy < 0) player.facing = "up";
    else if (vy > 0) player.facing = "down";
    else if (vx < 0) player.facing = "left";
    else if (vx > 0) player.facing = "right";

    const dx = vx * PLAYER_SPEED * dt;
    const dy = vy * PLAYER_SPEED * dt;

    if (dx !== 0 && !collidesAt(player.x + dx, player.y)) player.x += dx;
    if (dy !== 0 && !collidesAt(player.x, player.y + dy)) player.y += dy;

    player.x = Math.max(16, Math.min(CANVAS_W - 16 - player.w, player.x));
    player.y = Math.max(16, Math.min(CANVAS_H - 16 - player.h, player.y));

    if (player.moving) player.animT += dt;
  }

  function updateMovers(dt) {
    for (const m of movers) {
      m.x += m.dir * m.speed * dt;
      if (m.x <= m.minX) { m.x = m.minX; m.dir = 1; }
      if (m.x + m.w >= m.maxX) { m.x = m.maxX - m.w; m.dir = -1; }
    }
    if (player.hitCooldown > 0) player.hitCooldown -= dt;
    else {
      const pBox = { x: player.x, y: player.y, w: player.w, h: player.h };
      for (const m of movers) {
        if (rectsOverlap(pBox, m)) {
          state.timeLeft = Math.max(0, state.timeLeft - COLLISION_PENALTY);
          player.hitCooldown = COLLISION_COOLDOWN;
          showToast(`Struck by the forklift! -${COLLISION_PENALTY}s — stay clear of its travel path.`);
          player.x += m.dir * -14;
          break;
        }
      }
    }
  }

  // Floor traps: stepping on one (feet only, so it feels fair) costs time.
  function updateTraps() {
    if (player.hitCooldown > 0) return;
    const feet = { x: player.x + 3, y: player.y + player.h - 10, w: player.w - 6, h: 10 };
    for (const t of TRAPS) {
      if (rectsOverlap(feet, t)) {
        state.timeLeft = Math.max(0, state.timeLeft - TRAP_PENALTY);
        player.hitCooldown = COLLISION_COOLDOWN;
        showToast(`${t.msg} -${TRAP_PENALTY}s`);
        break;
      }
    }
  }

  let toastHideAt = 0;
  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    toastHideAt = performance.now() + 1700;
  }

  function updateToast() {
    if (toastHideAt && performance.now() > toastHideAt) {
      document.getElementById("toast").classList.add("hidden");
      toastHideAt = 0;
    }
  }

  function updateHUD() {
    const t = Math.max(0, Math.ceil(state.timeLeft));
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, "0");
    document.getElementById("hudTime").textContent = `${mm}:${ss}`;
    document.getElementById("hudScore").textContent = state.score;
    const found = HAZARDS.filter(h => h.answered).length;
    document.getElementById("hudFound").textContent = found;
  }

  function updatePromptBubble() {
    const bubble = document.getElementById("promptBubble");
    const hz = state.paused ? null : findHazardNear(player.x + player.w / 2, player.y + player.h / 2);
    if (hz) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / CANVAS_W;
      const scaleY = rect.height / CANVAS_H;
      bubble.style.left = `${hz.x * scaleX}px`;
      bubble.style.top = `${(hz.y - HAZARD_MARKER_R - 6) * scaleY}px`;
      bubble.textContent = isTouchDevice ? "Tap INSPECT" : "SPACE to inspect";
      bubble.classList.remove("hidden");
    } else {
      bubble.classList.add("hidden");
    }
  }

  function tick(ts) {
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000);
    state.lastTs = ts;

    if (state.started && !state.over && !state.paused) {
      updatePlayer(dt);
      updateMovers(dt);
      updateTraps();
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        endGame();
      }
    }
    updateToast();
    updateHUD();
    updatePromptBubble();
    render();
    requestAnimationFrame(tick);
  }

  /* ================================ RENDER =================================
     Static layer: everything that never changes is pre-rendered once into an
     offscreen canvas (with soft blurred shadows, floor noise, painted lane
     markings). The per-frame loop just stamps that image and draws the
     animated details on top.
  ========================================================================== */

  // deterministic pseudo-random so the floor noise looks identical every boot
  function makeRng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rr(g, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }

  function shadeColor(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + percent));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + percent));
    const b = Math.min(255, Math.max(0, (num & 0x0000ff) + percent));
    return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`;
  }

  const staticLayer = document.createElement("canvas");
  staticLayer.width = CANVAS_W;
  staticLayer.height = CANVAS_H;
  const sg = staticLayer.getContext("2d");

  // soft blurred drop shadow for a prop footprint (static layer only)
  function propShadow(g, x, y, w, h) {
    g.save();
    g.filter = "blur(5px)";
    g.fillStyle = "rgba(0,0,0,0.4)";
    g.fillRect(x + 3, y + 5, w, h);
    g.filter = "none";
    g.restore();
  }

  function chevronBand(g, x, y, w, h) {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = "#c79a12";
    g.fillRect(x, y, w, h);
    g.fillStyle = "#141519";
    for (let i = -h * 2; i < w + h; i += 14) {
      g.beginPath();
      g.moveTo(x + i, y + h);
      g.lineTo(x + i + 7, y + h);
      g.lineTo(x + i + 7 + h, y);
      g.lineTo(x + i + h, y);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function drawMiniWorker(g, x, y, vest, helmet, skin, lean) {
    // small standing figure used for scene-dressing pedestrians/technicians
    g.save();
    if (lean) { g.translate(x + 6, y + 10); g.rotate(lean); g.translate(-(x + 6), -(y + 10)); }
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath(); g.ellipse(x + 6, y + 23, 7, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#23262e";
    g.fillRect(x + 1.5, y + 13, 4, 10);
    g.fillRect(x + 6.5, y + 13, 4, 10);
    const vg = g.createLinearGradient(x, y, x, y + 14);
    vg.addColorStop(0, shadeColor(vest, 30));
    vg.addColorStop(1, shadeColor(vest, -25));
    g.fillStyle = vg;
    rr(g, x - 0.5, y, 13, 14, 2.5); g.fill();
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fillRect(x - 0.5, y + 6, 13, 1.6);
    g.fillStyle = skin;
    rr(g, x + 2, y - 7, 8, 8, 2); g.fill();
    g.fillStyle = helmet;
    g.beginPath(); g.ellipse(x + 6, y - 6.5, 5.5, 4, 0, Math.PI, 0); g.fill();
    g.fillRect(x + 0.5, y - 7, 11, 2.4);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(x + 2, y - 8.6, 4, 1.2);
    g.restore();
  }

  /* -------------------- static environment builder -------------------- */
  function buildStaticLayer() {
    const g = sg;
    const rand = makeRng(20260707);

    // base + raised-access floor tiles with per-tile tone variation
    g.fillStyle = "#101218";
    g.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const tile = 30;
    for (let y = 16; y < CANVAS_H - 16; y += tile) {
      for (let x = 16; x < CANVAS_W - 16; x += tile) {
        const v = Math.floor(rand() * 10) - 5;
        g.fillStyle = shadeColor("#2b303b", v);
        g.fillRect(x, y, tile, tile);
        // beveled tile edges
        g.fillStyle = "rgba(255,255,255,0.045)";
        g.fillRect(x, y, tile, 1.5);
        g.fillRect(x, y, 1.5, tile);
        g.fillStyle = "rgba(0,0,0,0.28)";
        g.fillRect(x, y + tile - 1.5, tile, 1.5);
        g.fillRect(x + tile - 1.5, y, 1.5, tile);
        // lifting-hole dots in tile corners
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(x + 3, y + 3, 2, 2);
        g.fillRect(x + tile - 5, y + 3, 2, 2);
        g.fillRect(x + 3, y + tile - 5, 2, 2);
        g.fillRect(x + tile - 5, y + tile - 5, 2, 2);
        // occasional scuff
        if (rand() < 0.12) {
          g.fillStyle = "rgba(0,0,0,0.12)";
          g.fillRect(x + 4 + rand() * 16, y + 4 + rand() * 16, 4 + rand() * 8, 1.5);
        }
      }
    }

    // perforated cooling tiles in the server zone (every other tile)
    for (let y = 46; y < 240; y += tile * 2) {
      for (let x = 16; x < 210; x += tile * 2) {
        g.fillStyle = "rgba(0,0,0,0.25)";
        for (let py = 6; py < tile - 4; py += 5) {
          for (let px = 6; px < tile - 4; px += 5) {
            g.fillRect(x + px, y + py, 1.6, 1.6);
          }
        }
      }
    }

    // zone tints + painted dashed zone boundaries
    for (const z of ZONES) {
      if (!z.tint) continue;
      g.fillStyle = z.tint;
      g.fillRect(z.x, z.y, z.w, z.h);
      g.strokeStyle = z.edge;
      g.lineWidth = 1.5;
      g.setLineDash([8, 6]);
      g.strokeRect(z.x + 3, z.y + 3, z.w - 6, z.h - 6);
      g.setLineDash([]);
    }

    // pools of overhead lighting — very subtle
    const pools = [[116, 130], [364, 130], [240, 308], [116, 470], [364, 470], [240, 650]];
    for (const [px, py] of pools) {
      const lg = g.createRadialGradient(px, py, 10, px, py, 120);
      lg.addColorStop(0, "rgba(185,205,255,0.055)");
      lg.addColorStop(1, "rgba(185,205,255,0)");
      g.fillStyle = lg;
      g.fillRect(px - 120, py - 120, 240, 240);
    }

    /* ---- forklift route: taped-off floor lane like a real data centre.
       The floor tiles stay visible — the lane is defined by yellow/black
       hazard tape at the edges and painted legends/arrows, not asphalt. ---- */
    const p = PATHWAY;
    // slight darkening from heavier traffic wear inside the lane
    g.fillStyle = "rgba(0,0,0,0.16)";
    g.fillRect(p.x, p.y, p.w, p.h);
    for (let i = 0; i < 260; i++) {
      const sx = p.x + rand() * p.w, sy = p.y + 8 + rand() * (p.h - 16);
      g.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.18)";
      g.fillRect(sx, sy, 1.4, 1.4);
    }
    // yellow/black hazard tape marking the lane edges
    chevronBand(g, p.x, p.y, p.w, 5);
    chevronBand(g, p.x, p.y + p.h - 5, p.w, 5);
    // painted lane legends
    g.fillStyle = "rgba(251,188,5,0.5)";
    g.font = "bold 11px Consolas, monospace";
    g.fillText("FORKLIFT", 50, p.y + 25);
    g.fillText("ROUTE", 60, p.y + 39);
    g.fillText("FORKLIFT", 340, p.y + 25);
    g.fillText("ROUTE", 350, p.y + 39);
    // painted direction arrows along the lane
    g.fillStyle = "rgba(251,188,5,0.45)";
    for (const ax of [150, 305, 420]) {
      g.beginPath();
      g.moveTo(ax, p.y + p.h / 2 - 5);
      g.lineTo(ax + 12, p.y + p.h / 2);
      g.lineTo(ax, p.y + p.h / 2 + 5);
      g.lineTo(ax + 4, p.y + p.h / 2);
      g.closePath();
      g.fill();
    }
    // pedestrian crossing where the centre corridor crosses the route
    for (let i = 0; i < 4; i++) {
      g.fillStyle = `rgba(226,229,236,${0.5 + rand() * 0.25})`;
      rr(g, 220, 288 + i * 12.5, 40, 7, 2);
      g.fill();
    }
    // faint tire wear from forklift traffic
    g.strokeStyle = "rgba(0,0,0,0.18)";
    g.lineWidth = 4;
    for (const [x1, x2, yy] of [[40, 200, 302], [280, 440, 316]]) {
      g.beginPath();
      g.moveTo(x1, yy);
      g.bezierCurveTo(x1 + 40, yy - 2, x2 - 40, yy + 2, x2, yy);
      g.stroke();
    }

    /* ---- overhead cable tray across the centre corridor ---- */
    g.fillStyle = "#1c2029";
    g.fillRect(216, 16, 48, 10);
    g.strokeStyle = "#0d0e12";
    g.lineWidth = 1;
    for (let cx = 220; cx < 262; cx += 6) {
      g.beginPath(); g.moveTo(cx, 16); g.lineTo(cx, 26); g.stroke();
    }
    // drooping cable bundles
    g.lineWidth = 1.6;
    for (const [c, off] of [["#3b62a8", 0], ["#a83b3b", 4], ["#3ba85c", 8]]) {
      g.strokeStyle = c;
      g.beginPath();
      g.moveTo(218 + off, 26);
      g.quadraticCurveTo(240, 40 + off * 1.6, 262 - off, 26);
      g.stroke();
    }

    /* ---- ambient floor glow spilling from the server racks ---- */
    for (const o of OBSTACLES) {
      if (o.type !== "rack" && o.type !== "rack-fan") continue;
      const gl = g.createRadialGradient(o.x + o.w + 8, o.y + o.h / 2, 4, o.x + o.w + 8, o.y + o.h / 2, 60);
      gl.addColorStop(0, "rgba(80,150,255,0.10)");
      gl.addColorStop(1, "rgba(80,150,255,0)");
      g.fillStyle = gl;
      g.fillRect(o.x + o.w - 30, o.y - 30, 110, o.h + 60);
    }

    /* ---- props (static geometry, soft shadows) ---- */
    for (const o of OBSTACLES) drawPropStatic(g, o);

    /* ---- floor traps (stepping on these costs time) ---- */
    for (const t of TRAPS) drawTrapStatic(g, t);

    /* ---- zone label chips ---- */
    g.font = "bold 9px Consolas, monospace";
    g.textBaseline = "middle";
    for (const z of ZONES) {
      const label = z.name;
      const tw = g.measureText(label).width;
      const lx = z.name === "VEHICLE PATHWAY" ? z.x + 6 : z.x + 6;
      const ly = z.name === "VEHICLE PATHWAY" ? z.y - 9 : z.y + 12;
      g.fillStyle = "rgba(10,11,14,0.72)";
      rr(g, lx - 4, ly - 7, tw + 9, 14, 4);
      g.fill();
      g.fillStyle = "rgba(232,234,237,0.75)";
      g.fillText(label, lx, ly + 0.5);
    }
    g.textBaseline = "alphabetic";

    /* ---- outer walls with depth + ambient occlusion ---- */
    g.fillStyle = COLORS.wall;
    for (const w of WALLS) g.fillRect(w.x, w.y, w.w, w.h);
    g.strokeStyle = "rgba(255,255,255,0.07)";
    g.lineWidth = 1.5;
    g.strokeRect(16.75, 16.75, CANVAS_W - 33.5, CANVAS_H - 33.5);
    // soft interior shadow cast by the walls
    const edges = [
      [16, 16, CANVAS_W - 32, 12, 0, 1],
      [16, CANVAS_H - 28, CANVAS_W - 32, 12, 0, -1],
      [16, 16, 12, CANVAS_H - 32, 1, 0],
      [CANVAS_W - 28, 16, 12, CANVAS_H - 32, -1, 0]
    ];
    for (const [ex, ey, ew, eh, dxn, dyn] of edges) {
      const sh = g.createLinearGradient(ex, ey, ex + (dxn ? ew * dxn : 0), ey + (dyn ? eh * dyn : 0));
      sh.addColorStop(0, "rgba(0,0,0,0.4)");
      sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh;
      g.fillRect(ex, ey, ew, eh);
    }
  }

  /* ------------------------- static prop drawing ------------------------- */
  function drawPropStatic(g, o) {
    switch (o.type) {
      case "rack":
      case "rack-fan": {
        propShadow(g, o.x, o.y, o.w, o.h);
        // side face for depth
        g.fillStyle = "#12141a";
        g.fillRect(o.x + o.w - 1, o.y + 3, 5, o.h - 1);
        // cabinet body
        const bg = g.createLinearGradient(o.x, o.y, o.x + o.w, o.y);
        bg.addColorStop(0, "#1a1d25");
        bg.addColorStop(0.15, "#2e3340");
        bg.addColorStop(0.85, "#252a35");
        bg.addColorStop(1, "#15171e");
        g.fillStyle = bg;
        rr(g, o.x, o.y, o.w, o.h, 3);
        g.fill();
        // top edge highlight
        g.fillStyle = "rgba(255,255,255,0.1)";
        g.fillRect(o.x + 2, o.y + 1, o.w - 4, 2);
        // inner frame
        g.strokeStyle = "#0d0e12";
        g.lineWidth = 2;
        g.strokeRect(o.x + 3, o.y + 4, o.w - 6, o.h - 8);
        // 1U server units
        const uH = 10, gap = 1.6;
        const usableH = (o.type === "rack-fan" ? o.h - 42 : o.h - 12);
        const count = Math.floor(usableH / (uH + gap));
        for (let i = 0; i < count; i++) {
          const uy = o.y + 6 + i * (uH + gap);
          const ug = g.createLinearGradient(o.x, uy, o.x, uy + uH);
          ug.addColorStop(0, "#2c313d");
          ug.addColorStop(1, "#1e222b");
          g.fillStyle = ug;
          rr(g, o.x + 5, uy, o.w - 10, uH, 1.5);
          g.fill();
          // handles
          g.fillStyle = "#454c5c";
          g.fillRect(o.x + 7, uy + 3, 2, 4);
          g.fillRect(o.x + o.w - 9, uy + 3, 2, 4);
          // vent slits
          g.fillStyle = "rgba(0,0,0,0.4)";
          for (let vx = 0; vx < 3; vx++) {
            g.fillRect(o.x + o.w - 22 + vx * 4, uy + 2.5, 1.6, 5);
          }
        }
        if (o.type === "rack-fan") {
          // exposed fan housing at the bottom (H2) — blades drawn per-frame
          const cx = o.x + o.w / 2, cy = o.y + o.h - 20;
          const fh = g.createRadialGradient(cx, cy, 2, cx, cy, 16);
          fh.addColorStop(0, "#3a4150");
          fh.addColorStop(1, "#101218");
          g.fillStyle = fh;
          g.beginPath(); g.arc(cx, cy, 15, 0, Math.PI * 2); g.fill();
          // screw dots where the guard SHOULD be bolted on
          g.fillStyle = "#5b6274";
          for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + i * (Math.PI / 2);
            g.beginPath();
            g.arc(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 1.4, 0, Math.PI * 2);
            g.fill();
          }
        }
        break;
      }
      case "crateStack": {
        propShadow(g, o.x, o.y, o.w, o.h);
        const wg = g.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        wg.addColorStop(0, "#96683c");
        wg.addColorStop(1, "#6b4523");
        g.fillStyle = wg;
        rr(g, o.x, o.y, o.w, o.h, 2);
        g.fill();
        // planks + grain
        g.strokeStyle = "rgba(58,35,15,0.8)";
        g.lineWidth = 1.5;
        for (let py = o.y + o.h / 2; py < o.y + o.h; py += 100) {
          g.beginPath(); g.moveTo(o.x, py); g.lineTo(o.x + o.w, py); g.stroke();
        }
        g.beginPath(); g.moveTo(o.x, o.y + o.h / 2); g.lineTo(o.x + o.w, o.y + o.h / 2); g.stroke();
        for (let px = o.x + 22; px < o.x + o.w; px += 22) {
          g.beginPath(); g.moveTo(px, o.y); g.lineTo(px, o.y + o.h); g.stroke();
        }
        g.strokeStyle = "rgba(0,0,0,0.15)";
        g.lineWidth = 1;
        for (let i = 0; i < 8; i++) {
          const gy = o.y + 4 + i * 7;
          g.beginPath(); g.moveTo(o.x + 3, gy); g.lineTo(o.x + o.w - 3, gy + 1); g.stroke();
        }
        // metal corner brackets
        g.fillStyle = "#8d949f";
        for (const [bx, by] of [[o.x, o.y], [o.x + o.w - 8, o.y], [o.x, o.y + o.h - 8], [o.x + o.w - 8, o.y + o.h - 8]]) {
          g.fillRect(bx, by, 8, 3);
          g.fillRect(bx, by, 3, 8);
        }
        // strapping bands
        g.fillStyle = "rgba(20,22,28,0.55)";
        g.fillRect(o.x + o.w * 0.3, o.y, 4, o.h);
        g.fillRect(o.x + o.w * 0.68, o.y, 4, o.h);
        // stencil
        g.fillStyle = "rgba(255,255,255,0.5)";
        g.font = "bold 8px Consolas, monospace";
        g.fillText("GDC-3PDC", o.x + 8, o.y + o.h - 8);
        break;
      }
      case "suspendedLoad": {
        const cx = o.x + o.w / 2;
        // gantry I-beam
        g.fillStyle = "#171a21";
        g.fillRect(o.x - 24, 90, o.w + 48, 4);
        g.fillStyle = "#2c313d";
        g.fillRect(o.x - 24, 94, o.w + 48, 6);
        g.fillStyle = "#171a21";
        g.fillRect(o.x - 24, 100, o.w + 48, 3);
        // trolley
        g.fillStyle = "#c79a12";
        rr(g, cx - 8, 96, 16, 10, 2);
        g.fill();
        // chains (small links)
        g.fillStyle = "#9aa1b2";
        for (let i = 0; i < 6; i++) {
          g.beginPath(); g.arc(cx - 11 + i * 0.8, 108 + i * 4, 1.6, 0, Math.PI * 2); g.fill();
          g.beginPath(); g.arc(cx + 11 - i * 0.8, 108 + i * 4, 1.6, 0, Math.PI * 2); g.fill();
        }
        // shadow of the load on the floor (tells the story from above)
        g.save();
        g.filter = "blur(6px)";
        g.fillStyle = "rgba(0,0,0,0.45)";
        g.beginPath(); g.ellipse(cx, 196, 26, 9, 0, 0, Math.PI * 2); g.fill();
        g.filter = "none";
        g.restore();
        // hanging pallet with slats
        const pg = g.createLinearGradient(cx - 22, 130, cx - 22, 146);
        pg.addColorStop(0, "#9c6a3f");
        pg.addColorStop(1, "#6b4523");
        g.fillStyle = pg;
        rr(g, cx - 22, 130, 44, 15, 2);
        g.fill();
        g.strokeStyle = "rgba(58,35,15,0.9)";
        g.lineWidth = 1.5;
        for (let i = -18; i <= 18; i += 7) {
          g.beginPath(); g.moveTo(cx + i, 130); g.lineTo(cx + i, 145); g.stroke();
        }
        // worker beneath, absorbed in phone (H3) — static; phone glow animated
        drawMiniWorker(g, o.x + 10, o.y + 6, "#FBBC05", "#e8eaed", "#f0c39a", 0.08);
        break;
      }
      case "workbench": {
        propShadow(g, o.x, o.y, o.w, o.h);
        // legs
        g.fillStyle = "#20242c";
        g.fillRect(o.x + 3, o.y + o.h - 6, 6, 6);
        g.fillRect(o.x + o.w - 9, o.y + o.h - 6, 6, 6);
        // steel top
        const tg = g.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        tg.addColorStop(0, "#79839a");
        tg.addColorStop(0.12, "#5d6577");
        tg.addColorStop(1, "#454b58");
        g.fillStyle = tg;
        rr(g, o.x, o.y, o.w, o.h - 4, 3);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.14)";
        g.fillRect(o.x + 2, o.y + 1.5, o.w - 4, 2);
        // wrench
        g.strokeStyle = "#c9cfda";
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(o.x + 14, o.y + 22); g.lineTo(o.x + 30, o.y + 12); g.stroke();
        g.beginPath(); g.arc(o.x + 12, o.y + 23, 4, 0.6, 5); g.stroke();
        // red toolbox
        const tb = g.createLinearGradient(o.x + 44, o.y + 10, o.x + 44, o.y + 26);
        tb.addColorStop(0, "#e05548");
        tb.addColorStop(1, "#a52d20");
        g.fillStyle = tb;
        rr(g, o.x + 44, o.y + 12, 26, 14, 2);
        g.fill();
        g.fillStyle = "#6e1d14";
        g.fillRect(o.x + 52, o.y + 9, 10, 4);
        // clamped vice
        g.fillStyle = "#39404e";
        g.fillRect(o.x + o.w - 20, o.y + 10, 12, 12);
        g.fillStyle = "#5b6274";
        g.fillRect(o.x + o.w - 22, o.y + 13, 16, 5);
        break;
      }
      case "conveyor": {
        propShadow(g, o.x, o.y, o.w, o.h);
        // legs
        g.fillStyle = "#20242c";
        g.fillRect(o.x + 6, o.y + o.h - 4, 6, 6);
        g.fillRect(o.x + o.w - 12, o.y + o.h - 4, 6, 6);
        // belt bed (belt lines animated per frame)
        g.fillStyle = "#22252d";
        g.fillRect(o.x + 3, o.y + 7, o.w - 6, o.h - 14);
        // side rails with metallic sheen
        for (const ry of [o.y, o.y + o.h - 8]) {
          const rg2 = g.createLinearGradient(o.x, ry, o.x, ry + 8);
          rg2.addColorStop(0, "#6a7286");
          rg2.addColorStop(0.5, "#454b58");
          rg2.addColorStop(1, "#2c313a");
          g.fillStyle = rg2;
          rr(g, o.x, ry, o.w, 8, 2);
          g.fill();
        }
        // rail bolts
        g.fillStyle = "#161920";
        for (let bx = o.x + 8; bx < o.x + o.w; bx += 20) {
          g.beginPath(); g.arc(bx, o.y + 4, 1.5, 0, Math.PI * 2); g.fill();
          g.beginPath(); g.arc(bx, o.y + o.h - 4, 1.5, 0, Math.PI * 2); g.fill();
        }
        // drive motor housing — powered, no lock applied (H6)
        g.fillStyle = "#39404e";
        rr(g, o.x - 4, o.y + 12, 12, 26, 2);
        g.fill();
        g.fillStyle = "rgba(0,0,0,0.4)";
        for (let vy = 0; vy < 4; vy++) g.fillRect(o.x - 1, o.y + 16 + vy * 5, 6, 1.6);
        // green "RUNNING" pilot light base (glow animated)
        g.fillStyle = "#1d3327";
        g.beginPath(); g.arc(o.x + 2, o.y + 9, 2.5, 0, Math.PI * 2); g.fill();
        // technician leaning INTO the running conveyor
        drawMiniWorker(g, o.x + o.w - 22, o.y - 20, "#4285F4", "#FBBC05", "#c98a5b", 0.35);
        break;
      }
      case "hotPipe": {
        propShadow(g, o.x, o.y + 4, o.w + 30, o.h - 4);
        // cylindrical pipe with specular highlight
        const pg2 = g.createLinearGradient(0, o.y, 0, o.y + o.h);
        pg2.addColorStop(0, "#c2593d");
        pg2.addColorStop(0.25, "#a8402c");
        pg2.addColorStop(0.8, "#5f1d10");
        pg2.addColorStop(1, "#471207");
        g.fillStyle = pg2;
        rr(g, o.x, o.y, o.w + 30, o.h, o.h / 2);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.28)";
        rr(g, o.x + 6, o.y + 3, o.w + 18, 2.6, 1.3);
        g.fill();
        // flanges with bolt dots
        for (let i = 0; i < 3; i++) {
          const fx = o.x + 24 + i * 48;
          g.fillStyle = "#3d1208";
          g.fillRect(fx, o.y - 2, 6, o.h + 4);
          g.fillStyle = "#7a3a28";
          g.fillRect(fx + 1.5, o.y - 2, 1.5, o.h + 4);
        }
        // floor brackets
        g.fillStyle = "#23262e";
        g.fillRect(o.x + 8, o.y + o.h, 6, 4);
        g.fillRect(o.x + o.w + 12, o.y + o.h, 6, 4);
        break;
      }
      case "chemShelf": {
        propShadow(g, o.x, o.y, o.w, o.h);
        // rack uprights + back panel
        g.fillStyle = "#2a2f3a";
        rr(g, o.x, o.y - 4, o.w, o.h + 2, 3);
        g.fill();
        g.fillStyle = "#181b22";
        g.fillRect(o.x + 2, o.y - 2, 5, o.h - 4);
        g.fillRect(o.x + o.w - 7, o.y - 2, 5, o.h - 4);
        // spill-containment tray (yellow grid)
        g.fillStyle = "#b08a14";
        rr(g, o.x + 4, o.y + o.h - 12, o.w - 8, 10, 2);
        g.fill();
        g.strokeStyle = "rgba(0,0,0,0.35)";
        g.lineWidth = 1;
        for (let gx = o.x + 10; gx < o.x + o.w - 6; gx += 9) {
          g.beginPath(); g.moveTo(gx, o.y + o.h - 12); g.lineTo(gx, o.y + o.h - 2); g.stroke();
        }
        // drums as shaded cylinders
        const drums = [
          { c: "#2f9e57", labeled: true },
          { c: "#8a919e", labeled: false }, // the unlabeled one (H9)
          { c: "#d54338", labeled: true },
          { c: "#2f9e57", labeled: true }
        ];
        drums.forEach((d, i) => {
          const dx = o.x + 12 + i * 33, dw = 24, dy = o.y + 2, dh = 36;
          const dg = g.createLinearGradient(dx, 0, dx + dw, 0);
          dg.addColorStop(0, shadeColor(d.c, -40));
          dg.addColorStop(0.3, shadeColor(d.c, 25));
          dg.addColorStop(0.55, shadeColor(d.c, 45));
          dg.addColorStop(1, shadeColor(d.c, -50));
          g.fillStyle = dg;
          rr(g, dx, dy, dw, dh, 3);
          g.fill();
          // rim + cap
          g.fillStyle = "rgba(0,0,0,0.4)";
          g.beginPath(); g.ellipse(dx + dw / 2, dy + 2.5, dw / 2 - 1, 3, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = shadeColor(d.c, 15);
          g.beginPath(); g.ellipse(dx + dw / 2, dy + 2, dw / 2 - 3, 2.2, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#161920";
          g.beginPath(); g.arc(dx + dw / 2, dy + 2, 2, 0, Math.PI * 2); g.fill();
          // ribs
          g.strokeStyle = "rgba(0,0,0,0.25)";
          g.beginPath(); g.moveTo(dx + 1, dy + 12); g.lineTo(dx + dw - 1, dy + 12); g.stroke();
          g.beginPath(); g.moveTo(dx + 1, dy + 24); g.lineTo(dx + dw - 1, dy + 24); g.stroke();
          if (d.labeled) {
            // GHS-style diamond label
            g.save();
            g.translate(dx + dw / 2, dy + 19);
            g.rotate(Math.PI / 4);
            g.fillStyle = "#f5f6f8";
            g.fillRect(-4.5, -4.5, 9, 9);
            g.strokeStyle = "#c0281c";
            g.lineWidth = 1.4;
            g.strokeRect(-4.5, -4.5, 9, 9);
            g.restore();
          } else {
            // faded dashed outline where the missing label should be
            g.strokeStyle = "rgba(255,255,255,0.28)";
            g.lineWidth = 1;
            g.setLineDash([2.5, 2.5]);
            g.strokeRect(dx + 5.5, dy + 13, 13, 12);
            g.setLineDash([]);
          }
        });
        break;
      }
      case "eyewashClean": {
        propShadow(g, o.x, o.y, o.w, o.h);
        // cabinet
        const eg = g.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        eg.addColorStop(0, "#3d4452");
        eg.addColorStop(1, "#272c36");
        g.fillStyle = eg;
        rr(g, o.x, o.y, o.w, o.h, 3);
        g.fill();
        // illuminated sign
        g.fillStyle = "#2f9e57";
        rr(g, o.x + 5, o.y + 5, o.w - 10, 12, 2);
        g.fill();
        g.fillStyle = "#eafff2";
        g.font = "bold 6.5px Consolas, monospace";
        g.fillText("EYEWASH", o.x + 9, o.y + 13);
        // white cross emblem
        g.fillStyle = "#eafff2";
        g.fillRect(o.x + o.w / 2 - 1.5, o.y + 20, 3, 9);
        g.fillRect(o.x + o.w / 2 - 4.5, o.y + 23, 9, 3);
        // basin + nozzles
        g.fillStyle = "#aeb6c4";
        g.beginPath(); g.ellipse(o.x + o.w / 2, o.y + 40, 16, 6, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#e3f4ea";
        g.beginPath(); g.arc(o.x + 15, o.y + 39, 4, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(o.x + o.w - 15, o.y + 39, 4, 0, Math.PI * 2); g.fill();
        // inspection tag — this one is compliant
        g.fillStyle = "#2f9e57";
        g.fillRect(o.x + o.w - 8, o.y + 20, 5, 8);
        break;
      }
    }
  }

  /* ------------------------- floor trap drawing ------------------------- */
  function drawTrapStatic(g, t) {
    switch (t.type) {
      case "sharpScrap": {
        // jagged sheet-metal offcuts left on the floor
        g.save();
        g.translate(t.x, t.y);
        g.fillStyle = "#8d949f";
        g.beginPath();
        g.moveTo(2, 14); g.lineTo(12, 2); g.lineTo(20, 8); g.lineTo(26, 4);
        g.lineTo(24, 16); g.lineTo(12, 20); g.closePath();
        g.fill();
        g.fillStyle = "#6a7286";
        g.beginPath();
        g.moveTo(10, 18); g.lineTo(24, 10); g.lineTo(30, 18); g.lineTo(18, 22); g.closePath();
        g.fill();
        g.strokeStyle = "rgba(255,255,255,0.5)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(12, 2); g.lineTo(20, 8); g.lineTo(26, 4); g.stroke();
        g.restore();
        break;
      }
      case "nailPallet": {
        // flattened pallet board with nails sticking up
        const wg = g.createLinearGradient(t.x, t.y, t.x, t.y + t.h);
        wg.addColorStop(0, "#8a5c33");
        wg.addColorStop(1, "#5f3d1f");
        g.fillStyle = wg;
        rr(g, t.x, t.y, t.w, t.h, 2);
        g.fill();
        g.strokeStyle = "rgba(58,35,15,0.8)";
        g.lineWidth = 1.5;
        for (let i = 1; i < 3; i++) {
          g.beginPath();
          g.moveTo(t.x, t.y + (t.h / 3) * i);
          g.lineTo(t.x + t.w, t.y + (t.h / 3) * i);
          g.stroke();
        }
        g.fillStyle = "#d7dbe2";
        for (const [nx, ny] of [[6, 5], [16, 9], [27, 4], [10, 17], [22, 15], [31, 18]]) {
          g.fillRect(t.x + nx, t.y + ny - 3, 1.6, 4);
          g.beginPath(); g.arc(t.x + nx + 0.8, t.y + ny - 3, 1.2, 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case "chemSpill": {
        // glossy chemical puddle spreading across the tiles
        g.save();
        g.translate(t.x + t.w / 2, t.y + t.h / 2);
        g.fillStyle = "rgba(64,190,110,0.45)";
        g.beginPath(); g.ellipse(0, 0, t.w / 2, t.h / 2, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(64,190,110,0.55)";
        g.beginPath(); g.ellipse(-6, 2, t.w / 3, t.h / 3, 0.3, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(t.w / 2 - 3, -4, 4, 3, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(255,255,255,0.25)";
        g.beginPath(); g.ellipse(-4, -3, 7, 3, -0.4, 0, Math.PI * 2); g.fill();
        g.restore();
        break;
      }
      case "steamVent": {
        // floor grate venting hot steam (puffs animated per frame)
        g.fillStyle = "#23262e";
        rr(g, t.x, t.y, t.w, t.h, 3);
        g.fill();
        g.strokeStyle = "#454c5c";
        g.lineWidth = 1.5;
        rr(g, t.x + 1, t.y + 1, t.w - 2, t.h - 2, 2);
        g.stroke();
        g.fillStyle = "#0d0e12";
        for (let i = 0; i < 4; i++) g.fillRect(t.x + 5, t.y + 4 + i * 5, t.w - 10, 2.4);
        break;
      }
      case "toolsScatter": {
        // dropped tools left across the walkway
        g.save();
        g.translate(t.x, t.y);
        g.strokeStyle = "#c9cfda";
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(4, 16); g.lineTo(16, 6); g.stroke();
        g.beginPath(); g.arc(3, 17, 3.4, 0.8, 5.2); g.stroke();
        g.strokeStyle = "#d99a2b";
        g.lineWidth = 2.6;
        g.beginPath(); g.moveTo(20, 18); g.lineTo(32, 12); g.stroke();
        g.strokeStyle = "#9aa1b2";
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(30, 13); g.lineTo(37, 9.5); g.stroke();
        g.fillStyle = "#7d8494";
        for (const [bx, by] of [[12, 20], [26, 6], [34, 18]]) {
          g.beginPath(); g.arc(bx, by, 1.8, 0, Math.PI * 2); g.fill();
        }
        g.restore();
        break;
      }
    }
  }

  function drawTrapAnimated(t, now) {
    switch (t.type) {
      case "steamVent": {
        for (let i = 0; i < 3; i++) {
          const ph = ((now / 1400) + i * 0.33) % 1;
          const wx = t.x + 7 + i * 10 + Math.sin(now / 300 + i * 2) * 2;
          ctx.fillStyle = `rgba(230,238,248,${(1 - ph) * 0.22})`;
          ctx.beginPath();
          ctx.ellipse(wx, t.y + 4 - ph * 20, 3 + ph * 4, 5 + ph * 4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "chemSpill": {
        // slow expanding shimmer ring
        const ph = (now / 1100) % 1;
        ctx.strokeStyle = `rgba(110,230,150,${(1 - ph) * 0.35})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(
          t.x + t.w / 2, t.y + t.h / 2,
          (t.w / 2) * (0.6 + ph * 0.5), (t.h / 2) * (0.6 + ph * 0.5),
          0, 0, Math.PI * 2
        );
        ctx.stroke();
        break;
      }
      default: {
        // periodic glint so sharp/trip traps catch the eye
        const ph = ((now / 1600) + t.x * 0.31) % 1;
        if (ph < 0.12) {
          const a = (1 - ph / 0.12) * 0.8;
          const gx = t.x + t.w * 0.6, gy = t.y + t.h * 0.3;
          ctx.strokeStyle = `rgba(255,255,255,${a})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(gx - 4, gy); ctx.lineTo(gx + 4, gy); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(gx, gy - 4); ctx.lineTo(gx, gy + 4); ctx.stroke();
        }
      }
    }
  }

  /* ----------------------- animated per-frame details ----------------------- */
  function drawPropAnimated(o, now) {
    switch (o.type) {
      case "rack":
      case "rack-fan": {
        // blinking status LEDs on each server unit
        const uH = 10, gap = 1.6;
        const usableH = (o.type === "rack-fan" ? o.h - 42 : o.h - 12);
        const count = Math.floor(usableH / (uH + gap));
        for (let i = 0; i < count; i++) {
          const uy = o.y + 6 + i * (uH + gap);
          const phase = Math.floor(now / 500 + i * 1.7 + o.x) % 5;
          const c1 = phase === 0 ? COLORS.green : (i % 2 ? COLORS.blue : "#39404e");
          const c2 = phase === 2 ? COLORS.yellow : "#39404e";
          ctx.fillStyle = c1;
          if (phase === 0) { ctx.shadowColor = COLORS.green; ctx.shadowBlur = 4; }
          ctx.fillRect(o.x + 11, uy + 3.4, 3, 3);
          ctx.shadowBlur = 0;
          ctx.fillStyle = c2;
          ctx.fillRect(o.x + 16, uy + 3.4, 3, 3);
        }
        if (o.type === "rack-fan") {
          // unguarded spinning blades + slow red pulse where the guard is missing
          const cx = o.x + o.w / 2, cy = o.y + o.h - 20;
          const spin = (now / 110) % (Math.PI * 2);
          ctx.strokeStyle = "#cdd3de";
          ctx.lineWidth = 2.4;
          ctx.lineCap = "round";
          for (let pass = 0; pass < 2; pass++) {
            ctx.globalAlpha = pass === 0 ? 0.3 : 1; // motion-blur ghost pass
            const a0 = spin - pass * 0.25;
            for (let i = 0; i < 4; i++) {
              const a = a0 + i * (Math.PI / 2);
              ctx.beginPath();
              ctx.moveTo(cx, cy);
              ctx.quadraticCurveTo(
                cx + Math.cos(a + 0.5) * 7, cy + Math.sin(a + 0.5) * 7,
                cx + Math.cos(a) * 12, cy + Math.sin(a) * 12
              );
              ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
          ctx.lineCap = "butt";
          ctx.fillStyle = "#39404e";
          ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
          const pulse = 0.35 + Math.sin(now / 350) * 0.2;
          ctx.strokeStyle = `rgba(234,67,53,${pulse})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.arc(cx, cy, 15.5, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
        break;
      }
      case "suspendedLoad": {
        // pulsing danger ring on the floor under the raised load
        const cx = o.x + o.w / 2;
        const p = (now / 1400) % 1;
        ctx.strokeStyle = `rgba(234,67,53,${(1 - p) * 0.5})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.ellipse(cx, 194, 18 + p * 14, 7 + p * 5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // phone glow on the distracted worker
        const glow = 0.5 + Math.sin(now / 300) * 0.3;
        ctx.fillStyle = `rgba(140,190,255,${glow})`;
        ctx.shadowColor = "#8cbeff";
        ctx.shadowBlur = 5;
        ctx.fillRect(o.x + 20, o.y + 10, 3.5, 5);
        ctx.shadowBlur = 0;
        break;
      }
      case "conveyor": {
        // moving belt chevrons
        ctx.save();
        ctx.beginPath();
        ctx.rect(o.x + 3, o.y + 8, o.w - 6, o.h - 16);
        ctx.clip();
        ctx.strokeStyle = "#454b58";
        ctx.lineWidth = 2;
        const off = (now / 90) % 16;
        for (let bx = -16 + off; bx < o.w; bx += 16) {
          ctx.beginPath();
          ctx.moveTo(o.x + bx, o.y + 8);
          ctx.lineTo(o.x + bx + 8, o.y + o.h - 8);
          ctx.stroke();
        }
        ctx.restore();
        // "RUNNING" pilot light — green, still energized (H6)
        const on = Math.sin(now / 260) > -0.4;
        ctx.fillStyle = on ? "#4ade80" : "#1d3327";
        if (on) { ctx.shadowColor = "#4ade80"; ctx.shadowBlur = 6; }
        ctx.beginPath(); ctx.arc(o.x + 2, o.y + 9, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }
      case "hotPipe": {
        // radiant heat glow + rising shimmer
        const glow = 0.35 + Math.sin(now / 260) * 0.18;
        const hg = ctx.createRadialGradient(o.x + (o.w + 30) / 2, o.y + o.h / 2, 4, o.x + (o.w + 30) / 2, o.y + o.h / 2, 70);
        hg.addColorStop(0, `rgba(255,96,64,${glow * 0.5})`);
        hg.addColorStop(1, "rgba(255,96,64,0)");
        ctx.fillStyle = hg;
        ctx.fillRect(o.x - 40, o.y - 45, o.w + 110, o.h + 90);
        // heat shimmer wisps
        for (let i = 0; i < 3; i++) {
          const t = ((now / 1600) + i * 0.33) % 1;
          const wx = o.x + 30 + i * 45 + Math.sin(now / 400 + i * 2) * 4;
          ctx.fillStyle = `rgba(255,160,120,${(1 - t) * 0.14})`;
          ctx.beginPath();
          ctx.ellipse(wx, o.y - 4 - t * 22, 4, 7, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "eyewashClean": {
        // gentle glow on the illuminated sign
        const glow = 0.25 + Math.sin(now / 900) * 0.1;
        ctx.fillStyle = `rgba(74,222,128,${glow})`;
        rr(ctx, o.x + 5, o.y + 5, o.w - 10, 12, 2);
        ctx.fill();
        break;
      }
    }
  }

  /* ---------------------------- dynamic actors ---------------------------- */
  function drawPedestrian(p, now) {
    const bob = Math.sin(now / 400 + p.x) * 1.2;
    ctx.save();
    ctx.translate(0, bob);
    drawMiniWorker(ctx, p.x, p.y, p.vest, p.helmet, p.skin, 0);
    ctx.restore();
  }

  function drawMover(m, now) {
    ctx.save();
    // moving shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(m.x + m.w / 2, m.y + m.h + 3, m.w / 2 + 3, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (m.type === "forklift") {
      const frontX = m.dir > 0 ? m.x + m.w * 0.66 : m.x - 13;
      const bodyX = m.dir > 0 ? m.x : m.x + m.w * 0.34 - 13;
      // headlight beam in direction of travel
      const beamX = m.dir > 0 ? m.x + m.w * 0.66 : m.x;
      const bg2 = ctx.createLinearGradient(beamX, 0, beamX + m.dir * 46, 0);
      bg2.addColorStop(0, "rgba(255,240,180,0.16)");
      bg2.addColorStop(1, "rgba(255,240,180,0)");
      ctx.fillStyle = bg2;
      ctx.beginPath();
      ctx.moveTo(beamX, m.y + 6);
      ctx.lineTo(beamX + m.dir * 46, m.y - 4);
      ctx.lineTo(beamX + m.dir * 46, m.y + m.h + 8);
      ctx.lineTo(beamX, m.y + m.h - 4);
      ctx.closePath();
      ctx.fill();
      // counterweight (rear)
      const rearX = m.dir > 0 ? m.x : m.x + m.w * 0.52;
      ctx.fillStyle = "#8f6f04";
      rr(ctx, rearX, m.y + 4, m.w * 0.16, m.h - 6, 2);
      ctx.fill();
      // body
      const fb = ctx.createLinearGradient(m.x, m.y, m.x, m.y + m.h);
      fb.addColorStop(0, "#ffd23f");
      fb.addColorStop(0.55, "#f2b600");
      fb.addColorStop(1, "#c79400");
      ctx.fillStyle = fb;
      rr(ctx, bodyX + (m.dir > 0 ? 4 : 9), m.y, m.w * 0.62, m.h, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(bodyX + (m.dir > 0 ? 7 : 12), m.y + 1.5, m.w * 0.5, 2);
      // overhead guard cage
      const cageX = m.dir > 0 ? m.x + m.w * 0.18 : m.x + m.w * 0.42;
      ctx.strokeStyle = "#1d2027";
      ctx.lineWidth = 2;
      ctx.strokeRect(cageX, m.y - 4, m.w * 0.34, 6);
      ctx.beginPath(); ctx.moveTo(cageX, m.y + 2); ctx.lineTo(cageX, m.y + 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cageX + m.w * 0.34, m.y + 2); ctx.lineTo(cageX + m.w * 0.34, m.y + 10); ctx.stroke();
      // operator
      ctx.fillStyle = "#f0c39a";
      ctx.fillRect(cageX + m.w * 0.1, m.y + 4, 6, 6);
      ctx.fillStyle = "#e8eaed";
      ctx.fillRect(cageX + m.w * 0.08, m.y + 2, 8, 3.4);
      // mast + fork tines
      ctx.fillStyle = "#1d2027";
      const mastX = m.dir > 0 ? m.x + m.w * 0.62 : m.x + m.w * 0.34;
      ctx.fillRect(mastX, m.y - 2, 4, m.h + 2);
      ctx.fillStyle = "#aeb6c4";
      ctx.fillRect(frontX, m.y + 4, 13, 4);
      ctx.fillRect(frontX, m.y + m.h - 8, 13, 4);
      // wheels
      for (const wx of [m.x + 9, m.x + m.w * 0.55]) {
        ctx.fillStyle = "#101215";
        ctx.beginPath(); ctx.arc(wx, m.y + m.h - 1, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#454c5c";
        ctx.beginPath(); ctx.arc(wx, m.y + m.h - 1, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      // rotating amber beacon + halo
      const blink = Math.sin(now / 130) > 0;
      if (blink) {
        const halo = ctx.createRadialGradient(m.x + m.w * 0.34, m.y - 6, 1, m.x + m.w * 0.34, m.y - 6, 14);
        halo.addColorStop(0, "rgba(255,150,20,0.5)");
        halo.addColorStop(1, "rgba(255,150,20,0)");
        ctx.fillStyle = halo;
        ctx.fillRect(m.x + m.w * 0.34 - 14, m.y - 20, 28, 28);
      }
      ctx.fillStyle = blink ? "#ff9614" : "#7a4a00";
      rr(ctx, m.x + m.w * 0.34 - 3, m.y - 9, 6, 5, 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayer(now) {
    const { x, y, w, h } = player;
    const stride = player.moving ? Math.sin(player.animT * 11) : 0;
    const bob = player.moving ? Math.abs(Math.sin(player.animT * 11)) * -1.6 : 0;

    // blink while invulnerable after a collision
    if (player.hitCooldown > 0 && Math.floor(now / 90) % 2 === 0) ctx.globalAlpha = 0.45;

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h + 2, w / 2 + 2, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // striding legs
    ctx.fillStyle = "#23262e";
    rr(ctx, x + 2.5, y + h - 9 + stride * 2, 4.5, 9 - stride * 2, 2); ctx.fill();
    rr(ctx, x + w - 7, y + h - 9 - stride * 2, 4.5, 9 + stride * 2, 2); ctx.fill();

    // swinging arms
    ctx.fillStyle = shadeColor(player.vest, -35);
    rr(ctx, x - 1.5, y + h - 20 + bob - stride * 2.4, 3, 10, 1.5); ctx.fill();
    rr(ctx, x + w - 1.5, y + h - 20 + bob + stride * 2.4, 3, 10, 1.5); ctx.fill();

    // hi-vis vest with outline + reflective stripes
    const vestGrad = ctx.createLinearGradient(x, y + h - 21, x, y + h - 5);
    vestGrad.addColorStop(0, shadeColor(player.vest, 35));
    vestGrad.addColorStop(1, shadeColor(player.vest, -25));
    ctx.fillStyle = vestGrad;
    rr(ctx, x + 0.5, y + h - 21 + bob, w - 1, 15, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1;
    rr(ctx, x + 0.5, y + h - 21 + bob, w - 1, 15, 3);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(x + 1.5, y + h - 15.6 + bob, w - 3, 1.8);
    ctx.fillRect(x + w / 2 - 1, y + h - 21 + bob, 2, 15);

    // head + simple face
    ctx.fillStyle = player.skin;
    rr(ctx, x + 2.5, y + h - 27 + bob, w - 5, 8, 2.5);
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    let dx = 0, dy = 0;
    if (player.facing === "up") dy = -1;
    if (player.facing === "down") dy = 1;
    if (player.facing === "left") dx = -1;
    if (player.facing === "right") dx = 1;
    if (player.facing !== "up") {
      ctx.fillRect(x + w / 2 - 3 + dx * 2.4, y + h - 24.5 + bob + dy, 1.8, 1.8);
      ctx.fillRect(x + w / 2 + 1.4 + dx * 2.4, y + h - 24.5 + bob + dy, 1.8, 1.8);
    }

    // hard hat with brim + specular highlight
    ctx.fillStyle = player.helmet;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h - 26.5 + bob, w / 2 - 0.5, 4.6, 0, Math.PI, 0);
    ctx.fill();
    rr(ctx, x + 1, y + h - 28 + bob, w - 2, 3.4, 1.6);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    rr(ctx, x + 3.5, y + h - 30 + bob, 4.5, 1.6, 0.8);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  function drawHazardMarkers(now) {
    for (const h of HAZARDS) {
      if (h.answered) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath(); ctx.ellipse(h.x, h.y + 8, 7, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        const cg = ctx.createRadialGradient(h.x - 2, h.y - 2, 1, h.x, h.y, 9);
        cg.addColorStop(0, "#5cd689");
        cg.addColorStop(1, "#238a4b");
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(h.x, h.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(h.x - 3.4, h.y + 0.2);
        ctx.lineTo(h.x - 1, h.y + 2.8);
        ctx.lineTo(h.x + 3.6, h.y - 2.6);
        ctx.stroke();
        continue;
      }
      const near = dist(player.x + player.w / 2, player.y + player.h / 2, h.x, h.y) <= INTERACT_RADIUS;
      // expanding sonar ring — draws the eye across the floor
      const p = ((now / 1300) + h.x * 0.137) % 1;
      ctx.strokeStyle = near
        ? `rgba(251,188,5,${(1 - p) * 0.55})`
        : `rgba(234,67,53,${(1 - p) * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 12 + p * 12, 0, Math.PI * 2);
      ctx.stroke();

      const pulse = 1 + Math.sin(now / 300 + h.x) * 0.1;
      const r = HAZARD_MARKER_R * pulse;
      ctx.save();
      ctx.translate(h.x, h.y);
      // drop shadow
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.ellipse(0, r * 0.95, r * 0.85, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      if (near) { ctx.shadowColor = COLORS.yellow; ctx.shadowBlur = 10; }
      const tg2 = ctx.createLinearGradient(0, -r, 0, r * 0.8);
      if (near) {
        tg2.addColorStop(0, "#ffd23f");
        tg2.addColorStop(1, "#e0a800");
      } else {
        tg2.addColorStop(0, "#ff6b5e");
        tg2.addColorStop(1, "#c62b1e");
      }
      ctx.fillStyle = tg2;
      ctx.strokeStyle = "#141519";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.92, r * 0.78);
      ctx.lineTo(-r * 0.92, r * 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.fillStyle = near ? "#141519" : "#ffffff";
      ctx.font = "bold 12px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText("!", 0, r * 0.55);
      ctx.textAlign = "left";
      ctx.restore();
    }
  }

  // slow-drifting dust motes — barely visible, adds atmosphere
  const MOTES = [];
  {
    const mr = makeRng(99);
    for (let i = 0; i < 14; i++) {
      MOTES.push({ x: 20 + mr() * 440, y: mr() * 760, s: 5 + mr() * 8, ph: mr() * 6.28, r: 0.8 + mr() * 1.2 });
    }
  }
  function drawMotes(now) {
    const t = now / 1000;
    for (const m of MOTES) {
      const y = ((m.y - t * m.s) % 728 + 728) % 728 + 16;
      const x = m.x + Math.sin(t * 0.5 + m.ph) * 8;
      ctx.fillStyle = `rgba(200,215,255,${0.05 + 0.04 * Math.sin(t + m.ph)})`;
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawAtmosphere() {
    // cool light wash from the top (like high-bay lighting)
    const top = ctx.createLinearGradient(0, 0, 0, 220);
    top.addColorStop(0, "rgba(150,180,255,0.06)");
    top.addColorStop(1, "rgba(150,180,255,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, CANVAS_W, 220);
    // vignette
    const g = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.3,
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.72
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(4,5,10,0.42)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  function render() {
    const now = performance.now();
    ctx.drawImage(staticLayer, 0, 0);
    for (const o of OBSTACLES) drawPropAnimated(o, now);
    for (const t of TRAPS) drawTrapAnimated(t, now);
    for (const p of PEDESTRIANS) drawPedestrian(p, now);
    for (const m of movers) drawMover(m, now);
    drawPlayer(now);
    drawHazardMarkers(now);
    drawMotes(now);
    drawAtmosphere();
  }

  /* ============================== UI / DOM ================================ */
  const startScreen = document.getElementById("startScreen");
  const endScreen = document.getElementById("endScreen");
  const hazardModal = document.getElementById("hazardModal");

  document.getElementById("introTime").textContent = formatTime(GAME_DURATION);
  document.getElementById("hudTotal").textContent = TOTAL_HAZARDS;

  function formatTime(sec) {
    const mm = Math.floor(sec / 60);
    const ss = String(sec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function openHazard(hz) {
    state.paused = true;
    state.activeHazard = hz;

    document.getElementById("hzZone").textContent = hz.zone;
    document.getElementById("hzTitle").textContent = hz.name;
    document.getElementById("hzScenario").textContent = hz.scenario;
    document.getElementById("hzFeedback").classList.add("hidden");

    const optsWrap = document.getElementById("hzOptions");
    optsWrap.innerHTML = "";
    optsWrap.classList.remove("hidden");

    const shuffled = [...hz.options].sort(() => Math.random() - 0.5);

    shuffled.forEach(opt => {
      const btn = document.createElement("button");
      btn.className = "hz-option-btn";
      btn.textContent = opt.text;
      btn.addEventListener("click", () => submitAnswer(hz, opt, btn, optsWrap));
      optsWrap.appendChild(btn);
    });

    hazardModal.classList.remove("hidden");
  }

  function submitAnswer(hz, opt, chosenBtn, optsWrap) {
    if (hz.answered) return;
    hz.answered = true;
    hz.resultType = opt.type;

    const points = opt.type === "correct" ? 10 : opt.type === "partial" ? 5 : 0;
    state.score += points;

    Array.from(optsWrap.children).forEach(b => (b.disabled = true));
    chosenBtn.classList.add(
      opt.type === "correct" ? "chosen-correct" : opt.type === "partial" ? "chosen-partial" : "chosen-wrong"
    );

    const feedbackText = opt.type === "wrong"
      ? `Not quite. ${hz.feedbackWrong}`
      : `${opt.type === "correct" ? "Correct!" : "Partially correct."} ${hz.feedbackCorrect}`;

    document.getElementById("hzFeedbackText").textContent = feedbackText;
    document.getElementById("hzCategoryLine").textContent = `Bodily Contact sub-category: ${hz.category}`;
    document.getElementById("hzPoints").textContent = `+${points} points`;
    document.getElementById("hzFeedback").classList.remove("hidden");

    playBeep(opt.type === "correct" ? 880 : opt.type === "partial" ? 540 : 220);
  }

  document.getElementById("hzContinue").addEventListener("click", () => {
    hazardModal.classList.add("hidden");
    state.paused = false;
    state.activeHazard = null;
    const found = HAZARDS.filter(h => h.answered).length;
    if (found >= TOTAL_HAZARDS) endGame();
  });

  // Minimal WebAudio beep for feedback — no external assets.
  let audioCtx = null;
  function playBeep(freq) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
      osc.stop(audioCtx.currentTime + 0.19);
    } catch (e) { /* audio not available — game still fully playable */ }
  }

  /* ============================== GAME FLOW ================================ */
  function resetState() {
    state.started = true;
    state.over = false;
    state.paused = false;
    state.timeLeft = GAME_DURATION;
    state.score = 0;
    state.activeHazard = null;
    HAZARDS.forEach(h => { h.answered = false; h.resultType = null; });
    player.x = 232; player.y = 255; player.facing = "down";
    movers[0].x = 30; movers[0].dir = 1;
  }

  function startGame() {
    resetState();
    startScreen.classList.add("hidden");
    endScreen.classList.add("hidden");
    hazardModal.classList.add("hidden");
  }

  function endGame() {
    if (state.over) return;
    state.over = true;
    state.paused = true;

    const found = HAZARDS.filter(h => h.answered).length;
    const pct = Math.round((state.score / MAX_POSSIBLE_SCORE) * 100);
    const completedAll = found >= TOTAL_HAZARDS;
    const remaining = Math.ceil(state.timeLeft);

    let rating;
    if (pct >= 80) rating = "BotG Safety Champion";
    else if (pct >= 50) rating = "Sharp Observer";
    else rating = "Needs More Floor Awareness";

    let headline, message;
    if (completedAll) {
      headline = "🎉 Congratulations!";
      const spare = remaining > 0 ? ` with ${remaining}s to spare` : "";
      message = `You spotted and logged every Bodily Contact hazard on the floor${spare}. ${
        pct >= 80
          ? "Sharp eyes and sharp write-ups — exactly the floor awareness that stops incidents before they start."
          : "Great awareness — now aim for more specific, actionable BotG observations to push your accuracy even higher."
      }`;
    } else {
      headline = "Time's Up";
      message = "Bodily contact hazards are often visible before an incident happens. Slow down, look closer, and describe exactly what's unsafe.";
    }

    document.getElementById("endHeadline").textContent = headline;
    document.getElementById("endRating").textContent = rating;
    document.getElementById("endScore").textContent = `${state.score} / ${MAX_POSSIBLE_SCORE}`;
    document.getElementById("endFound").textContent = `${found} / ${TOTAL_HAZARDS}`;
    document.getElementById("endAccuracy").textContent = `${pct}%`;
    document.getElementById("endMessage").textContent = message;
    endScreen.classList.toggle("success", completedAll);

    endScreen.classList.remove("hidden");
  }

  document.getElementById("startBtn").addEventListener("click", startGame);
  document.getElementById("playAgainBtn").addEventListener("click", startGame);
  document.getElementById("restartBtn").addEventListener("click", () => {
    if (state.started) startGame();
  });

  /* ================================ BOOT =================================== */
  buildStaticLayer();
  requestAnimationFrame(tick);
})();
