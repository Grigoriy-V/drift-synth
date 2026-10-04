// Отладочный анализатор: рендерит движок офлайн (быстрее реального времени) и считает метрики
// по сигналу и по сыгранным нотам. В приложение не подключён; в консоли страницы:
//   const s = document.createElement('script'); s.src = 'analyze.js'; document.head.append(s);
//   await driftAnalyze(drift.p, { seconds: 30 })
(function () {
  'use strict';

  const { Engine, SCALES } = window.Synth;
  const SR = 44100;
  const db = (x) => (x > 0 ? +(20 * Math.log10(x)).toFixed(1) : -Infinity);

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const wr = Math.cos(ang * k);
          const wi = Math.sin(ang * k);
          const a = i + k;
          const b = a + len / 2;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }

  // Усреднённый спектр мощности
  function spectrum(x, size) {
    const power = new Float64Array(size / 2);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let frames = 0;
    for (let start = 0; start + size <= x.length; start += size / 2) {
      for (let i = 0; i < size; i++) {
        re[i] = x[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
        im[i] = 0;
      }
      fft(re, im);
      for (let i = 0; i < size / 2; i++) power[i] += re[i] * re[i] + im[i] * im[i];
      frames++;
    }
    for (let i = 0; i < power.length; i++) power[i] /= frames || 1;
    return power;
  }

  function signalStats(x, scalePcs) {
    let peak = 0;
    let sum = 0;
    let clipped = 0;
    let clicks = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      peak = Math.max(peak, a);
      sum += x[i] * x[i];
      if (a > 0.99) clipped++;
      if (i && Math.abs(x[i] - x[i - 1]) > 0.35) clicks++;
    }
    const rms = Math.sqrt(sum / x.length);

    // громкость по секундам — видно провалы и скачки
    const perSec = [];
    for (let s = 0; s + SR <= x.length; s += SR) {
      let q = 0;
      for (let i = s; i < s + SR; i++) q += x[i] * x[i];
      perSec.push(db(Math.sqrt(q / SR)));
    }
    let maxJump = 0;
    for (let i = 1; i < perSec.length; i++) maxJump = Math.max(maxJump, Math.abs(perSec[i] - perSec[i - 1]));

    const size = 16384;
    const pw = spectrum(x, size);
    const hz = SR / size;
    const edges = { 'sub <120': [20, 120], 'low 120-400': [120, 400], 'mid 400-2k': [400, 2000], 'high 2k-6k': [2000, 6000], 'air >6k': [6000, 20000] };
    let total = 0;
    for (let i = 1; i < pw.length; i++) total += pw[i];
    const bands = {};
    for (const name in edges) {
      let e = 0;
      for (let i = Math.ceil(edges[name][0] / hz); i < edges[name][1] / hz && i < pw.length; i++) e += pw[i];
      bands[name] = Math.round((100 * e) / total) + '%';
    }

    // хрома: энергия по 12 нотам в диапазоне 200–2500 Гц и доля вне лада
    const chroma = new Float64Array(12);
    for (let i = Math.ceil(200 / hz); i < 2500 / hz; i++) {
      const pc = ((Math.round(12 * Math.log2((i * hz) / 440) + 69) % 12) + 12) % 12;
      chroma[pc] += pw[i];
    }
    const chromaSum = chroma.reduce((a, b) => a + b, 0);
    let out = 0;
    chroma.forEach((v, pc) => {
      if (!scalePcs.includes(pc)) out += v;
    });

    return {
      peakDb: db(peak),
      rmsDb: db(rms),
      clippedSamples: clipped,
      clicks,
      loudnessPerSec: { min: Math.min(...perSec), max: Math.max(...perSec), maxJumpDb: +maxJump.toFixed(1) },
      bands,
      outOfScaleEnergy: Math.round((100 * out) / chromaSum) + '%',
    };
  }

  // Насколько ноты слоя согласуются с аккордом, звучащим в момент ноты (доли по длительности)
  function harmonyStats(notes, chords) {
    const res = {};
    const chordAt = (t) => {
      let c = null;
      for (const ch of chords) {
        if (ch.t <= t + 0.01) c = ch;
        else break;
      }
      return c;
    };
    notes.forEach((n) => {
      const c = chordAt(n.t);
      if (!c) return;
      const pc = ((n.midi % 12) + 12) % 12;
      const dist = Math.min(...c.pcs.map((x) => Math.min((pc - x + 12) % 12, (x - pc + 12) % 12)));
      const r = (res[n.layer] = res[n.layer] || { notes: 0, time: 0, chord: 0, step: 0, semitone: 0, other: 0 });
      r.notes++;
      r.time += n.dur;
      r[dist === 0 ? 'chord' : dist === 1 ? 'semitone' : dist === 2 ? 'step' : 'other'] += n.dur;
    });
    for (const k in res) {
      const r = res[k];
      ['chord', 'step', 'semitone', 'other'].forEach((f) => (r[f] = Math.round((100 * r[f]) / r.time) + '%'));
      delete r.time;
    }
    return res;
  }

  function melodyStats(notes, seconds) {
    const m = notes.filter((n) => n.layer === 'lead').sort((a, b) => a.t - b.t);
    if (m.length < 2) return { notes: m.length };
    let steps = 0;
    let leaps = 0;
    let repeats = 0;
    let maxGap = 0;
    for (let i = 1; i < m.length; i++) {
      const d = Math.abs(m[i].midi - m[i - 1].midi);
      if (d === 0) repeats++;
      else if (d <= 2) steps++;
      else leaps++;
      maxGap = Math.max(maxGap, m[i].t - (m[i - 1].t + m[i - 1].dur));
    }
    const pitches = m.map((n) => n.midi);
    const pct = (v) => Math.round((100 * v) / (m.length - 1)) + '%';
    return {
      notesPerSec: +(m.length / seconds).toFixed(1),
      range: Math.min(...pitches) + '–' + Math.max(...pitches),
      stepwise: pct(steps),
      leaps: pct(leaps),
      repeats: pct(repeats),
      longestRestSec: +maxGap.toFixed(1),
    };
  }

  // opts: seconds, only: [слои] — оставить включёнными только эти (из включённых в params),
  // intro: true — начать со вступления, а не с полной секции
  async function driftAnalyze(params, opts = {}) {
    const seconds = opts.seconds || 30;
    const p = JSON.parse(JSON.stringify(params));
    if (opts.only) for (const k in p.layers) p.layers[k].on = p.layers[k].on && opts.only.includes(k);
    const oc = new OfflineAudioContext(2, SR * seconds, SR);
    const e = new Engine(p);
    e.init(oc);
    e.gate.gain.value = 1;
    e.forceMain = !opts.intro;

    const notes = [];
    const chords = [];
    let now = 0;
    let inLead = false;
    const hook = (name, log) => {
      const orig = e[name].bind(e);
      e[name] = (...a) => {
        log(...a);
        return orig(...a);
      };
    };
    const chordMidis = e.chordMidis.bind(e);
    e.chordMidis = (deg) => {
      const m = chordMidis(deg);
      chords.push({ t: now, pcs: [...new Set(m.map((x) => ((x % 12) + 12) % 12))] });
      return m;
    };
    hook('bass', (t, midi, dur) => notes.push({ layer: 'bass', t, midi, dur }));
    hook('arpNote', (t, midi) => notes.push({ layer: 'arp', t, midi, dur: 0.3 }));
    hook('bell', (t, midi) => inLead || notes.push({ layer: 'bells', t, midi, dur: 0.8 }));
    const lead = e.lead.bind(e);
    e.lead = (t, midi, dur, vel) => {
      notes.push({ layer: 'lead', t, midi, dur });
      inLead = true;
      lead(t, midi, dur, vel);
      inLead = false;
    };

    const sections = [];
    let sec = null;
    for (let i = 0, t = 0.05; t < seconds; i++, t += 60 / p.bpm / e.beat()) {
      now = t;
      e.scheduleStep(i, now);
      if (e.sec !== sec) {
        sec = e.sec;
        sections.push(now.toFixed(0) + 's ' + sec.type);
      }
    }
    const started = performance.now();
    const buf = await oc.startRendering();
    const renderMs = Math.round(performance.now() - started);
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    const mono = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2;

    const scalePcs = SCALES[p.scale].map((x) => (x + p.root) % 12);
    return {
      setup: `${p.theme}/${p.mood} ${p.meter} ${p.bpm}bpm ${p.scale}`,
      layers: Object.keys(p.layers).filter((k) => p.layers[k].on).join(','),
      sections,
      renderMs,
      signal: signalStats(mono, scalePcs),
      harmony: harmonyStats(notes, chords),
      melody: melodyStats(notes, seconds),
    };
  }

  window.driftAnalyze = driftAnalyze;
})();
