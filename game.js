/*
  Waterbender Side-Scroller (single-file JS)
  ------------------------------------------
  This file is intentionally very commented for beginner learning:
  - How game loops work
  - How player/enemy state is modeled
  - How mouse dragging can control an attack object (water orb)
  - How waves + upgrades can be implemented in plain JavaScript
*/

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const restartBtn = document.getElementById("restartBtn");
const levelUpBtn = document.getElementById("levelUpBtn");

const GROUND_Y = canvas.height - 95;
const WORLD_WIDTH = 3500; // world wider than screen to support side-scroll

// Camera tracks the player horizontally.
const camera = { x: 0 };

// Basic keyboard state map, e.g. keys["w"] = true when pressed.
const keys = {};

// ------------------------------
// Player / Orb / Game state
// ------------------------------
const gameState = {
  running: true,
  score: 0,
  wave: 1,
  level: 1,
  canLevelUp: false,
  selectedUpgrade: null,
};

const player = {
  x: 220,
  y: GROUND_Y - 80,
  w: 40,
  h: 80,
  vx: 0,
  vy: 0,
  speed: 4,
  jumpPower: 12.5,
  health: 100,
  maxHealth: 100,
  facing: 1,
  onGround: true,
  attackTimer: 0,
  // unlocked abilities start with only whip + melee
  abilities: {
    waterWhip: true,
    waterWave: false,
    iceShard: false,
    waterShield: false,
    slam: false,
  },
};

const orb = {
  x: player.x + 60,
  y: player.y + 18,
  vx: 0,
  vy: 0,
  radius: 14,
  state: "orbit", // orbit | dragging | launched | regenerating
  dragging: false,
  dragPoints: [],
  dragDamageCooldown: 0,
  isIceMode: false,
  regenTimer: 0,
  maxDistance: 170,
  lastDragDir: { x: 1, y: 0 },
};

const particles = [];
const enemies = [];
const structures = [];
const projectiles = []; // enemy projectiles that can be blocked by water shield/orb

let frame = 0;

// ------------------------------
// Utility helpers
// ------------------------------
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function screenToWorldX(screenX) {
  return screenX + camera.x;
}

function addParticles(x, y, color, amount = 10, spread = 2, speed = 2) {
  for (let i = 0; i < amount; i++) {
    particles.push({
      x,
      y,
      vx: rand(-speed, speed),
      vy: rand(-speed, speed),
      life: rand(20, 40),
      size: rand(2, 5),
      color,
      gravity: spread,
    });
  }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function enemyRect(enemy) {
  return { x: enemy.x, y: enemy.y, w: enemy.w, h: enemy.h };
}

// ------------------------------
// Wave generation
// ------------------------------
function buildStructuresForWave(wave) {
  structures.length = 0;
  const structureCount = Math.min(2 + Math.floor(wave / 2), 6);

  for (let i = 0; i < structureCount; i++) {
    const w = rand(40, 120);
    const h = rand(40, 140);
    structures.push({
      x: rand(550, WORLD_WIDTH - 240),
      y: GROUND_Y - h,
      w,
      h,
      kind: Math.random() < 0.5 ? "stone" : "ice-wall",
    });
  }
}

function spawnWave(wave) {
  enemies.length = 0;
  projectiles.length = 0;

  const maxEnemies = Math.min(2 + wave, 8); // intentionally low count per request
  for (let i = 0; i < maxEnemies; i++) {
    const typeRoll = Math.random();
    let behavior = "patrol";
    if (typeRoll > 0.65) behavior = "jumper";
    if (typeRoll > 0.82) behavior = "evasive";
    if (typeRoll > 0.92) behavior = "ranged";

    const sizeScale = rand(0.8, 1.35);
    const w = 30 * sizeScale;
    const h = 70 * sizeScale;

    enemies.push({
      x: rand(700, WORLD_WIDTH - 100),
      y: GROUND_Y - h,
      w,
      h,
      vx: rand(0.8, 1.7) + wave * 0.09,
      vy: 0,
      speed: rand(0.6, 1.8) + wave * 0.07,
      health: Math.floor(32 + wave * 9 * sizeScale),
      maxHealth: Math.floor(32 + wave * 9 * sizeScale),
      behavior,
      frozen: 0,
      patrolDir: Math.random() < 0.5 ? -1 : 1,
      jumpCooldown: rand(60, 150),
      evasiveCooldown: rand(25, 75),
      rangedCooldown: rand(90, 170),
      tint: rand(0.8, 1.1),
    });
  }

  buildStructuresForWave(wave);
  gameState.canLevelUp = false;
  levelUpBtn.disabled = true;
}

function applyLevelUp() {
  if (!gameState.canLevelUp) return;

  // Basic deterministic unlock order for beginner clarity.
  const unlockOrder = ["waterWave", "iceShard", "waterShield", "slam"];
  const toUnlock = unlockOrder.find((ability) => !player.abilities[ability]);

  if (toUnlock) {
    player.abilities[toUnlock] = true;
  } else {
    // If everything unlocked, grant stat boost each level.
    player.maxHealth += 10;
    player.health = Math.min(player.maxHealth, player.health + 10);
    player.speed += 0.25;
  }

  gameState.level += 1;
  gameState.wave += 1;
  spawnWave(gameState.wave);
}

// ------------------------------
// Input handling
// ------------------------------
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;

  if (key === " ") {
    // Jump uses Space
    if (player.onGround) {
      player.vy = -player.jumpPower;
      player.onGround = false;
    }
  }

  if (e.key === "Shift") {
    orb.isIceMode = orb.dragging && player.abilities.iceShard;
  }

  // Water Wave ability (Q) optional active ability.
  if (key === "q" && player.abilities.waterWave) {
    performWaterWave();
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  keys[key] = false;

  if (e.key === "Shift") {
    orb.isIceMode = false;
  }
});

canvas.addEventListener("mousedown", (e) => {
  if (!gameState.running) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const worldX = screenToWorldX(mx);

  // Player melee if we did NOT click orb.
  const hitOrb = dist(worldX, my, orb.x, orb.y) <= orb.radius + 12;
  if (!hitOrb) {
    player.attackTimer = 10;
    meleeAttack();
    return;
  }

  // Start dragging orb.
  if (orb.state === "orbit") {
    orb.dragging = true;
    orb.state = "dragging";
    orb.dragPoints = [];
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!orb.dragging) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const worldX = screenToWorldX(mx);

  // Constrain dragging around player so it feels attached/flexible.
  const dx = worldX - (player.x + player.w / 2);
  const dy = my - (player.y + player.h / 2);
  const distance = Math.hypot(dx, dy);

  let tx = worldX;
  let ty = my;
  if (distance > orb.maxDistance) {
    const scale = orb.maxDistance / distance;
    tx = player.x + player.w / 2 + dx * scale;
    ty = player.y + player.h / 2 + dy * scale;
  }

  orb.lastDragDir = { x: tx - orb.x, y: ty - orb.y };
  orb.x = tx;
  orb.y = ty;

  // Save trail points for whip visual.
  orb.dragPoints.push({ x: orb.x, y: orb.y, life: 22 });
  if (orb.dragPoints.length > 26) orb.dragPoints.shift();

  // Damage on drag (water whip)
  if (player.abilities.waterWhip) {
    whipDamage();
  }
});

window.addEventListener("mouseup", () => {
  if (!orb.dragging || orb.state !== "dragging") return;

  orb.dragging = false;

  // Launch orb in last drag direction
  const launch = orb.lastDragDir;
  const mag = Math.hypot(launch.x, launch.y) || 1;
  orb.vx = (launch.x / mag) * 11;
  orb.vy = (launch.y / mag) * 11;
  orb.state = "launched";

  addParticles(orb.x, orb.y, orb.isIceMode ? "#c7f2ff" : "#5fd6ff", 14, 0.5, 3);
});

restartBtn.addEventListener("click", () => resetGame());
levelUpBtn.addEventListener("click", () => applyLevelUp());

// ------------------------------
// Combat functions
// ------------------------------
function damageEnemy(enemy, amount, isIce = false, knockback = 0) {
  enemy.health -= amount;

  if (isIce) {
    enemy.frozen = Math.max(enemy.frozen, 120);
    addParticles(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, "#d6f6ff", 12, 0.2, 2);
  } else {
    addParticles(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, "#5fd6ff", 10, 0.2, 2.2);
  }

  enemy.x += knockback * player.facing;

  if (enemy.health <= 0) {
    gameState.score += 100;
    addParticles(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, "#ff4a4a", 18, 0.5, 2.6);
    enemies.splice(enemies.indexOf(enemy), 1);
  }
}

function meleeAttack() {
  const hitbox = {
    x: player.x + (player.facing === 1 ? player.w : -40),
    y: player.y + 20,
    w: 40,
    h: 40,
  };

  for (const enemy of [...enemies]) {
    if (rectsOverlap(hitbox, enemyRect(enemy))) {
      damageEnemy(enemy, 10, false, 7);
    }
  }
}

function whipDamage() {
  if (orb.dragDamageCooldown > 0) return;

  const whipRange = 30;
  for (const enemy of [...enemies]) {
    const centerX = enemy.x + enemy.w / 2;
    const centerY = enemy.y + enemy.h / 2;

    if (dist(orb.x, orb.y, centerX, centerY) < whipRange + enemy.w * 0.5) {
      damageEnemy(enemy, orb.isIceMode ? 6 : 8, orb.isIceMode, 4);
      orb.dragDamageCooldown = 8;
      break;
    }
  }
}

function performWaterWave() {
  const waveRange = 120;
  const waveX = player.x + (player.facing === 1 ? player.w : -waveRange);
  const waveRect = { x: waveX, y: player.y + 10, w: waveRange, h: 70 };

  // wave animation particles
  for (let i = 0; i < 20; i++) {
    addParticles(
      player.x + player.w / 2 + player.facing * rand(20, 80),
      player.y + rand(20, 70),
      "#7be4ff",
      1,
      0,
      2
    );
  }

  for (const enemy of [...enemies]) {
    if (rectsOverlap(waveRect, enemyRect(enemy))) {
      damageEnemy(enemy, 12, false, 14);
    }
  }
}

function performSlam() {
  if (!player.abilities.slam || player.onGround) return;
  // slam by holding S + dragging downward quickly
  const slamRect = { x: player.x - 90, y: player.y + player.h, w: 220, h: 80 };
  for (const enemy of [...enemies]) {
    if (rectsOverlap(slamRect, enemyRect(enemy))) {
      damageEnemy(enemy, 15, false, 10);
    }
  }
  addParticles(player.x + player.w / 2, player.y + player.h, "#79dfff", 26, 0.2, 3.6);
}

// ------------------------------
// Main update functions
// ------------------------------
function updatePlayer() {
  const movingLeft = keys["a"];
  const movingRight = keys["d"];

  player.vx = 0;

  if (movingLeft) {
    player.vx = -player.speed;
    player.facing = -1;
  }
  if (movingRight) {
    player.vx = player.speed;
    player.facing = 1;
  }

  player.x += player.vx;
  player.vy += 0.52;
  player.y += player.vy;

  if (player.y + player.h >= GROUND_Y) {
    player.y = GROUND_Y - player.h;
    player.vy = 0;
    player.onGround = true;
  }

  // Keep player inside world.
  player.x = clamp(player.x, 0, WORLD_WIDTH - player.w);

  // attack animation timer
  if (player.attackTimer > 0) player.attackTimer--;

  // triggered slam: while airborne + holding S + fast down drag
  if (keys["s"] && orb.dragging && orb.lastDragDir.y > 9) {
    performSlam();
  }
}

function structureBlocksPoint(x, y) {
  for (const s of structures) {
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s;
  }
  return null;
}

function updateOrb() {
  if (orb.dragDamageCooldown > 0) orb.dragDamageCooldown--;

  if (orb.state === "orbit") {
    // orb hovers near player with sinusoidal bob.
    orb.x = player.x + player.facing * 42;
    orb.y = player.y + 30 + Math.sin(frame * 0.1) * 8;
  } else if (orb.state === "launched") {
    orb.x += orb.vx;
    orb.y += orb.vy;
    orb.vy += 0.14;

    // damage enemies as projectile
    for (const enemy of [...enemies]) {
      const cX = enemy.x + enemy.w / 2;
      const cY = enemy.y + enemy.h / 2;
      if (dist(orb.x, orb.y, cX, cY) < orb.radius + enemy.w * 0.4) {
        damageEnemy(enemy, orb.isIceMode ? 12 : 14, orb.isIceMode, 9);
        // bounce slightly after hit
        orb.vx *= -0.3;
        orb.vy *= -0.2;
      }
    }

    // structures can block or reflect orb
    const blocked = structureBlocksPoint(orb.x, orb.y);
    if (blocked) {
      orb.vx *= -0.7;
      orb.vy *= -0.45;
      addParticles(orb.x, orb.y, "#9cecff", 12, 0.2, 2.4);
    }

    // if orb goes too far, begin regen
    if (orb.y > canvas.height + 30 || orb.x < 0 || orb.x > WORLD_WIDTH) {
      orb.state = "regenerating";
      orb.regenTimer = 80;
    }
  } else if (orb.state === "regenerating") {
    orb.regenTimer--;
    if (orb.regenTimer <= 0) {
      orb.state = "orbit";
      orb.isIceMode = false;
    }
  }

  // fade whip trail points
  for (const p of orb.dragPoints) p.life--;
  while (orb.dragPoints.length && orb.dragPoints[0].life <= 0) orb.dragPoints.shift();
}

function updateEnemies() {
  for (const enemy of enemies) {
    if (enemy.frozen > 0) {
      enemy.frozen--;
      continue;
    }

    if (enemy.behavior === "patrol") {
      // Patrol then occasionally move toward player.
      enemy.x += enemy.speed * enemy.patrolDir;
      if (Math.random() < 0.008) enemy.patrolDir *= -1;
      if (Math.random() < 0.03) {
        enemy.patrolDir = player.x > enemy.x ? 1 : -1;
      }
    } else if (enemy.behavior === "jumper") {
      enemy.x += enemy.speed * (player.x > enemy.x ? 1 : -1);
      enemy.jumpCooldown--;
      if (enemy.jumpCooldown <= 0 && enemy.y + enemy.h >= GROUND_Y) {
        enemy.vy = -rand(8, 12);
        enemy.jumpCooldown = rand(90, 160);
      }
    } else if (enemy.behavior === "evasive") {
      // Moves around player, sometimes dodges away from orb.
      const orbNear = dist(orb.x, orb.y, enemy.x + enemy.w / 2, enemy.y + enemy.h / 2) < 110;
      if (orbNear) {
        enemy.x += enemy.speed * 2.2 * (orb.x > enemy.x ? -1 : 1);
      } else {
        enemy.evasiveCooldown--;
        if (enemy.evasiveCooldown <= 0) {
          enemy.patrolDir *= -1;
          enemy.evasiveCooldown = rand(18, 70);
        }
        enemy.x += enemy.speed * enemy.patrolDir;
      }
    } else if (enemy.behavior === "ranged") {
      // Keeps slight distance and throws projectiles.
      const dirToPlayer = player.x > enemy.x ? 1 : -1;
      const desiredDistance = 260;
      const currentDistance = Math.abs(player.x - enemy.x);
      if (currentDistance < desiredDistance - 20) enemy.x -= dirToPlayer * enemy.speed;
      if (currentDistance > desiredDistance + 40) enemy.x += dirToPlayer * enemy.speed;

      enemy.rangedCooldown--;
      if (enemy.rangedCooldown <= 0) {
        const originX = enemy.x + enemy.w / 2;
        const originY = enemy.y + 24;
        const angle = Math.atan2((player.y + player.h / 2) - originY, (player.x + player.w / 2) - originX);
        projectiles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * 4.8,
          vy: Math.sin(angle) * 4.8,
          r: 6,
          life: 160,
        });
        enemy.rangedCooldown = rand(90, 170);
      }
    }

    // Common enemy gravity and bounds.
    enemy.vy += 0.4;
    enemy.y += enemy.vy;

    if (enemy.y + enemy.h >= GROUND_Y) {
      enemy.y = GROUND_Y - enemy.h;
      enemy.vy = 0;
    }

    enemy.x = clamp(enemy.x, 0, WORLD_WIDTH - enemy.w);

    // Touch damage to player
    if (rectsOverlap({ x: player.x, y: player.y, w: player.w, h: player.h }, enemyRect(enemy))) {
      player.health -= 0.08;
    }
  }
}

function updateProjectiles() {
  for (const p of [...projectiles]) {
    p.x += p.vx;
    p.y += p.vy;
    p.life--;

    // Water shield (unlocked) reflects incoming projectiles near player/orb
    const shieldActive = player.abilities.waterShield && (orb.dragging || orb.state === "orbit");
    if (shieldActive && dist(p.x, p.y, orb.x, orb.y) < 40) {
      p.vx *= -1.1;
      p.vy *= -1.1;
      addParticles(p.x, p.y, "#9fe8ff", 6, 0.2, 2);
    }

    // Projectiles damage player
    if (dist(p.x, p.y, player.x + player.w / 2, player.y + player.h / 2) < p.r + 20) {
      player.health -= 6;
      addParticles(p.x, p.y, "#ff9f9f", 8, 0.2, 2.5);
      projectiles.splice(projectiles.indexOf(p), 1);
      continue;
    }

    if (p.life <= 0 || p.x < 0 || p.x > WORLD_WIDTH || p.y > canvas.height + 20) {
      projectiles.splice(projectiles.indexOf(p), 1);
    }
  }
}

function updateParticles() {
  for (const p of [...particles]) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.03 * p.gravity;
    p.life--;
    if (p.life <= 0) particles.splice(particles.indexOf(p), 1);
  }
}

function updateWaveProgress() {
  if (enemies.length === 0 && gameState.running && !gameState.canLevelUp) {
    gameState.canLevelUp = true;
    levelUpBtn.disabled = false;
    // structures disappear between waves (brief calm)
    structures.length = 0;
  }
}

function updateCamera() {
  // Keep player roughly left-middle of screen in side-scroller style.
  camera.x = clamp(player.x - canvas.width * 0.35, 0, WORLD_WIDTH - canvas.width);
}

function update() {
  if (!gameState.running) return;

  frame++;
  updatePlayer();
  updateOrb();
  updateEnemies();
  updateProjectiles();
  updateParticles();
  updateWaveProgress();
  updateCamera();

  if (player.health <= 0) {
    gameState.running = false;
  }
}

// ------------------------------
// Drawing
// ------------------------------
function drawParallax() {
  // Simple layers that move at different rates to fake depth.
  const baseX = -camera.x * 0.2;
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    ctx.arc((i * 260 + baseX) % (canvas.width + 260), 120 + (i % 3) * 30, 34, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#6f8ca3";
  for (let i = 0; i < 12; i++) {
    const x = (i * 200 - camera.x * 0.45) % (canvas.width + 200);
    ctx.fillRect(x, GROUND_Y - 160, 80, 160);
  }
}

function drawPlayer() {
  const bob = Math.sin(frame * 0.25) * 2;
  const px = player.x - camera.x;

  // body
  ctx.fillStyle = "#2f86cb";
  ctx.fillRect(px, player.y + 18, player.w, player.h - 18);

  // head
  ctx.beginPath();
  ctx.fillStyle = "#8fd5ff";
  ctx.arc(px + player.w / 2, player.y + 12 + bob, 12, 0, Math.PI * 2);
  ctx.fill();

  // simple arms/legs animation
  const swing = Math.sin(frame * 0.35 + (Math.abs(player.vx) > 0.1 ? 0 : Math.PI / 2)) * 8;
  ctx.strokeStyle = "#8fd5ff";
  ctx.lineWidth = 4;

  // arm
  ctx.beginPath();
  ctx.moveTo(px + player.w / 2, player.y + 36);
  ctx.lineTo(px + player.w / 2 + swing * player.facing * 0.6, player.y + 55);
  ctx.stroke();

  // legs
  ctx.beginPath();
  ctx.moveTo(px + 12, player.y + player.h);
  ctx.lineTo(px + 12 + swing * 0.4, player.y + player.h - 20);
  ctx.moveTo(px + player.w - 12, player.y + player.h);
  ctx.lineTo(px + player.w - 12 - swing * 0.4, player.y + player.h - 20);
  ctx.stroke();

  // melee flash
  if (player.attackTimer > 0) {
    ctx.fillStyle = "rgba(120,220,255,0.6)";
    const fx = px + (player.facing === 1 ? player.w : -30);
    ctx.fillRect(fx, player.y + 20, 30, 30);
  }
}

function drawOrbAndWhip() {
  // Draw whip trail
  if (orb.dragPoints.length > 1) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = orb.isIceMode ? "rgba(214,246,255,0.8)" : "rgba(95,214,255,0.75)";
    ctx.beginPath();
    const first = orb.dragPoints[0];
    ctx.moveTo(first.x - camera.x, first.y);
    for (const p of orb.dragPoints) {
      ctx.lineTo(p.x - camera.x, p.y);
    }
    ctx.stroke();
  }

  // Draw line from player to orb while dragging (like flexible water stream)
  if (orb.dragging) {
    ctx.strokeStyle = orb.isIceMode ? "rgba(188,238,255,0.9)" : "rgba(88,190,255,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.x + player.w / 2 - camera.x, player.y + 34);
    ctx.quadraticCurveTo(
      (player.x + orb.x) / 2 - camera.x,
      (player.y + orb.y) / 2 - 30,
      orb.x - camera.x,
      orb.y
    );
    ctx.stroke();
  }

  // Orb glow
  const orbScreenX = orb.x - camera.x;
  const grad = ctx.createRadialGradient(orbScreenX, orb.y, 2, orbScreenX, orb.y, orb.radius * 2.2);
  grad.addColorStop(0, orb.isIceMode ? "rgba(230,250,255,0.95)" : "rgba(160,235,255,0.95)");
  grad.addColorStop(1, "rgba(80,170,230,0.08)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(orbScreenX, orb.y, orb.radius * 2.1 + Math.sin(frame * 0.2) * 2, 0, Math.PI * 2);
  ctx.fill();

  // Orb core
  ctx.beginPath();
  ctx.fillStyle = orb.isIceMode ? "#d3f3ff" : "#52cfff";
  ctx.arc(orbScreenX, orb.y, orb.radius + Math.sin(frame * 0.3) * 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemies() {
  for (const enemy of enemies) {
    const ex = enemy.x - camera.x;

    ctx.fillStyle = enemy.frozen > 0 ? "#b4e7ff" : `rgba(${220 * enemy.tint},50,50,1)`;
    ctx.fillRect(ex, enemy.y + 12, enemy.w, enemy.h - 12);

    ctx.beginPath();
    ctx.fillStyle = enemy.frozen > 0 ? "#dff5ff" : "#ff9f9f";
    ctx.arc(ex + enemy.w / 2, enemy.y + 8, 10, 0, Math.PI * 2);
    ctx.fill();

    // health bar
    ctx.fillStyle = "#390909";
    ctx.fillRect(ex, enemy.y - 10, enemy.w, 5);
    ctx.fillStyle = "#ff4a4a";
    ctx.fillRect(ex, enemy.y - 10, (enemy.health / enemy.maxHealth) * enemy.w, 5);
  }
}

function drawStructures() {
  for (const s of structures) {
    const sx = s.x - camera.x;
    ctx.fillStyle = s.kind === "ice-wall" ? "#9cc5df" : "#4c5760";
    ctx.fillRect(sx, s.y, s.w, s.h);

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(sx, s.y, s.w, s.h);
  }
}

function drawProjectiles() {
  for (const p of projectiles) {
    ctx.beginPath();
    ctx.fillStyle = "#f88989";
    ctx.arc(p.x - camera.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / 40);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - camera.x, p.y, p.size, p.size);
    ctx.globalAlpha = 1;
  }
}

function drawUIOverlay() {
  // top-left bars
  ctx.fillStyle = "rgba(8,17,28,0.72)";
  ctx.fillRect(12, 12, 360, 118);

  ctx.fillStyle = "#dff4ff";
  ctx.font = "16px Arial";
  ctx.fillText(`Health`, 22, 34);

  ctx.fillStyle = "#193045";
  ctx.fillRect(80, 22, 180, 16);
  ctx.fillStyle = "#5bd0ff";
  ctx.fillRect(80, 22, (player.health / player.maxHealth) * 180, 16);

  ctx.fillStyle = "#dff4ff";
  ctx.fillText(`Wave: ${gameState.wave}`, 22, 62);
  ctx.fillText(`Score: ${gameState.score}`, 22, 84);
  ctx.fillText(`Level: ${gameState.level}`, 22, 106);

  let unlocked = Object.entries(player.abilities)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ");

  ctx.fillStyle = "rgba(8,17,28,0.72)";
  ctx.fillRect(390, 12, 790, 50);
  ctx.fillStyle = "#dff4ff";
  ctx.font = "14px Arial";
  ctx.fillText(`Unlocked: ${unlocked}`, 402, 42);

  if (gameState.canLevelUp) {
    ctx.fillStyle = "rgba(8,17,28,0.82)";
    ctx.fillRect(canvas.width / 2 - 240, 90, 480, 70);
    ctx.fillStyle = "#9be3ff";
    ctx.font = "22px Arial";
    ctx.fillText("Wave cleared! Press Level Up to continue.", canvas.width / 2 - 212, 134);
  }

  if (!gameState.running) {
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "48px Arial";
    ctx.fillText("Game Over", canvas.width / 2 - 140, canvas.height / 2 - 10);
    ctx.font = "24px Arial";
    ctx.fillText("Press Restart to try again", canvas.width / 2 - 145, canvas.height / 2 + 32);
  }
}

function drawGround() {
  ctx.fillStyle = "#2b3f50";
  ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

  // subtle moving streaks in water/ground
  for (let i = 0; i < 30; i++) {
    const x = ((i * 90) - (frame * 1.3) - camera.x * 0.7) % (canvas.width + 100);
    ctx.fillStyle = "rgba(130,200,240,0.12)";
    ctx.fillRect(x, GROUND_Y + 10 + (i % 4) * 8, 60, 3);
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawParallax();
  drawGround();
  drawStructures();
  drawParticles();
  drawProjectiles();
  drawEnemies();
  drawPlayer();
  drawOrbAndWhip();
  drawUIOverlay();
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

function resetGame() {
  gameState.running = true;
  gameState.score = 0;
  gameState.wave = 1;
  gameState.level = 1;
  gameState.canLevelUp = false;

  player.x = 220;
  player.y = GROUND_Y - player.h;
  player.vx = 0;
  player.vy = 0;
  player.health = 100;
  player.maxHealth = 100;
  player.speed = 4;
  player.abilities = {
    waterWhip: true,
    waterWave: false,
    iceShard: false,
    waterShield: false,
    slam: false,
  };

  orb.x = player.x + 60;
  orb.y = player.y + 18;
  orb.vx = 0;
  orb.vy = 0;
  orb.state = "orbit";
  orb.dragging = false;
  orb.dragPoints = [];
  orb.isIceMode = false;
  orb.regenTimer = 0;

  particles.length = 0;
  levelUpBtn.disabled = true;

  spawnWave(1);
}

// Initial startup
resetGame();
loop();
