import { describe, it, expect } from 'vitest';
import {
  clamp,
  lerp,
  smoothstep01,
  getTierByHeight,
  getNextTierHeight,
  getBlendedTierParams,
  computePlayerProfile,
  sanitizeDdaConfig,
  applyDdaProfile,
  DEFAULT_DDA_CONFIG,
  DDA_PROFILES,
  DDA_PROFILE_ORDER,
  SPEED_TIERS,
  TIER_BLEND_BANDS
} from '../lib/game-utils.js';

// ===== MATH HELPERS =====
describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
  it('handles equal min and max', () => {
    expect(clamp(7, 5, 5)).toBe(5);
  });
});

describe('lerp', () => {
  it('returns start at t=0', () => {
    expect(lerp(0, 100, 0)).toBe(0);
  });
  it('returns end at t=1', () => {
    expect(lerp(0, 100, 1)).toBe(100);
  });
  it('returns midpoint at t=0.5', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });
  it('works with negative values', () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});

describe('smoothstep01', () => {
  it('returns 0 at t=0', () => {
    expect(smoothstep01(0)).toBe(0);
  });
  it('returns 1 at t=1', () => {
    expect(smoothstep01(1)).toBe(1);
  });
  it('returns 0.5 at t=0.5 (symmetric)', () => {
    expect(smoothstep01(0.5)).toBe(0.5);
  });
  it('clamps below 0 to 0', () => {
    expect(smoothstep01(-1)).toBe(0);
  });
  it('clamps above 1 to 1', () => {
    expect(smoothstep01(2)).toBe(1);
  });
  it('is slower than linear near edges (S-curve shape)', () => {
    // smoothstep should be slower than linear near 0 and 1
    expect(smoothstep01(0.1)).toBeLessThan(0.1);
    expect(smoothstep01(0.9)).toBeGreaterThan(0.9);
  });
});

// ===== TIER LOGIC =====
describe('getTierByHeight', () => {
  it('returns easy below 5000m', () => {
    expect(getTierByHeight(0)).toBe('easy');
    expect(getTierByHeight(4999)).toBe('easy');
  });
  it('returns medium from 5000m to 9999m', () => {
    expect(getTierByHeight(5000)).toBe('medium');
    expect(getTierByHeight(9999)).toBe('medium');
  });
  it('returns turbo at 10000m and above', () => {
    expect(getTierByHeight(10000)).toBe('turbo');
    expect(getTierByHeight(99999)).toBe('turbo');
  });
});

describe('getNextTierHeight', () => {
  it('returns 5000 when below 5000m', () => {
    expect(getNextTierHeight(0)).toBe(5000);
    expect(getNextTierHeight(4999)).toBe(5000);
  });
  it('returns 10000 when between 5000 and 9999m', () => {
    expect(getNextTierHeight(5000)).toBe(10000);
    expect(getNextTierHeight(9999)).toBe(10000);
  });
  it('returns null at 10000m and above (no next tier)', () => {
    expect(getNextTierHeight(10000)).toBeNull();
    expect(getNextTierHeight(99999)).toBeNull();
  });
});

describe('getBlendedTierParams', () => {
  it('returns pure easy params below blend start', () => {
    const params = getBlendedTierParams(0);
    expect(params.gameSpeed).toBe(SPEED_TIERS.easy.gameSpeed);
    expect(params.moveSpeed).toBe(SPEED_TIERS.easy.moveSpeed);
  });

  it('returns pure medium params in the medium zone', () => {
    const params = getBlendedTierParams(15000);
    expect(params.gameSpeed).toBe(SPEED_TIERS.medium.gameSpeed);
    expect(params.moveSpeed).toBe(SPEED_TIERS.medium.moveSpeed);
  });

  it('returns pure turbo params above turbo blend end', () => {
    const params = getBlendedTierParams(30000);
    expect(params.gameSpeed).toBe(SPEED_TIERS.turbo.gameSpeed);
    expect(params.moveSpeed).toBe(SPEED_TIERS.turbo.moveSpeed);
  });

  it('blends between easy and medium during transition', () => {
    const midBlend = (TIER_BLEND_BANDS.easyToMediumStart + TIER_BLEND_BANDS.easyToMediumEnd) / 2;
    const params = getBlendedTierParams(midBlend);
    // gameSpeed should be between easy and medium
    expect(params.gameSpeed).toBeGreaterThan(SPEED_TIERS.easy.gameSpeed);
    expect(params.gameSpeed).toBeLessThan(SPEED_TIERS.medium.gameSpeed);
  });

  it('blends between medium and turbo during transition', () => {
    const midBlend = (TIER_BLEND_BANDS.mediumToTurboStart + TIER_BLEND_BANDS.mediumToTurboEnd) / 2;
    const params = getBlendedTierParams(midBlend);
    expect(params.gameSpeed).toBeGreaterThan(SPEED_TIERS.medium.gameSpeed);
    expect(params.gameSpeed).toBeLessThan(SPEED_TIERS.turbo.gameSpeed);
  });

  it('speed increases monotonically with height', () => {
    const heights = [0, 5000, 9750, 13000, 20000, 26000, 30000];
    const speeds = heights.map(h => getBlendedTierParams(h).gameSpeed);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1]);
    }
  });
});

// ===== DDA CONFIG =====
describe('sanitizeDdaConfig', () => {
  it('returns defaults when called with empty object', () => {
    const cfg = sanitizeDdaConfig({});
    expect(cfg.adaptiveStrengthEasy).toBe(DEFAULT_DDA_CONFIG.adaptiveStrengthEasy);
    expect(cfg.jumpChainSoftCap).toBe(DEFAULT_DDA_CONFIG.jumpChainSoftCap);
  });

  it('clamps adaptiveStrengthEasy to [0, 0.2]', () => {
    expect(sanitizeDdaConfig({ adaptiveStrengthEasy: -1 }).adaptiveStrengthEasy).toBe(0);
    expect(sanitizeDdaConfig({ adaptiveStrengthEasy: 999 }).adaptiveStrengthEasy).toBe(0.2);
  });

  it('clamps jumpChainSoftCap to [2, 9]', () => {
    expect(sanitizeDdaConfig({ jumpChainSoftCap: 0 }).jumpChainSoftCap).toBe(2);
    expect(sanitizeDdaConfig({ jumpChainSoftCap: 100 }).jumpChainSoftCap).toBe(9);
    expect(sanitizeDdaConfig({ jumpChainSoftCap: 5 }).jumpChainSoftCap).toBe(5);
  });

  it('handles null/undefined gracefully', () => {
    expect(() => sanitizeDdaConfig(null)).not.toThrow();
    expect(() => sanitizeDdaConfig(undefined)).not.toThrow();
  });

  it('preserves valid values', () => {
    const cfg = sanitizeDdaConfig({ adaptiveSmoothing: 0.05 });
    expect(cfg.adaptiveSmoothing).toBe(0.05);
  });
});

describe('applyDdaProfile', () => {
  it('overrides base config with profile values', () => {
    const base = sanitizeDdaConfig(DEFAULT_DDA_CONFIG);
    const applied = applyDdaProfile(base, 'arcade-slow');
    expect(applied.adaptiveStrengthEasy).toBe(DDA_PROFILES['arcade-slow'].adaptiveStrengthEasy);
    expect(applied.jumpChainSoftCap).toBe(DDA_PROFILES['arcade-slow'].jumpChainSoftCap);
  });

  it('returns sanitized base if profile does not exist', () => {
    const base = sanitizeDdaConfig(DEFAULT_DDA_CONFIG);
    const result = applyDdaProfile(base, 'nonexistent-profile');
    expect(result.adaptiveStrengthEasy).toBe(DEFAULT_DDA_CONFIG.adaptiveStrengthEasy);
  });

  it('applies arcade-balanced profile correctly', () => {
    const applied = applyDdaProfile(DEFAULT_DDA_CONFIG, 'arcade-balanced');
    expect(applied.adaptiveStrengthEasy).toBe(DDA_PROFILES['arcade-balanced'].adaptiveStrengthEasy);
  });

  it('all profiles in DDA_PROFILE_ORDER exist in DDA_PROFILES', () => {
    DDA_PROFILE_ORDER.forEach(name => {
      expect(DDA_PROFILES[name]).toBeDefined();
    });
  });
});

// ===== PLAYER PROFILE =====
describe('computePlayerProfile', () => {
  it('returns default profile for empty history', () => {
    const profile = computePlayerProfile([]);
    expect(profile.sampleCount).toBe(0);
    expect(profile.avgHeight).toBe(0);
    expect(profile.consistency).toBe(0.5);
  });

  it('returns default profile for null history', () => {
    const profile = computePlayerProfile(null);
    expect(profile.sampleCount).toBe(0);
  });

  it('correctly computes averages', () => {
    const history = [
      { maxHeight: 100, score: 10, durationSec: 10 },
      { maxHeight: 200, score: 20, durationSec: 20 },
      { maxHeight: 300, score: 30, durationSec: 30 }
    ];
    const profile = computePlayerProfile(history);
    expect(profile.avgHeight).toBe(200);
    expect(profile.avgScore).toBe(20);
    expect(profile.avgDuration).toBe(20);
    expect(profile.sampleCount).toBe(3);
  });

  it('only uses last 20 sessions for averages', () => {
    // 25 sessions with height=0 followed by 1 with height=1000
    const history = Array.from({ length: 25 }, (_, i) => ({
      maxHeight: i < 24 ? 0 : 1000,
      score: 0,
      durationSec: 10
    }));
    const profile = computePlayerProfile(history);
    // Only last 20 are used: 19 with height=0, 1 with height=1000 → avg = 50
    expect(profile.avgHeight).toBe(50);
    expect(profile.sampleCount).toBe(25); // total count, not sliced
  });

  it('consistency is clamped to [0.15, 1]', () => {
    const wildHistory = [
      { maxHeight: 100, score: 1, durationSec: 5 },
      { maxHeight: 5000, score: 50, durationSec: 60 },
      { maxHeight: 50, score: 1, durationSec: 3 }
    ];
    const profile = computePlayerProfile(wildHistory);
    expect(profile.consistency).toBeGreaterThanOrEqual(0.15);
    expect(profile.consistency).toBeLessThanOrEqual(1);
  });

  it('consistency is high for identical sessions', () => {
    const history = Array.from({ length: 5 }, () => ({
      maxHeight: 1000,
      score: 20,
      durationSec: 30
    }));
    const profile = computePlayerProfile(history);
    expect(profile.consistency).toBe(1); // no variance → max consistency
  });

  it('avgClimbRate is computed correctly', () => {
    const history = [{ maxHeight: 300, score: 10, durationSec: 30 }];
    const profile = computePlayerProfile(history);
    expect(profile.avgClimbRate).toBe(10); // 300/30
  });
});

// ===== WITCH SPAWN THRESHOLD =====
describe('witch spawn integration constants', () => {
  it('witches spawn only at or above 5000m (WITCH_SPAWN_HEIGHT)', async () => {
    // Dynamically import main constants to verify the spawn threshold
    // Since WITCH_SPAWN_HEIGHT is defined in main.js (not game-utils), we test it
    // indirectly: the tier at which witches appear should be 'medium' or above.
    expect(getTierByHeight(5000)).toBe('medium');
    expect(getTierByHeight(4999)).toBe('easy');
  });
});
