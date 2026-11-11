/* ══════════════════════════════════════════════════════════════════
   audio.js — 背景音乐

   全钢琴编制：左手低音、右手织体、一条独立的主旋律，都是钢琴音色。
   没有弦垫、没有锯齿波，只在每个音上叠一次极轻的击弦瞬态做点缀。

   音色用 PeriodicWave 定义泛音列（而不是三角波），三个亮度档随力度切换，
   接近真实钢琴"弹得重→泛音多→更亮"的行为。

   结构：32 小节，四段（引子 8 / 推进 8 / 高潮 8 / 退潮 8），
   和声 Am–F–C–G 每和弦两小节，主旋律在第 8 小节进入。
   ══════════════════════════════════════════════════════════════════ */

const BPM = 96;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

const CHORDS = [
  { root: 45, tones: [57, 60, 64, 69] },  /* Am */
  { root: 41, tones: [57, 60, 65, 69] },  /* F  */
  { root: 48, tones: [55, 60, 64, 67] },  /* C  */
  { root: 43, tones: [55, 59, 62, 67] }   /* G  */
];

/* 四段情绪：音符间隔 step、力度 vel、低音八度 oct、旋律开关 mel */
const FORM = [
  { bars: 8,  step: 4, vel: 0.34, oct: 0, mel: 0 },
  { bars: 8,  step: 2, vel: 0.56, oct: 1, mel: 1 },
  { bars: 8,  step: 1, vel: 0.86, oct: 1, mel: 1 },
  { bars: 8,  step: 3, vel: 0.38, oct: 1, mel: 0 }
];
const TOTAL_BARS = FORM.reduce((n, f) => n + f.bars, 0);

/* 主旋律：A 小调，八小节一句，[音高, 拍数] */
const MOTIF = [
  [69, 2], [72, 1], [71, 1],
  [72, 2], [69, 2],
  [65, 2], [69, 1], [72, 1],
  [71, 3], [67, 1],
  [69, 2], [72, 1], [74, 1],
  [76, 2], [74, 2],
  [72, 2], [69, 1], [67, 1],
  [69, 4]
];

/* 把旋律展开成「第几拍开始、持续几拍、什么音」 */
const MOTIF_EVENTS = (() => {
  let b = 0;
  return MOTIF.map(([m, d]) => {
    const e = { b, m, d };
    b += d;
    return e;
  });
})();
const MOTIF_BEATS = MOTIF.reduce((n, [, d]) => n + d, 0);
const MEL_START = FORM[0].bars;

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

export function createMusic({ volume = 0.55 } = {}) {
  const src = document.documentElement.dataset.track || '';
  const light = matchMedia('(max-width: 860px)').matches;

  let ctx = null, master = null, wet = null, timer = 0;
  let bar = 0, nextTime = 0;
  let started = false, muted = false;
  let audioEl = null;
  let waves = null;
  const listeners = new Set();

  let running = () => false;
  const emit = () => listeners.forEach(fn => fn({ playing: started && !muted && running(), started, muted }));

  function impulse(c, seconds = 2.6, decay = 2.7) {
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

  /* 泛音列：tilt 越小越亮。钢琴的泛音大致按 n^-1.2 ~ n^-1.6 衰减 */
  function pianoWave(tilt) {
    const n = 26;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const fall = Math.pow(i, -tilt);
      /* 第 7、9 次泛音略突出，是钢琴"金属感"的来源 */
      const accent = (i === 7 || i === 9) ? 1.45 : 1;
      imag[i] = fall * accent;
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function buildGraph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    /* 总线上先做一次三段均衡：低音补一点、中低切一点、高音提一点 */
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 130;
    lowShelf.gain.value = 2.5;

    const mud = ctx.createBiquadFilter();
    mud.type = 'peaking';
    mud.frequency.value = 380;
    mud.Q.value = 0.9;
    mud.gain.value = -2.8;

    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 5200;
    air.gain.value = 1.8;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -19;
    comp.knee.value = 22;
    comp.ratio.value = 2.6;
    comp.attack.value = 0.008;
    comp.release.value = 0.25;

    master = ctx.createGain();
    master.gain.value = 0;

    const rev = ctx.createConvolver();
    rev.buffer = impulse(ctx);
    wet = ctx.createGain();
    wet.gain.value = 0.24;

    master.connect(lowShelf);
    lowShelf.connect(mud);
    mud.connect(air);
    air.connect(comp);
    master.connect(wet);
    wet.connect(rev);
    rev.connect(comp);
    comp.connect(ctx.destination);

    waves = {
      soft: pianoWave(1.55),
      mid: pianoWave(1.25),
      bright: pianoWave(1.0)
    };
    return true;
  }

  /* ── 钢琴：泛音列振荡器 + 极轻的击弦瞬态 ── */
  function piano(time, midi, dur, vel, pan = 0) {
    const f = mtof(midi);
    const wave = vel > 0.62 ? waves.bright : vel > 0.4 ? waves.mid : waves.soft;

    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = f;
    /* 轻微失谐的第二振荡器，模拟同音三根弦的拍频 */
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f;
    o2.detune.value = rand(2, 6);

    const g = ctx.createGain();
    const g2 = ctx.createGain();
    g2.gain.value = 0.22;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(14000, 1400 + vel * 6500 + f * 1.6);
    lp.Q.value = 0.35;

    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    const peak = Math.max(0.0003, vel * 0.34);
    const body = Math.max(0.16, dur);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.004);
    g.gain.exponentialRampToValueAtTime(peak * 0.30, time + body * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, time + body);

    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(lp);
    if (panner) { panner.pan.value = pan; lp.connect(panner); panner.connect(master); }
    else lp.connect(master);

    o.start(time); o2.start(time);
    o.stop(time + body + 0.05); o2.stop(time + body + 0.05);

    /* 击弦瞬态：10ms 的带通噪声，给音头一点颗粒 */
    if (vel > 0.45) {
      const nlen = Math.floor(ctx.sampleRate * 0.012);
      const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nlen);
      const ns = ctx.createBufferSource();
      ns.buffer = nb;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = Math.min(6000, f * 3.2);
      nf.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.value = vel * 0.035;
      ns.connect(nf); nf.connect(ng); ng.connect(master);
      ns.start(time);
    }
  }

  /* 低音也是钢琴，只是更低、更长、稍偏左 */
  function bass(time, midi, dur, vel) {
    piano(time, midi, dur, Math.min(0.72, vel * 0.9), -0.22);
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
    const i32 = index % TOTAL_BARS;

    /* 低音：根音 + 五度，长音铺底 */
    bass(t, ch.root, BAR * 0.95, sec.vel * 0.8);
    if (sec.step <= 2) bass(t + BEAT * 2, ch.root + 7, BEAT * 1.4, sec.vel * 0.42);

    /* 织体：上行四音再折回，重音落在一三拍 */
    const shape = [0, 1, 2, 3, 2, 1, 0, 1];
    for (let i = 0; i < 16; i += sec.step) {
      const midi = ch.tones[shape[i % 8]] + 12;
      const accent = i % 4 === 0 ? 1 : 0.66;
      const rise = 0.84 + 0.16 * (i / 15);
      piano(t + i * stepDur + rand(-0.004, 0.004), midi, stepDur * 3.2,
        sec.vel * accent * rise * rand(0.92, 1.06), 0.12);
    }

    /* 高潮段：右手加一层高八度的弱奏，厚度靠层数而不是音量 */
    if (sec.mel && sec.step === 1 && !light) {
      for (let i = 4; i < 16; i += 4) {
        piano(t + i * stepDur, ch.tones[shape[i % 8]] + 24, stepDur * 2.2, sec.vel * 0.30, -0.18);
      }
    }

    /* 主旋律：八小节一句，按预计算的拍位落音 */
    if (sec.mel) {
      const beatsIn = ((index - MEL_START) * 4 % MOTIF_BEATS + MOTIF_BEATS) % MOTIF_BEATS;
      const lift = (i32 >= 16 && i32 < 24) ? 12 : 0;   /* 高潮段整体提八度 */
      for (const e of MOTIF_EVENTS) {
        const local = e.b - beatsIn;
        if (local < 0 || local >= 4) continue;
        piano(t + local * BEAT, e.m + lift, BEAT * e.d * 1.05, sec.vel * 0.95, 0);
      }
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
    bar = 0;
    nextTime = ctx.currentTime + 0.12;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(muted ? 0.0001 : volume * 0.5, ctx.currentTime + 2.4);
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
