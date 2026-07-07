/* ==========================================================================
   BotG PATROL — Spot the Contact Risk
   Self-contained canvas game for the Bodily Contact safety campaign.
   Mobile-first: portrait layout, on-screen touch controls, no external
   assets/libraries — all art is drawn with canvas primitives.

   File map:
     CONFIG        tunable constants
     STATE         mutable game state
     MAP DATA      obstacles / zones for the floor layout (portrait)
     HAZARD DATA   the 8 inspectable hazards + BotG quiz content
     ENTITIES      player + moving forklift/vehicle + decorative pedestrians
     INPUT         keyboard / touch / mouse handling
     UPDATE        per-frame simulation
     RENDER        canvas drawing helpers (data-centre visual style)
     UI / DOM      HUD, modal, start/end screens
     GAME FLOW     start / end / restart
   ========================================================================== */

(() => {
  "use strict";

  /* ============================== CONFIG ============================== */
  const CANVAS_W = 480;
  const CANVAS_H = 760;
  const GAME_DURATION = 60; // seconds — quick phone-friendly session
  const PLAYER_SPEED = 170; // px/sec
  const INTERACT_RADIUS = 48;
  const HAZARD_MARKER_R = 11;
  const COLLISION_PENALTY = 2; // seconds lost when hit by moving equipment/vehicle
  const COLLISION_COOLDOWN = 1.2; // seconds of invulnerability after a hit

  const COLORS = {
    blue: "#4285F4",
    red: "#EA4335",
    yellow: "#FBBC05",
    green: "#34A853",
    floorLight: "#3a4250",
    floorDark: "#333a46",
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
    { name: "SERVER RACKS", x: 16, y: 16, w: 200, h: 230, tint: "rgba(66,133,244,0.08)" },
    { name: "LOADING AREA", x: 264, y: 16, w: 200, h: 230, tint: "rgba(251,188,5,0.08)" },
    { name: "MAINTENANCE", x: 16, y: 380, w: 200, h: 364, tint: "rgba(180,139,224,0.09)" },
    { name: "CHEMICAL STORAGE", x: 264, y: 380, w: 200, h: 364, tint: "rgba(52,168,83,0.09)" },
    { name: "VEHICLE PATHWAY", x: 16, y: 280, w: 448, h: 60, tint: "rgba(234,67,53,0.12)" }
  ];

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
  const PEDESTRIANS = [
    { x: 202, y: 300, tone: "#9aa1b2" }, // near the forklift blind spot (H11)
    { x: 278, y: 302, tone: "#c7cbd6" }  // near the vehicle crossing (H12)
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
        { type: "correct", text: "Rack panel has an exposed sharp edge at hand height in the aisle — laceration risk to anyone reaching past or walking by." },
        { type: "partial", text: "Something looks sharp near the racks." },
        { type: "wrong", text: "The rack fans are a bit noisy today." }
      ],
      feedbackCorrect: "This is a Bodily Contact risk because exposed edges can cut skin during ordinary foot traffic or reaching — especially when attention is on a laptop, not the rack.",
      feedbackWrong: "Look again — the key risk is the exposed sharp edge on the rack panel, not the fan noise."
    },
    {
      id: "H2", name: "Missing Fan Guard",
      zone: "Server Rack Aisle", category: "Contact with Rotating Machinery / Parts",
      x: 145, y: 140,
      scenario: "A cooling fan at the end of the row is missing its protective guard — the blades are exposed and spinning within arm's reach.",
      options: [
        { type: "correct", text: "Cooling fan guard is missing on the end-of-row unit — exposed rotating blades within reach of passing staff." },
        { type: "partial", text: "The fan looks a bit off." },
        { type: "wrong", text: "This rack row needs new asset labels." }
      ],
      feedbackCorrect: "Bypassed or missing guards on fans, drills, and similar equipment can cause serious entanglement or laceration injuries.",
      feedbackWrong: "Look again — the real hazard is the exposed, unguarded rotating fan blades."
    },
    {
      id: "H3", name: "Standing Under a Suspended Load",
      zone: "Loading Area", category: "Falling Objects",
      x: 316, y: 148,
      scenario: "A pallet is raised overhead by a lift truck while a worker stands directly underneath it, looking at their phone.",
      options: [
        { type: "correct", text: "Worker is standing under a raised load near the loading dock — struck-by/crush risk if the load shifts or drops." },
        { type: "partial", text: "A lift truck is being used in the loading area." },
        { type: "wrong", text: "The loading dock door is painted bright yellow." }
      ],
      feedbackCorrect: "Working underneath suspended loads or inside a lift's working envelope is one of the most severe bodily contact hazards — a dropped load carries huge energy.",
      feedbackWrong: "Look again — the hazard is the person standing directly under the raised load, not the door color."
    },
    {
      id: "H6", name: "No LOTO Before Repair",
      zone: "Maintenance Area", category: "Caught In / Between Objects",
      x: 172, y: 460,
      scenario: "A technician is reaching into a conveyor mechanism to clear a jam while the equipment is still powered and has not been locked out.",
      options: [
        { type: "correct", text: "Technician is working inside the conveyor without LOTO applied — energy source isn't isolated, risking a caught-in/between injury if it restarts." },
        { type: "partial", text: "Someone is fixing the conveyor belt." },
        { type: "wrong", text: "The conveyor belt housing is painted blue." }
      ],
      feedbackCorrect: "Working on equipment without Lockout/Tagout leaves stored or live energy in place, which can unexpectedly move and trap a hand, arm, or clothing.",
      feedbackWrong: "Look again — the real risk is missing LOTO before reaching into machinery that can move."
    },
    {
      id: "H7", name: "Unmarked Hot Pipe",
      zone: "Maintenance Area", category: "Contact with Hot / Cold Objects",
      x: 105, y: 560,
      scenario: "An exposed hot exhaust pipe near the maintenance bench carries no warning signage, and a technician's arm keeps brushing close to it.",
      options: [
        { type: "correct", text: "Hot exhaust pipe in the maintenance area has no 'Hot Surface' warning signage — staff can unknowingly brush against it and suffer burns." },
        { type: "partial", text: "There's a pipe near the workbench." },
        { type: "wrong", text: "The workbench in this area could be tidier." }
      ],
      feedbackCorrect: "Missing signage (e.g. 'Warning - Hot Surface') removes the early visual cue that would normally keep people a safe distance away.",
      feedbackWrong: "Look again — the risk is the unmarked hot surface, not general workbench tidiness."
    },
    {
      id: "H9", name: "Unlabeled Chemical Container",
      zone: "Chemical Storage Corner", category: "Contact with Chemical",
      x: 335, y: 424,
      scenario: "A container on the chemical storage shelf has no label identifying its contents.",
      options: [
        { type: "correct", text: "Unlabeled chemical container in the storage corner — contents unknown, risking incorrect handling and skin/eye exposure." },
        { type: "partial", text: "There are chemicals stored in this corner." },
        { type: "wrong", text: "There's a fire extinguisher mounted nearby." }
      ],
      feedbackCorrect: "Missing labels mean anyone handling the container doesn't know what PPE or precautions are needed, which increases exposure risk.",
      feedbackWrong: "Look again — the hazard is the unlabeled container itself, not the extinguisher."
    },
    {
      id: "H11", name: "Blind Spot Near Moving Forklift",
      zone: "Vehicle Pathway", category: "Contact with Moving Equipment",
      x: 208, y: 300,
      scenario: "A pedestrian is about to cross directly behind a reversing forklift, right inside the operator's blind spot.",
      options: [
        { type: "correct", text: "Pedestrian is walking into the forklift's rear blind spot on the pathway — the operator can't see them, high risk of being struck." },
        { type: "partial", text: "There's a forklift moving around the pathway." },
        { type: "wrong", text: "The vehicle pathway is marked out with floor paint." }
      ],
      feedbackCorrect: "Blind spots between pedestrians and operators of forklifts, MEWPs, or lift trucks are a leading cause of struck-by incidents.",
      feedbackWrong: "Look again — the hazard is the pedestrian entering the equipment's blind spot."
    },
    {
      id: "H12", name: "Crossing Without Looking",
      zone: "Vehicle Pathway", category: "Contact with Moving Vehicle",
      x: 272, y: 302,
      scenario: "A staff member steps into the vehicle pathway without checking for traffic, just as a people-carrier approaches.",
      options: [
        { type: "correct", text: "Pedestrian entered the vehicle pathway without checking for traffic while a people-carrier was approaching — struck-by-vehicle risk." },
        { type: "partial", text: "There's a vehicle driving through the pathway." },
        { type: "wrong", text: "The pathway has clear floor markings." }
      ],
      feedbackCorrect: "Failing to look before crossing a vehicle pathway is one of the most common precursors to vehicle-pedestrian incidents.",
      feedbackWrong: "Look again — the hazard is the pedestrian crossing without checking for the approaching vehicle."
    }
  ];
  HAZARDS.forEach(h => { h.answered = false; h.resultType = null; });
  const TOTAL_HAZARDS = HAZARDS.length;
  const MAX_POSSIBLE_SCORE = TOTAL_HAZARDS * 10;

  /* ============================== ENTITIES =============================== */
  const player = {
    x: 232, y: 255, w: 16, h: 24,
    facing: "down",
    moving: false,
    animT: 0,
    hitCooldown: 0
  };

  // Moving hazards that patrol the vehicle pathway. Colliding costs time.
  const movers = [
    { type: "forklift", x: 30, y: 300, w: 44, h: 30, minX: 30, maxX: 190, dir: 1, speed: 62 },
    { type: "vehicle", x: 300, y: 302, w: 48, h: 28, minX: 290, maxX: 440, dir: -1, speed: 82 }
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
          showToast(`Contact! -${COLLISION_PENALTY}s — that's exactly the risk we're teaching about.`);
          player.x += m.dir * -14;
          break;
        }
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

  /* ================================ RENDER ================================= */
  function drawFloor() {
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Raised access floor: grid tiles with corner perforation dots
    const tile = 30;
    for (let y = 16; y < CANVAS_H - 16; y += tile) {
      for (let x = 16; x < CANVAS_W - 16; x += tile) {
        const even = ((x / tile) + (y / tile)) % 2 === 0;
        ctx.fillStyle = even ? COLORS.floorLight : COLORS.floorDark;
        ctx.fillRect(x, y, tile, tile);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(x + 3, y + 3, 2, 2);
        ctx.fillRect(x + tile - 5, y + 3, 2, 2);
        ctx.fillRect(x + 3, y + tile - 5, 2, 2);
        ctx.fillRect(x + tile - 5, y + tile - 5, 2, 2);
      }
    }

    for (const z of ZONES) {
      ctx.fillStyle = z.tint;
      ctx.fillRect(z.x, z.y, z.w, z.h);
    }

    // Pathway asphalt + dashed centerline
    const path = ZONES[4];
    const pathGrad = ctx.createLinearGradient(0, path.y, 0, path.y + path.h);
    pathGrad.addColorStop(0, "rgba(10,10,14,0.55)");
    pathGrad.addColorStop(1, "rgba(10,10,14,0.7)");
    ctx.fillStyle = pathGrad;
    ctx.fillRect(path.x, path.y, path.w, path.h);
    ctx.strokeStyle = COLORS.yellow;
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(path.x, path.y + path.h / 2);
    ctx.lineTo(path.x + path.w, path.y + path.h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // overhead cable tray along the center corridor for realism
    ctx.fillStyle = "#20242e";
    ctx.fillRect(220, 16, 40, 8);
    ctx.strokeStyle = "#12141a";
    for (let cx = 224; cx < 258; cx += 6) {
      ctx.beginPath(); ctx.moveTo(cx, 16); ctx.lineTo(cx, 24); ctx.stroke();
    }

    // zone labels
    ctx.font = "bold 10px Consolas, monospace";
    ctx.textBaseline = "top";
    for (const z of ZONES) {
      ctx.fillStyle = "rgba(232,234,237,0.6)";
      const lx = z.name === "VEHICLE PATHWAY" ? z.x + 8 : z.x + 6;
      const ly = z.name === "VEHICLE PATHWAY" ? z.y - 13 : z.y + 4;
      ctx.fillText(z.name, lx, ly);
    }

    ctx.fillStyle = COLORS.wall;
    for (const w of WALLS) ctx.fillRect(w.x, w.y, w.w, w.h);
  }

  function drawObstacle(o) {
    switch (o.type) {
      case "rack":
      case "rack-fan": {
        const grad = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y);
        grad.addColorStop(0, "#1c1f27");
        grad.addColorStop(0.5, "#2c313d");
        grad.addColorStop(1, "#1c1f27");
        ctx.fillStyle = grad;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = "#0d0e12";
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);

        for (let i = 0; i < 7; i++) {
          const ly = o.y + 10 + i * ((o.h - 24) / 7);
          const lit = (i + Math.floor(performance.now() / 600)) % 4 === 0;
          ctx.fillStyle = lit ? COLORS.green : (i % 2 === 0 ? COLORS.blue : "#3a4150");
          ctx.shadowColor = lit ? COLORS.green : "transparent";
          ctx.shadowBlur = lit ? 4 : 0;
          ctx.fillRect(o.x + 6, ly, 5, 3);
          ctx.fillRect(o.x + o.w - 11, ly, 5, 3);
          ctx.shadowBlur = 0;
        }

        if (o.type === "rack-fan") {
          const cx = o.x + o.w / 2, cy = o.y + o.h - 20;
          const fanGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 14);
          fanGrad.addColorStop(0, "#3a4150");
          fanGrad.addColorStop(1, "#181a20");
          ctx.fillStyle = fanGrad;
          ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = COLORS.red;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.stroke();
          const spin = (performance.now() / 130) % (Math.PI * 2);
          ctx.strokeStyle = "#c3c9d6";
          ctx.lineWidth = 2;
          for (let i = 0; i < 4; i++) {
            const a = spin + i * (Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12);
            ctx.stroke();
          }
        }
        break;
      }
      case "crateStack": {
        const grad = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        grad.addColorStop(0, "#9c6a3f");
        grad.addColorStop(1, "#734a26");
        ctx.fillStyle = grad;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = "#4a2f18";
        ctx.lineWidth = 2;
        for (let gx = o.x; gx < o.x + o.w; gx += 22) {
          ctx.strokeRect(gx, o.y, 22, o.h / 2);
          ctx.strokeRect(gx, o.y + o.h / 2, 22, o.h / 2);
        }
        break;
      }
      case "suspendedLoad": {
        // overhead gantry rail + chains + hanging pallet, worker standing beneath
        const cx = o.x + o.w / 2;
        ctx.fillStyle = "#22262f";
        ctx.fillRect(o.x - 20, 92, o.w + 40, 8); // rail
        ctx.strokeStyle = "#8b8f99";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx - 12, 100); ctx.lineTo(cx - 8, 128); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 12, 100); ctx.lineTo(cx + 8, 128); ctx.stroke();
        // pallet
        ctx.fillStyle = "#8a5a34";
        ctx.fillRect(cx - 20, 128, 40, 14);
        ctx.strokeStyle = "#4a2f18";
        for (let i = -18; i <= 18; i += 8) {
          ctx.beginPath(); ctx.moveTo(cx + i, 128); ctx.lineTo(cx + i, 142); ctx.stroke();
        }
        // worker figure looking at phone, standing right under the load
        const wx = o.x, wy = o.y;
        ctx.fillStyle = "#2b3140";
        ctx.fillRect(wx + 2, wy + 10, 6, 12); // legs
        ctx.fillStyle = COLORS.yellow;
        ctx.fillRect(wx, wy, 10, 12); // hi-vis torso
        ctx.fillStyle = "#f0c39a";
        ctx.fillRect(wx + 2, wy - 6, 6, 7); // head
        ctx.fillStyle = COLORS.blue;
        ctx.fillRect(wx + 8, wy + 2, 3, 4); // phone glow
        ctx.shadowColor = COLORS.blue; ctx.shadowBlur = 4;
        ctx.fillRect(wx + 8, wy + 2, 3, 4);
        ctx.shadowBlur = 0;
        break;
      }
      case "workbench": {
        ctx.fillStyle = "#4b5163";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = "#6a7286";
        ctx.fillRect(o.x, o.y, o.w, 6);
        ctx.fillStyle = "#3a3f4c";
        ctx.fillRect(o.x + 4, o.y + o.h - 8, 6, 8);
        ctx.fillRect(o.x + o.w - 10, o.y + o.h - 8, 6, 8);
        ctx.fillStyle = COLORS.yellow;
        ctx.fillRect(o.x + 12, o.y + 12, 16, 8);
        ctx.fillStyle = "#c0392b";
        ctx.fillRect(o.x + 38, o.y + 14, 12, 6);
        break;
      }
      case "conveyor": {
        ctx.fillStyle = "#2c303a";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = "#454b58";
        ctx.fillRect(o.x, o.y, o.w, 6);
        ctx.fillRect(o.x, o.y + o.h - 6, o.w, 6);
        ctx.strokeStyle = "#5b6274";
        ctx.lineWidth = 2;
        const off = (performance.now() / 110) % 16;
        for (let bx = -16 + off; bx < o.w; bx += 16) {
          ctx.beginPath();
          ctx.moveTo(o.x + bx, o.y + 6);
          ctx.lineTo(o.x + bx + 10, o.y + o.h - 6);
          ctx.stroke();
        }
        // technician reaching in without LOTO (H6)
        ctx.fillStyle = "#2b3140";
        ctx.fillRect(o.x + o.w - 20, o.y - 18, 8, 10); // legs/torso lean
        ctx.fillStyle = COLORS.blue;
        ctx.fillRect(o.x + o.w - 24, o.y - 10, 20, 12);
        ctx.fillStyle = "#f0c39a";
        ctx.fillRect(o.x + o.w - 10, o.y - 20, 8, 8); // head
        break;
      }
      case "hotPipe": {
        const glow = 0.5 + Math.sin(performance.now() / 260) * 0.25;
        ctx.save();
        ctx.shadowColor = `rgba(234,67,53,${glow})`;
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#7a2f22";
        ctx.fillRect(o.x, o.y, o.w + 30, o.h);
        ctx.restore();
        ctx.fillStyle = "#a8402c";
        ctx.fillRect(o.x, o.y + 2, o.w + 30, o.h - 4);
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = "#5c1c12";
          ctx.fillRect(o.x + 10 + i * 40, o.y - 2, 4, o.h + 4);
        }
        break;
      }
      case "chemShelf": {
        ctx.fillStyle = "#454b58";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = "#5b6274";
        ctx.fillRect(o.x, o.y, o.w, 5);
        const drums = [
          { c: COLORS.green, labeled: true },
          { c: "#9aa1b2", labeled: false }, // the unlabeled one (H9)
          { c: COLORS.red, labeled: true },
          { c: COLORS.green, labeled: true }
        ];
        drums.forEach((d, i) => {
          const dx = o.x + 8 + i * 34;
          const dGrad = ctx.createLinearGradient(dx, 0, dx + 24, 0);
          dGrad.addColorStop(0, d.c);
          dGrad.addColorStop(0.5, "#ffffff33");
          dGrad.addColorStop(1, d.c);
          ctx.fillStyle = dGrad;
          ctx.fillRect(dx, o.y + 6, 24, 34);
          ctx.fillStyle = "#1b1f29";
          ctx.fillRect(dx, o.y + 6, 24, 5);
          if (d.labeled) {
            ctx.fillStyle = COLORS.yellow;
            ctx.beginPath();
            ctx.moveTo(dx + 12, o.y + 16); ctx.lineTo(dx + 18, o.y + 22);
            ctx.lineTo(dx + 12, o.y + 28); ctx.lineTo(dx + 6, o.y + 22);
            ctx.closePath(); ctx.fill();
          }
        });
        break;
      }
      case "eyewashClean": {
        ctx.fillStyle = "#3a3f4c";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(o.x + 8, o.y + 6, o.w - 16, 10);
        ctx.fillStyle = "#0d2818";
        ctx.font = "bold 8px monospace";
        ctx.fillText("EYEWASH", o.x + 9, o.y + 8);
        ctx.beginPath();
        ctx.arc(o.x + 15, o.y + 32, 8, 0, Math.PI * 2);
        ctx.arc(o.x + o.w - 15, o.y + 32, 8, 0, Math.PI * 2);
        ctx.fillStyle = "#bfe3cd";
        ctx.fill();
        break;
      }
    }
  }

  function drawPedestrian(p) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(p.x + 6, p.y + 22, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2b3140";
    ctx.fillRect(p.x + 2, p.y + 12, 5, 10);
    ctx.fillRect(p.x + 8, p.y + 12, 5, 10);
    ctx.fillStyle = p.tone;
    ctx.fillRect(p.x, p.y, 12, 13);
    ctx.fillStyle = "#f0c39a";
    ctx.fillRect(p.x + 2, p.y - 6, 8, 7);
  }

  function drawMover(m) {
    ctx.save();
    if (m.type === "forklift") {
      const body = ctx.createLinearGradient(m.x, m.y, m.x, m.y + m.h);
      body.addColorStop(0, "#ffd23f");
      body.addColorStop(1, "#e0a800");
      ctx.fillStyle = body;
      ctx.fillRect(m.x, m.y, m.w * 0.68, m.h);
      ctx.fillStyle = "#2b3140";
      ctx.fillRect(m.x + m.w * 0.5, m.y + 2, m.w * 0.2, m.h * 0.55);
      ctx.fillStyle = "#9aa1b2";
      const forkX = m.dir > 0 ? m.x + m.w * 0.68 : m.x - 12;
      ctx.fillRect(forkX, m.y + m.h - 8, 12, 5);
      ctx.fillRect(forkX, m.y + 3, 12, 5);
      // beacon light
      const blink = Math.sin(performance.now() / 150) > 0;
      ctx.fillStyle = blink ? "#ff8a00" : "#7a4a00";
      ctx.beginPath(); ctx.arc(m.x + m.w * 0.34, m.y - 3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#141414";
      ctx.beginPath(); ctx.arc(m.x + 7, m.y + m.h, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(m.x + m.w * 0.55, m.y + m.h, 5, 0, Math.PI * 2); ctx.fill();
    } else {
      const body = ctx.createLinearGradient(m.x, m.y, m.x, m.y + m.h);
      body.addColorStop(0, "#5b96f7");
      body.addColorStop(1, "#2f6bd6");
      ctx.fillStyle = body;
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.fillStyle = "#cfe0ff";
      ctx.fillRect(m.x + 6, m.y + 3, m.w - 12, 9);
      ctx.fillStyle = "#fff7cc";
      const lightX = m.dir > 0 ? m.x + m.w - 4 : m.x;
      ctx.fillRect(lightX, m.y + m.h / 2 - 2, 4, 4);
      ctx.fillStyle = "#141414";
      ctx.beginPath(); ctx.arc(m.x + 10, m.y + m.h, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(m.x + m.w - 10, m.y + m.h, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayer() {
    const { x, y, w, h } = player;
    const bob = player.moving ? Math.sin(player.animT * 10) * 1.5 : 0;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h + 2, w / 2 + 1, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#2b2f3a";
    ctx.fillRect(x + 2, y + h - 8 + bob * 0.2, 5, 8);
    ctx.fillRect(x + w - 7, y + h - 8 - bob * 0.2, 5, 8);

    const vestGrad = ctx.createLinearGradient(x, y + h - 20, x, y + h - 4);
    vestGrad.addColorStop(0, "#ffd23f");
    vestGrad.addColorStop(1, "#f7b500");
    ctx.fillStyle = vestGrad;
    ctx.fillRect(x + 1, y + h - 20 + bob, w - 2, 14);
    ctx.strokeStyle = "#e8eaed";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 1, y + h - 13 + bob); ctx.lineTo(x + w - 1, y + h - 13 + bob);
    ctx.stroke();

    ctx.fillStyle = "#f0c39a";
    ctx.fillRect(x + 3, y + h - 25 + bob, w - 6, 7);

    ctx.fillStyle = COLORS.blue;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h - 27 + bob, w / 2, 4, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x + 2, y + h - 28 + bob, w - 4, 4);

    ctx.fillStyle = "#1a1a1a";
    let dx = 0, dy = 0;
    if (player.facing === "up") dy = -1;
    if (player.facing === "down") dy = 1;
    if (player.facing === "left") dx = -1;
    if (player.facing === "right") dx = 1;
    ctx.fillRect(x + w / 2 - 1 + dx * 5, y + h - 22 + bob + dy * 2, 2, 2);
  }

  function drawHazardMarkers() {
    const t = performance.now() / 300;
    for (const h of HAZARDS) {
      if (h.answered) {
        ctx.fillStyle = COLORS.green;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0d2818";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText("✓", h.x, h.y + 4);
        ctx.textAlign = "left";
        continue;
      }
      const pulse = 1 + Math.sin(t + h.x) * 0.12;
      const r = HAZARD_MARKER_R * pulse;
      const near = dist(player.x + player.w / 2, player.y + player.h / 2, h.x, h.y) <= INTERACT_RADIUS;

      ctx.save();
      ctx.translate(h.x, h.y);
      if (near) { ctx.shadowColor = COLORS.yellow; ctx.shadowBlur = 8; }
      ctx.fillStyle = near ? COLORS.yellow : COLORS.red;
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.9, r * 0.8);
      ctx.lineTo(-r * 0.9, r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("!", 0, r * 0.55);
      ctx.textAlign = "left";
      ctx.restore();
    }
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.35,
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.75
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  function render() {
    drawFloor();
    for (const o of OBSTACLES) drawObstacle(o);
    for (const p of PEDESTRIANS) drawPedestrian(p);
    for (const m of movers) drawMover(m);
    drawHazardMarkers();
    drawPlayer();
    drawVignette();
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
    movers[1].x = 300; movers[1].dir = -1;
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
  requestAnimationFrame(tick);
})();
