// ===== PURE UTILITY FUNCTIONS & GAME CONSTANTS =====
// Extracted here so they can be unit-tested independently of the DOM/canvas.

// ===== MATH HELPERS =====
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ===== GAME CONSTANTS =====
export const TIER_BLEND_BANDS = {
  easyToMediumStart: 6500,
  easyToMediumEnd: 13000,
  mediumToTurboStart: 17000,
  mediumToTurboEnd: 26000
};

export const SPEED_TIERS = {
  easy: {
    label: 'FACILE',
    gameSpeed: 0.98,
    envSpeed: 0.98,
    moveSpeed: 2.5,
    obstacleChance: 0.02,
    obstacleBaseSpeed: 0.18,
    obstacleVarSpeed: 0.22
  },
  medium: {
    label: 'MEDIA',
    gameSpeed: 1.04,
    envSpeed: 1.04,
    moveSpeed: 2.8,
    obstacleChance: 0.032,
    obstacleBaseSpeed: 0.22,
    obstacleVarSpeed: 0.26
  },
  turbo: {
    label: 'TURBO',
    gameSpeed: 1.08,
    envSpeed: 1.1,
    moveSpeed: 3.05,
    obstacleChance: 0.045,
    obstacleBaseSpeed: 0.28,
    obstacleVarSpeed: 0.3
  }
};

export const DEFAULT_DDA_CONFIG = {
  adaptiveStrengthEasy: 0.035,
  adaptiveStrengthHard: 0.09,
  adaptiveSmoothing: 0.03,
  maxSpeedStepPerFrame: 0.002,
  targetSpeedFilterPerFrame: 0.0012,
  obstacleAdaptiveWeight: 0.55,
  verticalTierInfluenceEasy: 0.22,
  speedTierInfluenceEasy: 0.12,
  jumpChainWindowFrames: 54,
  jumpChainSoftCap: 4,
  jumpChainSpeedPenalty: 0.02,
  jumpChainSpeedPenaltyMax: 0.18,
  jumpChainJumpPenalty: 0.018,
  jumpChainJumpPenaltyMax: 0.12
};

export const DDA_PROFILES = {
  'arcade-slow': {
    adaptiveStrengthEasy: 0.02,
    adaptiveStrengthHard: 0.06,
    adaptiveSmoothing: 0.02,
    maxSpeedStepPerFrame: 0.0012,
    targetSpeedFilterPerFrame: 0.0008,
    verticalTierInfluenceEasy: 0.16,
    speedTierInfluenceEasy: 0.08,
    jumpChainSoftCap: 3,
    jumpChainSpeedPenalty: 0.026,
    jumpChainSpeedPenaltyMax: 0.24,
    jumpChainJumpPenalty: 0.024,
    jumpChainJumpPenaltyMax: 0.18
  },
  'arcade-balanced': {
    adaptiveStrengthEasy: 0.028,
    adaptiveStrengthHard: 0.075,
    adaptiveSmoothing: 0.026,
    maxSpeedStepPerFrame: 0.0016,
    targetSpeedFilterPerFrame: 0.001,
    verticalTierInfluenceEasy: 0.2,
    speedTierInfluenceEasy: 0.1,
    jumpChainSoftCap: 4,
    jumpChainSpeedPenalty: 0.022,
    jumpChainSpeedPenaltyMax: 0.2,
    jumpChainJumpPenalty: 0.02,
    jumpChainJumpPenaltyMax: 0.14
  }
};

export const DDA_PROFILE_ORDER = ['arcade-slow', 'arcade-balanced'];

// ===== DDA CONFIG =====
function parseDda(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function sanitizeDdaConfig(raw) {
  const cfg = raw || {};
  return {
    adaptiveStrengthEasy: clamp(parseDda(cfg.adaptiveStrengthEasy, DEFAULT_DDA_CONFIG.adaptiveStrengthEasy), 0, 0.2),
    adaptiveStrengthHard: clamp(parseDda(cfg.adaptiveStrengthHard, DEFAULT_DDA_CONFIG.adaptiveStrengthHard), 0, 0.35),
    adaptiveSmoothing: clamp(parseDda(cfg.adaptiveSmoothing, DEFAULT_DDA_CONFIG.adaptiveSmoothing), 0.01, 0.3),
    maxSpeedStepPerFrame: clamp(parseDda(cfg.maxSpeedStepPerFrame, DEFAULT_DDA_CONFIG.maxSpeedStepPerFrame), 0.001, 0.02),
    targetSpeedFilterPerFrame: clamp(parseDda(cfg.targetSpeedFilterPerFrame, DEFAULT_DDA_CONFIG.targetSpeedFilterPerFrame), 0.0005, 0.02),
    obstacleAdaptiveWeight: clamp(parseDda(cfg.obstacleAdaptiveWeight, DEFAULT_DDA_CONFIG.obstacleAdaptiveWeight), 0, 1),
    verticalTierInfluenceEasy: clamp(parseDda(cfg.verticalTierInfluenceEasy, DEFAULT_DDA_CONFIG.verticalTierInfluenceEasy), 0, 1),
    speedTierInfluenceEasy: clamp(parseDda(cfg.speedTierInfluenceEasy, DEFAULT_DDA_CONFIG.speedTierInfluenceEasy), 0, 1),
    jumpChainWindowFrames: clamp(parseDda(cfg.jumpChainWindowFrames, DEFAULT_DDA_CONFIG.jumpChainWindowFrames), 20, 90),
    jumpChainSoftCap: clamp(parseDda(cfg.jumpChainSoftCap, DEFAULT_DDA_CONFIG.jumpChainSoftCap), 2, 9),
    jumpChainSpeedPenalty: clamp(parseDda(cfg.jumpChainSpeedPenalty, DEFAULT_DDA_CONFIG.jumpChainSpeedPenalty), 0, 0.08),
    jumpChainSpeedPenaltyMax: clamp(parseDda(cfg.jumpChainSpeedPenaltyMax, DEFAULT_DDA_CONFIG.jumpChainSpeedPenaltyMax), 0, 0.4),
    jumpChainJumpPenalty: clamp(parseDda(cfg.jumpChainJumpPenalty, DEFAULT_DDA_CONFIG.jumpChainJumpPenalty), 0, 0.08),
    jumpChainJumpPenaltyMax: clamp(parseDda(cfg.jumpChainJumpPenaltyMax, DEFAULT_DDA_CONFIG.jumpChainJumpPenaltyMax), 0, 0.35)
  };
}

export function applyDdaProfile(baseConfig, profileName) {
  const preset = DDA_PROFILES[profileName];
  if (!preset) return sanitizeDdaConfig(baseConfig);
  return sanitizeDdaConfig({ ...baseConfig, ...preset });
}

// ===== TIER LOGIC =====
export function getTierByHeight(height) {
  if (height >= 10000) return 'turbo';
  if (height >= 5000) return 'medium';
  return 'easy';
}

export function getNextTierHeight(height) {
  if (height < 5000) return 5000;
  if (height < 10000) return 10000;
  return null;
}

export function getBlendedTierParams(height) {
  const easy = SPEED_TIERS.easy;
  const medium = SPEED_TIERS.medium;
  const turbo = SPEED_TIERS.turbo;
  const h = Math.max(0, height);

  const blend = (a, b, t) => ({
    label: t < 0.5 ? a.label : b.label,
    gameSpeed: lerp(a.gameSpeed, b.gameSpeed, t),
    envSpeed: lerp(a.envSpeed, b.envSpeed, t),
    moveSpeed: lerp(a.moveSpeed, b.moveSpeed, t),
    obstacleChance: lerp(a.obstacleChance, b.obstacleChance, t),
    obstacleBaseSpeed: lerp(a.obstacleBaseSpeed, b.obstacleBaseSpeed, t),
    obstacleVarSpeed: lerp(a.obstacleVarSpeed, b.obstacleVarSpeed, t)
  });

  if (h < TIER_BLEND_BANDS.easyToMediumStart) return easy;
  if (h < TIER_BLEND_BANDS.easyToMediumEnd) {
    const t = smoothstep01(clamp(
      (h - TIER_BLEND_BANDS.easyToMediumStart) /
      (TIER_BLEND_BANDS.easyToMediumEnd - TIER_BLEND_BANDS.easyToMediumStart),
      0, 1
    ));
    return blend(easy, medium, t);
  }
  if (h < TIER_BLEND_BANDS.mediumToTurboStart) return medium;
  if (h < TIER_BLEND_BANDS.mediumToTurboEnd) {
    const t = smoothstep01(clamp(
      (h - TIER_BLEND_BANDS.mediumToTurboStart) /
      (TIER_BLEND_BANDS.mediumToTurboEnd - TIER_BLEND_BANDS.mediumToTurboStart),
      0, 1
    ));
    return blend(medium, turbo, t);
  }
  return turbo;
}

// ===== PLAYER PROFILE =====
export function computePlayerProfile(history) {
  if (!history || history.length === 0) {
    return {
      sampleCount: 0,
      avgHeight: 0,
      avgScore: 0,
      avgDuration: 0,
      avgClimbRate: 0,
      consistency: 0.5
    };
  }

  const recent = history.slice(-20);
  const n = recent.length;
  const sumHeight = recent.reduce((acc, s) => acc + (s.maxHeight || 0), 0);
  const sumScore = recent.reduce((acc, s) => acc + (s.score || 0), 0);
  const sumDuration = recent.reduce((acc, s) => acc + (s.durationSec || 0), 0);
  const sumRate = recent.reduce((acc, s) => {
    const dur = Math.max(1, s.durationSec || 0);
    return acc + (s.maxHeight || 0) / dur;
  }, 0);

  const avgHeight = sumHeight / n;
  const variance = recent.reduce((acc, s) => {
    const d = (s.maxHeight || 0) - avgHeight;
    return acc + d * d;
  }, 0) / n;
  const stdDev = Math.sqrt(variance);
  const consistency = clamp(1 - (stdDev / Math.max(1, avgHeight)), 0.15, 1);

  return {
    sampleCount: history.length,
    avgHeight,
    avgScore: sumScore / n,
    avgDuration: sumDuration / n,
    avgClimbRate: sumRate / n,
    consistency
  };
}
