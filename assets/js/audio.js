/* ══════════════════════════════════════════════════════════════════
   audio.js — 背景音乐（合成器版，无音频文件依赖）

   目标不是复刻某一段旋律，而是把《Cornfield Chase》那类"极简动机 + 不断
   加层 + 缓慢推进"的写法搬过来：
     · 一条四小节的和声循环（Am–F–C–G）当骨架，始终不变，靠配器变化制造推进
     · 十六分音符的固定音型（ostinato）从第八小节进入，是全曲的心跳
     · 管风琴式的持续和弦铺在下面，负责"宏伟"；弦乐群负责"张力"
     · 低音用正弦波补 55Hz 的厚度，钢琴只做点描
   40 小节，五段：引子 8 / 建立 8 / 推进 8 / 高潮 8 / 退潮 8。

   循环：40 小节 = 10 个和声循环 = 5 个旋律乐句（8 小节），三者整除，
   循环点永远落在乐句与和声的同一相位上；末小节停在 G（bVII），
   回到第 0 小节的 Am 时是一个正格终止，听感上是"落回去"而不是"跳回去"。
   ══════════════════════════════════════════════════════════════════ */

const BPM = 92;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 40;

/* 四小节循环。bass 是低音区根音，tones 是四五声部的和声骨架，
   color 是这一段允许出现的色彩音（九音/十一音），用来做"悬而未决"的张力 */
const CHORDS = [
  { name: 'Am', root: 45, bass: 33, tones: [57, 60, 64, 69], color: 71 }, /* A C E A  +B */
  { name: 'F',  root: 41, bass: 29, tones: [53, 57, 60, 65], color: 67 }, /* F A C F  +G */
  { name: 'C',  root: 48, bass: 36, tones: [55, 60, 64, 67], color: 62 }, /* G C E G  +D */
  { name: 'G',  root: 43, bass: 31, tones: [55, 59, 62, 67], color: 69 }  /* G B D G  +A */
];

/* 十六分音符固定音型：和弦音的上下行折返，最高音落在每拍的第一格 */
const OST = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 3, 2, 1, 2];

/* 主旋律：八小节一句（32 拍），A 自然小调。
   第 4、8 小节都落在 G 和弦上，末音 F5 是 G 的七音，故意不解决——
   它把耳朵推向下一句的 E5，正好也是循环回 Am 时的落点。 */
const MELODY = [
  [76, 3], [74, 1],
  [72, 3], [69, 1],
  [72, 1], [74, 1], [76, 2],
  [79, 4],
  [76, 2], [74, 1], [72, 1],
  [69, 2], [72, 1], [74, 1],
  [76, 2], [79, 2],
  [77, 4]
];

const MEL_EVENTS = (() => {
  let b = 0;
  return MELODY.map(([m, d]) => { const e = { b, m, d }; b += d; return e; });
})();
const MEL_BEATS = MELODY.reduce((n, [, d]) => n + d, 0);   /* 32 拍 = 8 小节 */
const MEL_START = 8;                                        /* 第 8 小节进入 */
const MEL_END = 40;                                         /* 第 39 小节收尾 */

/* 力度曲线：整曲唯一的"情绪"，其余配器都按它取值 */
const ARC = [
  [0, 0.26], [7, 0.40], [8, 0.44], [15, 0.64],
  [16, 0.68], [23, 0.86], [24, 0.90], [28, 1.00],
  [31, 0.95], [32, 0.70], [39, 0.28]
];
function arcAt(bar) {
  for (let i = 1; i < ARC.length; i++) {
    if (bar <= ARC[i][0]) {
      const [b0, v0] = ARC[i - 1], [b1, v1] = ARC[i];
      const k = (bar - b0) / (b1 - b0 || 1);
      return v0 + (v1 - v0) * k;
    }
  }
  return ARC[ARC.length - 1][1];
}

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

/* ──────────────────────────────────────────────────────────────
   合成器：所有声音都挂在一个传入的 AudioContext 上，
   这样既能在页面里实时跑，也能在 OfflineAudioContext 里整段渲染出来校对。
   ────────────────────────────────────────────────────────────── */
export function createSynth(ctx, opts = {}) {
  const light = opts.light ?? false;
  const wetAmount = opts.wet ?? 0.30;

  /* ── 总线：低切 → 低频搁架 → 去浑浊 → 临场 → 空气 → 压缩 → 软削波 ── */
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 26;
  hp.Q.value = 0.7;

  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 95;
  low.gain.value = 3.2;

  const mud = ctx.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = 330;
  mud.Q.value = 0.8;
  mud.gain.value = -3.4;

  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2800;
  presence.Q.value = 0.9;
  presence.gain.value = 1.4;

  const air = ctx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 8600;
  air.gain.value = 1.1;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 26;
  comp.ratio.value = 2.6;
  comp.attack.value = 0.02;
  comp.release.value = 0.28;

  /* 压缩之后补一段增益，把整体响度提到 -1 dBFS 附近。
     这里不用 WaveShaper 做软削波：它的输入一旦超过 ±1 就会被裁在曲线端点，
     高潮处会留下一声"咔"。峰值交给 compressor 收，宁可少 2 dB 也不要爆音。 */
  const makeup = ctx.createGain();
  makeup.gain.value = 1.75;

  const master = ctx.createGain();
  master.gain.value = 0;

  const preDelay = ctx.createDelay(0.2);
  preDelay.delayTime.value = 0.035;
  const rev = ctx.createConvolver();
  rev.buffer = impulse(ctx, 4.4, 2.1);
  const wet = ctx.createGain();
  wet.gain.value = wetAmount;

  master.connect(hp);
  hp.connect(low); low.connect(mud); mud.connect(presence); presence.connect(air);
  air.connect(comp);

  master.connect(preDelay);
  preDelay.connect(rev);
  rev.connect(wet);
  wet.connect(comp);

  comp.connect(makeup);
  makeup.connect(ctx.destination);

  /* 分轨总线：钢琴 / 铺底 / 低音，各自一个音量，方便按段落做配器 */
  const busPiano = ctx.createGain(); busPiano.gain.value = 1.0; busPiano.connect(master);
  const busPad = ctx.createGain(); busPad.gain.value = 1.0; busPad.connect(master);
  const busLow = ctx.createGain(); busLow.gain.value = 1.0; busLow.connect(master);

  /* ── 音色 ── */
  /* 钢琴泛音列：tilt 越小越亮。7/9 次泛音略突出，是钢琴"金属感"的来源 */
  function harmonicWave(tilt, accent) {
    const n = 28;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      let a = Math.pow(i, -tilt);
      if (i === 7 || i === 9) a *= accent;
      if (i === 2) a *= 1.05;
      imag[i] = a;
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  /* 管风琴音栓：只留 1/2/3/4/6/8 次泛音，接近 8'+4'+2'+Mixture 的叠加 */
  function organWave() {
    const n = 18;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    const stops = { 1: 1.0, 2: 0.62, 3: 0.34, 4: 0.30, 6: 0.14, 8: 0.17, 12: 0.07, 16: 0.05 };
    for (const k in stops) imag[+k] = stops[k];
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  const waves = {
    soft: harmonicWave(1.85, 1.15),
    mid: harmonicWave(1.50, 1.35),
    bright: harmonicWave(1.18, 1.55),
    organ: organWave()
  };

  /* ── 乐器 ── */

  /* 钢琴：两个振荡器（第二根"弦"轻微失谐产生拍频）+ 两段衰减 + 击弦噪声 */
  function piano(t, midi, dur, vel, pan = 0) {
    const f = mtof(midi);
    const wave = vel > 0.60 ? waves.bright : vel > 0.36 ? waves.mid : waves.soft;

    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = f;

    const o2 = ctx.createOscillator();
    o2.setPeriodicWave(wave);
    o2.frequency.value = f;
    o2.detune.value = rand(3, 7);

    const mix = ctx.createGain();
    const g2 = ctx.createGain();
    g2.gain.value = 0.30;
    o.connect(mix);
    o2.connect(g2); g2.connect(mix);

    const g = ctx.createGain();
    const peak = Math.max(0.0004, vel * 0.26);
    const body = Math.max(0.22, dur * 1.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    /* 两段衰减：先快后慢，接近真实钢琴的"敲击 + 余韵" */
    g.gain.exponentialRampToValueAtTime(peak * 0.34, t + Math.min(0.34, body * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + body);

    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    mix.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(busPiano); }
    else g.connect(busPiano);

    o.start(t); o2.start(t);
    o.stop(t + body + 0.05); o2.stop(t + body + 0.05);
    o.onended = () => { try { mix.disconnect(); g.disconnect(); p && p.disconnect(); } catch {} };

    /* 击弦瞬态：8ms 带通噪声，力度越大越明显 */
    if (vel > 0.30) {
      const nlen = Math.max(24, Math.floor(ctx.sampleRate * 0.008));
      const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nlen);
      const ns = ctx.createBufferSource();
      ns.buffer = nb;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = Math.min(7000, f * 3.4);
      nf.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.value = vel * vel * 0.02;
      ns.connect(nf); nf.connect(ng); ng.connect(busPiano);
      ns.start(t);
    }
  }

  /* 管风琴：每个音两根轻微失谐的管子，慢起音、慢收音，负责"宏伟" */
  function organ(t, notes, dur, gain) {
    if (gain <= 0.004) return;
    const atk = 0.42;
    const rel = 0.9;
    notes.forEach((m, i) => {
      for (let d = 0; d < (light ? 1 : 2); d++) {
        const o = ctx.createOscillator();
        o.setPeriodicWave(waves.organ);
        o.frequency.value = mtof(m);
        o.detune.value = (d ? 6 : -5) + (i - 1.5) * 1.2;

        const g = ctx.createGain();
        const amp = gain * (i === 0 ? 0.030 : 0.021);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(amp, t + atk);
        g.gain.setValueAtTime(amp, t + Math.max(atk, dur - rel));
        g.gain.linearRampToValueAtTime(0.0001, t + dur);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2100 + i * 260;
        lp.Q.value = 0.5;

        o.connect(lp); lp.connect(g); g.connect(busPad);
        o.start(t); o.stop(t + dur + 0.08);
      }
    });
  }

  /* 弦乐群：锯齿波 + 低通 + 慢起音 + 颤音，负责"张力" */
  function strings(t, notes, dur, gain, open = 0.4) {
    if (gain <= 0.004 || light) return;
    const atk = Math.max(0.6, dur * 0.35);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4.7;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 5.5;
    lfo.connect(lfoAmt);

    notes.forEach((m, i) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.7;
      const fc = 620 + 2400 * clamp(open, 0, 1);
      lp.frequency.setValueAtTime(fc * 0.45, t);
      lp.frequency.linearRampToValueAtTime(fc, t + atk * 1.6);

      const g = ctx.createGain();
      const amp = gain * 0.020 / Math.sqrt(notes.length);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp, t + atk);
      g.gain.setValueAtTime(amp, t + Math.max(atk, dur - dur * 0.25));
      g.gain.linearRampToValueAtTime(0.0001, t + dur);

      for (let d = 0; d < 2; d++) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = (d ? 8 : -8) + (i - 1.5) * 2;
        lfoAmt.connect(o.detune);
        o.connect(lp);
        o.start(t); o.stop(t + dur + 0.1);
      }
      lp.connect(g); g.connect(busPad);
    });
    lfo.start(t); lfo.stop(t + dur + 0.1);
  }

  /* 低音：正弦波补厚度，+ 一个八度的三角波给"轮廓"，听不见但摸得着。
     时值故意超出一小节（BAR*1.25），让前后两小节的低音交叠，
     循环点上不会出现"前一拍收干、后一拍才起"的空洞。 */
  function sub(t, midi, dur, gain) {
    if (gain <= 0.004) return;
    const atk = 0.30;
    [0, 12].forEach((up, i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'triangle' : 'sine';
      o.frequency.value = mtof(midi + up);
      const g = ctx.createGain();
      const amp = gain * (i ? 0.045 : 0.16);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp, t + atk);
      g.gain.setValueAtTime(amp, t + dur * 0.66);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(busLow);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }

  /* 定音鼓：音高下滑 + 低频噪声，只在高潮的强拍上点一下 */
  function timpani(t, midi, gain) {
    if (gain <= 0.004) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = mtof(midi);
    o.frequency.setValueAtTime(f * 1.35, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * 0.30, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    o.connect(g); g.connect(busLow);
    o.start(t); o.stop(t + 2.0);

    const nlen = Math.floor(ctx.sampleRate * 0.09);
    const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 2);
    const ns = ctx.createBufferSource();
    ns.buffer = nb;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 380;
    const ng = ctx.createGain();
    ng.gain.value = gain * 0.10;
    ns.connect(nf); nf.connect(ng); ng.connect(busLow);
    ns.start(t);
  }

  /* 大锣：非谐分音，给高潮第一拍一个"砸下来"的瞬间 */
  function tam(t, midi, gain) {
    if (gain <= 0.004) return;
    const f = mtof(midi);
    [[1, 1.0, 4.2], [2.76, 0.5, 2.6], [5.40, 0.28, 1.6], [8.93, 0.14, 0.9]].forEach(([mul, amp, dec]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain * 0.09 * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(busPad);
      o.start(t); o.stop(t + dec + 0.05);
    });
  }

  /* 上行噪声：两小节的涨潮，把耳朵推到下一段 */
  function riser(t, dur, gain) {
    if (gain <= 0.004 || light) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource();
    s.buffer = b;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * 0.05, t + dur * 0.92);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.connect(bp); bp.connect(g); g.connect(busPad);
    s.start(t);
  }

  /* ── 编曲 ── */
  function scheduleBar(index, t) {
    const bar = ((index % BARS) + BARS) % BARS;
    const chord = CHORDS[bar % 4];
    const v = arcAt(bar);
    const s16 = BAR / 16;

    const inA = bar < 8;
    const inB = bar >= 8 && bar < 16;
    const inC = bar >= 16 && bar < 24;
    const inD = bar >= 24 && bar < 32;
    const inE = bar >= 32;

    /* 低音：每小节一个长音，第 3 拍补一个五度；高潮段加八度叠奏。
       时值给到 1.3 小节，前后交叠，循环点不会掉进静音里 */
    sub(t, chord.bass, BAR * 1.30, 0.35 + v * 0.75);
    if (!inA) sub(t, chord.bass + 19, BEAT * 1.6, 0.10 + v * 0.18);

    /* 管风琴：两小节一次换和声，起音比小节线稍早一点点，听起来像"呼吸" */
    if (bar % 2 === 0) {
      const voicing = chord.tones.map(m => m + 12);
      voicing.push(chord.root + 24);
      organ(t, voicing, BAR * 2 + 0.55, clamp(v * 1.05, 0, 1));
    }

    /* 弦乐：第 12 小节就悄悄进来，只留一点空气；推进段之后逐步打开低通，
       到高潮时整组弦乐已经"亮"开了——推进感主要来自这个缓慢的音色变化 */
    if ((inB && bar >= 12) || inC || inD || (inE && bar < 36)) {
      const open = clamp((v - 0.42) / 0.55, 0.05, 1);
      strings(t, [chord.root + 24, chord.tones[1] + 12, chord.tones[2] + 12], BAR * (inD ? 1.35 : 1.1),
        clamp(v * 1.1, 0, 1), open);
    }
    /* 退潮的最后两小节：弦乐不再断，直接把 G 拖过循环点，接住下一个 Am */
    if (bar === 38) {
      strings(t, [chord.root + 24, chord.tones[2] + 12, chord.tones[3] + 12], BAR * 2.4, 0.30, 0.25);
    }

    /* 固定音型：建立段是八分，推进/高潮是十六分，退潮回到八分并逐渐消失 */
    const step = (inB || inE) ? 2 : 1;
    const ostOn = !inA && bar < 36;
    if (ostOn) {
      for (let i = 0; i < 16; i += step) {
        const idx = OST[i % 16];
        const midi = chord.tones[idx] + 12;
        const accent = i % 4 === 0 ? 1 : 0.62;
        const lift = 0.86 + 0.14 * (i / 15);
        piano(t + i * s16 + rand(-0.006, 0.006), midi, s16 * (inD ? 4.2 : 5.4),
          v * accent * lift * rand(0.9, 1.08), 0.14);
      }
      /* 高潮段：每拍再叠一个高八度，厚度靠层数而不是音量 */
      if (inD && !light) {
        for (let i = 0; i < 16; i += 4) {
          piano(t + i * s16, chord.tones[OST[i % 16]] + 24, s16 * 2.4, v * 0.34, -0.20);
        }
      }
    }

    /* 低音钢琴：每小节第一拍点一下根音，给固定音型一个"地基" */
    if (!inA && bar % 2 === 0) {
      piano(t, chord.bass + 12, BEAT * 3.2, v * 0.62, -0.24);
    }

    /* 主旋律：第 8 小节进入，四个八小节乐句正好铺到第 39 小节 */
    if (bar >= MEL_START && bar < MEL_END) {
      const beatsIn = (((index - MEL_START) * 4) % MEL_BEATS + MEL_BEATS) % MEL_BEATS;
      const octUp = inD ? 12 : 0;
      for (const e of MEL_EVENTS) {
        const local = e.b - beatsIn;
        if (local < 0 || local >= 4) continue;
        const at = t + local * BEAT;
        const dur = BEAT * e.d * 1.08;
        piano(at, e.m + octUp, dur, v * 0.98, 0);
        /* 高潮段让管风琴把旋律也吹一遍，音色一下子"变宽" */
        if (inD && e.d >= 2) organ(at, [e.m + 12], dur * 0.96, v * 0.42);
        /* 乐句尾音加一个高八度的弱奏，像远处有人应了一声 */
        if (e.d >= 3) piano(at + 0.02, e.m + 24, dur * 0.8, v * 0.22, 0.26);
      }
    }

    /* 定音鼓：推进段每两小节一次，高潮段每小节两次 */
    if (inC && bar % 2 === 0) timpani(t, chord.bass + 12, v * 0.55);
    if (inD) {
      timpani(t, chord.bass + 12, v * 0.60);
      timpani(t + BEAT * 2, chord.bass + 12, v * 0.45);
    }

    /* 段落转折点：第 24 小节砸大锣，第 22、30 小节起涨潮 */
    if (bar === 24) tam(t, chord.bass + 24, v);
    if (bar === 22) riser(t, BAR * 2, 0.9);
    if (bar === 30) riser(t, BAR * 2, 0.55);

    /* 退潮段：旋律交给钢琴独奏，配器一层层撤掉，只剩混响在响 */
    if (bar >= 36 && bar % 2 === 0) {
      piano(t + BEAT * 2, (chord.tones[1] + 12), BEAT * 1.6, v * 0.5, 0.08);
    }
  }

  return {
    master, scheduleBar, bars: BARS, barSeconds: BAR,
    setVolume(v) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(Math.max(0.0001, v), now, 0.4);
    },
    fadeIn(v, seconds = 2.6) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), now + seconds);
    },
    fadeOut(seconds = 0.5) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0.0001, now, seconds / 3);
    }
  };
}

/* 混响脉冲：指数衰减的噪声 + 前 30ms 的早期反射，比纯噪声更"有房间" */
function impulse(c, seconds, decay) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const x = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, decay);
    }
    /* 早期反射：几个离散的短脉冲，避免混响听起来像"糊了一层" */
    [0.011, 0.019, 0.031, 0.047, 0.071].forEach((s, k) => {
      const idx = Math.floor(s * c.sampleRate) + (ch ? 37 : 0);
      if (idx < len) d[idx] += (k % 2 ? -1 : 1) * 0.35 / (k + 1);
    });
  }
  return buf;
}

/* ──────────────────────────────────────────────────────────────
   页面用：实时调度器
   ────────────────────────────────────────────────────────────── */
export function createMusic({ volume = 0.5 } = {}) {
  const src = document.documentElement.dataset.track || '';
  const light = matchMedia('(max-width: 860px)').matches;

  let ctx = null, synth = null, timer = 0;
  let bar = 0, nextTime = 0;
  let started = false, muted = false;
  let audioEl = null;
  const listeners = new Set();

  const running = () => (ctx ? ctx.state === 'running'
    : !!(audioEl && !audioEl.paused && !audioEl.ended));
  const emit = () => listeners.forEach(fn => fn({ playing: started && !muted && running(), started, muted }));

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    synth = createSynth(ctx, { light });
    return true;
  }

  /* 提前 2.8 秒排程：标签页被降频时也不会在两次 tick 之间断掉。
     真的落后了就整小节跳过（而不是把 nextTime 拉回 now），
     这样和声与旋律的相位永远对得上，不会出现半拍错位。 */
  function tick() {
    if (!ctx || !synth) return;
    const now = ctx.currentTime;
    if (nextTime < now) {
      const skip = Math.floor((now - nextTime) / BAR) + 1;
      bar += skip;
      nextTime += skip * BAR;
      if (nextTime < now + 0.05) nextTime = now + 0.05;
    }
    while (nextTime < now + 2.8) {
      synth.scheduleBar(bar, nextTime);
      bar += 1;
      nextTime += BAR;
    }
  }

  function startSynth() {
    if (!synth && build() === false) return;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (started) return;
    started = true;
    bar = 0;
    nextTime = ctx.currentTime + 0.15;
    synth.fadeIn(muted ? 0.0001 : volume, 3.2);
    clearInterval(timer);
    timer = setInterval(tick, 320);
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
      if (!muted && synth) {
        synth.master.gain.cancelScheduledValues(ctx.currentTime);
        synth.master.gain.setTargetAtTime(volume, ctx.currentTime, 0.5);
        emit();
      }
      return running();
    }
    /* 如果站点提供了真实音频文件（data-track），优先用它，合成器只做兜底 */
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
    if (synth) synth.fadeOut(0.6);
    emit();
  }

  async function toggle() {
    if (!started) { await start(); return started; }
    if (muted) {
      muted = false;
      if (audioEl) { audioEl.volume = Math.min(1, volume); audioEl.play().catch(() => {}); }
      if (synth) synth.setVolume(volume);
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

  /* 切回前台时补一次排程，避免后台被限频后开头空掉一小节 */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && started && !muted) tick();
  });

  return {
    start,
    stop,
    toggle,
    armUnlock,
    isPlaying: () => started && !muted && running(),
    getBar: () => bar % BARS,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
