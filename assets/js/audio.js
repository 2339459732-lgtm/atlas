/* ══════════════════════════════════════════════════════════════════
   audio.js — 背景音乐

   优先播放 assets/audio/theme.mp3（你自己放进去的音频，需你持有版权），
   文件不存在时，用 Web Audio 现场合成一段同气质的循环：
   96 BPM、A 小调、十六分音符的重复音型 + 弦垫 + 低音，无外部资源、无缝不断。

   浏览器禁止无交互自动播放，这里做了两级兜底：
   1) 加载时先试 resume()/play()；
   2) 被拦下就挂一次性手势监听，用户第一次点击/触摸/滚动即开始，并显示提示。
   ══════════════════════════════════════════════════════════════════ */

const BPM = 96;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

/* 八个和弦的循环：Am – F – C – G，每个两小节 */
const CHORDS = [
  { root: 45, tones: [57, 60, 64], top: [69, 72, 76] }, /* Am */
  { root: 41, tones: [57, 60, 65], top: [65, 69, 72] }, /* F  */
  { root: 48, tones: [55, 60, 64], top: [67, 72, 76] }, /* C  */
  { root: 43, tones: [55, 59, 62], top: [67, 71, 74] }  /* G  */
];

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export function createMusic({ src = 'assets/audio/theme.mp3', volume = 0.55 } = {}) {
  let ctx = null, master = null, wet = null, timer = 0;
  let bar = 0, nextTime = 0;
  let started = false, muted = false;
  let audioEl = null;
  const listeners = new Set();

  const emit = () => listeners.forEach(fn => fn({ playing: started && !muted, started, muted }));

  /* ── 混响：用噪声衰减造一个 2.4 秒的空间，不引入任何音频文件 ── */
  function impulse(c, seconds = 2.4, decay = 2.8) {
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
    comp.threshold.value = -18;
    comp.ratio.value = 2.6;

    const rev = ctx.createConvolver();
    rev.buffer = impulse(ctx);
    wet = ctx.createGain();
    wet.gain.value = 0.26;

    master.connect(comp);
    master.connect(wet);
    wet.connect(rev);
    rev.connect(comp);
    comp.connect(ctx.destination);
    return true;
  }

  /* 钢琴式的音色：三角波 + 高八度正弦，快起音、指数衰减 */
  function pluck(time, freq, dur, gain, bright = 1500) {
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();

    o1.type = 'triangle';
    o2.type = 'sine';
    o1.frequency.value = freq;
    o2.frequency.value = freq * 2.004;

    lp.type = 'lowpass';
    lp.frequency.value = bright;
    lp.Q.value = 0.6;

    const g2 = ctx.createGain();
    g2.gain.value = 0.32;

    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(master);

    o1.start(time); o2.start(time);
    o1.stop(time + dur + 0.05); o2.stop(time + dur + 0.05);
  }

  /* 弦垫：慢起慢落，铺在底下 */
  function pad(time, notes, dur, gain) {
    notes.forEach((m, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      o.detune.value = (i - 1) * 6;
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.Q.value = 0.4;
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(gain, time + dur * 0.45);
      g.gain.linearRampToValueAtTime(gain * 0.8, time + dur * 0.85);
      g.gain.linearRampToValueAtTime(0, time + dur);
      o.connect(lp); lp.connect(g); g.connect(master);
      o.start(time); o.stop(time + dur + 0.02);
    });
  }

  function scheduleBar(index, t) {
    const ch = CHORDS[Math.floor(index / 2) % CHORDS.length];
    const phase = index % 8;

    /* 低音：每小节一个长音，第 3 拍轻点一次 */
    pluck(t, mtof(ch.root), BAR * 0.92, 0.16, 420);
    pluck(t + BEAT * 2, mtof(ch.root), BEAT * 1.6, 0.07, 380);

    /* 十六分音符音型：0 1 0 2 0 1 0 3 的重复母题 */
    const pat = [0, 1, 0, 2, 0, 1, 0, 3];
    const step = BAR / 16;
    for (let i = 0; i < 16; i++) {
      const p = pat[i % 8];
      const m = ch.top[Math.min(2, p)] + (p === 3 ? 12 : 0);
      const accent = i % 4 === 0 ? 1 : 0.62;
      const fadeIn = phase < 2 ? 0.55 : 1;   /* 前两小节轻一点，像从远处过来 */
      pluck(t + i * step, mtof(m), step * 3.2, 0.052 * accent * fadeIn, 2200);
    }

    /* 弦垫：每两小节换一次和弦 */
    if (index % 2 === 0) {
      pad(t, ch.tones.map(m => m + 12), BAR * 2, 0.030);
    }

    /* 高处一条很慢的旋律，四小节一句 */
    if (index % 4 === 0) {
      const mel = ch.top[2] + 12;
      pluck(t + BEAT, mtof(mel), BAR * 1.8, 0.05, 2600);
    }
  }

  function tick() {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (nextTime < now) nextTime = now + 0.05;
    while (nextTime < now + 0.7) {
      scheduleBar(bar, nextTime);
      bar += 1;
      nextTime += BAR;
    }
  }

  function startSynth() {
    if (!ctx && buildGraph() === false) return;   /* 浏览器不支持 Web Audio 时静默退出 */
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (started) return;
    started = true;
    nextTime = ctx.currentTime + 0.12;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(muted ? 0.0001 : volume * 0.5, ctx.currentTime + 2.4);
    clearInterval(timer);
    timer = setInterval(tick, 180);
    tick();
    emit();
  }

  /* ── 若存在外部音频文件，优先用它（可无缝 loop） ── */
  async function hasFile() {
    try {
      const r = await fetch(src, { method: 'HEAD' });
      return r.ok && (r.headers.get('content-type') || '').startsWith('audio');
    } catch { return false; }
  }

  /* 页面加载时就探测好，手势回调里不必再 await，保住用户激活 */
  const fileReady = hasFile();

  const running = () => (ctx ? ctx.state === 'running' : !!(audioEl && !audioEl.paused && !audioEl.ended));

  async function start() {
    /* 已启动但被浏览器挂起：在手势里补一次 resume */
    if (started) {
      if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch {} }
      if (audioEl && audioEl.paused && !muted) { try { await audioEl.play(); } catch {} }
      if (!muted) {
        if (master) {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setTargetAtTime(volume * 0.5, ctx.currentTime, 0.5);
        }
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
    return ctx ? ctx.state === 'running' : false;
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

  /* 被浏览器拦截时，等第一次手势 */
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
    isPlaying: () => started && !muted,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
