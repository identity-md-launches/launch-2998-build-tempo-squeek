export const BEST_KEY = 'tempo-squeek.best.v1';

export interface BestScores { live: number; sim: number; }

export function readBest(): { scores: BestScores; available: boolean } {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
    const data = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const safe = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;
    return { scores: { live: safe(data.live), sim: safe(data.sim) }, available: true };
  } catch { return { scores: { live: 0, sim: 0 }, available: false }; }
}

export function saveBest(scores: BestScores): boolean {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(scores)); return true; }
  catch { return false; }
}
