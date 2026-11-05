/** Optional, locally synthesized sound. The visual game never depends on audio. */
export class GameAudio {
  enabled = false;
  private context: AudioContext | null = null;

  async toggle(): Promise<boolean> {
    if (this.enabled) { this.enabled = false; return false; }
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
      this.enabled = true;
      this.tone(660, 0.06, 0.035);
      return true;
    } catch { this.enabled = false; return false; }
  }

  play(type: 'beat' | 'perfect' | 'cheese' | 'dream' | 'hit' | 'phase' | 'finish'): void {
    if (!this.enabled) return;
    if (type === 'beat') this.tone(330, 0.045, 0.025);
    else if (type === 'hit') this.tone(125, 0.12, 0.045, 'triangle');
    else if (type === 'perfect') { this.tone(880, 0.09, 0.04); this.tone(1320, 0.14, 0.03, 'sine', 0.07); }
    else if (type === 'cheese' || type === 'dream') this.tone(type === 'dream' ? 520 : 660, 0.1, 0.035);
    else if (type === 'finish') { this.tone(523, 0.15, 0.035); this.tone(659, 0.2, 0.035, 'sine', 0.12); this.tone(784, 0.3, 0.035, 'sine', 0.24); }
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const time = ctx.currentTime + delay;
    oscillator.frequency.value = frequency;
    oscillator.type = type;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain); gain.connect(ctx.destination);
    oscillator.start(time); oscillator.stop(time + duration + 0.01);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
