import { clamp, lerp, smoothstep01, sanitizeDdaConfig, applyDdaProfile, getTierByHeight, getNextTierHeight, getBlendedTierParams, computePlayerProfile, TIER_BLEND_BANDS, SPEED_TIERS, DEFAULT_DDA_CONFIG, DDA_PROFILES, DDA_PROFILE_ORDER } from './lib/game-utils.js';

const W = 240, H = 282;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ===== GAME STATE =====
const STATE = { MENU: 0, PLAYING: 1, GAME_OVER: 2 };
let state = STATE.MENU;
let difficulty = 'easy';
let score = 0;
let highScore = 0;
let newRecord = false;
let cameraY = 0;
let gameSpeed = 1;
let envSpeedCurrent = 1;
let targetGameSpeedFiltered = 1;
let targetEnvSpeedFiltered = 1;
let jumpChainCount = 0;
let jumpChainTimer = 0;
let rocketBoostCurrent = 1;
let slowMoTimer = 0;
let rocketTimer = 0;
let speedTier = 'easy';
let tierFlashText = '';
let tierFlashTimer = 0;
let lastMeterMilestone = 0;
let milestoneText = '';
let milestoneTimer = 0;
let musicOn = true;
let touchX = -1;
let frameCount = 0;
let candyParticles = [];
let bgStars = [];
let lastTimestamp = 0;
let sessionHistory = [];
let playerProfile = {
  sampleCount: 0,
  avgHeight: 0,
  avgScore: 0,
  avgDuration: 0,
  avgClimbRate: 0,
  consistency: 0.5
};
let currentRun = null;
let smoothedAdaptiveFactor = 1;
let ddaConfig = null;
let debugOverlayOn = false;
let tuningHintText = '';
let tuningHintTimer = 0;

const BASE_FRAME_MS = 1000 / 60;
const MAX_DT_STEPS = 1.5;
const JUMP_BUFFER_FRAMES = 8;
const ROCKET_DURATION_FRAMES = 60 * 5;
const FLAPPY_JUMP_FORCE = -7.2;
const FLAPPY_GRAVITY_UP = 0.29;
const FLAPPY_GRAVITY_DOWN = 0.46;
const ROCKET_JUMP_BOOST = 1.38;
const WITCH_SPAWN_HEIGHT = 5000;
const WITCH_CHASE_SPEED = 0.85;
const WITCH_SPAWN_INTERVAL = 360;
const WITCH_MAX_COUNT = 4;
const APP_VERSION = 'V.0.5';
const SESSION_HISTORY_KEY = 'unicorn_sessions_v1';
const DDA_CONFIG_KEY = 'unicorn_dda_cfg_v1';
const DEBUG_OVERLAY_KEY = 'unicorn_debug_overlay_v1';
const DDA_PROFILE_KEY = 'unicorn_dda_profile_v1';
const DEFAULT_DDA_PROFILE_NAME = 'arcade-slow';
let activeDdaProfile = DEFAULT_DDA_PROFILE_NAME;
const SESSION_HISTORY_LIMIT = 40;

async function saveDdaConfig(cfg) {
  try {
    const payload = JSON.stringify(cfg);
    if (window.creationStorage) {
      await window.creationStorage.plain.setItem(DDA_CONFIG_KEY, btoa(payload));
    } else {
      localStorage.setItem(DDA_CONFIG_KEY, payload);
    }
  } catch (e) { /* ignore */ }
}

async function loadDdaConfig() {
  const fromQuery = new URLSearchParams(window.location.search).get('dda');
  if (fromQuery) {
    try {
      const parsed = sanitizeDdaConfig(JSON.parse(atob(fromQuery)));
      await saveDdaConfig(parsed);
      return parsed;
    } catch (e) { /* ignore */ }
  }

  try {
    if (window.creationStorage) {
      const s = await window.creationStorage.plain.getItem(DDA_CONFIG_KEY);
      if (s) return sanitizeDdaConfig(JSON.parse(atob(s)));
    } else {
      const s = localStorage.getItem(DDA_CONFIG_KEY);
      if (s) return sanitizeDdaConfig(JSON.parse(s));
    }
  } catch (e) { /* ignore */ }

  return sanitizeDdaConfig(DEFAULT_DDA_CONFIG);
}

function getNextDdaProfileName() {
  const idx = DDA_PROFILE_ORDER.indexOf(activeDdaProfile);
  if (idx < 0) return DDA_PROFILE_ORDER[0];
  return DDA_PROFILE_ORDER[(idx + 1) % DDA_PROFILE_ORDER.length];
}

function saveActiveDdaProfile() {
  try {
    if (window.creationStorage) {
      window.creationStorage.plain.setItem(DDA_PROFILE_KEY, activeDdaProfile);
    } else {
      localStorage.setItem(DDA_PROFILE_KEY, activeDdaProfile);
    }
  } catch (e) { /* ignore */ }
}

async function loadActiveDdaProfile() {
  try {
    let stored = null;
    if (window.creationStorage) {
      stored = await window.creationStorage.plain.getItem(DDA_PROFILE_KEY);
    } else {
      stored = localStorage.getItem(DDA_PROFILE_KEY);
    }
    if (stored && DDA_PROFILES[stored]) return stored;
  } catch (e) { /* ignore */ }
  return DEFAULT_DDA_PROFILE_NAME;
}

function setDdaProfile(profileName, showToast) {
  if (!DDA_PROFILES[profileName]) return;
  activeDdaProfile = profileName;
  ddaConfig = applyDdaProfile(DEFAULT_DDA_CONFIG, activeDdaProfile);
  saveDdaConfig(ddaConfig);
  saveActiveDdaProfile();

  if (showToast) {
    tuningHintText = 'PROFILE ' + activeDdaProfile.toUpperCase();
    tuningHintTimer = 110;
  }
}

function saveDebugOverlayState() {
  try {
    const value = debugOverlayOn ? '1' : '0';
    if (window.creationStorage) {
      window.creationStorage.plain.setItem(DEBUG_OVERLAY_KEY, value);
    } else {
      localStorage.setItem(DEBUG_OVERLAY_KEY, value);
    }
  } catch (e) { /* ignore */ }
}

async function loadDebugOverlayState() {
  try {
    if (window.creationStorage) {
      const s = await window.creationStorage.plain.getItem(DEBUG_OVERLAY_KEY);
      return s === '1';
    }
    return localStorage.getItem(DEBUG_OVERLAY_KEY) === '1';
  } catch (e) { /* ignore */ }
  return false;
}

function adjustDdaConfig(field, delta, min, max) {
  if (!ddaConfig) return;
  const prev = Number(ddaConfig[field] || 0);
  const next = clamp(prev + delta, min, max);
  ddaConfig[field] = Number(next.toFixed(3));

  const changed = Math.abs(next - prev) > 0.0001;
  const label = field === 'maxSpeedStepPerFrame' ? 'RAMP' : (field === 'adaptiveSmoothing' ? 'SMOOTH' : field.toUpperCase());
  let direction = 'LIMIT';
  if (changed) direction = delta < 0 ? '-' : '+';
  tuningHintText = label + ' ' + direction + ' ' + ddaConfig[field].toFixed(3);
  tuningHintTimer = 90;

  saveDdaConfig(ddaConfig);
}

function drawTuningHint() {
  if (tuningHintTimer <= 0) return;
  const text = tuningHintText || 'TUNING';
  const w = 156;
  const h = 20;
  const x = Math.floor((W - w) / 2);
  const y = H - h - 10;

  ctx.save();
  ctx.fillStyle = 'rgba(8,14,34,0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(150,220,255,0.9)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#E8F8FF';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, y + 14);
  ctx.restore();
}

function announceTier(tierKey) {
  const label = SPEED_TIERS[tierKey].label;
  tierFlashText = 'VELOCITA: ' + label;
  tierFlashTimer = 120;
}

function startRunTracking() {
  currentRun = {
    startedAt: performance.now(),
    selectedDifficulty: difficulty
  };
}

function getAdaptiveDifficultyFactor() {
  if (!currentRun || playerProfile.sampleCount < 4) return 1;

  const elapsedSec = Math.max(1, (performance.now() - currentRun.startedAt) / 1000);
  const runClimbRate = maxHeight / elapsedSec;
  const baselineRate = Math.max(30, playerProfile.avgClimbRate || 0);
  const rateDelta = (runClimbRate - baselineRate) / baselineRate;
  const consistencyBias = (playerProfile.consistency - 0.6) * 0.15;
  const rawDelta = clamp(rateDelta + consistencyBias, -0.35, 0.45);
  const strength = difficulty === 'easy' ? ddaConfig.adaptiveStrengthEasy * 0.35 : ddaConfig.adaptiveStrengthHard;
  const factor = 1 + rawDelta * strength;

  if (difficulty === 'easy') return clamp(factor, 0.99, 1.01);
  return clamp(factor, 0.9, 1.12);
}

function finalizeRunTracking() {
  if (!currentRun) return;

  const durationSec = Math.max(1, Math.round((performance.now() - currentRun.startedAt) / 1000));
  const session = {
    endedAt: Date.now(),
    difficulty: currentRun.selectedDifficulty,
    score,
    maxHeight: Math.floor(maxHeight),
    durationSec,
    tierReached: speedTier
  };

  sessionHistory.push(session);
  if (sessionHistory.length > SESSION_HISTORY_LIMIT) {
    sessionHistory = sessionHistory.slice(-SESSION_HISTORY_LIMIT);
  }

  playerProfile = computePlayerProfile(sessionHistory);
  saveSessionHistory(sessionHistory);
  currentRun = null;
}

// ===== AUDIO ENGINE (Web Audio API) =====
let audioCtx = null;
let musicPlaying = false;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playNote(freq, duration, type, vol) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'square';
  osc.frequency.value = freq;
  gain.gain.value = vol || 0.08;
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playJumpSound() {
  playNote(440, 0.08, 'square', 0.06);
  setTimeout(() => playNote(580, 0.08, 'square', 0.05), 40);
}

function playHitSound() {
  playNote(150, 0.3, 'sawtooth', 0.1);
  playNote(100, 0.4, 'square', 0.08);
}

function playPowerUpSound() {
  playNote(600, 0.1, 'square', 0.06);
  setTimeout(() => playNote(800, 0.1, 'square', 0.06), 80);
  setTimeout(() => playNote(1000, 0.15, 'square', 0.06), 160);
}

function playTrumpet() {
  const notes = [523, 659, 784, 1047, 784, 1047];
  const durs = [0.15, 0.15, 0.15, 0.3, 0.1, 0.4];
  let t = 0;
  notes.forEach((n, i) => {
    setTimeout(() => playNote(n, durs[i], 'sawtooth', 0.1), t);
    t += durs[i] * 700;
  });
}

let bgMelodyInterval = null;
function startBgMusic() {
  if (!audioCtx || !musicOn || musicPlaying) return;
  musicPlaying = true;
  const melody = [262, 294, 330, 349, 330, 294, 262, 247, 262, 294, 330, 294, 262, 220, 247, 262];
  let idx = 0;
  bgMelodyInterval = setInterval(() => {
    if (!musicOn || state !== STATE.PLAYING) { stopBgMusic(); return; }
    playNote(melody[idx % melody.length], 0.18, 'triangle', 0.03);
    idx++;
  }, 320);
}

function stopBgMusic() {
  musicPlaying = false;
  if (bgMelodyInterval) { clearInterval(bgMelodyInterval); bgMelodyInterval = null; }
}

// ===== PERSISTENT STORAGE =====
async function saveHighScore(val) {
  try {
    if (window.creationStorage) {
      await window.creationStorage.plain.setItem('unicorn_hi', btoa(JSON.stringify(val)));
    } else {
      localStorage.setItem('unicorn_hi', JSON.stringify(val));
    }
  } catch (e) { /* ignore */ }
}

async function loadHighScore() {
  try {
    if (window.creationStorage) {
      const s = await window.creationStorage.plain.getItem('unicorn_hi');
      if (s) return JSON.parse(atob(s));
    } else {
      const s = localStorage.getItem('unicorn_hi');
      if (s) return JSON.parse(s);
    }
  } catch (e) { /* ignore */ }
  return 0;
}

async function saveSessionHistory(history) {
  try {
    const payload = JSON.stringify(history);
    if (window.creationStorage) {
      await window.creationStorage.plain.setItem(SESSION_HISTORY_KEY, btoa(payload));
    } else {
      localStorage.setItem(SESSION_HISTORY_KEY, payload);
    }
  } catch (e) { /* ignore */ }
}

async function loadSessionHistory() {
  try {
    if (window.creationStorage) {
      const s = await window.creationStorage.plain.getItem(SESSION_HISTORY_KEY);
      if (s) return JSON.parse(atob(s));
    } else {
      const s = localStorage.getItem(SESSION_HISTORY_KEY);
      if (s) return JSON.parse(s);
    }
  } catch (e) { /* ignore */ }
  return [];
}

// ===== PIXEL ART DRAWING HELPERS =====
function drawPixelRect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), w, h);
}

// Unicorn sprite (16x16 pixel art)
function drawUnicorn(x, y, frame) {
  const px = 2;
  const ox = Math.floor(x), oy = Math.floor(y);

  // Body (white/lavender)
  drawPixelRect(ox + 2*px, oy + 4*px, 8*px, 6*px, '#E8D0FF');
  drawPixelRect(ox + 3*px, oy + 3*px, 6*px, 1*px, '#E8D0FF');

  // Head
  drawPixelRect(ox + 8*px, oy + 1*px, 5*px, 5*px, '#F0E0FF');
  drawPixelRect(ox + 9*px, oy + 0*px, 3*px, 1*px, '#F0E0FF');

  // Horn (golden)
  drawPixelRect(ox + 11*px, oy - 2*px, 1*px, 2*px, '#FFD700');
  drawPixelRect(ox + 12*px, oy - 3*px, 1*px, 1*px, '#FFF176');

  // Eye
  drawPixelRect(ox + 11*px, oy + 2*px, 1*px, 1*px, '#222');

  // Mane (rainbow)
  const maneColors = ['#FF4444', '#FF8800', '#FFDD00', '#44DD44', '#4488FF', '#AA44FF'];
  for (let i = 0; i < 4; i++) {
    drawPixelRect(ox + 7*px, oy + (1+i)*px, 1*px, 1*px, maneColors[i % maneColors.length]);
  }

  // Tail (rainbow)
  const tailWag = Math.sin(frame * 0.3) > 0 ? 0 : px;
  for (let i = 0; i < 3; i++) {
    drawPixelRect(ox + (0)*px + tailWag, oy + (5+i)*px, 2*px, 1*px, maneColors[(i+2) % maneColors.length]);
  }

  // Legs (animated)
  const legOff = Math.sin(frame * 0.4) * px;
  drawPixelRect(ox + 3*px, oy + 10*px, 1*px, 3*px + legOff, '#D0B0E8');
  drawPixelRect(ox + 5*px, oy + 10*px, 1*px, 3*px - legOff, '#D0B0E8');
  drawPixelRect(ox + 7*px, oy + 10*px, 1*px, 3*px + legOff, '#D0B0E8');
  drawPixelRect(ox + 9*px, oy + 10*px, 1*px, 3*px - legOff, '#D0B0E8');

  // Hooves
  drawPixelRect(ox + 3*px, oy + 13*px + legOff, 1*px, 1*px, '#AA88CC');
  drawPixelRect(ox + 5*px, oy + 13*px - legOff, 1*px, 1*px, '#AA88CC');
  drawPixelRect(ox + 7*px, oy + 13*px + legOff, 1*px, 1*px, '#AA88CC');
  drawPixelRect(ox + 9*px, oy + 13*px - legOff, 1*px, 1*px, '#AA88CC');

  // Rocket trail while boost is active
  if (rocketTimer > 0) {
    ctx.fillStyle = '#FFAA00';
    ctx.fillRect(ox + 1, oy + 11, 3, 2);
    ctx.fillStyle = '#FF4400';
    ctx.fillRect(ox - 1, oy + 11, 2, 2);
  }
}

function drawCloud(x, y, w, type) {
  const sy = Math.floor(y);
  const sx = Math.floor(x);
  if (type === 'moving') {
    ctx.fillStyle = '#88CCFF';
  } else if (type === 'crumbling') {
    ctx.fillStyle = '#FFAA88';
  } else {
    ctx.fillStyle = '#FFF';
  }
  // Fluffy cloud shape
  ctx.fillRect(sx + 4, sy + 4, w - 8, 8);
  ctx.fillRect(sx + 2, sy + 6, w - 4, 6);
  ctx.fillRect(sx, sy + 8, w, 4);

  // Highlights
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(sx + 6, sy + 4, w - 16, 2);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(sx + 2, sy + 12, w - 4, 2);
}

function drawWitch(x, y) {
  const sx = Math.floor(x), sy = Math.floor(y);
  const wobble = Math.floor(Math.sin(frameCount * 0.12) * 2);
  const by = sy + wobble;

  // Hat – dark purple
  ctx.fillStyle = '#4400AA';
  ctx.fillRect(sx + 5, by, 6, 3);
  ctx.fillRect(sx + 3, by + 3, 10, 2);

  // Face – sickly yellow-green
  ctx.fillStyle = '#AABB44';
  ctx.fillRect(sx + 4, by + 5, 8, 5);
  // Pointy nose
  ctx.fillStyle = '#889922';
  ctx.fillRect(sx + 11, by + 7, 3, 2);
  // Glowing red eyes
  ctx.fillStyle = '#FF2200';
  ctx.fillRect(sx + 5, by + 6, 2, 2);
  ctx.fillRect(sx + 9, by + 6, 2, 2);

  // Robe
  ctx.fillStyle = '#5500BB';
  ctx.fillRect(sx + 3, by + 10, 10, 4);

  // Cape flutter
  const capeFlap = Math.sin(frameCount * 0.18) > 0 ? 2 : 0;
  ctx.fillStyle = '#6600CC';
  ctx.fillRect(sx, by + 10 + capeFlap, 4, 3);

  // Broom handle
  ctx.fillStyle = '#7B4C1E';
  ctx.fillRect(sx, by + 13, 16, 2);
  // Broom bristles
  ctx.fillStyle = '#C8952E';
  ctx.fillRect(sx + 11, by + 15, 5, 2);
}

function drawObstacle(x, y) {
  const sx = Math.floor(x), sy = Math.floor(y);
  // Spiky bird pixel art
  ctx.fillStyle = '#FF2222';
  ctx.fillRect(sx, sy + 2, 12, 6);
  ctx.fillRect(sx + 2, sy, 8, 2);
  ctx.fillRect(sx + 2, sy + 8, 8, 2);
  // Wings
  const wingOff = Math.sin(frameCount * 0.3) > 0 ? -2 : 2;
  ctx.fillStyle = '#FF6644';
  ctx.fillRect(sx + 1, sy + wingOff, 3, 3);
  ctx.fillRect(sx + 8, sy + wingOff, 3, 3);
  // Eye
  ctx.fillStyle = '#FFF';
  ctx.fillRect(sx + 8, sy + 3, 2, 2);
  ctx.fillStyle = '#000';
  ctx.fillRect(sx + 9, sy + 3, 1, 1);
}

function drawPowerUp(x, y, type) {
  const sx = Math.floor(x), sy = Math.floor(y);
  const pulse = Math.sin(frameCount * 0.15) * 2;
  if (type === 'rocket') {
    // Rocket icon
    ctx.fillStyle = '#F5F5F5';
    ctx.fillRect(sx + 4, sy + 2, 4, 7);
    ctx.fillStyle = '#FF3344';
    ctx.fillRect(sx + 5, sy, 2, 2);
    ctx.fillStyle = '#66D9FF';
    ctx.fillRect(sx + 5, sy + 4, 2, 2);
    ctx.fillStyle = '#FFAA00';
    ctx.fillRect(sx + 5, sy + 9, 2, 2);
    ctx.fillStyle = '#FF6600';
    ctx.fillRect(sx + 5, sy + 11, 2, 1);
  } else {
    // Timer icon
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(sx + 2, sy + 2, 8, 8);
    ctx.fillStyle = '#333';
    ctx.fillRect(sx + 5, sy + 0, 2, 2);
    ctx.fillRect(sx + 5, sy + 4, 1, 3);
    ctx.fillRect(sx + 5, sy + 6, 2, 1);
    ctx.fillStyle = '#44D6FF';
    ctx.fillRect(sx + 3, sy + 3, 6, 6);
    ctx.fillStyle = '#0B2A3A';
    ctx.fillRect(sx + 5, sy + 5, 1, 2);
    ctx.fillRect(sx + 5, sy + 5, 2, 1);
  }

  // Glow
  const glow = type === 'rocket' ? 'rgba(255,100,0,' : 'rgba(0,220,255,';
  ctx.fillStyle = `${glow}${0.14 + 0.1 * Math.sin(frameCount * 0.1)})`;
  ctx.beginPath();
  ctx.arc(sx + 6, sy + 6, 10 + pulse, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpeechBubble(x, y, text, fontSize) {
  ctx.save();
  const fs = fontSize || 10;
  ctx.font = `bold ${fs}px monospace`;
  const metrics = ctx.measureText(text);
  const tw = metrics.width;
  const pad = 6;
  const bw = tw + pad * 2;
  const bh = fs + pad * 2;
  const bx = Math.floor(x - bw / 2);
  const by = Math.floor(y - bh);

  // Bubble body
  ctx.fillStyle = '#FFF';
  ctx.fillRect(bx + 2, by, bw - 4, bh);
  ctx.fillRect(bx, by + 2, bw, bh - 4);

  // Pixel border
  ctx.fillStyle = '#222';
  ctx.fillRect(bx + 2, by - 1, bw - 4, 1);
  ctx.fillRect(bx + 2, by + bh, bw - 4, 1);
  ctx.fillRect(bx - 1, by + 2, 1, bh - 4);
  ctx.fillRect(bx + bw, by + 2, 1, bh - 4);

  // Tail
  ctx.fillStyle = '#FFF';
  ctx.fillRect(bx + bw/2 - 3, by + bh, 6, 3);
  ctx.fillRect(bx + bw/2 - 1, by + bh + 3, 2, 2);
  ctx.fillStyle = '#222';
  ctx.fillRect(bx + bw/2 - 4, by + bh, 1, 3);
  ctx.fillRect(bx + bw/2 + 3, by + bh, 1, 3);
  ctx.fillRect(bx + bw/2 - 2, by + bh + 3, 1, 2);
  ctx.fillRect(bx + bw/2 + 2, by + bh + 3, 1, 2);

  // Text
  ctx.fillStyle = '#FF6600';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, Math.floor(x), by + bh / 2);
  ctx.restore();
}

// ===== CANDY EXPLOSION =====
function spawnCandyExplosion() {
  for (let i = 0; i < 60; i++) {
    const colors = ['#FF4488', '#FFDD00', '#44FF88', '#44AAFF', '#FF8844', '#DD44FF', '#FF2222', '#00FFCC'];
    candyParticles.push({
      x: W / 2 + (Math.random() - 0.5) * 80,
      y: H / 2 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6 - 2,
      size: 2 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 60 + Math.random() * 40,
      shape: Math.random() > 0.5 ? 'rect' : 'circle'
    });
  }
}

function updateCandyParticles() {
  for (let i = candyParticles.length - 1; i >= 0; i--) {
    const p = candyParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.08;
    p.life--;
    if (p.life <= 0) candyParticles.splice(i, 1);
  }
}

function drawCandyParticles() {
  candyParticles.forEach(p => {
    ctx.globalAlpha = Math.min(1, p.life / 20);
    ctx.fillStyle = p.color;
    if (p.shape === 'rect') {
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.globalAlpha = 1;
}

// ===== BACKGROUND =====
function initStars() {
  bgStars = [];
  for (let i = 0; i < 40; i++) {
    bgStars.push({
      x: Math.random() * W,
      y: Math.random() * 600,
      size: Math.random() > 0.7 ? 2 : 1,
      twinkle: Math.random() * Math.PI * 2
    });
  }
}

function drawBackground() {
  const height = Math.max(0, -cameraY);

  // Gradient sky
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  if (height < 5000) {
    grad.addColorStop(0, 'rgb(70,130,210)');
    grad.addColorStop(1, 'rgb(145,208,255)');
  } else if (height < 10000) {
    grad.addColorStop(0, 'rgb(44,54,122)');
    grad.addColorStop(1, 'rgb(115,120,220)');
  } else {
    grad.addColorStop(0, 'rgb(8,10,40)');
    grad.addColorStop(1, 'rgb(28,24,70)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Stars (visible as you go higher)
  if (height >= 5000) {
    ctx.fillStyle = '#FFF';
    bgStars.forEach(s => {
      const sy = (s.y - cameraY * 0.1) % 600;
      if (sy > 0 && sy < H) {
        const stageAlpha = height >= 10000 ? 1 : 0.6;
        const alpha = stageAlpha * (0.5 + 0.5 * Math.sin(frameCount * 0.05 + s.twinkle));
        ctx.globalAlpha = alpha;
        ctx.fillRect(Math.floor(s.x), Math.floor(sy), s.size, s.size);
      }
    });
    ctx.globalAlpha = 1;
  }
}

// ===== GAME ENTITIES =====
let unicorn = { x: 0, y: 0, vx: 0, vy: 0, w: 28, h: 30 };
let clouds = [];
let obstacles = [];
let powerUps = [];
let witches = [];
let witchSpawnTimer = 0;
let maxHeight = 0;
let groundedCloud = null;
let jumpBufferTimer = 0;

function resetGame() {
  score = 0;
  newRecord = false;
  cameraY = 0;
  gameSpeed = 1;
  envSpeedCurrent = 1;
  targetGameSpeedFiltered = 1;
  targetEnvSpeedFiltered = 1;
  jumpChainCount = 0;
  jumpChainTimer = 0;
  rocketBoostCurrent = 1;
  smoothedAdaptiveFactor = 1;
  slowMoTimer = 0;
  rocketTimer = 0;
  speedTier = 'easy';
  tierFlashText = '';
  tierFlashTimer = 0;
  lastMeterMilestone = 0;
  milestoneText = '';
  milestoneTimer = 0;
  frameCount = 0;
  candyParticles = [];
  maxHeight = 0;
  groundedCloud = null;
  jumpBufferTimer = 0;

  unicorn = { x: W / 2 - 14, y: H - 60, vx: 0, vy: 0, w: 28, h: 30 };

  clouds = [];
  obstacles = [];
  powerUps = [];
  witches = [];
  witchSpawnTimer = 0;

  // Generate initial clouds
  for (let i = 0; i < 8; i++) {
    clouds.push(createCloud(H - 30 - i * 46));
  }
  // Ensure a starting platform
  clouds[0].x = W / 2 - 25;
  clouds[0].y = H - 30;
  clouds[0].type = 'normal';
  startRunTracking();
  lastTimestamp = 0;
}

function createCloud(atY) {
  const cw = 36 + Math.random() * 20;
  const type = pickCloudType();
  return {
    x: Math.random() * (W - cw),
    y: atY,
    w: cw,
    type: type,
    moveDir: type === 'moving' ? (Math.random() > 0.5 ? 1 : -1) : 0,
    moveSpeed: 0.5 + Math.random() * 0.8,
    crumbleTimer: 15
  };
}

function queueJump() {
  if (state === STATE.PLAYING) {
    jumpBufferTimer = JUMP_BUFFER_FRAMES;
  }
}

function pickCloudType() {
  const r = Math.random();
  const hardMod = difficulty === 'hard' ? 0.1 : 0;
  if (r < 0.15 + hardMod) return 'moving';
  if (r < 0.22 + hardMod) return 'crumbling';
  return 'normal';
}

function generateContent(adaptiveFactor = smoothedAdaptiveFactor) {
  const topVisible = cameraY - 50;
  const tier = getBlendedTierParams(maxHeight);
  const isSlowProfile = activeDdaProfile === 'arcade-slow';
  const hardObstacleMod = difficulty === 'hard' ? 1.25 : 1;
  const obstacleWeight = ddaConfig ? ddaConfig.obstacleAdaptiveWeight : DEFAULT_DDA_CONFIG.obstacleAdaptiveWeight;
  const obstacleSpeedFactor = clamp(0.92 + (adaptiveFactor - 1) * obstacleWeight, 0.86, 1.12);

  // Add clouds above
  while (clouds.length === 0 || clouds[clouds.length - 1].y > topVisible - 60) {
    const prevCloud = clouds.length > 0 ? clouds[clouds.length - 1] : null;
    const lastY = prevCloud ? prevCloud.y : H;
    const baseGapMin = difficulty === 'easy' ? (isSlowProfile ? 46 : 42) : (isSlowProfile ? 38 : 34);
    const baseGapVar = difficulty === 'easy' ? (isSlowProfile ? 34 : 30) : (isSlowProfile ? 28 : 24);
    const chainGapBoost = Math.min(jumpChainCount, 6) * (difficulty === 'easy' ? 2.2 : 1.4);
    const gap = baseGapMin + Math.random() * baseGapVar + chainGapBoost;
    const newY = lastY - gap;
    const newCloud = createCloud(newY);

    // Prevent vertical stacks that cause automatic chain jumps without meaningful movement.
    if (prevCloud) {
      const minCenterDist = difficulty === 'easy'
        ? (isSlowProfile ? 52 : 44)
        : (isSlowProfile ? 42 : 36);
      const prevCenter = prevCloud.x + prevCloud.w * 0.5;
      for (let tries = 0; tries < 10; tries++) {
        const newCenter = newCloud.x + newCloud.w * 0.5;
        if (Math.abs(newCenter - prevCenter) >= minCenterDist) break;
        newCloud.x = Math.random() * (W - newCloud.w);
      }
    }

    clouds.push(newCloud);

    // Obstacles (spawn more as height increases)
    const obstChance = tier.obstacleChance * hardObstacleMod * adaptiveFactor;
    if (Math.random() < obstChance && maxHeight > 420) {
      obstacles.push({
        x: Math.random() * (W - 16),
        y: newY - 15 - Math.random() * 20,
        w: 12, h: 10,
        vx: (Math.random() > 0.5 ? 1 : -1) * (tier.obstacleBaseSpeed + Math.random() * tier.obstacleVarSpeed) * obstacleSpeedFactor
      });
    }

    // Power-ups (rare)
    if (Math.random() < 0.06) {
      powerUps.push({
        x: Math.random() * (W - 16),
        y: newY - 20,
        w: 12, h: 12,
        type: Math.random() < 0.65 ? 'timer' : 'rocket',
        collected: false
      });
    }
  }

  // Remove off-screen entities
  const bottomCull = cameraY + H + 100;
  clouds = clouds.filter(c => c.y < bottomCull);
  obstacles = obstacles.filter(o => o.y < bottomCull);
  powerUps = powerUps.filter(p => p.y < bottomCull && !p.collected);
  witches = witches.filter(w => w.y < bottomCull);
}

// ===== GAME UPDATE =====
function updateGame(dt) {
  frameCount += dt;

  if (jumpBufferTimer > 0) {
    jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);
  }

  if (jumpChainTimer > 0) {
    jumpChainTimer = Math.max(0, jumpChainTimer - dt);
    if (jumpChainTimer === 0) jumpChainCount = 0;
  }

  // Track ascent first, then update tier at visible height milestones.
  const ascent = Math.max(0, -cameraY);
  if (ascent > maxHeight) {
    maxHeight = ascent;
    const nextMilestone = Math.floor(maxHeight / 50) * 50;
    if (nextMilestone > lastMeterMilestone && nextMilestone > 0) {
      lastMeterMilestone = nextMilestone;
      milestoneText = nextMilestone + 'm!';
      milestoneTimer = 55;
    }

    const nextTier = getTierByHeight(maxHeight);
    if (nextTier !== speedTier) {
      speedTier = nextTier;
      announceTier(speedTier);
    }
  }

  const tier = getBlendedTierParams(maxHeight);
  const targetAdaptiveFactor = getAdaptiveDifficultyFactor();
  const adaptiveLerp = clamp((ddaConfig ? ddaConfig.adaptiveSmoothing : DEFAULT_DDA_CONFIG.adaptiveSmoothing) * dt, 0.01, 1);
  smoothedAdaptiveFactor = lerp(smoothedAdaptiveFactor, targetAdaptiveFactor, adaptiveLerp);
  const moveSpeed = tier.moveSpeed * (difficulty === 'hard' ? 1.08 : 1);
  const baseJumpForce = FLAPPY_JUMP_FORCE;
  const gravityUp = FLAPPY_GRAVITY_UP;
  const gravityDown = FLAPPY_GRAVITY_DOWN;
  rocketBoostCurrent = rocketTimer > 0 ? ROCKET_JUMP_BOOST : 1;
  const jumpBoost = rocketBoostCurrent;
  const chainSoftCap = Math.floor(ddaConfig ? ddaConfig.jumpChainSoftCap : DEFAULT_DDA_CONFIG.jumpChainSoftCap);
  const chainExcess = Math.max(0, jumpChainCount - chainSoftCap);
  const chainSpeedPenalty = clamp(
    chainExcess * (ddaConfig ? ddaConfig.jumpChainSpeedPenalty : DEFAULT_DDA_CONFIG.jumpChainSpeedPenalty),
    0,
    ddaConfig ? ddaConfig.jumpChainSpeedPenaltyMax : DEFAULT_DDA_CONFIG.jumpChainSpeedPenaltyMax
  );
  const chainSpeedDamp = 1 - chainSpeedPenalty;

  const jumpFromCloud = (cloud) => {
    if (jumpChainTimer > 0) {
      jumpChainCount += 1;
    } else {
      jumpChainCount = 1;
    }
    jumpChainTimer = ddaConfig ? ddaConfig.jumpChainWindowFrames : DEFAULT_DDA_CONFIG.jumpChainWindowFrames;

    unicorn.y = cloud.y - cameraY - unicorn.h;
    unicorn.vy = baseJumpForce * jumpBoost;
    jumpBufferTimer = 0;
    score++;
    playJumpSound();

    if (cloud.type === 'crumbling') {
      cloud.crumbleTimer--;
      if (cloud.crumbleTimer <= 0) {
        const cloudIndex = clouds.indexOf(cloud);
        if (cloudIndex >= 0) clouds.splice(cloudIndex, 1);
      }
    }
  };

  const canStandOnCloud = (cloud) => {
    if (!cloud || !clouds.includes(cloud)) return false;
    return unicorn.x + unicorn.w > cloud.x + 4 && unicorn.x < cloud.x + cloud.w - 4;
  };

  // Tiered speed progression with temporary slowdown from timer power-up.
  const slowFactor = slowMoTimer > 0 ? 0.7 : 1;
  const speedInfluence = difficulty === 'easy'
    ? (ddaConfig ? ddaConfig.speedTierInfluenceEasy : DEFAULT_DDA_CONFIG.speedTierInfluenceEasy)
    : 1;
  const speedGameTiered = lerp(SPEED_TIERS.easy.gameSpeed, tier.gameSpeed, speedInfluence);
  const speedEnvTiered = lerp(SPEED_TIERS.easy.envSpeed, tier.envSpeed, speedInfluence);

  let targetGameSpeed = speedGameTiered * slowFactor * smoothedAdaptiveFactor * chainSpeedDamp;
  let targetEnvSpeed = speedEnvTiered * slowFactor * smoothedAdaptiveFactor * chainSpeedDamp;

  if (difficulty === 'easy') {
    targetGameSpeed = Math.min(targetGameSpeed, 1.04);
    targetEnvSpeed = Math.min(targetEnvSpeed, 1.05);
  }

  const targetFilterBase = Math.max(0.001, (ddaConfig ? ddaConfig.targetSpeedFilterPerFrame : DEFAULT_DDA_CONFIG.targetSpeedFilterPerFrame));
  const targetFilterLimit = difficulty === 'easy' ? Math.min(targetFilterBase, 0.0009) : targetFilterBase;
  const targetFilterStep = targetFilterLimit * dt;
  targetGameSpeedFiltered += clamp(targetGameSpeed - targetGameSpeedFiltered, -targetFilterStep, targetFilterStep);
  targetEnvSpeedFiltered += clamp(targetEnvSpeed - targetEnvSpeedFiltered, -targetFilterStep, targetFilterStep);

  const speedStepBase = Math.max(0.001, (ddaConfig ? ddaConfig.maxSpeedStepPerFrame : DEFAULT_DDA_CONFIG.maxSpeedStepPerFrame));
  const speedStepLimit = difficulty === 'easy' ? Math.min(speedStepBase, 0.0012) : speedStepBase;
  const speedStep = speedStepLimit * dt;
  gameSpeed += clamp(targetGameSpeedFiltered - gameSpeed, -speedStep, speedStep);
  envSpeedCurrent += clamp(targetEnvSpeedFiltered - envSpeedCurrent, -speedStep, speedStep);

  // Touch/input movement
  let targetVx = 0;
  if (touchX >= 0) {
    targetVx = touchX < W / 2 ? -moveSpeed : moveSpeed;
  }
  const steerLerp = touchX >= 0 ? 0.35 : 0.18;
  unicorn.vx += (targetVx - unicorn.vx) * steerLerp * dt;
  unicorn.vx = clamp(unicorn.vx, -moveSpeed, moveSpeed);
  unicorn.x += unicorn.vx * dt;

  if (groundedCloud && !canStandOnCloud(groundedCloud)) {
    groundedCloud = null;
  }

  let jumpedThisFrame = false;
  if (groundedCloud && jumpBufferTimer > 0) {
    const launchCloud = groundedCloud;
    groundedCloud = null;
    jumpFromCloud(launchCloud);
    jumpedThisFrame = true;
  }

  // Physics
  if (groundedCloud) {
    unicorn.vy = 0;
    unicorn.y = groundedCloud.y - cameraY - unicorn.h;
  } else {
    if (!jumpedThisFrame) {
      const gravity = unicorn.vy < 0 ? gravityUp : gravityDown;
      unicorn.vy += gravity * dt;
      unicorn.vy = clamp(unicorn.vy, -12, 10);
    }
    unicorn.y += unicorn.vy * dt;
  }

  // Wrap horizontally
  if (unicorn.x + unicorn.w < 0) unicorn.x = W;
  if (unicorn.x > W) unicorn.x = -unicorn.w;

  // Cloud collision (only when falling)
  if (unicorn.vy >= 0) {
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const screenY = c.y - cameraY;
      if (
        unicorn.x + unicorn.w > c.x + 4 &&
        unicorn.x < c.x + c.w - 4 &&
        unicorn.y + unicorn.h >= c.y - cameraY &&
        unicorn.y + unicorn.h <= c.y - cameraY + 14
      ) {
        groundedCloud = c;
        unicorn.vy = 0;
        unicorn.y = c.y - cameraY - unicorn.h;

        if (jumpBufferTimer > 0) {
          const launchCloud = groundedCloud;
          groundedCloud = null;
          jumpFromCloud(launchCloud);
        }
        break;
      }
    }
  }

  // Moving clouds
  clouds.forEach(c => {
    if (c.type === 'moving') {
      const prevX = c.x;
      c.x += c.moveDir * c.moveSpeed * envSpeedCurrent * dt;
      if (c.x <= 0 || c.x + c.w >= W) c.moveDir *= -1;
      if (c === groundedCloud) {
        unicorn.x += c.x - prevX;
      }
    }
  });

  // Obstacles
  obstacles.forEach(o => {
    o.x += o.vx * envSpeedCurrent * dt;
    if (o.x <= 0 || o.x + o.w >= W) o.vx *= -1;
  });

  // Witches – spawn and chase
  if (maxHeight >= WITCH_SPAWN_HEIGHT) {
    witchSpawnTimer = Math.max(0, witchSpawnTimer - dt);
    if (witchSpawnTimer === 0 && witches.length < WITCH_MAX_COUNT) {
      witches.push({
        x: Math.random() * (W - 16),
        y: cameraY - 20,
        w: 16, h: 17
      });
      witchSpawnTimer = WITCH_SPAWN_INTERVAL;
    }
  }
  const uxWorld = unicorn.x + unicorn.w / 2;
  const uyWorld = unicorn.y + cameraY + unicorn.h / 2;
  witches.forEach(w => {
    const dx = uxWorld - (w.x + w.w / 2);
    const dy = uyWorld - (w.y + w.h / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      const spd = WITCH_CHASE_SPEED * dt;
      w.x += (dx / dist) * spd;
      w.y += (dy / dist) * spd;
    }
  });

  // Camera follows unicorn
  // Follow only by unicorn screen offset to avoid camera feedback loops.
  const camDelta = unicorn.y - H * 0.35;
  if (camDelta < 0) {
    cameraY += camDelta * 0.1 * dt;
  }

  if (slowMoTimer > 0) slowMoTimer = Math.max(0, slowMoTimer - dt);
  if (rocketTimer > 0) rocketTimer = Math.max(0, rocketTimer - dt);
  if (tierFlashTimer > 0) tierFlashTimer = Math.max(0, tierFlashTimer - dt);
  if (milestoneTimer > 0) milestoneTimer = Math.max(0, milestoneTimer - dt);

  // Collision with obstacles
  const ux = unicorn.x, uy = unicorn.y + cameraY;
  witches.forEach(w => {
    if (
      ux + unicorn.w > w.x + 2 &&
      ux < w.x + w.w - 2 &&
      uy + unicorn.h > w.y + 2 &&
      uy < w.y + w.h - 2
    ) {
      gameOver();
    }
  });
  obstacles.forEach(o => {
    if (
      ux + unicorn.w > o.x + 2 &&
      ux < o.x + o.w - 2 &&
      uy + unicorn.h > o.y + 2 &&
      uy < o.y + o.h - 2
    ) {
      gameOver();
    }
  });

  // Collect power-ups
  powerUps.forEach(p => {
    if (!p.collected &&
      ux + unicorn.w > p.x &&
      ux < p.x + p.w &&
      uy + unicorn.h > p.y &&
      uy < p.y + p.h
    ) {
      p.collected = true;
      if (p.type === 'rocket') {
        rocketTimer = ROCKET_DURATION_FRAMES;
      } else {
        slowMoTimer = 300;
      }
      playPowerUpSound();
    }
  });

  // Fall death
  if (unicorn.y > H + 20) {
    gameOver();
  }

  generateContent(smoothedAdaptiveFactor);
  updateCandyParticles();
}

function gameOver() {
  state = STATE.GAME_OVER;
  stopBgMusic();
  playHitSound();
  finalizeRunTracking();
  if (score > highScore) {
    newRecord = true;
    highScore = score;
    saveHighScore(highScore);
    spawnCandyExplosion();
    playTrumpet();
  }
}

// ===== DRAWING =====
function drawMenu() {
  drawBackground();
  drawTuningHint();

  // Title
  ctx.save();
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFD700';
  ctx.fillText('🦄 UNICORN', W / 2, 40);
  ctx.fillText('CLOUD JUMP', W / 2, 58);

  // Pixel unicorn preview
  drawUnicorn(W / 2 - 14, 70, frameCount);

  // Difficulty buttons
  const easyColor = difficulty === 'easy' ? '#44FF88' : '#446644';
  const hardColor = difficulty === 'hard' ? '#FF4444' : '#664444';

  // Easy button
  ctx.fillStyle = easyColor;
  ctx.fillRect(20, 130, 90, 32);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('EASY', 65, 150);

  // Hard button
  ctx.fillStyle = hardColor;
  ctx.fillRect(130, 130, 90, 32);
  ctx.fillStyle = '#000';
  ctx.fillText('HARD', 175, 150);

  // High score
  ctx.fillStyle = '#FFF';
  ctx.font = '10px monospace';
  ctx.fillText('HIGH SCORE: ' + highScore, W / 2, 185);

  if (debugOverlayOn) {
    // DDA tuning quick controls
    ctx.font = '8px monospace';
    ctx.fillStyle = '#D7E8FF';
    const rampLabel = ddaConfig ? ddaConfig.maxSpeedStepPerFrame.toFixed(3) : DEFAULT_DDA_CONFIG.maxSpeedStepPerFrame.toFixed(3);
    const smoothLabel = ddaConfig ? ddaConfig.adaptiveSmoothing.toFixed(3) : DEFAULT_DDA_CONFIG.adaptiveSmoothing.toFixed(3);
    const filterLabel = ddaConfig ? ddaConfig.targetSpeedFilterPerFrame.toFixed(3) : DEFAULT_DDA_CONFIG.targetSpeedFilterPerFrame.toFixed(3);
    ctx.fillText('PROFILE [P]: ' + activeDdaProfile.toUpperCase(), W / 2, 192);
    ctx.fillText('RAMP +/-: [ ]  ' + rampLabel, W / 2, 200);
    ctx.fillText('SMOOTH +/-: , .  ' + smoothLabel, W / 2, 210);
    ctx.fillText('FILTER: ' + filterLabel, W / 2, 220);
  }

  // Start instruction
  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 11px monospace';
  const blink = Math.sin(frameCount * 0.08) > 0;
  if (blink) {
    ctx.fillText('TAP TO START', W / 2, 228);
  }

  // Music toggle
  ctx.fillStyle = musicOn ? '#44FF88' : '#FF4444';
  ctx.fillRect(W / 2 - 30, 240, 60, 24);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 9px monospace';
  ctx.fillText(musicOn ? '♪ ON' : '♪ OFF', W / 2, 255);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#D7E8FF';
  ctx.font = '8px monospace';
  ctx.fillText(APP_VERSION, 8, H - 8);

  ctx.restore();
}

function drawGame() {
  drawBackground();
  drawTuningHint();

  // Draw clouds
  clouds.forEach(c => {
    const sy = c.y - cameraY;
    if (sy > -20 && sy < H + 20) {
      drawCloud(c.x, sy, c.w, c.type);
    }
  });

  // Draw power-ups
  powerUps.forEach(p => {
    if (!p.collected) {
      const sy = p.y - cameraY;
      if (sy > -20 && sy < H + 20) {
        drawPowerUp(p.x, sy, p.type);
      }
    }
  });

  // Draw obstacles
  obstacles.forEach(o => {
    const sy = o.y - cameraY;
    if (sy > -20 && sy < H + 20) {
      drawObstacle(o.x, sy);
    }
  });

  // Draw witches
  witches.forEach(w => {
    const sy = w.y - cameraY;
    if (sy > -30 && sy < H + 30) {
      drawWitch(w.x, sy);
    }
  });

  // Draw unicorn
  drawUnicorn(unicorn.x, unicorn.y, frameCount);

  // Score speech bubble (top center)
  drawSpeechBubble(W / 2, 30, 'JUMPS: ' + score, 9);

  if (milestoneTimer > 0) {
    drawSpeechBubble(W - 34, 56, milestoneText, 7);
  }

  // Active power-up indicators
  if (slowMoTimer > 0 || rocketTimer > 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 8px monospace';
    let y = H - 18;
    if (slowMoTimer > 0) {
      ctx.fillStyle = '#44D6FF';
      ctx.fillText('TIMER x0.7: ' + Math.ceil(slowMoTimer / 60) + 's', W / 2, y);
      y += 10;
    }
    if (rocketTimer > 0) {
      ctx.fillStyle = '#FFAA33';
      ctx.fillText('ROCKET: ' + Math.ceil(rocketTimer / 60) + 's', W / 2, y);
    }
    ctx.restore();
  }

  // Height indicator
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '7px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('ZONE: ' + SPEED_TIERS[speedTier].label, 4, 12);

  const nextTierHeight = getNextTierHeight(maxHeight);
  if (nextTierHeight !== null) {
    ctx.fillText('NEXT: ' + nextTierHeight + 'm', 4, 22);
  }

  ctx.textAlign = 'right';
  ctx.fillText(Math.floor(maxHeight) + 'm', W - 4, 12);
  ctx.restore();

  if (tierFlashTimer > 0) {
    drawSpeechBubble(W / 2, 76, tierFlashText, 9);
  }

  drawCandyParticles();
}

function drawGameOver() {
  drawBackground();
  drawTuningHint();

  // Dim overlay
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.textAlign = 'center';

  if (newRecord) {
    // New record celebration
    ctx.font = 'bold 14px monospace';
    const hue = (frameCount * 5) % 360;
    ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
    ctx.fillText('★ NEW RECORD! ★', W / 2, 50);

    drawCandyParticles();
  }

  // Game over text
  ctx.font = 'bold 16px monospace';
  ctx.fillStyle = '#FF4444';
  ctx.fillText('GAME OVER', W / 2, 90);

  // Score in speech bubble
  drawSpeechBubble(W / 2, 130, 'SCORE: ' + score, 12);

  // High score
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 10px monospace';
  ctx.fillText('BEST: ' + highScore, W / 2, 170);

  // Height
  ctx.fillStyle = '#AAF';
  ctx.font = '9px monospace';
  ctx.fillText('HEIGHT: ' + Math.floor(maxHeight) + 'm', W / 2, 190);

  // Retry
  const blink = Math.sin(frameCount * 0.08) > 0;
  if (blink) {
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('TAP TO RETRY', W / 2, 230);
  }

  // Menu button
  ctx.fillStyle = '#666';
  ctx.fillRect(W / 2 - 30, 248, 60, 22);
  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 9px monospace';
  ctx.fillText('MENU', W / 2, 262);

  ctx.restore();
}

// ===== MAIN LOOP =====
function gameLoop() {
  const now = performance.now();
  if (!lastTimestamp) lastTimestamp = now;
  const dt = clamp((now - lastTimestamp) / BASE_FRAME_MS, 0.5, MAX_DT_STEPS);
  lastTimestamp = now;

  if (tuningHintTimer > 0) {
    tuningHintTimer = Math.max(0, tuningHintTimer - dt);
  }

  ctx.clearRect(0, 0, W, H);

  switch (state) {
    case STATE.MENU:
      frameCount += dt;
      updateCandyParticles();
      drawMenu();
      break;
    case STATE.PLAYING:
      updateGame(dt);
      drawGame();
      break;
    case STATE.GAME_OVER:
      frameCount += dt;
      updateCandyParticles();
      drawGameOver();
      break;
  }

  requestAnimationFrame(gameLoop);
}

// ===== INPUT HANDLING =====
function handleTouchStart(x, y) {
  initAudio();

  if (state === STATE.MENU) {
    // Difficulty selection
    if (y >= 130 && y <= 162) {
      if (x >= 20 && x <= 110) {
        difficulty = 'easy';
        return;
      } else if (x >= 130 && x <= 220) {
        difficulty = 'hard';
        return;
      }
    }
    // Music toggle
    if (y >= 240 && y <= 264 && x >= W/2 - 30 && x <= W/2 + 30) {
      musicOn = !musicOn;
      if (!musicOn) stopBgMusic();
      return;
    }
    // Start game
    state = STATE.PLAYING;
    resetGame();
    if (musicOn) startBgMusic();
    return;
  }

  if (state === STATE.GAME_OVER) {
    // Menu button
    if (y >= 248 && y <= 270 && x >= W/2 - 30 && x <= W/2 + 30) {
      state = STATE.MENU;
      candyParticles = [];
      return;
    }
    // Retry
    state = STATE.PLAYING;
    resetGame();
    if (musicOn) startBgMusic();
    return;
  }

  if (state === STATE.PLAYING) {
    queueJump();
    touchX = x;
  }
}

function handleTouchEnd() {
  touchX = -1;
}

function handleTouchMove(x) {
  if (state === STATE.PLAYING) {
    touchX = x;
  }
}

// Touch events
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  const x = (t.clientX - rect.left) * (W / rect.width);
  const y = (t.clientY - rect.top) * (H / rect.height);
  handleTouchStart(x, y);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  const x = (t.clientX - rect.left) * (W / rect.width);
  handleTouchMove(x);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  handleTouchEnd();
}, { passive: false });

// Mouse fallback for development
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (W / rect.width);
  const y = (e.clientY - rect.top) * (H / rect.height);
  handleTouchStart(x, y);
});

canvas.addEventListener('mousemove', (e) => {
  if (e.buttons === 1) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    handleTouchMove(x);
  }
});

canvas.addEventListener('mouseup', () => handleTouchEnd());

// R1 hardware events
window.addEventListener('sideClick', () => {
  initAudio();
  if (state === STATE.MENU) {
    state = STATE.PLAYING;
    resetGame();
    if (musicOn) startBgMusic();
  } else if (state === STATE.GAME_OVER) {
    state = STATE.PLAYING;
    resetGame();
    if (musicOn) startBgMusic();
  } else if (state === STATE.PLAYING) {
    queueJump();
  }
});

window.addEventListener('scrollUp', () => {
  if (state === STATE.PLAYING) {
    touchX = 0;
  }
});

window.addEventListener('scrollDown', () => {
  if (state === STATE.PLAYING) {
    touchX = W;
  }
});

// Keyboard fallback
window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    debugOverlayOn = !debugOverlayOn;
    saveDebugOverlayState();
    return;
  }

  if (debugOverlayOn) {
    if (e.code === 'KeyP') {
      setDdaProfile(getNextDdaProfileName(), true);
      return;
    }

    if (e.code === 'BracketLeft') {
      adjustDdaConfig('maxSpeedStepPerFrame', -0.002, 0.002, 0.03);
    }
    if (e.code === 'BracketRight') {
      adjustDdaConfig('maxSpeedStepPerFrame', 0.002, 0.002, 0.03);
    }
    if (e.code === 'Comma') {
      adjustDdaConfig('adaptiveSmoothing', -0.01, 0.01, 0.4);
    }
    if (e.code === 'Period') {
      adjustDdaConfig('adaptiveSmoothing', 0.01, 0.01, 0.4);
    }
  }

  if (e.code === 'Space') {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('sideClick'));
  }
  if (state === STATE.PLAYING) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') touchX = 0;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') touchX = W;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD') {
    touchX = -1;
  }
});

// ===== INIT =====
async function init() {
  highScore = (await loadHighScore()) || 0;
  sessionHistory = (await loadSessionHistory()) || [];
  activeDdaProfile = await loadActiveDdaProfile();
  const loadedDda = await loadDdaConfig();
  ddaConfig = applyDdaProfile(loadedDda, activeDdaProfile);
  saveDdaConfig(ddaConfig);
  saveActiveDdaProfile();
  debugOverlayOn = await loadDebugOverlayState();
  playerProfile = computePlayerProfile(sessionHistory);
  initStars();
  gameLoop();
}

init();
