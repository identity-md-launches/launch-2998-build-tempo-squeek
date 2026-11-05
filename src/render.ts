import { PLAYER_X, random } from './game.ts';
import type { Entity, GameState } from './game.ts';

const TAU = Math.PI * 2;

/** Every game visual is drawn here; no image, sprite, or network asset is used. */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 1000;
  private height = 414;
  private scale = 1;
  private ground = 340;
  private reducedMotion: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not create the game canvas.');
    this.ctx = ctx;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => { this.reducedMotion = e.matches; });
    this.resize();
  }

  resize(): void {
    const box = this.canvas.getBoundingClientRect();
    this.width = box.width;
    this.height = box.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = this.width / (this.width < 640 ? 650 : 1000);
    this.ground = this.height * 0.82;
  }

  draw(state: GameState): void {
    const c = this.ctx;
    const w = this.width;
    const h = this.height;
    const nap = state.phase === 'NAP' && state.status === 'running';
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#191b15';
    c.fillRect(0, 0, w, h);
    this.landscape(state, nap);
    const floor = this.ground;

    c.fillStyle = nap ? '#24252a' : '#24291c';
    c.fillRect(0, floor, w, h - floor);
    c.fillStyle = nap ? '#686373' : '#686d41';
    c.fillRect(0, floor, w, 2);
    c.fillStyle = nap ? '#36343b' : '#353b25';
    c.fillRect(0, floor + 3, w, 8);
    const travel = this.reducedMotion ? 0 : state.scenery * this.scale;
    c.fillStyle = nap ? '#45424c' : '#464c30';
    for (let x = -(travel % 74); x < w; x += 74) c.fillRect(x, floor + 5, 35, 2);
    c.strokeStyle = '#303526';
    c.lineWidth = 1;
    for (let x = -(travel % 130); x < w; x += 130) {
      c.beginPath(); c.moveTo(x + 10, floor + 16); c.lineTo(x + 56, floor + 16); c.stroke();
    }

    if (state.status === 'ready') {
      this.cheese(w * 0.59, floor - 38 * this.scale, this.scale * 1.1, false);
      this.cheese(w * 0.67, floor - 64 * this.scale, this.scale * 1.1, false);
      this.hurdle(w * 0.78, floor, this.scale, false);
      this.grass(w * 0.9, floor, this.scale, '#73794a');
    } else {
      for (const entity of state.entities) this.entity(entity, state);
    }

    const px = (PLAYER_X + 23) * this.scale;
    const py = floor - (state.playerY + (state.duck ? 16 : 27)) * this.scale;
    if (state.status === 'running' || state.status === 'ready') {
      const radius = (state.duck ? 36 : 45) * this.scale;
      c.strokeStyle = state.beatFlash ? '#f6ce69' : nap ? '#81758f' : '#555a37';
      c.lineWidth = state.beatFlash ? 3 : 1;
      c.beginPath(); c.arc(px, py, radius, 0, TAU); c.stroke();
      if (state.status === 'running' && !nap) {
        c.strokeStyle = '#efbe4b'; c.lineWidth = 2;
        c.beginPath(); c.arc(px, py, radius, -Math.PI / 2, -Math.PI / 2 + state.beat * TAU); c.stroke();
      }
      if (state.beatFlash && !this.reducedMotion) {
        c.strokeStyle = '#efbe4b55'; c.lineWidth = 1;
        c.beginPath(); c.arc(px, py, radius + 8 * this.scale, 0, TAU); c.stroke();
      }
    }

    c.fillStyle = '#0c0f0b55';
    c.beginPath(); c.ellipse(px, floor + 3, 29 * this.scale, 5 * this.scale, 0, 0, TAU); c.fill();
    c.save();
    if (state.invulnerable > 0) c.globalAlpha = 0.65;
    this.hamster((PLAYER_X + 23) * this.scale, floor - state.playerY * this.scale, this.scale, state);
    c.restore();
    this.canvas.dataset.action = state.playerY > 0.5 ? 'jump' : state.duck ? 'duck' : 'run';
  }

  private landscape(state: GameState, nap: boolean): void {
    const c = this.ctx, w = this.width, h = this.height;
    const shift = this.reducedMotion ? 0 : state.scenery * this.scale;
    const rng = random(7251);
    c.fillStyle = '#c3bd8150';
    for (let i = 0; i < 30; i++) {
      const x = rng() * w, y = 12 + rng() * h * 0.6;
      const r = rng() > 0.8 ? 1.6 : 0.8;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }

    const cx = w * 0.82, cy = h * 0.46, radius = Math.min(w * 0.18, h * 0.36);
    c.save(); c.translate(cx, cy);
    c.strokeStyle = nap ? '#4d475a' : '#4b4d2d';
    c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, radius, 0, TAU); c.stroke();
    c.beginPath(); c.arc(0, 0, radius - 9, 0, TAU); c.stroke();
    c.strokeStyle = nap ? '#3d3947' : '#393d26';
    c.lineWidth = 5;
    c.beginPath(); c.arc(0, 0, radius - 4.5, 0, TAU); c.stroke();
    c.rotate(this.reducedMotion ? 0 : state.wheelAngle * 0.25);
    c.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const angle = i / 12 * TAU;
      c.beginPath(); c.moveTo(Math.cos(angle) * 10, Math.sin(angle) * 10);
      c.lineTo(Math.cos(angle) * (radius - 9), Math.sin(angle) * (radius - 9)); c.stroke();
    }
    c.fillStyle = nap ? '#615770' : '#7e7840';
    c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill();
    c.restore();

    c.strokeStyle = nap ? '#4d475a' : '#4b4d2d';
    c.beginPath(); c.moveTo(cx - radius * 0.25, cy + radius + 12); c.lineTo(cx, cy); c.lineTo(cx + radius * 0.25, cy + radius + 12); c.stroke();
    const hills: [string, number, number][] = [
      [nap ? '#23232a' : '#22271b', 0.64, 0.04],
      [nap ? '#2a2930' : '#2b301e', 0.73, 0.08],
    ];
    for (const [color, level, rate] of hills) {
      c.fillStyle = color;
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w + 16; x += 16) {
        const y = h * level + Math.sin((x + shift * rate) / (w * 0.17)) * 16
          + Math.cos((x + shift * rate) / (w * 0.3)) * 8;
        c.lineTo(x, y);
      }
      c.lineTo(w, h); c.closePath(); c.fill();
    }
    // Small seed stalks belong to the habitat, not a separate visual theme.
    const offset = shift * 0.2 % 230;
    for (let x = 55 - offset; x < w; x += 230) this.grass(x, this.ground, this.scale * 0.7, nap ? '#45414c' : '#4a5230');
  }

  private grass(x: number, ground: number, scale: number, color: string): void {
    const c = this.ctx;
    c.save(); c.translate(x, ground); c.scale(scale, scale);
    c.strokeStyle = color; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-1, -21, -10, -34);
    c.moveTo(1, 0); c.quadraticCurveTo(12, -25, 8, -48);
    c.moveTo(3, 0); c.quadraticCurveTo(20, -12, 21, -26); c.stroke();
    c.fillStyle = color;
    for (const [a, b, r] of [[-9, -32, -0.6], [9, -44, 0.3], [20, -24, 0.5]]) {
      c.beginPath(); c.ellipse(a!, b!, 3, 8, r!, 0, TAU); c.fill();
    }
    c.restore();
  }

  private entity(entity: Entity, state: GameState): void {
    const x = (entity.x - state.course) * this.scale;
    if (x < -100 || x > this.width + 100) return;
    const nap = state.phase === 'NAP';
    if (entity.kind === 'cheese' || entity.kind === 'dream') {
      const y = this.ground - (entity.y + entity.height / 2) * this.scale;
      this.ctx.save();
      if (nap && entity.kind === 'cheese') this.ctx.globalAlpha = 0.4;
      this.cheese(x + entity.width / 2 * this.scale, y, this.scale, entity.kind === 'dream');
      this.ctx.restore();
    } else if (entity.kind === 'hurdle') this.hurdle(x, this.ground, this.scale, nap);
    else {
      const c = this.ctx;
      c.save(); c.translate(x, this.ground); c.scale(this.scale, this.scale);
      c.strokeStyle = nap ? '#756c86' : '#8d8051'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(22, -110); c.lineTo(22, -148);
      c.moveTo(58, -110); c.lineTo(58, -144); c.stroke();
      c.fillStyle = nap ? '#514957' : '#6f6844';
      c.beginPath(); c.roundRect(0, -110, 80, 76, 9); c.fill();
      c.fillStyle = nap ? '#8c7b9e' : '#b1a367';
      c.beginPath(); c.roundRect(0, -54, 80, 20, [0, 0, 9, 9]); c.fill();
      c.strokeStyle = '#24251c'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(32, -44); c.lineTo(40, -38); c.lineTo(48, -44); c.stroke();
      c.strokeStyle = nap ? '#756c86' : '#8d8051'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(12, -91); c.lineTo(54, -91); c.moveTo(22, -80); c.lineTo(68, -80); c.stroke();
      c.restore();
    }
  }

  private hurdle(x: number, ground: number, scale: number, nap: boolean): void {
    const c = this.ctx;
    c.save(); c.translate(x, ground); c.scale(scale, scale);
    c.fillStyle = nap ? '#5c5262' : '#ae713f';
    c.beginPath(); c.roundRect(0, -44, 42, 44, [7, 7, 2, 2]); c.fill();
    c.fillStyle = nap ? '#8c7b9e' : '#db9d54';
    c.beginPath(); c.roundRect(0, -44, 42, 11, [7, 7, 0, 0]); c.fill();
    c.strokeStyle = nap ? '#b0a0bd' : '#f2c77f'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(14, -19); c.lineTo(21, -26); c.lineTo(28, -19); c.stroke();
    c.fillStyle = '#15170f55'; c.fillRect(5, -2, 32, 2);
    c.restore();
  }

  private cheese(x: number, y: number, scale: number, dream: boolean): void {
    const c = this.ctx;
    c.save(); c.translate(x, y); c.scale(scale, scale);
    if (dream) {
      c.strokeStyle = '#a99bc55c'; c.lineWidth = 1;
      c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.stroke();
      c.fillStyle = '#c8b9ef'; c.fillRect(22, -12, 3, 3); c.fillRect(-22, 9, 2, 2);
    }
    c.fillStyle = dream ? '#9d88bd' : '#d99e37';
    c.beginPath(); c.moveTo(-13, 8); c.lineTo(12, 8); c.lineTo(12, 13); c.lineTo(-13, 13); c.closePath(); c.fill();
    c.fillStyle = dream ? '#d6c7f6' : '#f6ce69';
    c.beginPath(); c.moveTo(-13, 8); c.lineTo(-6, -12); c.lineTo(12, 8); c.closePath(); c.fill();
    c.fillStyle = dream ? '#8d78ae' : '#b47c29';
    for (const [a, b, r] of [[-5, 2, 3], [4, 5, 2], [-5, -6, 1.5]]) {
      c.beginPath(); c.arc(a!, b!, r!, 0, TAU); c.fill();
    }
    c.restore();
  }

  private hamster(x: number, y: number, scale: number, state: GameState): void {
    const c = this.ctx;
    const moving = state.status === 'running' && state.phase === 'RUN' && !this.reducedMotion;
    const stride = moving && state.playerY === 0 ? Math.sin(state.elapsed * (9 + state.rpm / 10)) : 0;
    const duck = state.duck;
    c.save(); c.translate(x, y - (moving ? Math.abs(stride) * 1.5 : 0)); c.scale(scale, scale);
    if (duck) { c.translate(0, -1); c.scale(1.15, 0.56); }
    // Tail, back foot, and warm cinnamon coat.
    c.fillStyle = '#d5a183'; c.beginPath(); c.ellipse(-26, -14, 7, 5, -0.3, 0, TAU); c.fill();
    c.fillStyle = '#bd824f'; c.beginPath(); c.ellipse(-12 - stride * 7, -2, 10, 4, 0, 0, TAU); c.fill();
    c.fillStyle = '#d7a066'; c.beginPath(); c.ellipse(-1, -24, 25, 24, -0.1, 0, TAU); c.fill();
    c.fillStyle = '#f2d3a3'; c.beginPath(); c.ellipse(7, -19, 17, 17, 0.1, 0, TAU); c.fill();
    c.fillStyle = '#b78053'; c.beginPath(); c.arc(25, -44, 8, 0, TAU); c.fill();
    c.fillStyle = '#e1af79'; c.beginPath(); c.arc(17, -31, 20, 0, TAU); c.fill();
    c.fillStyle = '#d7a066'; c.beginPath(); c.arc(7, -46, 10, 0, TAU); c.fill();
    c.fillStyle = '#edbcb0'; c.beginPath(); c.arc(7, -46, 5.5, 0, TAU); c.fill();
    c.fillStyle = '#f2d3a3'; c.beginPath(); c.ellipse(29, -24, 13, 10, 0, 0, TAU); c.fill();
    c.fillStyle = '#24211a'; c.beginPath(); c.ellipse(25, -34, 2.7, 3.3, 0, 0, TAU); c.fill();
    c.fillStyle = '#fff4d8'; c.beginPath(); c.arc(26, -35, 0.9, 0, TAU); c.fill();
    c.fillStyle = '#4c3429'; c.beginPath(); c.ellipse(40, -26, 3, 2.5, 0, 0, TAU); c.fill();
    c.strokeStyle = '#9e7450'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(30, -22); c.lineTo(46, -20); c.moveTo(31, -20); c.lineTo(43, -16); c.stroke();
    c.fillStyle = '#e0a18a'; c.beginPath(); c.ellipse(21, -24, 4, 2.5, 0, 0, TAU); c.fill();
    // A small amber bandana echoes the beat ring.
    c.fillStyle = '#efbe4b'; c.beginPath(); c.moveTo(3, -17); c.lineTo(20, -13); c.lineTo(13, -8); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(3, -17); c.lineTo(-11, -18 + stride); c.lineTo(-5, -11); c.closePath(); c.fill();
    c.fillStyle = '#f2c78e'; c.beginPath(); c.ellipse(11 + stride * 7, -2, 10, 4, 0, 0, TAU); c.fill();
    c.fillStyle = '#d4a16b'; c.beginPath(); c.ellipse(12, -14, 7, 4, -0.3 + stride * 0.25, 0, TAU); c.fill();
    c.restore();
  }
}
