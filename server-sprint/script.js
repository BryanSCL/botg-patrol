/* =====================================================================
   SERVER SPRINT: RACE THE RISK
   BotG Safety Campaign — Bodily Contact hazards
   ---------------------------------------------------------------------
   Self-contained arcade lane-runner. No external assets or libraries.
   All art is drawn procedurally in pixel style; all audio is WebAudio.

   EDITING GUIDE (see README.md for detail):
   - CONFIG          : speed, run length, spawn pacing, scoring values
   - ZONES           : zone order, colours, hazard weighting
   - HAZARD_DEFS     : hazard catalogue + BotG category + safe response
   - DECISIONS       : rapid-decision scenarios
   ===================================================================== */

'use strict';

/* =====================================================================
   1. CONFIG — the main tuning table
   ===================================================================== */
const CONFIG = {
  W: 960, H: 540,                 // internal canvas resolution (16:9)
  PX: 4,                          // pixel-art unit size

  RUN_DURATION: 90,               // seconds for a full sprint (1.5 min max)
  LIVES: 3,                       // contacts allowed before the run ends
  BASE_SPEED: 300,                // world scroll px/s at start
  MAX_SPEED: 600,                 // world scroll px/s at the end

  LANES: [330, 480, 630],         // lane centre x positions
  LANE_W: 128,                    // lane visual width
  PLAYER_Y: 440,                  // player's fixed y on screen
  HIT_BAND: 24,                   // +/- px around PLAYER_Y that counts as contact
  HIT_X: 48,                      // horizontal px overlap needed for contact
                                  // (uses the player's VISUAL position, so
                                  //  mid-lane-change near-misses don't count)

  SPAWN_GAP_EARLY: 1.15,          // seconds between hazard waves at start
  SPAWN_GAP_LATE: 0.60,           // seconds between hazard waves at full speed
  FIRST_HAZARD_DELAY: 0.4,        // action within the first seconds

  JUMP_TIME: 0.58,                // seconds airborne
  LANE_SNAP: 14,                  // lane-change lerp speed (higher = snappier)

  // Scoring — BotG tokens (coins) are the main score driver
  SCORE_DIST: 0.02,               // small trickle per px travelled
  SCORE_AVOID: 50,                // per hazard avoided (x multiplier)
  SCORE_TOKEN: 150,               // per BotG token collected (x multiplier)
  SCORE_DECISION: 500,            // correct rapid decision
  QUIZ_POINTS: 1000,              // per correct video-quiz answer
  SCORE_REACT_BONUS: 60,          // fast-reaction bonus (reaction < 0.6s)
  PENALTY_CONTACT: 250,           // deducted on hazard contact
  PENALTY_DECISION: 150,          // deducted on wrong / missed decision

  STREAK_STEPS: [5, 10, 15],      // streak needed for x2 / x3 / x4
  INCIDENT_MIN: 1.0,              // incident card minimum read time before tap-to-continue
  INCIDENT_MAX: 8.0,              // auto-continue fallback if nobody taps
  REWIND_PX: 380,                 // how far hazards are pushed back on rewind
  INVULN_AFTER_INCIDENT: 1.6,     // grace seconds after resuming

  DECISION_TIMES: [0.15, 0.35, 0.55, 0.75],  // run fractions where rapid decisions fire
  DECISION_WINDOW: 8.0,           // generous timer — text waits for the player's tap
  DECISION_HOLD: 2.6,             // seconds the answer feedback stays (tap to skip)
};

/* =====================================================================
   2. ZONES — seamless site progression
   Each zone: name, floor/wall colours, and a weighted hazard pool.
   Weights are relative; hazards are defined in HAZARD_DEFS below.
   ===================================================================== */
const ZONES = [
  { name: 'WAREHOUSE',        floor: '#3a3f4d', floorAlt: '#343947', wall: '#23273a', accent: '#FBBC04',
    pool: { fallingBox: 4, shelfSpill: 3, palletNails: 2, forklift: 2, trolley: 1 } },
  { name: 'SERVER HALL',      floor: '#2c3550', floorAlt: '#273049', wall: '#1a2138', accent: '#4285F4',
    pool: { rackDoorLow: 4, swingDoor: 3, sharpRail: 3, fallingBox: 1, trolley: 1 } },
  { name: 'LOADING BAY',      floor: '#41403c', floorAlt: '#3b3a36', wall: '#2a2926', accent: '#EA4335',
    pool: { forklift: 5, overheadLoad: 3, fallingBox: 2, palletNails: 2, pinchDoors: 1 } },
  { name: 'MAINTENANCE AREA', floor: '#38414a', floorAlt: '#323b44', wall: '#222a31', accent: '#34A853',
    pool: { sharpRail: 3, palletNails: 3, swingDoor: 2, pinchDoors: 2, forklift: 2 } },
  { name: 'PLANT ROOM',       floor: '#33404a', floorAlt: '#2d3a44', wall: '#1e282f', accent: '#4285F4',
    pool: { pinchDoors: 4, rackDoorLow: 3, forklift: 2, overheadLoad: 2, sharpRail: 2 } },
];

/* =====================================================================
   3. HAZARD CATALOGUE
   evade values:
     'lane'   — must NOT be in the hazard lane when it reaches you
     'duck'   — must be ducking (same lane) when it reaches you
     'jump'   — must be airborne (same lane) when it reaches you
     'timing' — vehicle sweeps across; must not overlap its path
     'gap'    — pinch point; must be in the one open lane
   ===================================================================== */
const HAZARD_DEFS = {
  fallingBox: {
    cat: 'Falling Objects', evade: 'lane',
    cue: 'Wobbling box tipping off the shelf edge',
    safe: 'Switch lane — stay out of the drop zone',
  },
  shelfSpill: {
    cat: 'Falling Objects', evade: 'lane',
    cue: 'Unsecured items stacked past the shelf edge',
    safe: 'Switch lane away from the loaded edge',
  },
  overheadLoad: {
    cat: 'Falling Objects', evade: 'lane',
    cue: 'Shadow of a suspended load entering the lane',
    safe: 'Never walk under a suspended load — change lane',
  },
  rackDoorLow: {
    cat: 'Struck By / Against', evade: 'duck',
    cue: 'Open rack door protruding at head height',
    safe: 'Duck below the strike line',
  },
  swingDoor: {
    cat: 'Struck By / Against', evade: 'lane',
    cue: 'Cabinet door swinging into the pedestrian route',
    safe: 'Move outside the swing path',
  },
  sharpRail: {
    cat: 'Sharp Objects', evade: 'jump',
    cue: 'Protruding server rail with exposed sheet-metal edge',
    safe: 'Jump clear of the exposed edge',
  },
  palletNails: {
    cat: 'Sharp Objects', evade: 'jump',
    cue: 'Damaged pallet with exposed nails on the floor',
    safe: 'Jump clear — report damaged pallets',
  },
  forklift: {
    cat: 'Moving Vehicles', evade: 'timing',
    cue: 'Forklift horn and beacon before it crossed',
    safe: 'Stop, look, and time the crossing — never race a vehicle',
  },
  trolley: {
    cat: 'Moving Vehicles', evade: 'timing',
    cue: 'Loaded trolley entering the walkway',
    safe: 'Give vehicles right of way — move to a clear lane',
  },
  pinchDoors: {
    cat: 'Caught In / Between', evade: 'gap',
    cue: 'Barrier doors closing across the route',
    safe: 'Never enter a closing gap — take the open route',
  },
};

/* =====================================================================
   4. RAPID DECISION SCENARIOS (kept rare — one per DECISION_TIMES entry)
   ===================================================================== */
const DECISIONS = [
  {
    text: 'A colleague is about to walk under an unstable suspended load.',
    options: ['WARN THE WORKER', 'KEEP RUNNING', 'FOLLOW THEIR ROUTE'],
    correct: 0,
    why: 'BotG: intervene when you observe risk — a 2-second warning prevents a struck-by incident.',
  },
  {
    text: 'A forklift reverses toward a blind corner you need to pass.',
    options: ['SPRINT PAST IT', 'MAKE EYE CONTACT & WAIT', 'WALK CLOSE BEHIND IT'],
    correct: 1,
    why: 'BotG: confirm the operator has seen you before entering a vehicle path.',
  },
  {
    text: 'A rack door hangs open into the walkway with a sharp edge.',
    options: ['SQUEEZE PAST IT', 'CLOSE & LATCH IT', 'IGNORE — NOT YOUR RACK'],
    correct: 1,
    why: 'BotG: fix simple contact hazards on the spot — an open door is everyone’s hazard.',
  },
  {
    text: 'You spot a pallet stacked past the shelf edge above a busy walkway.',
    options: ['WALK UNDER QUICKLY', 'REPORT & CORDON THE AREA', 'PUSH IT BACK YOURSELF'],
    correct: 1,
    why: 'BotG: an unstable load overhead is a falling-object risk — keep people out and report it.',
  },
  {
    text: 'A trolley is parked blocking the pedestrian lane next to moving forklifts.',
    options: ['STEP INTO THE FORKLIFT LANE', 'STOP & MOVE THE TROLLEY CLEAR', 'CLIMB OVER THE TROLLEY'],
    correct: 1,
    why: 'BotG: never trade one hazard for another — restore the safe pedestrian route first.',
  },
];

/* =====================================================================
   4b. VIDEO QUIZ — "Precautions for Machinery Hazards"
   Shown after the run, before the final score is tabulated.
   Each correct answer adds CONFIG.QUIZ_POINTS to the total score.
   ===================================================================== */
const QUIZ = [
  {
    q: 'In the video, which situations are given as requiring workers to be trained before operating equipment?',
    opts: [
      'New workers, new machinery, or changes in work processes',
      'Only when a workplace accident has already occurred',
      'Only during annual refresher training sessions',
      'Only when requested by the worker themselves',
    ],
    correct: 0,
  },
  {
    q: 'According to the video, lockout and tagout must be applied before which of the following activities?',
    opts: [
      'Only before major machine overhauls scheduled months in advance',
      'Only during the machine\'s initial installation',
      'Cleaning, lubricating, inspecting, repairing, adjusting, or clearing a jam',
      'Only when a machine is being permanently decommissioned',
    ],
    correct: 2,
  },
  {
    q: 'In the video, what should a worker do if a safeguard device such as a guard or interlock is found to be damaged or not working?',
    opts: [
      'Replace the guard themselves before continuing',
      'Report it immediately and not continue as normal',
      'Ignore it if the task will only take a few minutes',
      'Continue working carefully and report it at the end of the shift',
    ],
    correct: 1,
  },
];

/* =====================================================================
   4c. LOCALISATION — English, Traditional Chinese, Thai, Japanese
   All display text lives here. Game logic (correct answers, hazard
   behaviour) stays in the English structures above; these are lookups.
   ===================================================================== */
const I18N = {
  en: {
    zones: ['WAREHOUSE', 'SERVER HALL', 'LOADING BAY', 'MAINTENANCE AREA', 'PLANT ROOM'],
    ui: {
      menuBadge: 'BotG SAFETY CAMPAIGN', subtitle: 'RACE THE RISK',
      tagline: 'Urgent server alert. Sprint the site — spot every Bodily&nbsp;Contact risk on the way.',
      opId: 'OPERATOR ID', start: '&#9654; START SPRINT',
      hint1: '<span class="key">&#9664;</span><span class="key">&#9654;</span> or <span class="key">A</span><span class="key">D</span> change lane',
      hint2: '<span class="key">&#9650;</span> or <span class="key">W</span> jump &nbsp;&nbsp; <span class="key">&#9660;</span> or <span class="key">S</span> duck',
      hint3: '<span class="key">1</span><span class="key">2</span><span class="key">3</span> rapid decisions',
      lgdLane: 'FALLING LOAD &rarr; SWITCH LANE', lgdDuck: 'LOW DOOR &rarr; DUCK', lgdJump: 'SHARP EDGE &rarr; JUMP',
      lgdVeh: 'VEHICLE &rarr; TIME IT', lgdPinch: 'PINCH POINT &rarr; STAY CLEAR',
      viewBoard: 'VIEW LEADERBOARD', boardTitle: 'SITE LEADERBOARD &mdash; TOP 10',
      thRank: '#', thName: 'NAME', thScore: 'SCORE', thAcc: 'ACC', thStreak: 'STREAK',
      back: 'BACK', boardEmpty: 'NO SPRINTS RECORDED YET',
      reportBadge: 'BotG PERFORMANCE REPORT', again: '&#8635; PLAY AGAIN', board: 'LEADERBOARD',
      quizBadge: 'VIDEO QUIZ &mdash; PRECAUTIONS FOR MACHINERY HAZARDS',
      quizRef: 'These 3 questions are based on the <strong>&ldquo;Precautions for Machinery Hazards&rdquo;</strong> video sent to all participants before the campaign.',
      quizProgress: 'QUESTION {n} OF {t}', quizCorrect: '✔ CORRECT  +{p} POINTS',
      quizWrong: '✘ NOT QUITE — the safe answer is highlighted',
      quizNext: 'NEXT QUESTION ▶', quizSee: 'SEE MY REPORT ▶',
      sAcc: 'OBSERVATION ACCURACY', sReact: 'AVG REACTION TIME', sAvoid: 'HAZARDS AVOIDED',
      sContact: 'CONTACT INCIDENTS', sStreak: 'BEST STREAK', sTokens: 'BotG TOKENS',
      sDecisions: 'RAPID DECISIONS', sQuiz: 'VIDEO QUIZ', sDist: 'DISTANCE',
    },
    ratings: { champion: 'INCIDENT ZERO CHAMPION', specialist: 'BotG SPECIALIST', spotter: 'RISK SPOTTER', alert: 'ALERT OPERATOR', developing: 'DEVELOPING OBSERVER' },
    c: {
      alert: '⚠ URGENT SERVER ALERT ⚠', go: 'GO!', sub: 'Reach the server hall. Observe every risk.',
      decisionHdr: '⚠ RAPID DECISION', goodObs: 'GOOD OBSERVATION', tooSlow: 'TOO SLOW', unsafeChoice: 'UNSAFE CHOICE',
      tapCont: '▶ TAP OR PRESS ANY KEY TO CONTINUE',
      missedObs: '⚠ BotG MISSED OBSERVATION', catLbl: 'CATEGORY: ', cueLbl: 'Missed cue: ', safeLbl: 'Safer response: ',
      livesLeft: 'LIVES LEFT', noLives: 'NO LIVES LEFT — SPRINT OVER',
      tapReport: '▶ TAP OR PRESS ANY KEY FOR YOUR REPORT', tapResume: '⏪ TAP OR PRESS ANY KEY TO CONTINUE',
      duckLbl: '▼ DUCK', jumpLbl: '▲ JUMP', streakWord: 'STREAK!',
      complete: 'SPRINT COMPLETE', outOfLives: 'OUT OF LIVES',
    },
    haz: {
      fallingBox: { cat: 'Falling Objects', cue: 'Wobbling box tipping off the shelf edge', safe: 'Switch lane — stay out of the drop zone' },
      shelfSpill: { cat: 'Falling Objects', cue: 'Unsecured items stacked past the shelf edge', safe: 'Switch lane away from the loaded edge' },
      overheadLoad: { cat: 'Falling Objects', cue: 'Shadow of a suspended load entering the lane', safe: 'Never walk under a suspended load — change lane' },
      rackDoorLow: { cat: 'Struck By / Against', cue: 'Open rack door protruding at head height', safe: 'Duck below the strike line' },
      swingDoor: { cat: 'Struck By / Against', cue: 'Cabinet door swinging into the pedestrian route', safe: 'Move outside the swing path' },
      sharpRail: { cat: 'Sharp Objects', cue: 'Protruding server rail with exposed sheet-metal edge', safe: 'Jump clear of the exposed edge' },
      palletNails: { cat: 'Sharp Objects', cue: 'Damaged pallet with exposed nails on the floor', safe: 'Jump clear — report damaged pallets' },
      forklift: { cat: 'Moving Vehicles', cue: 'Forklift horn and beacon before it crossed', safe: 'Stop, look, and time the crossing — never race a vehicle' },
      trolley: { cat: 'Moving Vehicles', cue: 'Loaded trolley entering the walkway', safe: 'Give vehicles right of way — move to a clear lane' },
      pinchDoors: { cat: 'Caught In / Between', cue: 'Barrier doors closing across the route', safe: 'Never enter a closing gap — take the open route' },
    },
    dec: [
      { text: 'A colleague is about to walk under an unstable suspended load.', options: ['WARN THE WORKER', 'KEEP RUNNING', 'FOLLOW THEIR ROUTE'], why: 'BotG: intervene when you observe risk — a 2-second warning prevents a struck-by incident.' },
      { text: 'A forklift reverses toward a blind corner you need to pass.', options: ['SPRINT PAST IT', 'MAKE EYE CONTACT & WAIT', 'WALK CLOSE BEHIND IT'], why: 'BotG: confirm the operator has seen you before entering a vehicle path.' },
      { text: 'A rack door hangs open into the walkway with a sharp edge.', options: ['SQUEEZE PAST IT', 'CLOSE & LATCH IT', 'IGNORE — NOT YOUR RACK'], why: 'BotG: fix simple contact hazards on the spot — an open door is everyone’s hazard.' },
      { text: 'You spot a pallet stacked past the shelf edge above a busy walkway.', options: ['WALK UNDER QUICKLY', 'REPORT & CORDON THE AREA', 'PUSH IT BACK YOURSELF'], why: 'BotG: an unstable load overhead is a falling-object risk — keep people out and report it.' },
      { text: 'A trolley is parked blocking the pedestrian lane next to moving forklifts.', options: ['STEP INTO THE FORKLIFT LANE', 'STOP & MOVE THE TROLLEY CLEAR', 'CLIMB OVER THE TROLLEY'], why: 'BotG: never trade one hazard for another — restore the safe pedestrian route first.' },
    ],
    quiz: [
      { q: 'In the video, which situations are given as requiring workers to be trained before operating equipment?', opts: ['New workers, new machinery, or changes in work processes', 'Only when a workplace accident has already occurred', 'Only during annual refresher training sessions', 'Only when requested by the worker themselves'] },
      { q: 'According to the video, lockout and tagout must be applied before which of the following activities?', opts: ['Only before major machine overhauls scheduled months in advance', 'Only during the machine’s initial installation', 'Cleaning, lubricating, inspecting, repairing, adjusting, or clearing a jam', 'Only when a machine is being permanently decommissioned'] },
      { q: 'In the video, what should a worker do if a safeguard device such as a guard or interlock is found to be damaged or not working?', opts: ['Replace the guard themselves before continuing', 'Report it immediately and not continue as normal', 'Ignore it if the task will only take a few minutes', 'Continue working carefully and report it at the end of the shift'] },
    ],
  },

  zh: {
    zones: ['倉庫', '伺服器機房', '卸貨區', '維修區', '機電室'],
    ui: {
      menuBadge: 'BotG 安全宣導活動', subtitle: '與風險賽跑',
      tagline: '伺服器緊急警報!全速穿越廠區——沿途找出每一個人身接觸危害。',
      opId: '操作員代號', start: '&#9654; 開始衝刺',
      hint1: '<span class="key">&#9664;</span><span class="key">&#9654;</span> 或 <span class="key">A</span><span class="key">D</span> 切換跑道',
      hint2: '<span class="key">&#9650;</span> 或 <span class="key">W</span> 跳躍 &nbsp;&nbsp; <span class="key">&#9660;</span> 或 <span class="key">S</span> 蹲下',
      hint3: '<span class="key">1</span><span class="key">2</span><span class="key">3</span> 快速判斷',
      lgdLane: '墜落物 &rarr; 切換跑道', lgdDuck: '低矮門板 &rarr; 蹲下', lgdJump: '尖銳邊緣 &rarr; 跳躍',
      lgdVeh: '車輛 &rarr; 抓準時機', lgdPinch: '夾捲點 &rarr; 保持距離',
      viewBoard: '查看排行榜', boardTitle: '現場排行榜 &mdash; 前 10 名',
      thRank: '名次', thName: '名字', thScore: '分數', thAcc: '準確率', thStreak: '連續',
      back: '返回', boardEmpty: '尚無衝刺紀錄',
      reportBadge: 'BotG 表現報告', again: '&#8635; 再玩一次', board: '排行榜',
      quizBadge: '影片測驗 &mdash; 機械危害預防措施',
      quizRef: '以下 3 題出自活動前發送給所有參與者的<strong>「Precautions for Machinery Hazards(機械危害預防措施)」</strong>影片。',
      quizProgress: '第 {n} 題,共 {t} 題', quizCorrect: '✔ 答對了! +{p} 分',
      quizWrong: '✘ 答錯了——正確答案已標示',
      quizNext: '下一題 ▶', quizSee: '查看我的報告 ▶',
      sAcc: '觀察準確率', sReact: '平均反應時間', sAvoid: '成功避開危害',
      sContact: '接觸事故', sStreak: '最佳連續紀錄', sTokens: 'BotG 代幣',
      sDecisions: '快速判斷', sQuiz: '影片測驗', sDist: '距離',
    },
    ratings: { champion: '零事故冠軍', specialist: 'BotG 專家', spotter: '風險偵察員', alert: '警覺操作員', developing: '觀察力養成中' },
    c: {
      alert: '⚠ 伺服器緊急警報 ⚠', go: '開始!', sub: '趕往伺服器機房,留意每一個風險。',
      decisionHdr: '⚠ 快速判斷', goodObs: '觀察得當', tooSlow: '太慢了', unsafeChoice: '不安全的選擇',
      tapCont: '▶ 點擊或按任意鍵繼續',
      missedObs: '⚠ BotG 錯過的觀察', catLbl: '類別:', cueLbl: '錯過的警示:', safeLbl: '更安全的做法:',
      livesLeft: '剩餘生命', noLives: '生命值用盡——衝刺結束',
      tapReport: '▶ 點擊或按任意鍵查看報告', tapResume: '⏪ 點擊或按任意鍵繼續',
      duckLbl: '▼ 蹲下', jumpLbl: '▲ 跳躍', streakWord: '連擊!',
      complete: '衝刺完成', outOfLives: '生命值用盡',
    },
    haz: {
      fallingBox: { cat: '墜落物', cue: '貨架邊緣的紙箱搖晃欲墜', safe: '切換跑道——遠離墜落區' },
      shelfSpill: { cat: '墜落物', cue: '物品堆放超出貨架邊緣且未固定', safe: '切換跑道,遠離超載的貨架邊緣' },
      overheadLoad: { cat: '墜落物', cue: '吊掛重物的陰影進入跑道', safe: '切勿從吊掛重物下方通過——切換跑道' },
      rackDoorLow: { cat: '撞擊/碰撞', cue: '機櫃門開啟並突出於頭部高度', safe: '蹲下,從撞擊線下方通過' },
      swingDoor: { cat: '撞擊/碰撞', cue: '櫃門擺動進入人行通道', safe: '移動到門的擺動範圍之外' },
      sharpRail: { cat: '尖銳物品', cue: '伺服器滑軌突出,金屬板邊緣外露', safe: '跳過外露的尖銳邊緣' },
      palletNails: { cat: '尖銳物品', cue: '破損棧板的鐵釘外露在地面', safe: '跳過並回報破損棧板' },
      forklift: { cat: '移動車輛', cue: '堆高機通過前的喇叭與警示燈', safe: '停下、觀察、抓準時機——切勿與車輛搶道' },
      trolley: { cat: '移動車輛', cue: '載貨推車進入人行通道', safe: '禮讓車輛——移動到淨空的跑道' },
      pinchDoors: { cat: '夾捲/受困', cue: '屏障門正在關閉,橫跨通道', safe: '切勿進入正在關閉的間隙——走開放的通道' },
    },
    dec: [
      { text: '一位同事正要走到不穩固的吊掛重物下方。', options: ['提醒同事', '繼續奔跑', '跟著他走'], why: 'BotG:發現風險就要介入——兩秒的提醒能避免一起撞擊事故。' },
      { text: '一台堆高機正倒車駛向你必經的視線死角。', options: ['快速衝過去', '與駕駛眼神確認後等待', '緊跟在車後走'], why: 'BotG:進入車輛動線前,務必確認駕駛已經看見你。' },
      { text: '一扇機櫃門開著突出到走道上,邊緣銳利。', options: ['硬擠過去', '關上並扣好門', '不是我的機櫃,不管'], why: 'BotG:當場排除簡單的接觸危害——開著的門是所有人的危害。' },
      { text: '你發現一個棧板堆放超出貨架邊緣,下方是繁忙走道。', options: ['快速從下方通過', '回報並圍起該區域', '自己動手推回去'], why: 'BotG:頭頂上不穩的貨物是墜落物風險——先隔離人員並回報。' },
      { text: '一台推車停放擋住人行道,旁邊就是行駛中的堆高機。', options: ['走進堆高機車道', '停下來把推車移開', '從推車上爬過去'], why: 'BotG:切勿用一個危害換另一個危害——先恢復安全的人行動線。' },
    ],
    quiz: [
      { q: '影片中提到,哪些情況下工作人員必須先接受訓練才能操作設備?', opts: ['新進人員、新機械,或作業流程變更時', '只有在職場已發生事故之後', '只有在年度回訓課程期間', '只有在員工自己提出要求時'] },
      { q: '根據影片,在進行下列哪些作業之前必須執行上鎖掛牌(Lockout/Tagout)?', opts: ['只有在數月前就排定的大型檢修之前', '只有在機器初次安裝時', '清潔、潤滑、檢查、維修、調整或排除卡料時', '只有在機器永久除役時'] },
      { q: '影片中提到,若發現護罩或連鎖裝置等安全防護裝置損壞或失效,工作人員應該怎麼做?', opts: ['自行更換護罩後再繼續作業', '立即回報,且不可照常繼續作業', '如果作業只需要幾分鐘就可以不理會', '小心地繼續作業,下班前再回報'] },
    ],
  },

  th: {
    zones: ['คลังสินค้า', 'ห้องเซิร์ฟเวอร์', 'จุดขนถ่ายสินค้า', 'พื้นที่ซ่อมบำรุง', 'ห้องเครื่อง'],
    ui: {
      menuBadge: 'แคมเปญความปลอดภัย BotG', subtitle: 'วิ่งแข่งกับความเสี่ยง',
      tagline: 'สัญญาณเตือนเซิร์ฟเวอร์ฉุกเฉิน! วิ่งผ่านพื้นที่ทำงานและมองหาความเสี่ยงจากการสัมผัสร่างกายทุกจุด',
      opId: 'รหัสผู้ปฏิบัติงาน', start: '&#9654; เริ่มวิ่ง',
      hint1: '<span class="key">&#9664;</span><span class="key">&#9654;</span> หรือ <span class="key">A</span><span class="key">D</span> เปลี่ยนเลน',
      hint2: '<span class="key">&#9650;</span> หรือ <span class="key">W</span> กระโดด &nbsp;&nbsp; <span class="key">&#9660;</span> หรือ <span class="key">S</span> ก้ม',
      hint3: '<span class="key">1</span><span class="key">2</span><span class="key">3</span> ตัดสินใจด่วน',
      lgdLane: 'ของตกจากที่สูง &rarr; เปลี่ยนเลน', lgdDuck: 'ประตูต่ำ &rarr; ก้ม', lgdJump: 'ขอบคม &rarr; กระโดด',
      lgdVeh: 'ยานพาหนะ &rarr; รอจังหวะ', lgdPinch: 'จุดหนีบ &rarr; หลีกให้ห่าง',
      viewBoard: 'ดูตารางอันดับ', boardTitle: 'ตารางอันดับ &mdash; 10 อันดับแรก',
      thRank: 'อันดับ', thName: 'ชื่อ', thScore: 'คะแนน', thAcc: 'ความแม่นยำ', thStreak: 'ต่อเนื่อง',
      back: 'กลับ', boardEmpty: 'ยังไม่มีสถิติการวิ่ง',
      reportBadge: 'รายงานผล BotG', again: '&#8635; เล่นอีกครั้ง', board: 'ตารางอันดับ',
      quizBadge: 'แบบทดสอบวิดีโอ &mdash; ข้อควรระวังอันตรายจากเครื่องจักร',
      quizRef: 'คำถาม 3 ข้อนี้อ้างอิงจากวิดีโอ <strong>&ldquo;Precautions for Machinery Hazards (ข้อควรระวังอันตรายจากเครื่องจักร)&rdquo;</strong> ที่ส่งให้ผู้เข้าร่วมทุกคนก่อนแคมเปญ',
      quizProgress: 'ข้อ {n} จาก {t}', quizCorrect: '✔ ถูกต้อง! +{p} คะแนน',
      quizWrong: '✘ ยังไม่ถูก — คำตอบที่ปลอดภัยถูกไฮไลต์ไว้',
      quizNext: 'ข้อถัดไป ▶', quizSee: 'ดูรายงานของฉัน ▶',
      sAcc: 'ความแม่นยำในการสังเกต', sReact: 'เวลาตอบสนองเฉลี่ย', sAvoid: 'หลบอันตรายสำเร็จ',
      sContact: 'อุบัติการณ์สัมผัส', sStreak: 'สถิติต่อเนื่องสูงสุด', sTokens: 'เหรียญ BotG',
      sDecisions: 'การตัดสินใจด่วน', sQuiz: 'แบบทดสอบวิดีโอ', sDist: 'ระยะทาง',
    },
    ratings: { champion: 'แชมป์ปลอดอุบัติเหตุ', specialist: 'ผู้เชี่ยวชาญ BotG', spotter: 'นักสังเกตความเสี่ยง', alert: 'ผู้ปฏิบัติงานตื่นตัว', developing: 'นักสังเกตมือใหม่' },
    c: {
      alert: '⚠ สัญญาณเตือนเซิร์ฟเวอร์ฉุกเฉิน ⚠', go: 'ไป!', sub: 'ไปให้ถึงห้องเซิร์ฟเวอร์ สังเกตทุกความเสี่ยง',
      decisionHdr: '⚠ ตัดสินใจด่วน', goodObs: 'สังเกตได้ดี', tooSlow: 'ช้าเกินไป', unsafeChoice: 'ตัวเลือกไม่ปลอดภัย',
      tapCont: '▶ แตะหรือกดปุ่มใดก็ได้เพื่อไปต่อ',
      missedObs: '⚠ การสังเกตที่พลาด (BotG)', catLbl: 'ประเภท: ', cueLbl: 'สัญญาณที่พลาด: ', safeLbl: 'วิธีที่ปลอดภัยกว่า: ',
      livesLeft: 'ชีวิตที่เหลือ', noLives: 'ชีวิตหมด — จบการวิ่ง',
      tapReport: '▶ แตะหรือกดปุ่มใดก็ได้เพื่อดูรายงาน', tapResume: '⏪ แตะหรือกดปุ่มใดก็ได้เพื่อเล่นต่อ',
      duckLbl: '▼ ก้ม', jumpLbl: '▲ กระโดด', streakWord: 'คอมโบ!',
      complete: 'วิ่งสำเร็จ', outOfLives: 'ชีวิตหมด',
    },
    haz: {
      fallingBox: { cat: 'ของตกจากที่สูง', cue: 'กล่องโยกคลอนใกล้ตกจากขอบชั้นวาง', safe: 'เปลี่ยนเลน — ออกจากแนวตกของสิ่งของ' },
      shelfSpill: { cat: 'ของตกจากที่สูง', cue: 'สิ่งของวางล้ำขอบชั้นโดยไม่ยึดแน่น', safe: 'เปลี่ยนเลนให้ห่างจากขอบชั้นที่มีของล้น' },
      overheadLoad: { cat: 'ของตกจากที่สูง', cue: 'เงาของสัมภาระที่แขวนอยู่เข้ามาในเลน', safe: 'ห้ามเดินใต้ของที่แขวนอยู่ — เปลี่ยนเลน' },
      rackDoorLow: { cat: 'ถูกชน-กระแทก', cue: 'ประตูตู้แร็คเปิดค้างยื่นออกมาระดับศีรษะ', safe: 'ก้มให้ต่ำกว่าแนวชน' },
      swingDoor: { cat: 'ถูกชน-กระแทก', cue: 'ประตูตู้แกว่งเข้ามาในทางเดิน', safe: 'เลี่ยงออกนอกแนวแกว่งของประตู' },
      sharpRail: { cat: 'ของมีคม', cue: 'รางเซิร์ฟเวอร์ยื่นออกมา ขอบโลหะคมโผล่', safe: 'กระโดดข้ามขอบคมที่โผล่ออกมา' },
      palletNails: { cat: 'ของมีคม', cue: 'พาเลทชำรุด มีตะปูโผล่บนพื้น', safe: 'กระโดดข้าม — และแจ้งพาเลทชำรุด' },
      forklift: { cat: 'ยานพาหนะเคลื่อนที่', cue: 'เสียงแตรและไฟเตือนก่อนรถโฟล์คลิฟท์ข้ามผ่าน', safe: 'หยุด มอง และรอจังหวะ — ห้ามวิ่งแข่งกับรถ' },
      trolley: { cat: 'ยานพาหนะเคลื่อนที่', cue: 'รถเข็นบรรทุกของเข้ามาในทางเดิน', safe: 'ให้ทางแก่ยานพาหนะ — ย้ายไปเลนที่ว่าง' },
      pinchDoors: { cat: 'ถูกหนีบ-ติดค้าง', cue: 'ประตูกั้นกำลังปิดขวางเส้นทาง', safe: 'ห้ามเข้าไปในช่องที่กำลังปิด — ใช้เส้นทางที่เปิดอยู่' },
    },
    dec: [
      { text: 'เพื่อนร่วมงานกำลังจะเดินใต้สัมภาระแขวนที่ไม่มั่นคง', options: ['เตือนเพื่อนร่วมงาน', 'วิ่งต่อไป', 'เดินตามเส้นทางเดียวกัน'], why: 'BotG: เมื่อเห็นความเสี่ยงให้เข้าไปช่วย — คำเตือน 2 วินาทีป้องกันอุบัติเหตุถูกชนได้' },
      { text: 'รถโฟล์คลิฟท์กำลังถอยเข้ามุมอับที่คุณต้องเดินผ่าน', options: ['วิ่งตัดหน้า', 'สบตากับผู้ขับแล้วรอ', 'เดินตามหลังรถใกล้ ๆ'], why: 'BotG: ต้องแน่ใจว่าผู้ขับเห็นคุณก่อนเข้าไปในเส้นทางรถ' },
      { text: 'ประตูแร็คเปิดค้างยื่นเข้าทางเดิน และมีขอบคม', options: ['เบียดผ่านไป', 'ปิดและล็อกประตู', 'ไม่ใช่แร็คของฉัน ไม่สนใจ'], why: 'BotG: แก้อันตรายง่าย ๆ ทันที — ประตูที่เปิดค้างคืออันตรายของทุกคน' },
      { text: 'คุณเห็นพาเลทวางล้ำขอบชั้นเหนือทางเดินที่พลุกพล่าน', options: ['รีบเดินลอดด้านล่าง', 'แจ้งและกั้นพื้นที่', 'ดันกลับเข้าไปเอง'], why: 'BotG: ของไม่มั่นคงเหนือศีรษะคือความเสี่ยงของตก — กันคนออกและแจ้งทันที' },
      { text: 'รถเข็นจอดขวางทางเดินเท้า ติดกับเลนโฟล์คลิฟท์ที่กำลังวิ่ง', options: ['ก้าวเข้าเลนโฟล์คลิฟท์', 'หยุดแล้วย้ายรถเข็นออก', 'ปีนข้ามรถเข็น'], why: 'BotG: อย่าแลกอันตรายหนึ่งกับอีกอันตราย — คืนทางเดินที่ปลอดภัยก่อน' },
    ],
    quiz: [
      { q: 'ในวิดีโอ สถานการณ์ใดบ้างที่กำหนดให้พนักงานต้องได้รับการฝึกอบรมก่อนใช้งานอุปกรณ์?', opts: ['พนักงานใหม่ เครื่องจักรใหม่ หรือมีการเปลี่ยนแปลงกระบวนการทำงาน', 'เฉพาะเมื่อเกิดอุบัติเหตุในที่ทำงานแล้วเท่านั้น', 'เฉพาะช่วงการอบรมทบทวนประจำปีเท่านั้น', 'เฉพาะเมื่อพนักงานร้องขอเองเท่านั้น'] },
      { q: 'ตามวิดีโอ ต้องทำการล็อกและติดป้าย (Lockout/Tagout) ก่อนกิจกรรมใดต่อไปนี้?', opts: ['เฉพาะก่อนการซ่อมใหญ่ที่วางแผนล่วงหน้าหลายเดือนเท่านั้น', 'เฉพาะตอนติดตั้งเครื่องจักรครั้งแรกเท่านั้น', 'การทำความสะอาด หล่อลื่น ตรวจสอบ ซ่อมแซม ปรับแต่ง หรือแก้ของติดขัด', 'เฉพาะเมื่อปลดระวางเครื่องจักรถาวรเท่านั้น'] },
      { q: 'ในวิดีโอ หากพบว่าอุปกรณ์ป้องกัน เช่น การ์ดหรืออินเตอร์ล็อกชำรุดหรือใช้งานไม่ได้ พนักงานควรทำอย่างไร?', opts: ['เปลี่ยนการ์ดด้วยตนเองก่อนทำงานต่อ', 'รายงานทันทีและไม่ทำงานต่อตามปกติ', 'ไม่ต้องสนใจหากงานใช้เวลาเพียงไม่กี่นาที', 'ทำงานต่ออย่างระมัดระวังแล้วค่อยรายงานตอนเลิกกะ'] },
    ],
  },

  ja: {
    zones: ['倉庫', 'サーバールーム', '搬入エリア', 'メンテナンスエリア', '機械室'],
    ui: {
      menuBadge: 'BotG 安全キャンペーン', subtitle: 'リスクと競争',
      tagline: 'サーバー緊急アラート発生!現場を駆け抜けながら、身体接触リスクをすべて見つけよう。',
      opId: 'オペレーターID', start: '&#9654; スプリント開始',
      hint1: '<span class="key">&#9664;</span><span class="key">&#9654;</span> または <span class="key">A</span><span class="key">D</span> レーン変更',
      hint2: '<span class="key">&#9650;</span> または <span class="key">W</span> ジャンプ &nbsp;&nbsp; <span class="key">&#9660;</span> または <span class="key">S</span> しゃがむ',
      hint3: '<span class="key">1</span><span class="key">2</span><span class="key">3</span> クイック判断',
      lgdLane: '落下物 &rarr; レーン変更', lgdDuck: '低い扉 &rarr; しゃがむ', lgdJump: '鋭利な角 &rarr; ジャンプ',
      lgdVeh: '車両 &rarr; タイミングを待つ', lgdPinch: '挟まれ点 &rarr; 近づかない',
      viewBoard: 'ランキングを見る', boardTitle: 'ランキング &mdash; トップ10',
      thRank: '順位', thName: '名前', thScore: 'スコア', thAcc: '精度', thStreak: '連続',
      back: '戻る', boardEmpty: 'まだ記録がありません',
      reportBadge: 'BotG パフォーマンスレポート', again: '&#8635; もう一度プレイ', board: 'ランキング',
      quizBadge: '動画クイズ &mdash; 機械危害への予防策',
      quizRef: 'この3問は、キャンペーン前に全参加者へ送付した動画<strong>「Precautions for Machinery Hazards(機械危害への予防策)」</strong>に基づいています。',
      quizProgress: '質問 {n} / {t}', quizCorrect: '✔ 正解! +{p}ポイント',
      quizWrong: '✘ 不正解 — 安全な答えがハイライトされています',
      quizNext: '次の質問 ▶', quizSee: 'レポートを見る ▶',
      sAcc: '観察精度', sReact: '平均反応時間', sAvoid: '回避したハザード',
      sContact: '接触インシデント', sStreak: '最高連続記録', sTokens: 'BotG トークン',
      sDecisions: 'クイック判断', sQuiz: '動画クイズ', sDist: '距離',
    },
    ratings: { champion: '無事故チャンピオン', specialist: 'BotG スペシャリスト', spotter: 'リスク発見者', alert: '注意深いオペレーター', developing: '観察力トレーニング中' },
    c: {
      alert: '⚠ サーバー緊急アラート ⚠', go: 'スタート!', sub: 'サーバールームへ急げ。すべてのリスクを見逃すな。',
      decisionHdr: '⚠ クイック判断', goodObs: '良い観察!', tooSlow: '遅すぎた', unsafeChoice: '危険な選択',
      tapCont: '▶ タップまたは任意のキーで続行',
      missedObs: '⚠ BotG 見逃した観察', catLbl: 'カテゴリー:', cueLbl: '見逃した警告:', safeLbl: 'より安全な対応:',
      livesLeft: '残りライフ', noLives: 'ライフ切れ — スプリント終了',
      tapReport: '▶ タップまたは任意のキーでレポートへ', tapResume: '⏪ タップまたは任意のキーで再開',
      duckLbl: '▼ しゃがむ', jumpLbl: '▲ ジャンプ', streakWord: '連続!',
      complete: 'スプリント完了', outOfLives: 'ライフ切れ',
    },
    haz: {
      fallingBox: { cat: '落下物', cue: '棚の端で箱がぐらついている', safe: 'レーンを変えて落下範囲から離れる' },
      shelfSpill: { cat: '落下物', cue: '棚の端から荷物がはみ出して固定されていない', safe: 'レーンを変えて荷崩れの恐れがある棚から離れる' },
      overheadLoad: { cat: '落下物', cue: '吊り荷の影がレーンに入ってきた', safe: '吊り荷の下は絶対に通らない — レーン変更' },
      rackDoorLow: { cat: '激突・接触', cue: 'ラックの扉が頭の高さに開いたまま', safe: 'しゃがんで接触ラインの下を通る' },
      swingDoor: { cat: '激突・接触', cue: 'キャビネットの扉が通路側に揺れている', safe: '扉の可動範囲の外へ移動する' },
      sharpRail: { cat: '鋭利物', cue: 'サーバーレールが突き出し、鋭い金属端が露出', safe: 'ジャンプして鋭利な端を越える' },
      palletNails: { cat: '鋭利物', cue: '破損パレットの釘が床に露出', safe: 'ジャンプでかわし、破損パレットを報告する' },
      forklift: { cat: '走行車両', cue: '通過前のフォークリフトの警笛と回転灯', safe: '止まって確認し、タイミングを待つ — 車両と競争しない' },
      trolley: { cat: '走行車両', cue: '荷物を積んだ台車が通路に進入', safe: '車両に道を譲り、空いているレーンへ移動' },
      pinchDoors: { cat: '挟まれ・巻き込まれ', cue: '遮断扉が通路を横切って閉まりつつある', safe: '閉まりかけの隙間に入らない — 開いている通路を使う' },
    },
    dec: [
      { text: '同僚が不安定な吊り荷の下を歩こうとしている。', options: ['同僚に警告する', 'そのまま走り続ける', '同じルートを通る'], why: 'BotG:リスクを見たら介入する — 2秒の警告が激突事故を防ぐ。' },
      { text: 'フォークリフトが、あなたが通る死角へ後退してくる。', options: ['走り抜ける', '運転者とアイコンタクトして待つ', '車両のすぐ後ろを歩く'], why: 'BotG:車両の動線に入る前に、運転者が自分を認識したか確認する。' },
      { text: 'ラックの扉が通路に開いたままで、端が鋭利だ。', options: ['すき間を無理に通る', '扉を閉めてロックする', '自分のラックではないので無視'], why: 'BotG:簡単な接触危害はその場で解消する — 開いた扉は全員の危害。' },
      { text: '混雑した通路の上で、パレットが棚の端からはみ出しているのを発見。', options: ['急いで下を通る', '報告して立入禁止にする', '自分で押し戻す'], why: 'BotG:頭上の不安定な荷は落下物リスク — 人を近づけず報告する。' },
      { text: '台車が歩行者レーンを塞いで停まっており、隣はフォークリフトの走行レーン。', options: ['フォークリフトのレーンに出る', '止まって台車をどかす', '台車を乗り越える'], why: 'BotG:危害を別の危害と交換しない — まず安全な歩行ルートを回復する。' },
    ],
    quiz: [
      { q: '動画では、どのような場合に作業者は設備を操作する前に訓練を受ける必要があるとされていますか?', opts: ['新入社員、新しい機械、または作業プロセスの変更があるとき', '職場で事故がすでに起きた場合のみ', '年次のリフレッシュ研修の期間のみ', '作業者本人が希望した場合のみ'] },
      { q: '動画によると、次のどの作業の前にロックアウト・タグアウトを実施しなければなりませんか?', opts: ['数か月前から予定されている大規模オーバーホールの前のみ', '機械の初回設置時のみ', '清掃・注油・点検・修理・調整・詰まりの除去を行うとき', '機械を恒久的に廃棄するときのみ'] },
      { q: '動画では、ガードやインターロックなどの安全防護装置が破損・故障しているのを見つけた場合、作業者はどうすべきとされていますか?', opts: ['自分でガードを交換してから作業を続ける', '直ちに報告し、通常どおり作業を続けない', '数分で終わる作業なら無視してよい', '注意しながら作業を続け、シフト終了時に報告する'] },
    ],
  },
};

let lang = 'en';
try { lang = localStorage.getItem('serverSprintLang') || 'en'; } catch (e) {}
if (!I18N[lang]) lang = 'en';

function L() { return I18N[lang]; }

function setLang(l) {
  if (!I18N[l]) return;
  lang = l;
  try { localStorage.setItem('serverSprintLang', l); } catch (e) {}
  applyLang();
}

// Push translations into every static HTML element tagged data-i18n,
// and re-render dynamic panels if they're open.
function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const s = L().ui[el.dataset.i18n];
    if (s !== undefined) el.innerHTML = s;
  });
  document.querySelectorAll('#langRow button').forEach(b => {
    b.classList.toggle('on', b.dataset.lang === lang);
  });
  if (typeof quiz !== 'undefined' && quiz && game && game.state === 'QUIZ') renderQuizQuestion();
}

/* =====================================================================
   5. AUDIO — tiny WebAudio synth (created on first user gesture)
   ===================================================================== */
const AudioSys = {
  ctx: null, muted: false, musicTimer: null, musicStep: 0,

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { /* audio unavailable — game runs silently */ }
  },

  blip(freq, dur, type, vol, slide) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  noise(dur, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = vol || 0.25;
    src.buffer = buf;
    src.connect(g); g.connect(this.master);
    src.start(t);
  },

  // Named game sounds ------------------------------------------------
  horn()     { this.blip(180, 0.35, 'sawtooth', 0.22); this.blip(178, 0.35, 'square', 0.10); },
  warn()     { this.blip(980, 0.09, 'square', 0.10); },
  token()    { this.blip(880, 0.07, 'square', 0.12); this.blip(1320, 0.10, 'square', 0.10); },
  combo(n)   { this.blip(660 + n * 160, 0.12, 'square', 0.14, 900 + n * 200); },
  contact()  { this.noise(0.30, 0.30); this.blip(120, 0.30, 'sawtooth', 0.20, 50); },
  rewind()   { this.blip(1200, 0.45, 'triangle', 0.14, 200); },
  jump()     { this.blip(300, 0.12, 'square', 0.08, 620); },
  decideOk() { this.blip(523, 0.1, 'square', 0.14); this.blip(784, 0.16, 'square', 0.14); },
  decideNo() { this.blip(200, 0.25, 'sawtooth', 0.16, 90); },
  finish()   { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.18, 'square', 0.14), i * 110)); },

  // Chiptune loop: bass + lead over a 16-step sequence ----------------
  MUSIC_BASS: [110, 0, 110, 0, 147, 0, 147, 0, 131, 0, 131, 0, 98, 0, 165, 0],
  MUSIC_LEAD: [440, 0, 523, 587, 0, 440, 0, 659, 587, 0, 523, 0, 440, 392, 0, 330],
  startMusic() {
    if (this.musicTimer || !this.ctx) return;
    this.musicStep = 0;
    this.musicTimer = setInterval(() => {
      if (this.muted || game.state !== 'RUNNING') return;
      const s = this.musicStep % 16;
      if (this.MUSIC_BASS[s]) this.blip(this.MUSIC_BASS[s], 0.11, 'triangle', 0.09);
      if (this.MUSIC_LEAD[s]) this.blip(this.MUSIC_LEAD[s], 0.08, 'square', 0.035);
      this.musicStep++;
    }, 140);
  },
  stopMusic() { clearInterval(this.musicTimer); this.musicTimer = null; },
};

/* =====================================================================
   6. GAME STATE
   ===================================================================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const TOTAL_DIST = ((CONFIG.BASE_SPEED + CONFIG.MAX_SPEED) / 2) * CONFIG.RUN_DURATION;

let game = null;
let player = null;

function freshGame() {
  return {
    state: 'MENU',            // MENU | COUNTDOWN | RUNNING | DECISION | INCIDENT | RESULTS
    time: 0,                  // running time (s)
    countdown: 0,
    speed: CONFIG.BASE_SPEED,
    distance: 0,
    zoneIndex: 0,
    zoneBanner: 0,            // banner fade timer

    lives: CONFIG.LIVES,
    gameOver: false,
    score: 0, tokens: 0,
    streak: 0, bestStreak: 0, mult: 1,
    avoided: 0, contacts: 0,
    reactionSamples: [],      // seconds, correct responses only
    decisionsCorrect: 0, decisionsTotal: 0,

    hazards: [], pickups: [], particles: [], floats: [],
    nextSpawn: CONFIG.FIRST_HAZARD_DELAY,
    decisionQueue: CONFIG.DECISION_TIMES.map((f, i) => ({ frac: f, idx: i % DECISIONS.length, fired: false })),

    decision: null,           // active rapid-decision {def, timer, answered}
    incident: null,           // active incident card {def info, timer}
    invuln: 0,
    shake: 0,
    finished: false,
  };
}

function freshPlayer() {
  return {
    lane: 1, x: CONFIG.LANES[1],
    jumpT: -1,                // -1 = grounded, else 0..JUMP_TIME
    duck: false, duckHeld: false, duckMin: 0,
    runFrame: 0,
    laneChangedAt: 0, jumpAt: 0, duckAt: 0,   // input timestamps for reaction stats
  };
}

/* =====================================================================
   7. HAZARD SPAWNING
   Waves are built so at least one safe lane / response always exists,
   and every hazard is visible well before it becomes unavoidable.
   ===================================================================== */
function pickFromPool(pool) {
  let total = 0;
  for (const k in pool) total += pool[k];
  let r = Math.random() * total;
  for (const k in pool) { r -= pool[k]; if (r <= 0) return k; }
  return Object.keys(pool)[0];
}

function spawnWave() {
  const zone = ZONES[game.zoneIndex];
  const t = runFrac();
  const type = pickFromPool(zone.pool);
  const def = HAZARD_DEFS[type];
  const y = -90;

  if (def.evade === 'timing') {
    // Vehicle: enters from a side, sweeps horizontally while scrolling down.
    const fromLeft = Math.random() < 0.5;
    game.hazards.push({
      type, def, y: -60, lane: -1,
      x: fromLeft ? -80 : CONFIG.W + 80,
      vx: (fromLeft ? 1 : -1) * (150 + t * 90),
      warned: false, resolved: false, spawnT: game.time,
    });
  } else if (def.evade === 'gap') {
    // Pinch point: one open lane, doors close over the others.
    const open = Math.floor(Math.random() * 3);
    game.hazards.push({ type, def, y, lane: -1, openLane: open, resolved: false, spawnT: game.time });
  } else {
    const lane = Math.floor(Math.random() * 3);
    game.hazards.push({ type, def, y, lane, resolved: false, spawnT: game.time, dropped: false });

    // From early-mid game on, often pair with a second hazard in another lane,
    // always leaving at least one fully safe lane.
    if (t > 0.18 && Math.random() < 0.55) {
      const lanes = [0, 1, 2].filter(l => l !== lane);
      const lane2 = lanes[Math.floor(Math.random() * 2)];
      const pool2 = { ...zone.pool };
      delete pool2.forklift; delete pool2.trolley; delete pool2.pinchDoors;
      const t2 = pickFromPool(pool2);
      if (t2 && HAZARD_DEFS[t2].evade !== 'timing' && HAZARD_DEFS[t2].evade !== 'gap') {
        game.hazards.push({ type: t2, def: HAZARD_DEFS[t2], y: y - 70, lane: lane2, resolved: false, spawnT: game.time, dropped: false });
      }
    }
  }

  // Tokens: a short trail, biased toward safe lanes. Tokens are the main
  // score source, so nearly every wave carries some.
  if (Math.random() < 0.92) {
    let safeLane = Math.floor(Math.random() * 3);
    const wave = game.hazards[game.hazards.length - 1];
    if (wave.lane >= 0) safeLane = (wave.lane + 1 + Math.floor(Math.random() * 2)) % 3;
    if (wave.openLane !== undefined) safeLane = wave.openLane;
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      game.pickups.push({ lane: safeLane, y: y - 190 - i * 55, taken: false });
    }
  }
}

/* =====================================================================
   8. INPUT
   ===================================================================== */
const keys = {};

function doMove(dir) {
  if (game.state !== 'RUNNING') return;
  const nl = Math.max(0, Math.min(2, player.lane + dir));
  if (nl !== player.lane) { player.lane = nl; player.laneChangedAt = game.time; }
}
function doJump() {
  if (game.state !== 'RUNNING') return;
  if (player.jumpT < 0 && !player.duck) {
    player.jumpT = 0; player.jumpAt = game.time; AudioSys.jump();
  }
}
function doDuck(on) {
  if (game.state !== 'RUNNING') { player.duckHeld = false; return; }
  player.duckHeld = on;
  if (on && player.jumpT < 0 && !player.duck) {
    player.duck = true; player.duckMin = 0.30; player.duckAt = game.time;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  AudioSys.init();

  if (game.state === 'DECISION' && game.decision && !game.decision.answered) {
    if (e.code === 'Digit1' || e.code === 'Numpad1') answerDecision(0);
    if (e.code === 'Digit2' || e.code === 'Numpad2') answerDecision(1);
    if (e.code === 'Digit3' || e.code === 'Numpad3') answerDecision(2);
    return;
  }
  if (game.state === 'QUIZ') {     // 1-4 or A-D answer; Enter/Space advances
    if (!quiz) return;
    if (!quiz.answered) {
      const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'];
      const letters = ['KeyA', 'KeyB', 'KeyC', 'KeyD'];
      let di = digits.indexOf(e.code); if (di >= 4) di -= 4;
      const li = letters.indexOf(e.code);
      if (di >= 0) answerQuiz(di);
      else if (li >= 0) answerQuiz(li);
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      nextQuizQuestion();
    }
    return;
  }
  if (dismissCard()) return;       // any key continues past incident/feedback cards
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': doMove(-1); break;
    case 'ArrowRight': case 'KeyD': doMove(1); break;
    case 'ArrowUp': case 'KeyW': doJump(); e.preventDefault(); break;
    case 'ArrowDown': case 'KeyS': doDuck(true); e.preventDefault(); break;
    case 'Space':
      e.preventDefault();
      if (game.state === 'MENU' && document.activeElement !== ui.nameInput) startRun();
      else if (game.state === 'RESULTS') startRun();
      break;
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'ArrowDown' || e.code === 'KeyS') doDuck(false);
});

// Click / tap support for rapid-decision options (maps canvas CSS pixels
// back to the 960x540 internal resolution).
canvas.addEventListener('pointerdown', (e) => {
  if (!game) return;
  if (dismissCard()) return;       // tap continues past incident/feedback cards
  if (game.state !== 'DECISION' || !game.decision || game.decision.answered) return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (CONFIG.W / r.width);
  const y = (e.clientY - r.top) * (CONFIG.H / r.height);
  for (let i = 0; i < game.decision.def.options.length; i++) {
    const oy = 250 + i * 46;
    if (x > CONFIG.W / 2 - 240 && x < CONFIG.W / 2 + 240 && y > oy - 24 && y < oy + 12) answerDecision(i);
  }
});

/* =====================================================================
   9. UI ELEMENTS + MENU FLOW
   ===================================================================== */
const ui = {
  menu: document.getElementById('menu'),
  results: document.getElementById('results'),
  board: document.getElementById('board'),
  nameInput: document.getElementById('playerName'),
  startBtn: document.getElementById('startBtn'),
  againBtn: document.getElementById('againBtn'),
  muteBtn: document.getElementById('muteBtn'),
  fsBtn: document.getElementById('fsBtn'),
  reportName: document.getElementById('reportName'),
  ratingLine: document.getElementById('ratingLine'),
  finalScore: document.getElementById('finalScore'),
  statGrid: document.getElementById('statGrid'),
  boardTable: document.querySelector('#boardTable tbody'),
  touch: document.getElementById('touch'),
  quiz: document.getElementById('quiz'),
  quizProgress: document.getElementById('quizProgress'),
  quizQ: document.getElementById('quizQ'),
  quizOpts: document.getElementById('quizOpts'),
  quizFeedback: document.getElementById('quizFeedback'),
  quizNext: document.getElementById('quizNext'),
};
ui.quizNext.addEventListener('click', nextQuizQuestion);

let playerName = 'AAA';
let boardReturn = 'menu';
let lastEntryId = null;

try { ui.nameInput.value = localStorage.getItem('serverSprintName') || ''; } catch (e) {}

ui.startBtn.addEventListener('click', startRun);
ui.againBtn.addEventListener('click', startRun);

document.getElementById('menuBoardBtn').addEventListener('click', () => showBoard('menu'));
document.getElementById('resultsBoardBtn').addEventListener('click', () => showBoard('results'));
document.getElementById('boardBackBtn').addEventListener('click', () => {
  ui.board.classList.add('hidden');
  (boardReturn === 'results' ? ui.results : ui.menu).classList.remove('hidden');
});

ui.muteBtn.addEventListener('click', () => {
  AudioSys.init();
  AudioSys.muted = !AudioSys.muted;
  ui.muteBtn.innerHTML = AudioSys.muted ? '&#128263;' : '&#128266;';
  ui.muteBtn.classList.toggle('off', AudioSys.muted);
});

ui.fsBtn.addEventListener('click', () => {
  const el = document.documentElement;
  if (!document.fullscreenElement) { if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); }
  else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
});

// Touch controls
ui.touch.querySelectorAll('button').forEach(btn => {
  const act = btn.dataset.act;
  const down = (e) => {
    e.preventDefault(); AudioSys.init();
    if (act === 'left') doMove(-1);
    if (act === 'right') doMove(1);
    if (act === 'jump') doJump();
    if (act === 'duck') doDuck(true);
  };
  const up = (e) => { e.preventDefault(); if (act === 'duck') doDuck(false); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointerleave', up);
});

function startRun() {
  AudioSys.init();
  const n = (ui.nameInput.value || 'AAA').trim().toUpperCase().slice(0, 10);
  playerName = n || 'AAA';
  try { localStorage.setItem('serverSprintName', playerName); } catch (e) {}

  game = freshGame();
  player = freshPlayer();
  game.state = 'COUNTDOWN';
  game.countdown = 2.0;
  quiz = null;
  ui.menu.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.board.classList.add('hidden');
  ui.quiz.classList.add('hidden');
  AudioSys.startMusic();
}

/* =====================================================================
   10. LEADERBOARD (localStorage)
   ===================================================================== */
const LB_KEY = 'serverSprintLB';

function loadBoard() {
  try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; }
  catch (e) { return []; }
}
function saveScore(entry) {
  const list = loadBoard();
  entry.id = Date.now() + '' + Math.floor(Math.random() * 999);
  lastEntryId = entry.id;
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list.length = Math.min(list.length, 10);
  try { localStorage.setItem(LB_KEY, JSON.stringify(list)); } catch (e) {}
}
function showBoard(from) {
  boardReturn = from;
  ui.menu.classList.add('hidden');
  ui.results.classList.add('hidden');
  const list = loadBoard();
  ui.boardTable.innerHTML = list.length
    ? list.map((e, i) =>
        `<tr class="${e.id === lastEntryId ? 'me' : ''}"><td>${i + 1}</td><td>${escapeHtml(e.name)}</td>` +
        `<td>${e.score.toLocaleString()}</td><td>${e.acc}%</td><td>${e.streak}</td></tr>`).join('')
    : '<tr><td colspan="5" style="color:#8b96b8;padding:20px">' + L().ui.boardEmpty + '</td></tr>';
  ui.board.classList.remove('hidden');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* =====================================================================
   11. SCORING HELPERS
   ===================================================================== */
function runFrac() { return Math.min(1, game.time / CONFIG.RUN_DURATION); }

function multiplierFor(streak) {
  const s = CONFIG.STREAK_STEPS;
  if (streak >= s[2]) return 4;
  if (streak >= s[1]) return 3;
  if (streak >= s[0]) return 2;
  return 1;
}

function addStreak() {
  game.streak++;
  game.bestStreak = Math.max(game.bestStreak, game.streak);
  const m = multiplierFor(game.streak);
  if (m > game.mult) { AudioSys.combo(m); addFloat(CONFIG.W / 2, 330, 'x' + m + ' ' + L().c.streakWord, '#FBBC04'); }
  game.mult = m;
}
function resetStreak() { game.streak = 0; game.mult = 1; }

function addFloat(x, y, text, color) {
  game.floats.push({ x, y, text, color, t: 1.1 });
}

function hazardAvoided(h) {
  if (h.resolved) return;
  h.resolved = true;
  game.avoided++;
  addStreak();
  const pts = CONFIG.SCORE_AVOID * game.mult;
  game.score += pts;
  {
    const fp = project(CONFIG.PLAYER_Y - 60, h.lane >= 0 ? CONFIG.LANES[h.lane] : h.x);
    addFloat(fp.x, fp.y - 60, '+' + pts, '#34A853');
  }

  // Reaction time: the correct input made after the hazard appeared.
  let inputT = 0;
  const ev = h.def.evade;
  if (ev === 'lane' || ev === 'timing' || ev === 'gap') inputT = player.laneChangedAt;
  else if (ev === 'duck') inputT = player.duckAt;
  else if (ev === 'jump') inputT = player.jumpAt;
  if (inputT > h.spawnT) {
    const rt = inputT - h.spawnT;
    game.reactionSamples.push(rt);
    if (rt < 0.6) game.score += CONFIG.SCORE_REACT_BONUS;
  }
}

/* =====================================================================
   12. INCIDENT (contact) — freeze, BotG card, rewind, resume
   ===================================================================== */
function hazardContact(h) {
  if (game.invuln > 0 || h.resolved) return;
  h.resolved = true;
  game.contacts++;
  game.lives--;
  resetStreak();
  game.score = Math.max(0, game.score - CONFIG.PENALTY_CONTACT);
  game.shake = 0.5;
  AudioSys.contact();
  // Card stays until the player taps / presses a key (after a minimum read
  // time), with an auto-continue fallback so a booth never stalls.
  game.incident = { type: h.type, def: h.def, elapsed: 0, lane: h.lane >= 0 ? h.lane : player.lane, fatal: game.lives <= 0 };
  game.state = 'INCIDENT';
}

function endIncident() {
  const fatal = game.incident.fatal;
  game.incident = null;
  if (fatal) {                     // third contact: run ends here
    game.gameOver = true;
    finishRun();
    return;
  }
  // "Rewind": push everything back and clear anything about to hit.
  AudioSys.rewind();
  for (const h of game.hazards) h.y -= CONFIG.REWIND_PX;
  for (const p of game.pickups) p.y -= CONFIG.REWIND_PX;
  game.hazards = game.hazards.filter(h => !(h.y > 100 && h.y < CONFIG.H));
  game.invuln = CONFIG.INVULN_AFTER_INCIDENT;
  game.state = 'RUNNING';
}

// Any key or tap dismisses the incident card / decision feedback once the
// minimum read time has passed — the text never vanishes before you're ready.
function dismissCard() {
  if (game.state === 'INCIDENT' && game.incident && game.incident.elapsed >= CONFIG.INCIDENT_MIN) {
    endIncident();
    return true;
  }
  if (game.state === 'DECISION' && game.decision && game.decision.answered && game.decision.holdTimer < CONFIG.DECISION_HOLD - 0.4) {
    game.decision = null;
    game.state = 'RUNNING';
    return true;
  }
  return false;
}

/* =====================================================================
   13. RAPID DECISIONS
   ===================================================================== */
function fireDecision(idx) {
  game.decision = { idx, def: DECISIONS[idx], timer: CONFIG.DECISION_WINDOW, answered: false, result: null, holdTimer: 0 };
  game.decisionsTotal++;
  game.state = 'DECISION';
  AudioSys.warn(); AudioSys.warn();
}
function answerDecision(i) {
  const d = game.decision;
  if (!d || d.answered) return;
  d.answered = true;
  d.holdTimer = CONFIG.DECISION_HOLD;
  if (i === d.def.correct) {
    d.result = 'correct';
    game.decisionsCorrect++;
    game.score += CONFIG.SCORE_DECISION;
    addStreak();
    AudioSys.decideOk();
  } else {
    d.result = 'wrong';
    game.score = Math.max(0, game.score - CONFIG.PENALTY_DECISION);
    resetStreak();
    AudioSys.decideNo();
  }
}

/* =====================================================================
   14. UPDATE LOOP
   ===================================================================== */
function update(dt) {
  if (!game) return;

  if (game.state === 'COUNTDOWN') {
    game.countdown -= dt;
    if (game.countdown <= 0) game.state = 'RUNNING';
    updatePlayerMotion(dt);
    return;
  }

  if (game.state === 'INCIDENT') {
    game.incident.elapsed += dt;
    game.shake = Math.max(0, game.shake - dt);
    if (game.incident.elapsed >= CONFIG.INCIDENT_MAX) endIncident();
    return;
  }

  if (game.state === 'DECISION') {
    const d = game.decision;
    if (!d.answered) {
      d.timer -= dt;
      if (d.timer <= 0) {                       // timed out = missed decision
        d.answered = true; d.result = 'missed'; d.holdTimer = CONFIG.DECISION_HOLD;
        game.score = Math.max(0, game.score - CONFIG.PENALTY_DECISION);
        resetStreak();
        AudioSys.decideNo();
      }
    } else {
      d.holdTimer -= dt;
      if (d.holdTimer <= 0) { game.decision = null; game.state = 'RUNNING'; }
    }
    return;
  }

  if (game.state !== 'RUNNING') return;

  // ---- time / speed / distance ----
  game.time += dt;
  const frac = runFrac();
  game.speed = CONFIG.BASE_SPEED + (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED) * frac;
  game.distance += game.speed * dt;
  game.score += game.speed * dt * CONFIG.SCORE_DIST;
  game.invuln = Math.max(0, game.invuln - dt);
  game.shake = Math.max(0, game.shake - dt);

  // ---- run complete ----
  if (game.time >= CONFIG.RUN_DURATION && !game.finished) {
    game.finished = true;
    finishRun();
    return;
  }

  // ---- zone progression (5 equal segments, seamless) ----
  const zi = Math.min(ZONES.length - 1, Math.floor(frac * ZONES.length));
  if (zi !== game.zoneIndex) { game.zoneIndex = zi; game.zoneBanner = 2.2; }
  game.zoneBanner = Math.max(0, game.zoneBanner - dt);

  // ---- rapid decisions ----
  for (const q of game.decisionQueue) {
    if (!q.fired && frac >= q.frac) { q.fired = true; fireDecision(q.idx); return; }
  }

  // ---- spawning ----
  game.nextSpawn -= dt;
  if (game.nextSpawn <= 0) {
    spawnWave();
    const gap = CONFIG.SPAWN_GAP_EARLY + (CONFIG.SPAWN_GAP_LATE - CONFIG.SPAWN_GAP_EARLY) * frac;
    game.nextSpawn = gap * (0.85 + Math.random() * 0.3);
  }

  updatePlayerMotion(dt);

  // ---- hazards ----
  const py = CONFIG.PLAYER_Y;
  for (const h of game.hazards) {
    h.y += game.speed * dt;

    if (h.def.evade === 'timing') {
      h.x += h.vx * dt;
      // Horn + beacon warning as the vehicle approaches the visible area
      if (!h.warned && h.y > -40) { h.warned = true; AudioSys.horn(); }
      if (!h.resolved && Math.abs(h.y - py) < CONFIG.HIT_BAND + 14) {
        const half = 74;                                  // vehicle half-width
        // No airborne exemption: you cannot jump a vehicle — time it instead.
        if (Math.abs(h.x - player.x) < half + 20) hazardContact(h);
      }
      if (!h.resolved && h.y > py + CONFIG.HIT_BAND + 30) hazardAvoided(h);
      continue;
    }

    if (h.def.evade === 'gap') {
      if (!h.warnedG && h.y > -30) { h.warnedG = true; AudioSys.warn(); }
      if (!h.resolved && Math.abs(h.y - py) < CONFIG.HIT_BAND) {
        const closure = pinchClosure(h);
        // x-based: you're safe once visually inside the open lane
        if (Math.abs(CONFIG.LANES[h.openLane] - player.x) > 52 && closure > 0.55) hazardContact(h);
      }
      if (!h.resolved && h.y > py + CONFIG.HIT_BAND + 10) hazardAvoided(h);
      continue;
    }

    // Lane hazards -----------------------------------------------------
    if (!h.warnedL && h.y > -50) { h.warnedL = true; AudioSys.warn(); }
    if ((h.type === 'fallingBox' || h.type === 'overheadLoad') && !h.dropped && h.y > py - 210) {
      h.dropped = true;                                    // box commits to the drop
    }
    // Contact uses the player's VISUAL x, not the logical lane — so if you're
    // mid-lane-change and visually clear of the object, you don't get hit.
    if (!h.resolved &&
        Math.abs(CONFIG.LANES[h.lane] - player.x) < CONFIG.HIT_X &&
        Math.abs(h.y - py) < CONFIG.HIT_BAND) {
      const ev = h.def.evade;
      const hit =
        (ev === 'lane') ||
        (ev === 'duck' && !player.duck) ||
        (ev === 'jump' && !isAirborne());
      if (hit) hazardContact(h);
    }
    if (!h.resolved && h.y > py + CONFIG.HIT_BAND + 10) hazardAvoided(h);
  }
  game.hazards = game.hazards.filter(h =>
    h.y < CONFIG.H + 160 &&
    (h.def.evade !== 'timing' || (h.x > -180 && h.x < CONFIG.W + 180)));

  // ---- pickups ----
  for (const p of game.pickups) {
    p.y += game.speed * dt;
    if (!p.taken && p.lane === player.lane && Math.abs(p.y - py) < 34 && !isAirborne()) {
      p.taken = true;
      game.tokens++;
      const pts = CONFIG.SCORE_TOKEN * game.mult;
      game.score += pts;
      AudioSys.token();
      const tp = project(p.y, CONFIG.LANES[p.lane]);
      addFloat(tp.x, tp.y - 50, '+' + pts, '#FBBC04');
      for (let i = 0; i < 6; i++) {
        game.particles.push({ x: tp.x, y: tp.y - 30, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 140, t: 0.5, c: '#FBBC04' });
      }
    }
  }
  game.pickups = game.pickups.filter(p => !p.taken && p.y < CONFIG.H + 60);

  // ---- particles / floats ----
  for (const pt of game.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt + 200 * dt * dt; pt.vy += 400 * dt; pt.t -= dt; }
  game.particles = game.particles.filter(p => p.t > 0);
  for (const f of game.floats) { f.y -= 40 * dt; f.t -= dt; }
  game.floats = game.floats.filter(f => f.t > 0);
}

function updatePlayerMotion(dt) {
  // Lane lerp
  const tx = CONFIG.LANES[player.lane];
  player.x += (tx - player.x) * Math.min(1, CONFIG.LANE_SNAP * dt);

  // Jump arc
  if (player.jumpT >= 0) {
    player.jumpT += dt;
    if (player.jumpT >= CONFIG.JUMP_TIME) player.jumpT = -1;
  }
  // Duck: held, with a minimum duration so taps still work
  if (player.duck) {
    player.duckMin -= dt;
    if (!player.duckHeld && player.duckMin <= 0) player.duck = false;
  }
  player.runFrame += dt * (8 + runFrac() * 6);
}

function isAirborne() {
  if (player.jumpT < 0) return false;
  const h = Math.sin((player.jumpT / CONFIG.JUMP_TIME) * Math.PI);
  return h > 0.35;
}

function pinchClosure(h) {
  // Doors close as the pinch point approaches the player: 0 open → 1 shut
  return Math.max(0, Math.min(1, (h.y + 90) / (CONFIG.PLAYER_Y + 60)));
}

/* =====================================================================
   15. FINISH + REPORT
   ===================================================================== */
function ratingFor(acc, contacts) {
  if (contacts === 0 && acc >= 95) return 'champion';
  if (acc >= 90) return 'specialist';
  if (acc >= 78) return 'spotter';
  if (acc >= 60) return 'alert';
  return 'developing';
}

// Run over (time up or out of lives) → video quiz first, then the report.
function finishRun() {
  AudioSys.stopMusic();
  game.finished = true;
  startQuiz();
}

/* ---- video quiz flow ---- */
let quiz = null;

function startQuiz() {
  quiz = { i: 0, correct: 0, answered: false };
  game.state = 'QUIZ';
  ui.results.classList.add('hidden');
  ui.quiz.classList.remove('hidden');
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const item = L().quiz[quiz.i];             // translated question + options
  quiz.answered = false;
  ui.quizProgress.textContent = L().ui.quizProgress.replace('{n}', quiz.i + 1).replace('{t}', QUIZ.length);
  ui.quizQ.textContent = item.q;
  ui.quizFeedback.textContent = '';
  ui.quizFeedback.className = 'quiz-feedback';
  ui.quizNext.classList.add('hidden');
  ui.quizOpts.innerHTML = '';
  item.opts.forEach((opt, idx) => {
    const b = document.createElement('button');
    b.className = 'quiz-opt';
    b.innerHTML = '<span class="ltr">' + String.fromCharCode(65 + idx) + '</span>' + escapeHtml(opt);
    b.addEventListener('click', () => answerQuiz(idx));
    ui.quizOpts.appendChild(b);
  });
}

function answerQuiz(idx) {
  if (!quiz || quiz.answered) return;
  quiz.answered = true;
  const item = QUIZ[quiz.i];
  const btns = ui.quizOpts.querySelectorAll('.quiz-opt');
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === item.correct) b.classList.add('correct');
    else if (i === idx) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  if (idx === item.correct) {
    quiz.correct++;
    game.score += CONFIG.QUIZ_POINTS;
    ui.quizFeedback.textContent = L().ui.quizCorrect.replace('{p}', CONFIG.QUIZ_POINTS.toLocaleString());
    ui.quizFeedback.classList.add('good');
    AudioSys.decideOk();
  } else {
    ui.quizFeedback.textContent = L().ui.quizWrong;
    ui.quizFeedback.classList.add('bad');
    AudioSys.decideNo();
  }
  ui.quizNext.textContent = quiz.i < QUIZ.length - 1 ? L().ui.quizNext : L().ui.quizSee;
  ui.quizNext.classList.remove('hidden');
}

function nextQuizQuestion() {
  if (!quiz || !quiz.answered) return;
  if (quiz.i < QUIZ.length - 1) {
    quiz.i++;
    renderQuizQuestion();
  } else {
    ui.quiz.classList.add('hidden');
    showReport();
  }
}

function showReport() {
  if (!game.gameOver) AudioSys.finish();
  game.state = 'RESULTS';

  const total = game.avoided + game.contacts;
  const acc = total > 0 ? Math.round((game.avoided / total) * 100) : 100;
  const avgRt = game.reactionSamples.length
    ? (game.reactionSamples.reduce((a, b) => a + b, 0) / game.reactionSamples.length)
    : 0;
  const score = Math.round(game.score);
  const rating = ratingFor(acc, game.contacts);

  // Name + outcome line above the rating
  const U = L().ui;
  ui.reportName.textContent = playerName + ' — ' + (game.gameOver ? L().c.outOfLives : L().c.complete);
  ui.reportName.classList.toggle('over', game.gameOver);
  ui.ratingLine.textContent = L().ratings[rating];
  ui.finalScore.textContent = score.toLocaleString();
  ui.statGrid.innerHTML = [
    stat(acc + '%', U.sAcc, acc >= 78 ? 'good' : 'bad'),
    stat(avgRt ? avgRt.toFixed(2) + 's' : '—', U.sReact, avgRt && avgRt < 0.9 ? 'good' : ''),
    stat(game.avoided, U.sAvoid, 'good'),
    stat(game.contacts, U.sContact, game.contacts === 0 ? 'good' : 'bad'),
    stat('x' + multiplierFor(game.bestStreak) + ' (' + game.bestStreak + ')', U.sStreak, ''),
    stat(game.tokens, U.sTokens, ''),
    stat(game.decisionsCorrect + '/' + game.decisionsTotal, U.sDecisions, ''),
    stat(quiz ? quiz.correct + '/' + QUIZ.length : '—', U.sQuiz, quiz && quiz.correct === QUIZ.length ? 'good' : ''),
    stat((game.distance / 100).toFixed(0) + 'm', U.sDist, ''),
  ].join('');

  saveScore({ name: playerName, score, acc, streak: game.bestStreak, date: new Date().toISOString().slice(0, 10) });
  ui.results.classList.remove('hidden');
}
function stat(v, k, cls) { return `<div class="stat ${cls}"><div class="v">${v}</div><div class="k">${k}</div></div>`; }

/* =====================================================================
   16. RENDERING — all pixel art drawn with rect fills
   ===================================================================== */
const P = CONFIG.PX;
function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w * P, h * P); }

/* ---- first-person camera + perspective projection ----
   World coordinates are unchanged from the game logic (worldY runs from
   -90 at spawn to PLAYER_Y at the player's feet; worldX uses the LANES
   positions). project() maps them onto a corridor converging at HORIZON.
   The camera rises when jumping, drops when ducking, and bobs as you run.
*/
const HORIZON = 190;

function camOffY() {
  const jt = player.jumpT >= 0 ? player.jumpT / CONFIG.JUMP_TIME : -1;
  const lift = jt >= 0 ? Math.sin(jt * Math.PI) * 42 : 0;      // eye up → scene down
  const duckDrop = player.duck ? 32 : 0;                        // eye down → scene up
  const bob = (game && game.state === 'RUNNING') ? Math.sin(player.runFrame * 3.1) * 2.5 : 0;
  return lift - duckDrop + bob;
}

function project(worldY, worldX) {
  const p = Math.max(0, Math.min(1.12, (worldY + 90) / (CONFIG.PLAYER_Y + 90)));
  const zp = Math.pow(p, 2.2);                 // perspective ease: far = slow, near = fast
  const s = 0.10 + 1.50 * zp;                  // sprite scale
  const y = HORIZON + (508 - HORIZON) * zp + camOffY();
  const x = CONFIG.W / 2 + (worldX - player.x) * 1.05 * s;
  return { x, y, s, p };
}

// Scaled sprite rect: offsets/sizes in near-plane pixels, multiplied by s.
// Negative widths/heights draw in the opposite direction (used for mirrored parts).
function spr(cx, gy, dx, dy, w, h, c, s) {
  let x = cx + dx * s, y = gy + dy * s, ww = w * s, hh = h * s;
  if (ww < 0) { x += ww; ww = -ww; }
  if (hh < 0) { y += hh; hh = -hh; }
  ctx.fillStyle = c;
  ctx.fillRect(x, y, Math.max(1, ww), Math.max(1, hh));
}

function shadowEllipse(x, y, rx, ry, a) {
  ctx.fillStyle = 'rgba(0,0,0,' + (a || 0.3) + ')';
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(2, rx), Math.max(1, ry), 0, 0, 7);
  ctx.fill();
}

function render() {
  const W = CONFIG.W, H = CONFIG.H;
  ctx.save();

  // Screen shake
  if (game && game.shake > 0) {
    ctx.translate((Math.random() - 0.5) * game.shake * 22, (Math.random() - 0.5) * game.shake * 22);
  }

  const zone = game ? ZONES[game.zoneIndex] : ZONES[0];
  drawWorld(zone);

  if (game) {
    // Far-to-near draw order; anything past the camera plane vanishes behind you
    const items = [];
    for (const p of game.pickups) if (p.y <= CONFIG.PLAYER_Y + 20) items.push({ y: p.y, pick: p });
    for (const h of game.hazards) if (h.y <= CONFIG.PLAYER_Y + 30) items.push({ y: h.y, haz: h });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.pick) drawPickup(it.pick);
      else drawHazard(it.haz);
    }
    drawCockpit();
    drawParticles();
    drawFloats();
    drawHUD(zone);

    if (game.state === 'COUNTDOWN') drawCountdown();
    if (game.state === 'DECISION') drawDecision();
    if (game.state === 'INCIDENT') drawIncident();
    if (game.zoneBanner > 0) drawZoneBanner(zone);
  }
  ctx.restore();
}

/* ---- environment (first-person corridor) ---- */
let scrollY = 0;

function drawWorld(zone) {
  const W = CONFIG.W, H = CONFIG.H;
  const hor = HORIZON + (game ? camOffY() : 0);

  // Back wall / ceiling above the horizon
  ctx.fillStyle = zone.wall;
  ctx.fillRect(0, 0, W, Math.max(0, hor));

  // Corridor end: a glowing doorway at the vanishing point
  ctx.fillStyle = '#0b0f1c';
  ctx.fillRect(W / 2 - 46, hor - 62, 92, 62);
  ctx.fillStyle = zone.accent;
  ctx.fillRect(W / 2 - 46, hor - 62, 92, 4);
  ctx.fillRect(W / 2 - 46, hor - 62, 4, 62);
  ctx.fillRect(W / 2 + 42, hor - 62, 4, 62);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(W / 2 - 42, hor - 58, 84, 58);

  // Floor base
  ctx.fillStyle = zone.floor;
  ctx.fillRect(0, hor, W, H - hor);

  // Scrolling floor bands (trapezoids between projected depth lines)
  const band = 120;
  const off = scrollY % band;
  const parity0 = Math.floor(scrollY / band);
  for (let i = -1; i < 8; i++) {
    const wyA = -90 + off + (i - 1) * band;
    const wyB = wyA + band;
    if (((parity0 - i) % 2 + 2) % 2 === 0) continue;
    const lA = project(wyA, 246), rA = project(wyA, 714);
    const lB = project(wyB, 246), rB = project(wyB, 714);
    ctx.fillStyle = zone.floorAlt;
    ctx.beginPath();
    ctx.moveTo(lA.x, lA.y); ctx.lineTo(rA.x, rA.y);
    ctx.lineTo(rB.x, rB.y); ctx.lineTo(lB.x, lB.y);
    ctx.closePath(); ctx.fill();
  }

  // Side walls converging toward the horizon
  for (const side of [246, 714]) {
    const far = project(-90, side), near = project(510, side);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    if (side < 480) {
      ctx.moveTo(far.x, hor); ctx.lineTo(near.x, H); ctx.lineTo(0, H); ctx.lineTo(0, hor);
    } else {
      ctx.moveTo(far.x, hor); ctx.lineTo(near.x, H); ctx.lineTo(W, H); ctx.lineTo(W, hor);
    }
    ctx.closePath(); ctx.fill();
  }

  // Hazard striping along both walkway edges
  const stripeStep = 80;
  const sOff = scrollY % (stripeStep * 2);
  for (const ex of [252, 708]) {
    for (let i = -1; i < 16; i++) {
      const wy = -90 + sOff + (i - 1) * stripeStep;
      if (wy > 520) break;
      const pr = project(wy, ex);
      const yellow = ((Math.floor(scrollY / stripeStep) - i) % 2 + 2) % 2 === 0;
      ctx.fillStyle = yellow ? '#FBBC04' : '#15181f';
      ctx.fillRect(pr.x - 6 * pr.s, pr.y - 3 * pr.s, 12 * pr.s, 8 * pr.s);
    }
  }

  // Lane divider dashes
  const dashStep = 70;
  const dOff = scrollY % dashStep;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  for (const dx of [405, 555]) {
    for (let i = -1; i < 12; i++) {
      const wy = -90 + dOff + (i - 1) * dashStep;
      if (wy > 520) break;
      const pr = project(wy, dx);
      ctx.fillRect(pr.x - 3 * pr.s, pr.y - 12 * pr.s, 6 * pr.s, 22 * pr.s);
    }
  }

  // Zone props lining both sides of the corridor
  const step = 190;
  const pOff = scrollY % step;
  for (let i = -1; i < 6; i++) {
    const wy = -90 + pOff + (i - 1) * step;
    if (wy > 470) continue;
    drawPropFP(project(wy, 150), zone, i);
    drawPropFP(project(wy, 810), zone, i);
  }
}

// Simplified pixel props, scaled with depth
function drawPropFP(pr, zone, seed) {
  const s = pr.s, x = pr.x, y = pr.y;
  if (s < 0.12) return;
  const name = zone.name;
  if (name === 'SERVER HALL') {
    // Server rack with blinking LEDs
    spr(x, y, -34, -170, 68, 170, '#10182c', s);
    for (let r = 0; r < 4; r++) {
      spr(x, y, -28, -158 + r * 40, 56, 2, '#26355c', s);
      const on = (Math.floor(scrollY / 200) + r + seed) % 3 !== 0;
      spr(x, y, -22, -150 + r * 40, 5, 5, on ? '#34A853' : '#123', s);
      spr(x, y, 12, -150 + r * 40, 5, 5, on ? '#4285F4' : '#123', s);
    }
  } else if (name === 'WAREHOUSE') {
    // Pallet racking with boxes
    spr(x, y, -40, -150, 6, 150, '#6b5a3a', s);
    spr(x, y, 34, -150, 6, 150, '#6b5a3a', s);
    spr(x, y, -40, -96, 80, 8, '#5a4a2f', s);
    spr(x, y, -40, -8, 80, 8, '#5a4a2f', s);
    spr(x, y, -30, -140, 30, 40, '#a8792f', s);
    spr(x, y, 4, -132, 26, 32, '#8f6526', s);
    spr(x, y, -26, -60, 34, 48, '#bd8c3e', s);
  } else if (name === 'LOADING BAY') {
    // Roller door + dock stripe
    spr(x, y, -44, -160, 88, 160, '#4a4a48', s);
    for (let r = 1; r < 6; r++) spr(x, y, -44, -160 + r * 26, 88, 3, '#3a3a38', s);
    spr(x, y, -44, -10, 88, 10, '#EA4335', s);
  } else if (name === 'MAINTENANCE AREA') {
    // Tool board
    spr(x, y, -36, -140, 72, 90, '#2c4436', s);
    spr(x, y, -22, -120, 6, 40, '#c9cdd8', s);
    spr(x, y, -2, -110, 26, 6, '#c9cdd8', s);
    spr(x, y, 14, -128, 8, 40, '#FBBC04', s);
  } else {
    // Plant room pipes + valve
    spr(x, y, -44, -150, 88, 14, '#4f6472', s);
    spr(x, y, -44, -90, 88, 14, '#41545f', s);
    spr(x, y, -10, -150, 14, 150, '#4f6472', s);
    spr(x, y, 22, -70, 20, 20, '#EA4335', s);
  }
}

/* ---- first-person body: pumping arms, helmet brim, duck posture ---- */
function drawCockpit() {
  const W = CONFIG.W, H = CONFIG.H;
  const jt = player.jumpT >= 0 ? player.jumpT / CONFIG.JUMP_TIME : -1;
  const lift = jt >= 0 ? Math.sin(jt * Math.PI) * 30 : 0;
  const duck = player.duck;
  const phase = player.runFrame * 3.1;
  const flash = game.invuln > 0 && Math.floor(game.time * 12) % 2 === 0;
  if (flash) ctx.globalAlpha = 0.4;

  // Hard-hat brim across the top of the view (drops lower when ducking)
  const brimH = duck ? 54 : 22;
  ctx.fillStyle = '#FBBC04';
  ctx.fillRect(0, 0, W, brimH);
  ctx.fillStyle = '#c79302';
  ctx.fillRect(0, brimH, W, 6);

  // Two pumping arms with hi-vis sleeves and gloves
  const armSwing = (game.state === 'RUNNING' && jt < 0 && !duck) ? 1 : 0;
  const ly = (duck ? 440 : 476) - lift + Math.sin(phase) * 16 * armSwing;
  const ry = (duck ? 440 : 476) - lift + Math.sin(phase + Math.PI) * 16 * armSwing;
  const lx = duck ? 300 : 236;
  const rx = duck ? 596 : 660;
  for (const [ax, ay, flip] of [[lx, ly, 1], [rx, ry, -1]]) {
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(flip * -0.35);
    ctx.fillStyle = '#e07b39';               // hi-vis sleeve
    ctx.fillRect(-26, 20, 64, 90);
    ctx.fillStyle = '#f5f0e6';               // reflective stripe
    ctx.fillRect(-26, 44, 64, 10);
    ctx.fillStyle = '#e8b48c';               // hand
    ctx.fillRect(-18, -8, 48, 34);
    ctx.fillStyle = '#d19a6b';               // knuckle shading
    ctx.fillRect(-18, 18, 48, 8);
    ctx.restore();
  }

  // Duck: darken the lower edge as your chin tucks in
  if (duck) {
    ctx.fillStyle = 'rgba(5,7,13,0.55)';
    ctx.fillRect(0, H - 44, W, 44);
  }
  ctx.globalAlpha = 1;
}

/* ---- hazards (perspective-projected sprites) ---- */
function drawHazard(h) {
  const telegraphing = h.y < 130;              // still far away = warning phase

  switch (h.type) {
    case 'fallingBox': {
      const pr = project(h.y, CONFIG.LANES[h.lane]);
      const s = pr.s;
      const wob = h.dropped ? 0 : Math.sin(game.time * 14) * 6 * s;
      const hover = h.dropped ? 46 : 150 + Math.sin(game.time * 9) * 6;
      shadowEllipse(pr.x, pr.y, 42 * s, 10 * s, 0.30);
      spr(pr.x + wob, pr.y, -26, -hover, 52, 46, '#a8792f', s);   // box
      spr(pr.x + wob, pr.y, -26, -hover, 52, 8, '#8f6526', s);
      spr(pr.x + wob, pr.y, -4, -hover, 8, 46, '#d9c8a0', s);     // tape
      warnIcon(pr.x, pr.y - 170 * s, telegraphing, '#EA4335');
      break;
    }
    case 'shelfSpill': {
      const pr = project(h.y, CONFIG.LANES[h.lane]);
      const s = pr.s;
      shadowEllipse(pr.x, pr.y, 44 * s, 9 * s, 0.25);
      spr(pr.x, pr.y, -40, -30, 26, 26, '#8f6526', s);
      spr(pr.x, pr.y, -8, -44, 30, 40, '#a8792f', s);
      spr(pr.x, pr.y, 22, -22, 22, 20, '#bd8c3e', s);
      warnIcon(pr.x, pr.y - 90 * s, telegraphing, '#EA4335');
      break;
    }
    case 'overheadLoad': {
      const pr = project(h.y, CONFIG.LANES[h.lane]);
      const s = pr.s;
      const spread = Math.min(1, (h.y + 90) / 400);
      shadowEllipse(pr.x, pr.y, (26 + spread * 40) * s, (7 + spread * 7) * s, 0.15 + spread * 0.3);
      spr(pr.x, pr.y, -1, -320, 3, 110, '#333', s);               // cable
      spr(pr.x, pr.y, -30, -230, 60, 44, '#7c8496', s);           // suspended crate
      spr(pr.x, pr.y, -30, -230, 60, 8, '#EA4335', s);
      warnIcon(pr.x, pr.y - 250 * s, telegraphing, '#EA4335');
      break;
    }
    case 'rackDoorLow': {
      // Head-height beam across the whole lane — the gap under it reads "duck"
      const pr = project(h.y, CONFIG.LANES[h.lane]);
      const s = pr.s;
      const halfW = 70;
      spr(pr.x, pr.y, -halfW, -132, halfW * 2, 28, '#3b4b73', s); // beam
      for (let i = 0; i < 7; i++) {
        spr(pr.x, pr.y, -halfW + 6 + i * 19, -128, 9, 20, i % 2 ? '#FBBC04' : '#15181f', s);
      }
      spr(pr.x, pr.y, -halfW, -106, halfW * 2, 4, '#FBBC04', s);  // strike line
      spr(pr.x, pr.y, -halfW, -104, 8, 104, '#25355d', s);        // posts to floor
      spr(pr.x, pr.y, halfW - 8, -104, 8, 104, '#25355d', s);
      actionLabel(pr.x, pr.y - 180 * s, h.y, L().c.duckLbl, '#FBBC04');
      break;
    }
    case 'swingDoor': {
      const pr = project(h.y, CONFIG.LANES[h.lane]);
      const s = pr.s;
      const swing = Math.sin(game.time * 6) * 14 * s;
      spr(pr.x, pr.y, -64, -120, 10, 120, '#25355d', s);          // hinge post
      spr(pr.x + swing, pr.y, -54, -116, 58, 96, '#3b4b73', s);   // swinging panel
      spr(pr.x + swing, pr.y, -54, -116, 58, 6, '#FBBC04', s);
      spr(pr.x + swing, pr.y, -6, -70, 8, 8, '#c9cdd8', s);       // handle
      warnIcon(pr.x, pr.y - 150 * s, telegraphing, '#FBBC04');
      break;
    }
    case 'sharpRail': {
      const pr = project(h.y, CONFIG.LANES[h.lane]);
      const s = pr.s;
      spr(pr.x, pr.y, -56, -18, 112, 14, '#c9cfdd', s);           // rail body
      spr(pr.x, pr.y, -56, -18, 112, 4, '#eef2fa', s);
      for (let i = 0; i < 8; i++) spr(pr.x, pr.y, -50 + i * 14, -32, 6, 14, '#eef2fa', s); // teeth
      spr(pr.x, pr.y, -56, 0, 112, 6, '#EA4335', s);              // red floor marking
      actionLabel(pr.x, pr.y - 70 * s, h.y, L().c.jumpLbl, '#34A853');
      break;
    }
    case 'palletNails': {
      const pr = project(h.y, CONFIG.LANES[h.lane]);
      const s = pr.s;
      spr(pr.x, pr.y, -56, -20, 112, 18, '#6b5a3a', s);           // broken pallet
      spr(pr.x, pr.y, -56, -20, 112, 5, '#5a4a2f', s);
      spr(pr.x, pr.y, -20, -30, 26, 6, '#4a3d26', s);             // splintered plank
      for (let i = 0; i < 6; i++) spr(pr.x, pr.y, -46 + i * 17, -34, 4, 12, '#eef2fa', s); // nails
      spr(pr.x, pr.y, -56, 0, 112, 5, '#EA4335', s);
      actionLabel(pr.x, pr.y - 70 * s, h.y, L().c.jumpLbl, '#34A853');
      break;
    }
    case 'forklift': case 'trolley': {
      const pr = project(h.y, h.x);
      const s = pr.s;
      const isFork = h.type === 'forklift';
      const beacon = Math.floor(game.time * 8) % 2 === 0;
      shadowEllipse(pr.x, pr.y, 76 * s, 12 * s, 0.3);
      if (isFork) {
        const dir = h.vx > 0 ? 1 : -1;
        spr(pr.x, pr.y, -34, -78, 68, 66, '#FBBC04', s);          // body
        spr(pr.x, pr.y, -34, -78, 68, 12, '#c79302', s);
        spr(pr.x, pr.y, dir * 34, -96, dir * 14, 96, '#3a3f4d', s); // mast
        spr(pr.x, pr.y, dir * 44, -34, dir * 52, 8, '#8b96b8', s);  // forks
        spr(pr.x, pr.y, dir * 44, -14, dir * 52, 8, '#8b96b8', s);
        spr(pr.x, pr.y, -14, -104, 26, 26, '#e8b48c', s);         // driver
        spr(pr.x, pr.y, -18, -114, 34, 12, '#EA4335', s);         // driver helmet
        if (beacon) spr(pr.x, pr.y, -6, -132, 12, 12, '#FF9900', s); // flashing beacon
        spr(pr.x, pr.y, -34, -14, 18, 14, '#15181f', s);          // wheels
        spr(pr.x, pr.y, 16, -14, 18, 14, '#15181f', s);
      } else {
        spr(pr.x, pr.y, -30, -44, 60, 30, '#5b6577', s);          // trolley bed
        spr(pr.x, pr.y, -24, -82, 26, 38, '#a8792f', s);          // load
        spr(pr.x, pr.y, 2, -74, 22, 30, '#8f6526', s);
        spr(pr.x, pr.y, -28, -14, 14, 14, '#15181f', s);
        spr(pr.x, pr.y, 14, -14, 14, 14, '#15181f', s);
        if (beacon) spr(pr.x, pr.y, -5, -96, 10, 10, '#FF9900', s);
      }
      // Entry-side warning arrow while the vehicle is still approaching
      if (!h.resolved && h.y < CONFIG.PLAYER_Y - 60 && beacon) {
        ctx.fillStyle = '#FF9900';
        ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center';
        ctx.fillText(h.vx > 0 ? '▶' : '◀', h.vx > 0 ? 80 : 880, Math.min(500, pr.y));
      }
      break;
    }
    case 'pinchDoors': {
      const closure = pinchClosure(h);
      for (let l = 0; l < 3; l++) {
        if (l === h.openLane) continue;
        const pr = project(h.y, CONFIG.LANES[l]);
        const s = pr.s;
        const lw = 134;                        // lane width at near-plane scale
        const half = (lw / 2) * closure;
        spr(pr.x, pr.y, -lw / 2, -96, half, 96, '#3a4356', s);          // left panel
        spr(pr.x, pr.y, lw / 2 - half, -96, half, 96, '#3a4356', s);    // right panel
        spr(pr.x, pr.y, -lw / 2 + half - 6, -96, 6, 96, '#FBBC04', s);  // yellow lips
        spr(pr.x, pr.y, lw / 2 - half, -96, 6, 96, '#FBBC04', s);
      }
      // Open-lane marker
      if (h.y < CONFIG.PLAYER_Y - 40) {
        const po = project(h.y, CONFIG.LANES[h.openLane]);
        ctx.fillStyle = Math.floor(game.time * 6) % 2 === 0 ? '#34A853' : '#7ee2a1';
        ctx.font = 'bold ' + Math.round(16 + 14 * po.s) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('▼', po.x, po.y - 120 * po.s);
      }
      break;
    }
  }
}

function warnIcon(x, y, active, color) {
  if (!active) return;
  const on = Math.floor(game.time * 7) % 2 === 0;
  if (!on) return;
  ctx.fillStyle = color;
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('!', x, y - 46);
}

// Flashing action prompt shown while the hazard approaches, so the required
// response (DUCK / JUMP) is unmistakable until it's nearly on the player.
// sx/sy are screen coordinates; worldY gates it off once the hazard is close.
function actionLabel(sx, sy, worldY, text, color) {
  if (worldY > CONFIG.PLAYER_Y - 70) return;
  if (Math.floor(game.time * 5) % 3 === 2) return;         // slow flash
  ctx.font = 'bold 17px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000';
  ctx.fillText(text, sx + 2, sy + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, sx, sy);
}

/* ---- pickups / particles / floats ---- */
function drawPickup(p) {
  const pr = project(p.y, CONFIG.LANES[p.lane]);
  const r = Math.max(3, 16 * pr.s);
  const bob = Math.sin(game.time * 6 + p.y * 0.05) * 4 * pr.s;
  const cy = pr.y - 26 * pr.s + bob;
  // Hex BotG token, scaled with depth
  ctx.fillStyle = '#FBBC04';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i - Math.PI / 6;
    const hx = pr.x + Math.cos(a) * r, hy = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
  }
  ctx.closePath(); ctx.fill();
  if (r > 6) {
    ctx.fillStyle = '#7a5c02';
    ctx.font = 'bold ' + Math.round(r * 0.9) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('B', pr.x, cy + r * 0.35);
  }
}

function drawParticles() {
  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, p.t * 2);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
  }
  ctx.globalAlpha = 1;
}

function drawFloats() {
  ctx.textAlign = 'center';
  ctx.font = 'bold 17px monospace';
  for (const f of game.floats) {
    ctx.globalAlpha = Math.min(1, f.t * 2);
    ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x + 2, f.y + 2);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

/* ---- HUD ---- */
function drawHUD(zone) {
  const W = CONFIG.W;
  ctx.textAlign = 'left';

  // Score
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = '#000'; ctx.fillText(Math.round(game.score).toLocaleString(), 22, 36);
  ctx.fillStyle = '#fff'; ctx.fillText(Math.round(game.score).toLocaleString(), 20, 34);

  // Multiplier + streak pips
  if (game.mult > 1) {
    ctx.fillStyle = '#FBBC04';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('x' + game.mult, 20, 62);
  }
  const nextStep = CONFIG.STREAK_STEPS.find(s => s > game.streak) || CONFIG.STREAK_STEPS[2];
  for (let i = 0; i < nextStep; i++) {
    ctx.fillStyle = i < game.streak ? '#34A853' : 'rgba(255,255,255,0.18)';
    ctx.fillRect(20 + (game.mult > 1 ? 46 : 0) + i * 10, 54, 7, 7);
  }

  // Token counter
  ctx.fillStyle = '#FBBC04';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('⬢ ' + game.tokens, W - 110, 34);

  // Lives (hard hats)
  ctx.font = 'bold 20px monospace';
  for (let i = 0; i < CONFIG.LIVES; i++) {
    ctx.fillStyle = i < game.lives ? '#FBBC04' : 'rgba(255,255,255,0.18)';
    ctx.fillText('⛑', W - 110 - i * 26, 62);
  }

  // Progress bar with zone ticks
  const bw = 320, bx = (W - bw) / 2, by = 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, 12);
  ctx.fillStyle = zone.accent; ctx.fillRect(bx, by, bw * runFrac(), 12);
  ctx.fillStyle = '#fff';
  for (let i = 1; i < ZONES.length; i++) ctx.fillRect(bx + (bw / ZONES.length) * i, by, 2, 12);
  ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = '#e8ecf7';
  ctx.fillText(L().zones[game.zoneIndex], W / 2, by + 26);
}

function drawCountdown() {
  ctx.fillStyle = 'rgba(5,7,13,0.55)';
  ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px monospace';
  ctx.fillStyle = '#EA4335';
  ctx.fillText(L().c.alert, CONFIG.W / 2, 200);
  ctx.font = 'bold 64px monospace';
  ctx.fillStyle = '#FBBC04';
  const n = Math.ceil(game.countdown);
  ctx.fillText(game.countdown > 0.35 ? String(n) : L().c.go, CONFIG.W / 2, 300);
  ctx.font = '16px monospace';
  ctx.fillStyle = '#8b96b8';
  ctx.fillText(L().c.sub, CONFIG.W / 2, 350);
}

function drawZoneBanner(zone) {
  const a = Math.min(1, game.zoneBanner);
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(5,7,13,0.7)';
  ctx.fillRect(CONFIG.W / 2 - 200, 70, 400, 46);
  ctx.fillStyle = zone.accent;
  ctx.fillRect(CONFIG.W / 2 - 200, 70, 400, 4);
  ctx.textAlign = 'center';
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText('▸ ' + L().zones[game.zoneIndex] + ' ◂', CONFIG.W / 2, 102);
  ctx.globalAlpha = 1;
}

function drawDecision() {
  const d = game.decision;
  const W = CONFIG.W, H = CONFIG.H;
  ctx.fillStyle = 'rgba(5,7,13,0.85)';
  ctx.fillRect(0, 0, W, H);

  const bx = W / 2 - 330, bw = 660;
  ctx.fillStyle = '#141b30'; ctx.fillRect(bx, 110, bw, 320);
  ctx.fillStyle = '#EA4335'; ctx.fillRect(bx, 110, bw, 6);

  const dd = L().dec[d.idx];       // translated scenario text
  ctx.textAlign = 'center';
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#EA4335';
  ctx.fillText(L().c.decisionHdr, W / 2, 150);

  ctx.font = '17px monospace';
  ctx.fillStyle = '#e8ecf7';
  wrapText(dd.text, W / 2, 190, 560, 24);

  // Options
  const optY = 250;
  for (let i = 0; i < dd.options.length; i++) {
    const oy = optY + i * 46;
    let bg = '#1d2745', fg = '#e8ecf7';
    if (d.answered) {
      if (i === d.def.correct) { bg = '#34A853'; fg = '#04210d'; }
      else if (d.result !== 'correct' && d.result !== 'missed') { bg = '#3a2030'; fg = '#8b96b8'; }
    }
    ctx.fillStyle = bg; ctx.fillRect(W / 2 - 240, oy - 24, 480, 36);
    ctx.fillStyle = fg;
    ctx.font = 'bold 15px monospace';
    ctx.fillText('[' + (i + 1) + '] ' + dd.options[i], W / 2, oy);
  }

  if (!d.answered) {
    // Timer bar
    const frac = Math.max(0, d.timer / CONFIG.DECISION_WINDOW);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(W / 2 - 240, 398, 480, 10);
    ctx.fillStyle = frac > 0.4 ? '#FBBC04' : '#EA4335';
    ctx.fillRect(W / 2 - 240, 398, 480 * frac, 10);
  } else {
    ctx.font = 'bold 16px monospace';
    if (d.result === 'correct') { ctx.fillStyle = '#34A853'; ctx.fillText('+' + CONFIG.SCORE_DECISION + '  ' + L().c.goodObs, W / 2, 400); }
    else if (d.result === 'missed') { ctx.fillStyle = '#EA4335'; ctx.fillText(L().c.tooSlow + ' — −' + CONFIG.PENALTY_DECISION, W / 2, 400); }
    else { ctx.fillStyle = '#EA4335'; ctx.fillText(L().c.unsafeChoice + ' — −' + CONFIG.PENALTY_DECISION, W / 2, 400); }
    ctx.font = '13px monospace';
    ctx.fillStyle = '#8b96b8';
    wrapText(dd.why, W / 2, 418, 560, 18);
    if (d.holdTimer < CONFIG.DECISION_HOLD - 0.4) {
      ctx.fillStyle = '#e8ecf7';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(L().c.tapCont, W / 2, 460);
    }
  }
}

function drawIncident() {
  const inc = game.incident;
  const tr = L().haz[inc.type] || inc.def;   // translated category / cue / response
  const W = CONFIG.W;
  ctx.fillStyle = 'rgba(120,10,10,0.28)';
  ctx.fillRect(0, 0, W, CONFIG.H);

  // Highlight ring where the contact happened (projected near plane)
  const hp = project(CONFIG.PLAYER_Y - 20, CONFIG.LANES[Math.max(0, inc.lane)]);
  ctx.strokeStyle = '#EA4335';
  ctx.lineWidth = 4;
  ctx.strokeRect(hp.x - 90, hp.y - 160, 180, 170);

  const bx = W / 2 - 300;
  ctx.fillStyle = '#141b30'; ctx.fillRect(bx, 130, 600, 210);
  ctx.fillStyle = '#EA4335'; ctx.fillRect(bx, 130, 600, 6);

  ctx.textAlign = 'center';
  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = '#EA4335';
  ctx.fillText(L().c.missedObs, W / 2, 168);

  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#FBBC04';
  ctx.fillText(L().c.catLbl + tr.cat.toUpperCase(), W / 2, 202);

  ctx.font = '14px monospace';
  ctx.fillStyle = '#e8ecf7';
  wrapText(L().c.cueLbl + tr.cue, W / 2, 232, 520, 20);
  ctx.fillStyle = '#34A853';
  wrapText(L().c.safeLbl + tr.safe, W / 2, 278, 520, 20);

  // Lives remaining after this contact
  ctx.font = 'bold 14px monospace';
  ctx.fillStyle = inc.fatal ? '#EA4335' : '#FBBC04';
  ctx.fillText(inc.fatal ? L().c.noLives : L().c.livesLeft + ': ' + game.lives + ' / ' + CONFIG.LIVES, W / 2, 314);

  // Tap-to-continue prompt (appears after the minimum read time)
  if (inc.elapsed >= CONFIG.INCIDENT_MIN && Math.floor(game.time * 500 + inc.elapsed * 2) % 2 === 0) {
    ctx.fillStyle = '#e8ecf7';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(inc.fatal ? L().c.tapReport : L().c.tapResume, W / 2, 334);
  }
}

function wrapText(text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); y += lh; line = w;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

/* =====================================================================
   17. MAIN LOOP
   ===================================================================== */
let lastT = performance.now();
function frame(now) {
  let dt = (now - lastT) / 1000;
  lastT = now;
  dt = Math.min(dt, 0.05);            // clamp tab-switch spikes

  try {
    if (game) {
      if (game.state === 'RUNNING' || game.state === 'COUNTDOWN') {
        scrollY += (game.state === 'RUNNING' ? game.speed : 120) * dt;
      }
      update(dt);
      render();
    }
  } catch (err) {
    // Fail soft: log and keep the loop alive so a draw glitch never kills the booth.
    console.error('Server Sprint error:', err);
  }
  requestAnimationFrame(frame);
}

// Language selector buttons
document.querySelectorAll('#langRow button').forEach(b => {
  b.addEventListener('click', () => setLang(b.dataset.lang));
});

// Boot: idle attract state behind the menu, in the saved language
game = freshGame();
player = freshPlayer();
applyLang();
requestAnimationFrame(frame);
