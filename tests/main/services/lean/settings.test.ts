import { describe, expect, it } from 'vitest';
import { BUILD_STALE_GRACE_MS, buildStaleAfterMs, DEFAULT_LEAN_SETTINGS, leanSettingsFromEnv } from '@main/services/lean/settings';

describe('leanSettingsFromEnv', () => {
  it('reads seconds for timeouts and falls back on blanks and garbage', () => {
    const settings = leanSettingsFromEnv({ LEAN_BUILD_TIMEOUT: '30', LAKE_UPDATE_TIMEOUT: ' ', LEAN_TOOLCHAIN_INSTALL_TIMEOUT: 'soon', LEAN_NUM_THREADS: '0' });
    expect(settings.leanBuildTimeoutMs).toBe(30_000);
    expect(settings.lakeUpdateTimeoutMs).toBe(DEFAULT_LEAN_SETTINGS.lakeUpdateTimeoutMs);
    expect(settings.toolchainInstallTimeoutMs).toBe(DEFAULT_LEAN_SETTINGS.toolchainInstallTimeoutMs);
    expect(settings.leanNumThreads).toBe(1);
  });
});

describe('buildStaleAfterMs', () => {
  it('outlasts every phase a first-time session build can run', () => {
    // Distinct primes so a dropped or double-counted term shows up in the sum.
    const settings = { ...DEFAULT_LEAN_SETTINGS, toolchainInstallTimeoutMs: 2, lakeUpdateTimeoutMs: 3, lakeCacheGetTimeoutMs: 5, leanBuildTimeoutMs: 7 };
    // `elan toolchain list` + `install`, again after `lake update` may bump
    // the pin; then `lake update`, `lake exe cache get`, `lake build`.
    const pipeline = 2 * 2 + 2 * 2 + 3 + 5 + 7;
    expect(buildStaleAfterMs(settings)).toBe(pipeline + BUILD_STALE_GRACE_MS);
    const defaults = DEFAULT_LEAN_SETTINGS;
    const worstCase = 4 * defaults.toolchainInstallTimeoutMs + defaults.lakeUpdateTimeoutMs + defaults.lakeCacheGetTimeoutMs + defaults.leanBuildTimeoutMs;
    expect(buildStaleAfterMs(defaults)).toBeGreaterThan(worstCase);
  });
});
