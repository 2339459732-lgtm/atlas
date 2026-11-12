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
  /* 阈值抬高、比例降低：引子要能"轻"下去，否则整首都在同一个响度上，
     高潮再叠乐器也不觉得大。真正的峰值交给末级限幅。 */
  comp.threshold.value = -16;
  comp.knee.value = 20;
  comp.ratio.value = 2.2;
  comp.attack.value = 0.02;
  comp.release.value = 0.28;

  /* 压缩之后补一段增益，把整体响度提到 -1 dBFS 附近。
     这里不用 WaveShaper 做软削波：它的输入一旦超过 ±1 就会被裁在曲线端点，
     高潮处会留下一声"咔"。峰值交给 compressor 收，宁可少 2 dB 也不要爆音。 */
  const makeup = ctx.createGain();
  makeup.gain.value = 1.58;

  /* 末级限幅：高潮段叠了铜管 + 低音簇 + 大锣，峰值很容易冲过 1。
     用高压缩比 + 快启动把尖顶收住（不用 WaveShaper：输入端一旦超过 ±1
     就会被裁在曲线端点，反而留下咔声）。 */
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -5;
  limit.knee.value = 2;
  limit.ratio.value = 18;
  limit.attack.value = 0.002;
  limit.release.value = 0.12;

  const master = ctx.createGain();
  master.gain.value = 0;

  const preDelay = ctx.createDelay(0.2);
  preDelay.delayTime.value = 0.035;
  const rev = ctx.createConvolver();
  rev.buffer = impulse(ctx, 4.4, 2.1);
  const wet = ctx.createGain();
  wet.gain.value = opts.dry ? 0.0001 : wetAmount;

  master.connect(hp);
  hp.connect(low); low.connect(mud); mud.connect(presence); presence.connect(air);
  air.connect(comp);

  master.connect(preDelay);
  preDelay.connect(rev);
  rev.connect(wet);
  wet.connect(comp);

  comp.connect(makeup);
  makeup.connect(limit);
  limit.connect(ctx.destination);

  /* 分轨总线：钢琴 / 铺底 / 低音，各自一个音量，方便按段落做配器 */
  const busPiano = ctx.createGain(); busPiano.gain.value = 1.0; busPiano.connect(master);
  const busPad = ctx.createGain(); busPad.gain.value = 1.0; busPad.connect(master);
  const busLow = ctx.createGain(); busLow.gain.value = 1.0; busLow.connect(master);

  /* ── 音色 ── */
  /* 钢琴不是"一个音 + 一条泛音列"，而是几组衰减速度不同的分音叠在一起：
     低次分音撑住音高与厚度，高次分音只负责击弦那一瞬间的"亮"。
     用一条包络统管全部泛音，听起来就是风琴——旧版的主要毛病在这里。 */
  const PIANO_BANKS = [
    { parts: [1, 2],            decay: 1.00, cents: 0.0, vexp: 0.28, gain: 1.00, strings: 2 },
    { parts: [3, 4, 5],         decay: 0.54, cents: 2.4, vexp: 0.70, gain: 0.82, strings: 1 },
    { parts: [6, 7, 8, 10],     decay: 0.32, cents: 5.2, vexp: 1.20, gain: 0.60, strings: 1 },
    { parts: [11, 13, 16, 20],  decay: 0.20, cents: 8.6, vexp: 1.80, gain: 0.42, strings: 1 }
  ];

  /* 击弦点在弦长 1/7~1/8 处，那个位置的泛音会被抵消：
     真实钢琴在 7、8 次泛音附近是"凹"的，不是凸的。
     旧版特意加强 7/9 次泛音，所以总带一点金属味。 */
  function hammerWeight(n) {
    return 1 - 0.58 * Math.exp(-Math.pow((n - 7.4) / 2.1, 2));
  }

  /* 每组一张波表：只含该组分音，组内按 1/n^1.15 衰减，
     组与组之间的比例交给包络和力度指数控制。 */
  function pianoWave(parts) {
    const N = 24;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (const n of parts) {
      imag[n] = Math.pow(parts[0] / n, 1.15) * hammerWeight(n);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
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
    organ: organWave(),
    piano: PIANO_BANKS.map(b => pianoWave(b.parts))
  };

  /* 击弦噪声共用一段缓冲：每音重新生成会让 GC 在高潮段频繁触发 */
  const hammerBuf = (() => {
    const len = Math.max(64, Math.floor(ctx.sampleRate * 0.07));
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const x = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 3.4);
    }
    return b;
  })();

  /* 同音重击：上一次的余韵必须被"止住"，否则同频叠加会糊成一片，
     听起来像踩着延音踏板弹音阶。这里按 MIDI 记住正在响的那一个。 */
  const ringing = new Map();

  function dampVoice(entry, at, fast = true) {
    if (!entry || !entry.gain) return;
    const g = entry.gain;
    try {
      if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(at);
      else { g.gain.cancelScheduledValues(at); g.gain.setValueAtTime(0.0001, at); }
      g.gain.setTargetAtTime(0.0001, at, fast ? 0.006 : 0.03);
    } catch {}
  }

  /* ── 钢琴 ──
     4 组振荡器 × 1~2 根弦 + 击弦噪声 + 制音器。
     组内失谐（cents）模拟钢琴弦的刚性：真实泛音是"拉伸"的，
     不是严格的整数倍，这层微失谐正是"木头味"的来源。 */
  function piano(t, midi, dur, vel, pan = 0) {
    if (vel <= 0.004) return;
    const f = mtof(midi);

    /* 低音衰减慢、高音衰减快：这是钢琴最容易被忽略的一条物理事实。
       数值按"每秒约 17 dB"标定：C4 约 2.1 s 落到 -36 dB，
       低音更长、高音更短，和真实钢琴的 t60 走向一致。 */
    const tau = clamp(4.6 * Math.pow(2, -(midi - 33) / 24), 0.9, 5.0);
    const atk = 0.0022 + 0.0016 * clamp((84 - midi) / 48, 0, 1);
    const peak = Math.pow(vel, 1.15) * 0.105;

    const mix = ctx.createGain();
    const noteGain = ctx.createGain();
    noteGain.gain.value = 1;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) {
      /* 真正录制的钢琴低音偏左、高音偏右；叠上调用方给的位置 */
      p.pan.value = clamp(pan + clamp((midi - 62) * 0.006, -0.26, 0.26), -1, 1);
      mix.connect(noteGain); noteGain.connect(p); p.connect(busPiano);
    } else {
      mix.connect(noteGain); noteGain.connect(busPiano);
    }

    const prev = ringing.get(midi);
    if (prev) dampVoice(prev, t);
    const entry = { gain: noteGain, at: t, end: t + tau + 0.12 };
    ringing.set(midi, entry);

    let lastOsc = null;
    const banks = light ? PIANO_BANKS.slice(0, 3) : PIANO_BANKS;
    banks.forEach((bank, bi) => {
      const amp = peak * bank.gain * Math.pow(vel, bank.vexp);
      const d = tau * bank.decay;
      const strings = light ? 1 : bank.strings;

      for (let k = 0; k < strings; k++) {
        const o = ctx.createOscillator();
        o.setPeriodicWave(waves.piano[bi]);
        o.frequency.value = f;
        /* 组间失谐 + 弦间失谐 + 每音 ±2 音的随机，避免机械感 */
        o.detune.value = bank.cents + (k ? 3.4 : -1.7) + rand(-2, 2);

        const g = ctx.createGain();
        const a = amp / strings;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(a, t + atk);
        /* 两段衰减：击弦后 140ms 掉到 36%（"啪"），之后按每秒约 17 dB
           缓慢落下去。尾段再快速收到 0，避免振荡器停振时留下咔声。 */
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, a * 0.36), t + Math.min(0.14, d * 0.2));
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, a * 0.008), t + d);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);

        o.connect(g); g.connect(mix);
        o.start(t); o.stop(t + d + 0.06);
        lastOsc = o;
      }
    });

    /* 制音器：手松开（或该换音了）之后按音区在 90~260ms 内收住。
       只在音符还没自己衰减完时才有意义。 */
    const off = t + Math.max(0.06, dur);
    if (off < t + tau * 1.05) {
      const rel = midi < 48 ? 0.26 : 0.13;
      noteGain.gain.setValueAtTime(1, off);
      noteGain.gain.setTargetAtTime(0.0001, off, rel / 3);
    }

    /* 击弦瞬态：高频"嗒" + 低频"咚"，两者比例随音区变化。
       旧版只有一个 8ms 带通，音量小到几乎听不见，所以起音是"软"的。 */
    if (vel > 0.16) {
      const ns = ctx.createBufferSource();
      ns.buffer = hammerBuf;
      ns.playbackRate.value = rand(0.92, 1.08);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = clamp(f * 4.2, 1800, 7200);
      bp.Q.value = 0.75;
      const ng = ctx.createGain();
      ng.gain.value = Math.pow(vel, 1.7) * 0.09;
      ns.connect(bp); bp.connect(ng); ng.connect(mix);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = clamp(220 + f * 0.5, 220, 900);
      const lg = ctx.createGain();
      lg.gain.value = Math.pow(vel, 2.1) * 0.055;
      const ns2 = ctx.createBufferSource();
      ns2.buffer = hammerBuf;
      ns2.playbackRate.value = 0.6;
      ns2.connect(lp); lp.connect(lg); lg.connect(mix);

      ns.start(t); ns.stop(t + 0.08);
      ns2.start(t); ns2.stop(t + 0.06);
    }

    if (lastOsc) {
      lastOsc.onended = () => {
        if (ringing.get(midi) === entry) ringing.delete(midi);
        try { mix.disconnect(); noteGain.disconnect(); p && p.disconnect(); } catch {}
      };
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
    if (gain <= 0.004) return;
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

      for (let d = 0; d < (light ? 1 : 2); d++) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = (d ? 8 : -8) + (i - 1.5) * 2;
        if (!light) lfoAmt.connect(o.detune);
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

  /* 铜管：靠"起音后滤波打开"制造亮度，而不是单纯加音量。
     只在高潮段用六小节，进得太早会失去分量。 */
  function brass(t, notes, dur, gain, open = 0.5) {
    if (gain <= 0.004) return;
    notes.forEach((m, i) => {
      const f = mtof(m);
      /* 轻量模式只留一根管：铜管是"有没有"的问题，不是"几根"的问题 */
      for (let d = 0; d < (light ? 1 : 2); d++) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = (d ? 6.5 : -5.5) + i * 1.1;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 0.8;
        lp.frequency.setValueAtTime(240 + f * 1.4, t);
        lp.frequency.linearRampToValueAtTime(700 + f * (3.2 + open * 5.2), t + Math.min(dur * 0.5, 1.2));

        const g = ctx.createGain();
        const amp = gain * 0.015 * (i === 0 ? 1 : 0.7);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(amp, t + Math.min(0.4, dur * 0.35));
        g.gain.setValueAtTime(amp, t + dur * 0.78);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        o.connect(lp); lp.connect(g); g.connect(busPad);
        o.start(t); o.stop(t + dur + 0.03);
      }
    });
  }

  /* 低频下潜：大锣落下时补一层 68→34 Hz 的滑音，身体能"感觉"到 */
  function subDrop(t, from, to, dur, gain) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(busLow);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /* ── 编曲 ──
     一条力度曲线管全曲，配器按段进、按段撤；
     高潮不是"更响"，而是层数更多、频带更宽、留白更狠。 */
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
    const gap = bar === 23;          /* 大锣前的两拍空白 */

    /* 低音：长音铺底，第 3 拍补五度；时值交叠到下一小节，循环点不掉进静音 */
    sub(t, chord.bass, BAR * 1.30, 0.22 + v * 0.95);
    if (!inA) sub(t, chord.bass + 19, BEAT * 1.6, 0.10 + v * 0.18);

    /* 管风琴：两小节一次换和声，比小节线稍早一点起音，像"呼吸" */
    if (bar % 2 === 0) {
      const voicing = chord.tones.map(m => m + 12);
      voicing.push(chord.root + 24);
      organ(t, voicing, BAR * 2 + 0.55, Math.pow(clamp(v * 1.06, 0, 1), 1.35));
    }

    /* 弦乐：第 6 小节就悄悄进来（引子末尾的一点空气），
       之后随力度曲线逐步打开低通；高潮段再叠一层低八度的"大提琴" */
    if ((inA && bar >= 6) || inB || inC || inD || (inE && bar < 36)) {
      const open = clamp((v - 0.36) / 0.6, 0.08, 1);
      strings(t, [chord.root + 24, chord.tones[1] + 12, chord.tones[2] + 12],
        BAR * (inD ? 1.32 : 1.1),
        clamp(v * (inA ? 0.55 : 1.1), 0, 1), open);
    }
    if (inD || (inC && bar >= 20)) {
      strings(t, [chord.root, chord.tones[0]], BAR * 1.25, 0.42 + v * 0.22, 0.16);
    }
    /* 退潮的最后两小节：弦乐不断，直接把 G 拖过循环点接住下一个 Am */
    if (bar === 38) {
      strings(t, [chord.root + 24, chord.tones[2] + 12, chord.tones[3] + 12], BAR * 2.4, 0.30, 0.25);
    }

    /* 铜管：第 26 小节进、第 31 小节撤，正好卡在最高点上 */
    if (bar >= 26 && bar <= 31) {
      const atk = bar === 26 ? BEAT * 2 : 0;
      brass(t + atk, [chord.root + 12, chord.tones[2] + 12, chord.root + 24],
        BAR * (bar === 31 ? 0.92 : 1.05) - atk,
        clamp((v - 0.35) * 1.5, 0, 1), clamp(v, 0, 1));
    }

    /* 固定音型：建立段八分，推进/高潮十六分，退潮回到八分 */
    const step = (inB || inE) ? 2 : 1;
    const ostOn = !inA && bar < 36;
    if (ostOn) {
      const stopAt = gap ? 8 : 16;
      for (let i = 0; i < stopAt; i += step) {
        const idx = OST[i % 16];
        const midi = chord.tones[idx] + 12;
        const accent = i % 4 === 0 ? 1 : 0.62;
        const lift = 0.86 + 0.14 * (i / 15);
        piano(t + i * s16 + rand(-0.006, 0.006), midi, s16 * (inD ? 4.2 : 5.4),
          v * accent * lift * rand(0.9, 1.08), 0.14);
      }
      /* 高潮段：每拍叠一个高八度，厚度靠层数而不是音量 */
      if (inD) {
        for (let i = 0; i < 16; i += 4) {
          piano(t + i * s16, chord.tones[OST[i % 16]] + 24, s16 * 2.4, v * 0.32, -0.20);
        }
      }
    }

    /* 低音钢琴：每两小节点一次根音，给固定音型一个"地基" */
    if (!inA && bar % 2 === 0) {
      piano(t, chord.bass + 12, BEAT * 3.2, v * 0.62, -0.24);
    }

    /* 主旋律：第 8 小节进入，四个八小节乐句铺到第 39 小节 */
    if (bar >= MEL_START && bar < MEL_END) {
      const beatsIn = (((index - MEL_START) * 4) % MEL_BEATS + MEL_BEATS) % MEL_BEATS;
      const octUp = inD ? 12 : 0;
      for (const e of MEL_EVENTS) {
        const local = e.b - beatsIn;
        if (local < 0 || local >= 4) continue;
        const at = t + local * BEAT;
        const dur = BEAT * e.d * 1.08;
        piano(at, e.m + octUp, dur, v * 0.98, 0);
        /* 高潮段：低八度加一层，"重量"来自这里；管风琴再吹一遍让音色变宽 */
        if (inD) {
          piano(at, e.m - 12, dur * 1.02, v * 0.40, -0.14);
          if (e.d >= 2) organ(at, [e.m + 12], dur * 0.96, v * 0.40);
        }
        /* 乐句尾音加一个高八度弱奏，像远处有人应了一声 */
        if (e.d >= 3 && !light) piano(at + 0.02, e.m + 24, dur * 0.8, v * 0.20, 0.26);
      }
    }

    /* 定音鼓：推进段每两小节一次，高潮段每小节两次 */
    if (inC && bar % 2 === 0) timpani(t, chord.bass + 12, v * 0.55);
    if (inD) {
      timpani(t, chord.bass + 12, v * 0.60);
      if (!gap) timpani(t + BEAT * 2, chord.bass + 12, v * 0.45);
    }

    /* 第 23 小节：撤掉音型，用定音鼓滚奏把两拍空白填满，
       然后第 24 小节整组砸下来——"震撼"主要靠这一下前后对比。 */
    if (gap) {
      for (let i = 0; i < 12; i++) {
        timpani(t + BEAT * 2 + i * (BEAT * 2 / 12), chord.bass + 12, 0.16 + i * 0.05);
      }
    }

    /* 高点：大锣 + 低音簇 + 下潜，三个不同频段同时落 */
    if (bar === 24) {
      tam(t, chord.bass + 24, v);
      piano(t, chord.bass + 12, BEAT * 3, v * 0.95, -0.20);
      piano(t, chord.bass + 19, BEAT * 3, v * 0.58, 0.16);
      subDrop(t, 68, 34, 1.7, 0.30);
    }
    if (bar === 22) riser(t, BAR * 2, 0.9);
    if (bar === 30) riser(t, BAR * 2, 0.5);

    /* 退潮段：旋律交给钢琴独奏，配器一层层撤掉，只剩混响在响 */
    if (bar >= 36 && bar % 2 === 0) {
      piano(t + BEAT * 2, (chord.tones[1] + 12), BEAT * 1.6, v * 0.5, 0.08);
    }
    /* 最后一小节：低音 A 钉住，循环回 Am 时是"落回"而不是"跳回" */
    if (bar === 39) {
      piano(t + BEAT * 2, 45, BEAT * 2.2, 0.34, -0.18);
    }
  }

  return {
    master, scheduleBar, bars: BARS, barSeconds: BAR,
    /* 单音试听：验证音色、测分音衰减都靠它 */
    playNote(midi, vel = 0.8, dur = 2, at = ctx.currentTime, pan = 0) {
      piano(at, midi, dur, vel, pan);
    },
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
    if (!started) { await start(); return started && !muted; }

    /* 顺序很重要：先看"是不是被用户关掉了"，再看"是不是被浏览器挂起了"。
       自动播放被拦时 ctx 处于 suspended，此时第一次点击应该是"开始播放"；
       旧逻辑只看 started，会把这一次点击当成"关掉"，用户要点两下才有声音。 */
    if (muted) {
      muted = false;
      if (audioEl) { audioEl.volume = Math.min(1, volume); audioEl.play().catch(() => {}); }
      if (synth) synth.setVolume(volume);
      emit();
      return true;
    }

    if (ctx && ctx.state !== 'running') {
      try { await ctx.resume(); } catch {}
      emit();
      return ctx.state === 'running';
    }

    stop();
    return false;
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
