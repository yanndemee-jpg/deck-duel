(() => {
  // =========================
  // Deck Duel — mini prototype
  // =========================

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const btnRestart = document.getElementById("btnRestart");
  const chkHard = document.getElementById("chkHard");

  // World
  const W = canvas.width, H = canvas.height;
  const DECK = { x: 60, y: 70, w: W - 120, h: H - 140 };
  const MID_X = DECK.x + DECK.w / 2;

  // Tuning
  const G = 900;                 // pseudo-gravity magnitude applied along tilt
  const FRICTION = 0.90;
  const PLAYER_SPEED = 260;
  const PICK_RADIUS = 22;

  // Types (icônes simples par formes + lettres)
  const ITEM_TYPES = [
    { key: "CORDAGE", label: "C", shape: "circle" },
    { key: "CAISSE",   label: "K", shape: "box"    },
    { key: "OUTIL",    label: "O", shape: "tri"    },
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; }

  // Input
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    // éviter scroll flèches / espace
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
  }, { passive: false });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  // Entities
  function makePlayer(side) {
    const isLeft = side === "LEFT";
    const pxMin = isLeft ? DECK.x + 40 : MID_X + 40;
    const pxMax = isLeft ? MID_X - 40 : DECK.x + DECK.w - 40;
    return {
      side,
      x: rand(pxMin, pxMax),
      y: rand(DECK.y + 70, DECK.y + DECK.h - 70),
      vx: 0, vy: 0,
      r: 16,
      carrying: null, // item id
      score: 0
    };
  }

  function makeItem(side, typeKey) {
    const isLeft = side === "LEFT";
    const pxMin = isLeft ? DECK.x + 30 : MID_X + 30;
    const pxMax = isLeft ? MID_X - 30 : DECK.x + DECK.w - 30;
    return {
      id: cryptoRandomId(),
      side, // initial side (for spawn), but physics will keep it on its half via barrier
      typeKey,
      x: rand(pxMin, pxMax),
      y: rand(DECK.y + 30, DECK.y + DECK.h - 30),
      vx: rand(-40, 40),
      vy: rand(-40, 40),
      r: 12,
      heldBy: null,
      delivered: false
    };
  }

  function makeSlots(side) {
    // 6 slots per player (2 rows x 3 cols)
    const isLeft = side === "LEFT";
    const margin = 16;
    const slotW = 46, slotH = 46;
    const baseX = isLeft ? (DECK.x + margin) : (DECK.x + DECK.w - margin - 3*slotW - 2*10);
    const baseY = DECK.y + margin;

    const pattern = [
      "CORDAGE","CAISSE","OUTIL",
      "OUTIL","CORDAGE","CAISSE"
    ];

    return pattern.map((need, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      return {
        side,
        need,
        x: baseX + col*(slotW + 10),
        y: baseY + row*(slotH + 10),
        w: slotW,
        h: slotH,
        filled: false
      };
    });
  }

  // Captain nuisance
  const captain = {
    active: false,
    side: "LEFT",
    x: MID_X,
    y: DECK.y + DECK.h / 2,
    r: 26,
    tLeft: 0,
    nextIn: 0
  };

  // Waves
  let tilt = 0;          // current tilt angle indicator (not actual rotation)
  let tiltVel = 0;
  let nextWaveIn = 0;

  // Game state
  let p1, p2, items, slotsL, slotsR;
  let running = true;
  let winner = null;
  let lastTime = performance.now();

  function cryptoRandomId() {
    // simple unique-ish id without deps
    return Math.random().toString(16).slice(2) + "-" + Math.random().toString(16).slice(2);
  }

  function reset() {
    p1 = makePlayer("LEFT");
    p2 = makePlayer("RIGHT");

    slotsL = makeSlots("LEFT");
    slotsR = makeSlots("RIGHT");

    items = [];
    // spawn 12 per side (mix types)
    for (let i = 0; i < 12; i++) {
      const t = ITEM_TYPES[i % ITEM_TYPES.length].key;
      items.push(makeItem("LEFT", t));
      items.push(makeItem("RIGHT", t));
    }

    running = true;
    winner = null;

    tilt = 0; tiltVel = 0;
    nextWaveIn = chkHard.checked ? rand(1.0, 2.2) : rand(1.6, 3.2);

    captain.active = false;
    captain.tLeft = 0;
    captain.nextIn = chkHard.checked ? rand(4.0, 7.0) : rand(6.0, 11.0);

    lastTime = performance.now();
  }

  btnRestart.addEventListener("click", reset);
  chkHard.addEventListener("change", reset);

  function playerControls(player, dt) {
    const isLeft = player.side === "LEFT";

    // Movement keys
    let ax = 0, ay = 0;
    if (isLeft) {
      if (keys.has("KeyQ")) ax -= 1;
      if (keys.has("KeyD")) ax += 1;
      if (keys.has("KeyZ")) ay -= 1;
      if (keys.has("KeyS")) ay += 1;
    } else {
      if (keys.has("ArrowLeft")) ax -= 1;
      if (keys.has("ArrowRight")) ax += 1;
      if (keys.has("ArrowUp")) ay -= 1;
      if (keys.has("ArrowDown")) ay += 1;
    }

    const len = Math.hypot(ax, ay) || 1;
    ax /= len; ay /= len;

    // captain "stress": slower when he's active on your side
    const slow = (captain.active && captain.side === player.side) ? 0.78 : 1.0;

    player.vx += ax * PLAYER_SPEED * slow * dt;
    player.vy += ay * PLAYER_SPEED * slow * dt;
  }

  function enforceDeckBounds(e, halfBarrier = true) {
    // Keep inside deck
    e.x = clamp(e.x, DECK.x + 10, DECK.x + DECK.w - 10);
    e.y = clamp(e.y, DECK.y + 10, DECK.y + DECK.h - 10);

    // Keep on its half (matches "ton côté")
    if (halfBarrier) {
      if (e.side === "LEFT") e.x = clamp(e.x, DECK.x + 10, MID_X - 10);
      if (e.side === "RIGHT") e.x = clamp(e.x, MID_X + 10, DECK.x + DECK.w - 10);
    }
  }

  // Debounce for pick/drop keys
  let p1ActionLatch = false;
  let p2ActionLatch = false;

  function handleAction(player) {
    const isLeft = player.side === "LEFT";
    const code = isLeft ? "KeyE" : "Enter";

    let latch = isLeft ? p1ActionLatch : p2ActionLatch;
    const pressed = keys.has(code);

    if (pressed && !latch) {
      // trigger action
      if (player.carrying) {
        // drop
        const it = items.find(x => x.id === player.carrying);
        if (it) {
          it.heldBy = null;
          player.carrying = null;
        }
      } else {
        // pick nearest item (not delivered, not held)
        let best = null;
        let bestD2 = Infinity;
        for (const it of items) {
          if (it.delivered || it.heldBy) continue;
          if (it.side !== player.side) continue; // only your side
          const d2 = dist2(player.x, player.y, it.x, it.y);
          if (d2 < PICK_RADIUS * PICK_RADIUS && d2 < bestD2) {
            best = it; bestD2 = d2;
          }
        }
        // captain blocks pickup if too close
        const blocked = captain.active && captain.side === player.side
          && dist2(player.x, player.y, captain.x, captain.y) < (captain.r + 18) ** 2;

        if (best && !blocked) {
          best.heldBy = player.side;
          player.carrying = best.id;
        }
      }
    }

    latch = pressed;
    if (isLeft) p1ActionLatch = latch; else p2ActionLatch = latch;
  }

  function tryDeliver(player) {
    if (!player.carrying) return;

    const it = items.find(x => x.id === player.carrying);
    if (!it || it.delivered) return;

    const slots = (player.side === "LEFT") ? slotsL : slotsR;

    for (const s of slots) {
      if (s.filled) continue;
      // player must be in front of slot
      const inX = player.x >= s.x && player.x <= s.x + s.w;
      const inY = player.y >= s.y && player.y <= s.y + s.h;
      if (!inX || !inY) continue;

      // must match type
      if (it.typeKey === s.need) {
        s.filled = true;
        it.delivered = true;
        it.heldBy = null;
        player.carrying = null;
        player.score += 1;
      } else {
        // wrong slot: small penalty (drop + stumble)
        it.heldBy = null;
        player.carrying = null;
        player.vx *= 0.2;
        player.vy *= 0.2;
      }
      break;
    }
  }

  function updateWaves(dt) {
    nextWaveIn -= dt;
    if (nextWaveIn <= 0) {
      // a wave impulse changes tilt velocity
      const impulse = chkHard.checked ? rand(-2.6, 2.6) : rand(-2.0, 2.0);
      tiltVel += impulse;
      nextWaveIn = chkHard.checked ? rand(0.9, 2.0) : rand(1.4, 3.0);
    }

    // tilt dynamics (damped)
    tiltVel += (-tilt * 2.2) * dt;
    tiltVel *= (chkHard.checked ? 0.92 : 0.94);
    tilt += tiltVel * dt;

    tilt = clamp(tilt, -1.2, 1.2);
  }

  function updateCaptain(dt) {
    if (!captain.active) {
      captain.nextIn -= dt;
      if (captain.nextIn <= 0) {
        captain.active = true;
        captain.side = Math.random() < 0.5 ? "LEFT" : "RIGHT";

        const pxMin = (captain.side === "LEFT") ? (DECK.x + 80) : (MID_X + 80);
        const pxMax = (captain.side === "LEFT") ? (MID_X - 80) : (DECK.x + DECK.w - 80);

        captain.x = rand(pxMin, pxMax);
        captain.y = rand(DECK.y + 120, DECK.y + DECK.h - 60);

        captain.tLeft = chkHard.checked ? rand(3.0, 4.5) : rand(3.5, 5.5);
      }
      return;
    }

    captain.tLeft -= dt;
    if (captain.tLeft <= 0) {
      captain.active = false;
      captain.nextIn = chkHard.checked ? rand(4.0, 7.0) : rand(6.0, 11.0);
      return;
    }

    // Captain nuisance effect: if player comes close -> push + drop carried item
    for (const pl of [p1, p2]) {
      if (pl.side !== captain.side) continue;
      const d2 = dist2(pl.x, pl.y, captain.x, captain.y);
      const hitR = (captain.r + 18);
      if (d2 < hitR * hitR) {
        const dx = pl.x - captain.x;
        const dy = pl.y - captain.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len, ny = dy / len;

        // push
        pl.vx += nx * 420;
        pl.vy += ny * 420;

        // make you drop item
        if (pl.carrying) {
          const it = items.find(x => x.id === pl.carrying);
          if (it) {
            it.heldBy = null;
            pl.carrying = null;
            // item gets kicked a bit
            it.vx += nx * 260;
            it.vy += ny * 260;
          }
        }
      }
    }
  }

  function physics(dt) {
    // Apply tilt as horizontal acceleration (sliding)
    const axTilt = Math.sin(tilt) * G;

    for (const it of items) {
      if (it.delivered) continue;

      if (it.heldBy) {
        // follow player's hands
        const pl = it.heldBy === "LEFT" ? p1 : p2;
        it.x = pl.x;
        it.y = pl.y - 20;
        it.vx = pl.vx * 0.2;
        it.vy = pl.vy * 0.2;
        continue;
      }

      it.vx += axTilt * dt;
      it.vx *= FRICTION;
      it.vy *= FRICTION;

      it.x += it.vx * dt;
      it.y += it.vy * dt;

      enforceDeckBounds(it, true);
    }

    // Players
    for (const pl of [p1, p2]) {
      pl.vx *= 0.86;
      pl.vy *= 0.86;

      pl.x += pl.vx * dt;
      pl.y += pl.vy * dt;

      enforceDeckBounds(pl, true);
    }
  }

  function checkWin() {
    const doneL = slotsL.every(s => s.filled);
    const doneR = slotsR.every(s => s.filled);
    if (!running) return;

    if (doneL && doneR) {
      running = false;
      winner = "Égalité parfaite";
    } else if (doneL) {
      running = false;
      winner = "Joueur 1 (bâbord) gagne";
    } else if (doneR) {
      running = false;
      winner = "Joueur 2 (tribord) gagne";
    }
  }

  // Rendering
  function drawDeck() {
    // deck
    roundRect(DECK.x, DECK.y, DECK.w, DECK.h, 14, "#0f2239", "#2a3a55");
    // middle separation line
    ctx.strokeStyle = "#2a3a55";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MID_X, DECK.y);
    ctx.lineTo(MID_X, DECK.y + DECK.h);
    ctx.stroke();

    // top labels
    ctx.fillStyle = "rgba(232,238,246,0.75)";
    ctx.font = "14px system-ui";
    ctx.fillText("BÂBORD (J1)", DECK.x + 12, DECK.y - 14);
    ctx.fillText("TRIBORD (J2)", MID_X + 12, DECK.y - 14);

    // tilt indicator
    ctx.fillStyle = "rgba(232,238,246,0.75)";
    ctx.fillText(`Vagues: inclinaison ${tilt.toFixed(2)}`, DECK.x + 12, DECK.y + DECK.h + 26);
  }

  function drawSlots(slots) {
    for (const s of slots) {
      const type = ITEM_TYPES.find(t => t.key === s.need);
      const fill = s.filled ? "rgba(150,220,170,0.25)" : "rgba(255,255,255,0.06)";
      const stroke = s.filled ? "rgba(150,220,170,0.65)" : "rgba(232,238,246,0.25)";
      roundRect(s.x, s.y, s.w, s.h, 10, fill, stroke);

      ctx.fillStyle = "rgba(232,238,246,0.85)";
      ctx.font = "16px system-ui";
      ctx.fillText(type.label, s.x + s.w/2 - 5, s.y + s.h/2 + 6);
    }
  }

  function drawItems() {
    for (const it of items) {
      if (it.delivered) continue;

      const type = ITEM_TYPES.find(t => t.key === it.typeKey);
      const alpha = it.heldBy ? 0.95 : 0.85;

      ctx.save();
      ctx.globalAlpha = alpha;

      // simple styling: left side slightly different tint via outline
      ctx.lineWidth = 2;
      ctx.strokeStyle = (it.side === "LEFT") ? "rgba(140,190,255,0.7)" : "rgba(255,190,140,0.7)";
      ctx.fillStyle = "rgba(232,238,246,0.14)";

      if (type.shape === "circle") {
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
      } else if (type.shape === "box") {
        ctx.beginPath();
        ctx.rect(it.x - it.r, it.y - it.r, it.r*2, it.r*2);
        ctx.fill(); ctx.stroke();
      } else { // tri
        ctx.beginPath();
        ctx.moveTo(it.x, it.y - it.r);
        ctx.lineTo(it.x + it.r, it.y + it.r);
        ctx.lineTo(it.x - it.r, it.y + it.r);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }

      ctx.fillStyle = "rgba(232,238,246,0.9)";
      ctx.font = "14px system-ui";
      ctx.fillText(type.label, it.x - 4, it.y + 5);

      ctx.restore();
    }
  }

  function drawPlayer(pl, label) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 3;

    ctx.strokeStyle = (pl.side === "LEFT") ? "rgba(140,190,255,0.95)" : "rgba(255,190,140,0.95)";
    ctx.fillStyle = "rgba(232,238,246,0.10)";

    ctx.beginPath();
    ctx.arc(pl.x, pl.y, pl.r, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();

    // name + score
    ctx.fillStyle = "rgba(232,238,246,0.9)";
    ctx.font = "14px system-ui";
    ctx.fillText(`${label}  (${pl.score}/6)`, pl.x - 26, pl.y - 24);

    // carrying marker
    if (pl.carrying) {
      ctx.beginPath();
      ctx.arc(pl.x, pl.y - 26, 6, 0, Math.PI*2);
      ctx.fillStyle = "rgba(232,238,246,0.85)";
      ctx.fill();
    }

    ctx.restore();
  }

  function drawCaptain() {
    if (!captain.active) return;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,90,90,0.95)";
    ctx.fillStyle = "rgba(255,90,90,0.08)";

    ctx.beginPath();
    ctx.arc(captain.x, captain.y, captain.r, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = "rgba(232,238,246,0.95)";
    ctx.font = "14px system-ui";
    ctx.fillText("CAPITAINE", captain.x - 34, captain.y - captain.r - 8);
    ctx.restore();
  }

  function drawHUD() {
    // next wave / captain
    ctx.fillStyle = "rgba(232,238,246,0.78)";
    ctx.font = "14px system-ui";
    ctx.fillText(`Prochaine vague: ${Math.max(0, nextWaveIn).toFixed(1)}s`, DECK.x + DECK.w - 170, DECK.y + DECK.h + 26);

    const capTxt = captain.active
      ? `Capitaine: ${captain.tLeft.toFixed(1)}s`
      : `Capitaine dans: ${Math.max(0, captain.nextIn).toFixed(1)}s`;

    ctx.fillText(capTxt, DECK.x + DECK.w - 170, DECK.y + DECK.h + 46);

    if (!running && winner) {
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = "rgba(14,17,22,0.75)";
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "rgba(232,238,246,0.95)";
      ctx.font = "28px system-ui";
      ctx.fillText("Fin de manche", W/2 - 95, H/2 - 24);

      ctx.font = "20px system-ui";
      ctx.fillText(winner, W/2 - ctx.measureText(winner).width/2, H/2 + 12);

      ctx.font = "14px system-ui";
      const hint = "Clique sur Recommencer";
      ctx.fillText(hint, W/2 - ctx.measureText(hint).width/2, H/2 + 42);

      ctx.restore();
    }
  }

  function roundRect(x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function step(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    if (running) {
      updateWaves(dt);
      updateCaptain(dt);

      playerControls(p1, dt);
      playerControls(p2, dt);

      handleAction(p1);
      handleAction(p2);

      physics(dt);

      // deliver check when standing on slot
      tryDeliver(p1);
      tryDeliver(p2);

      checkWin();
    }

    // draw
    ctx.clearRect(0, 0, W, H);
    drawDeck();
    drawSlots(slotsL);
    drawSlots(slotsR);
    drawItems();
    drawCaptain();
    drawPlayer(p1, "J1");
    drawPlayer(p2, "J2");
    drawHUD();

    requestAnimationFrame(step);
  }

  // Start
  reset();
  requestAnimationFrame(step);
})();
