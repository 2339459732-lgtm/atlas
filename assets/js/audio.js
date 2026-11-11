/* ══════════════════════════════════════════════════════════════════
   audio.js — 背景音乐

   一段原创的钢琴循环，写法参照《Cornfield Chase》的织体：
   十六分音符的重复音型、缓慢上行的和声、靠力度与密度堆出高潮再退回来。
   旋律与配器都是自己写的（受版权保护的是那段录音和乐谱，不是这种写法）。

   结构：32 小节一个循环，分四段
     0–7   引子   稀疏、弱、只有高音区的零星音
     8–15  推进   音型加密，低音进入
    16–23  高潮   全密度、双八度、力度最强
    24–31  退潮   抽掉内声部，回到单音
   ══════════════════════════════════════════════════════════════════ */

const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

/* Am – F – C – G，每个和弦两小节 */
const CHORDS = [
  { root: 45, tones: [57, 60, 64, 69] },  /* Am */
  { root: 41, tones: [57, 60, 65, 69] },  /* F  */
  { root: 48, tones: [55, 60, 64, 67] },  /* C  */
  { root: 43, tones: [55, 59, 62, 67] }   /* G  */
];

/* 四段情绪曲线 */
const FORM = [
  { bars: 8,  step: 4, vel: 0.30, oct: 0, pad: 0.30 },  /* 引子 */
  { bars: 8,  step: 2, vel: 0.52, oct: 1, pad: 0.55 },  /* 推进 */
  { bars: 8,  step: 1, vel: 0.88, oct: 2, pad: 1.00 },  /* 高潮 */
  { bars: 8,  step: 3, vel: 0.34, oct: 1, pad: 0.45 }   /* 退潮 */
];
const TOTAL_BARS = FORM.reduce((n, f) => n + f.bars, 0);

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

export function createMusic({ volume = 0.55 } = {}) {
  /* 只有显式声明了音轨才去取外部文件，避免默认探测产生 404
     <html data-track="assets/audio/theme.mp3"> 即可接管播放 */
  const src = document.documentElement.dataset.track || '';
  const light = matchMedia('(max-width: 860px)').matches;

  let ctx = null, master = null, wet = null, timer = 0;
  let bar = 0, nextTime = 0;
  let started = false, muted = false;
  let audioEl = null;
  const listeners = new Set();

  let running = () => false;
  const emit = () => listeners.forEach(fn => fn({ playing: started && !muted && running(), started, muted }));

  /* ── 混响：噪声衰减造空间，不引入任何音频文件 ── */
  function impulse(c, seconds = 2.8, decay = 2.6) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function buildGraph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.28;

    const rev = ctx.createConvolver();
    rev.buffer = impulse(ctx);
    wet = ctx.createGain();
    wet.gain.value = 0.30;

    master.connect(comp);
    master.connect(wet);
    wet.connect(rev);
    rev.connect(comp);
    comp.connect(ctx.destination);
    return true;
  }

  /* ── 钢琴：四个泛音，高次泛音衰减更快，力度同时影响音量与亮度 ── */
  function piano(time, midi, dur, vel) {
    const f = mtof(midi);
    const parts = [
      { ratio: 1.0,   gain: 1.00, decay: 1.0 },
      { ratio: 2.002, gain: 0.46, decay: 0.72 },
      { ratio: 3.006, gain: 0.22, decay: 0.52 },
      { ratio: 4.012, gain: 0.10, decay: 0.38 }
    ];
    const bright = 900 + vel * 3600;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = bright;
    lp.Q.value = 0.5;
    lp.connect(master);

    const body = ctx.createGain();
    body.gain.value = 0.42;
    body.connect(lp);

    parts.forEach(p => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f * p.ratio;
      o.detune.value = rand(-4, 4);

      const peak = Math.max(0.0002, vel * 0.30 * p.gain);
      const d = Math.max(0.18, dur * p.decay);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, time + d);

      o.connect(g);
      g.connect(body);
      o.start(time);
      o.stop(time + d + 0.05);
    });
  }

  /* 低音：正弦 + 一点三角，尾音长 */
  function bass(time, midi, dur, vel) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = mtof(midi);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.26, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g);
    g.connect(master);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  /* 弦垫：只在有力度时出现，铺底不抢 */
  function pad(time, notes, dur, gain) {
    if (gain <= 0.01) return;
    notes.forEach((m, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      o.detune.value = (i - 1) * 7;
      lp.type = 'lowpass';
      lp.frequency.value = 760;
      lp.Q.value = 0.3;
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(gain * 0.035, time + dur * 0.45);
      g.gain.linearRampToValueAtTime(gain * 0.028, time + dur * 0.8);
      g.gain.linearRampToValueAtTime(0, time + dur);
      o.connect(lp); lp.connect(g); g.connect(master);
      o.start(time); o.stop(time + dur + 0.05);
    });
  }

  function sectionOf(index) {
    const i = index % TOTAL_BARS;
    let acc = 0;
    for (const f of FORM) {
      if (i < acc + f.bars) return f;
      acc += f.bars;
    }
    return FORM[0];
  }

  function scheduleBar(index, t) {
    const ch = CHORDS[Math.floor(index / 2) % CHORDS.length];
    const sec = sectionOf(index);
    const stepDur = BAR / 16;
    const local = index % sec.bars;

    /* 低音：每小节一次，高潮段在第 3 拍再加一次 */
    const bassVel = sec.vel * (0.7 + 0.3 * Math.min(1, sec.oct / 2));
    bass(t, ch.root, BAR * 0.95, bassVel);
    if (sec.oct >= 1) bass(t + BEAT * 2, ch.root + 12, BEAT * 1.5, bassVel * 0.45);

    /* 音型：上行四音再折回，第 1/3 拍重音 */
    const shape = [0, 1, 2, 3, 2, 1, 0, 1];
    for (let i = 0; i < 16; i++) {
      if (i % sec.step !== 0) continue;
      const idx = shape[i % 8];
      const octave = 12 * (sec.oct >= 2 && i % 8 >= 4 ? 2 : 1);
      const midi = ch.tones[idx] + octave;

      const accent = i % 4 === 0 ? 1 : 0.62;
      const rise = 0.82 + 0.18 * (i / 15);          /* 小节内轻微渐强 */
      const jitter = rand(-0.004, 0.004);
      piano(t + i * stepDur + jitter, midi, stepDur * 3.4, sec.vel * accent * rise * rand(0.9, 1.08));
    }

    /* 高潮段加一层高八度的弱音，织体更厚（手机上省掉，避免节点过多） */
    if (sec.oct >= 2 && !light) {
      for (let i = 0; i < 16; i += 2) {
        const midi = ch.tones[shape[i % 8]] + 24;
        piano(t + i * stepDur, midi, stepDur * 2.2, sec.vel * 0.26);
      }
    }

    /* 每两小节换一次和声垫 */
    if (index % 2 === 0) pad(t, ch.tones.map(m => m + 12), BAR * 2, sec.pad);

    /* 段落转折处给一个长音，像呼吸 */
    if (local === 0) {
      piano(t + BEAT * 0.5, ch.tones[3] + 12 + (sec.oct >= 2 ? 12 : 0), BAR * 1.6, sec.vel * 0.55);
    }
  }

  function tick() {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (nextTime < now) nextTime = now + 0.05;
    while (nextTime < now + 0.9) {
      scheduleBar(bar, nextTime);
      bar += 1;
      nextTime += BAR;
    }
  }

  running = () => (ctx ? ctx.state === 'running' : !!(audioEl && !audioEl.paused && !audioEl.ended));

  function startSynth() {
    if (!ctx && buildGraph() === false) return;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (started) return;
    started = true;
    nextTime = ctx.currentTime + 0.12;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(muted ? 0.0001 : volume * 0.5, ctx.currentTime + 2.6);
    clearInterval(timer);
    timer = setInterval(tick, 160);
    tick();
    emit();
  }

  async function hasFile() {
    if (!src) return false;
    try {
      const r = await fetch(src, { method: 'HEAD' });
      return r.ok && (r.headers.get('content-type') || '').startsWith('audio');
    } catch { return false; }
  }
  const fileReady = src ? hasFile() : Promise.resolve(false);

  async function start() {
    if (started) {
      if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch {} }
      if (audioEl && audioEl.paused && !muted) { try { await audioEl.play(); } catch {} }
      if (!muted && master && ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(volume * 0.5, ctx.currentTime, 0.5);
        emit();
      }
      return running();
    }
    if (await fileReady) {
      if (!audioEl) {
        audioEl = new Audio(src);
        audioEl.loop = true;
        audioEl.preload = 'auto';
        audioEl.volume = muted ? 0 : Math.min(1, volume);
      }
      try {
        await audioEl.play();
        started = true; muted = false;
        clearInterval(timer);
        emit();
        return true;
      } catch { return false; }
    }
    startSynth();
    return running();
  }

  function stop() {
    muted = true;
    if (audioEl) audioEl.pause();
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
    }
    emit();
  }

  async function toggle() {
    if (!started) { await start(); return started; }
    if (muted) {
      muted = false;
      if (audioEl) { audioEl.volume = Math.min(1, volume); audioEl.play().catch(() => {}); }
      if (ctx && master) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(volume * 0.5, ctx.currentTime, 0.4);
      }
      emit();
    } else {
      stop();
    }
    return started && !muted;
  }

  function armUnlock(onReady) {
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    const handler = async () => {
      const ok = await start();
      if (ok) {
        events.forEach(ev => window.removeEventListener(ev, handler, true));
        onReady?.();
      }
    };
    events.forEach(ev => window.addEventListener(ev, handler, { capture: true, passive: true }));
    return handler;
  }

  return {
    start,
    stop,
    toggle,
    armUnlock,
    isPlaying: () => started && !muted && running(),
    getBar: () => bar % TOTAL_BARS,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
