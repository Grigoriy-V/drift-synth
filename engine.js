// Процедурный генератор музыки на Web Audio API.
// Всё синтезируется на лету: пэды, бас, арпеджио, FM-колокольчики, ударные, шумовая текстура.
(function () {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    pentatonic: [0, 3, 5, 7, 10],
  };

  // Базовая громкость слоя и посылы на реверб/дилей
  const LAYERS = {
    pad: { gain: 1.0, rev: 0.6, del: 0.1 },
    choir: { gain: 1.0, rev: 0.75, del: 0.1 },
    bass: { gain: 0.9, rev: 0.04, del: 0 },
    arp: { gain: 0.8, rev: 0.35, del: 0.5 },
    bells: { gain: 0.8, rev: 0.8, del: 0.4 },
    lead: { gain: 1.2, rev: 0.45, del: 0.35 },
    drums: { gain: 0.9, rev: 0.1, del: 0.04 },
    texture: { gain: 0.5, rev: 0.4, del: 0 },
    vinyl: { gain: 4, rev: 0, del: 0 },
    amb: { gain: 0.8, rev: 0.12, del: 0 },
  };

  // Темы: из этих пулов дирижёр выбирает инструменты, атмосферу, лад и аккордовые ходы
  const THEMES = {
    lofi: {
      padInst: ['warm', 'glass'], leadInst: ['ep', 'musicbox', 'flute'], arpInst: ['pluck', 'harp'], bassInst: ['sub'], kit: ['lofi'],
      amb: ['rain', 'night', 'fire'],
      ninth: true,
    },
    fantasy: {
      padInst: ['lute'], leadInst: ['flute', 'harp'], arpInst: ['harp'], bassInst: ['bowed'], kit: ['folk'],
      amb: ['forest', 'fire', 'waves'],
      ninth: false, triads: true, folk: true,
    },
    anime: {
      padInst: ['glass', 'warm'], leadInst: ['synth', 'ep', 'musicbox'], arpInst: ['chip', 'pluck'], bassInst: ['fm', 'synth'], kit: ['80s'],
      amb: ['night', 'rain', 'none'],
      ninth: true,
    },
    ambient: {
      padInst: ['glass', 'strings', 'warm'], leadInst: ['musicbox', 'flute', 'ep'], arpInst: ['harp', 'pluck'], bassInst: ['sub'], kit: ['lofi'],
      amb: ['waves', 'rain', 'forest', 'night'],
      ninth: true,
    },
    synthwave: {
      padInst: ['warm', 'strings'], leadInst: ['synth', 'ep'], arpInst: ['pluck', 'chip'], bassInst: ['synth', 'fm'], kit: ['80s'],
      amb: ['night', 'none'],
      ninth: false,
    },
  };
  // Настроение: лады, из которых выбирает дирижёр, характер мелодии (leap — скачки, rest — паузы,
  // stacc — отрывисто), как часто вступают ударные и поправки к вероятности слоёв в секциях.
  // tempo/density/bright — поправки к базовым значениям темы (их применяет панель)
  const MOODS = {
    happy: { scales: ['major', 'mixolydian', 'lydian'], tempo: 1.18, density: 0.18, bright: 0.12, drums: 1, leap: 0.35, rest: 0.1, stacc: true, bias: { arp: 0.2, lead: 0.2 } },
    calm: { scales: ['lydian', 'major', 'dorian'], tempo: 0.86, density: -0.18, bright: -0.04, drums: 0.5, leap: 0.1, rest: 0.5, stacc: false, bias: { choir: 0.1, bells: 0.1 } },
    sad: { scales: ['minor', 'dorian'], tempo: 0.82, density: -0.1, bright: -0.1, drums: 0.7, leap: 0.15, rest: 0.4, stacc: false, bias: { lead: 0.2 } },
    dark: { scales: ['phrygian', 'minor'], tempo: 0.8, density: -0.15, bright: -0.2, drums: 0.5, leap: 0.2, rest: 0.5, stacc: false, bias: { choir: 0.4, arp: -0.2, bells: 0.2 } },
    epic: { scales: ['minor', 'dorian', 'mixolydian'], tempo: 1.02, density: 0.1, bright: 0.05, drums: 1, leap: 0.4, rest: 0.15, stacc: false, bias: { choir: 0.5, lead: 0.1 } },
  };

  // Характерные аккордовые ходы для каждого лада (ступени)
  const PROGS = {
    major: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 4, 2, 5], [0, 3, 0, 4], [1, 4, 0, 5], [0, 3, 4, 0]],
    mixolydian: [[0, 6, 3, 0], [0, 6, 0, 3], [0, 3, 6, 0], [0, 4, 6, 0]],
    lydian: [[0, 1, 0, 1], [0, 1, 5, 0], [0, 4, 1, 0], [0, 5, 1, 0]],
    dorian: [[0, 3, 0, 6], [0, 6, 3, 0], [0, 2, 6, 3], [0, 3, 6, 0]],
    minor: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 5, 6, 0], [0, 3, 6, 2], [0, 3, 5, 6]],
    phrygian: [[0, 1, 0, 6], [0, 1, 2, 1], [0, 6, 1, 0]],
  };

  const AMBIENCES = ['rain', 'fire', 'forest', 'waves', 'night'];

  // kick: [старт Гц, конец Гц, затухание с, громкость]
  const KITS = {
    lofi: { kick: [150, 45, 0.35, 0.7], snare: { hp: 1200, dec: 0.16, noise: 0.3, tone: 200, toneGain: 0.25 }, hat: { hp: 7000, dec: 0.04, gain: 0.11 } },
    '80s': { kick: [190, 50, 0.3, 0.75], snare: { hp: 700, dec: 0.3, noise: 0.28, tone: 180, toneGain: 0.3 }, hat: { hp: 9000, dec: 0.05, gain: 0.13 } },
    folk: { kick: [95, 55, 0.5, 0.5], snare: { hp: 5000, dec: 0.09, noise: 0.42, tone: 0, toneGain: 0 }, hat: { hp: 8500, dec: 0.03, gain: 0.13 } },
  };

  // oscs: [форма, расстройка в центах, сдвиг в полутонах, уровень]
  const PADS = {
    warm: { oscs: [['sawtooth', -8, 0, 1], ['sawtooth', 7, 0, 1]], peak: 0.045, att: 2.5, filtered: true, vib: 0 },
    strings: { oscs: [['sawtooth', -12, 0, 1], ['sawtooth', 0, 0, 1], ['sawtooth', 11, 0, 1], ['sawtooth', 4, 12, 0.4]], peak: 0.026, att: 1.2, filtered: true, vib: 7 },
    glass: { oscs: [['sine', -4, 0, 1], ['sine', 5, 0, 1], ['triangle', 0, 12, 0.3]], peak: 0.03, att: 2, filtered: false, vib: 0 },
  };

  // Секции стрима. Число у слоя — вероятность, что он звучит в этой секции;
  // drums: какие барабаны играют (k/s/h), bars — возможная длина, next — куда идём дальше
  const SECTIONS = {
    intro: { pad: 1, choir: 0.4, bass: 0, arp: 0.5, bells: 0.8, lead: 0.3, drums: null, bars: [4, 8], next: ['build', 'main'] },
    build: { pad: 1, choir: 0.3, bass: 1, arp: 0.8, bells: 0.4, lead: 0.3, drums: 'kh', bars: [4, 8], next: ['main'] },
    main: { pad: 1, choir: 0.3, bass: 1, arp: 0.7, bells: 0.5, lead: 0.8, drums: 'ksh', bars: [8, 16], next: ['alt', 'break', 'sparse'] },
    alt: { pad: 0.8, choir: 0.7, bass: 1, arp: 0.3, bells: 0.6, lead: 0.5, drums: 'ksh', bars: [8], next: ['main', 'break', 'sparse'] },
    break: { pad: 1, choir: 0.7, bass: 0.3, arp: 0.4, bells: 0.9, lead: 0.5, drums: null, bars: [4, 8], next: ['build', 'main'] },
    sparse: { pad: 0.4, choir: 0, bass: 1, arp: 0.3, bells: 0.3, lead: 0.4, drums: 'kh', bars: [8], next: ['main', 'alt', 'break'] },
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Форманты гласных: [частота, Гц; усиление] для F1–F3
  const VOWELS = {
    a: [[800, 1], [1150, 0.5], [2900, 0.25]],
    o: [[450, 1], [800, 0.35], [2830, 0.1]],
    u: [[325, 1], [700, 0.25], [2700, 0.06]],
    e: [[400, 1], [1700, 0.3], [2600, 0.2]],
  };

  const STEPS = 16;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const mod = (a, n) => ((a % n) + n) % n;

  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function euclid(pulses, steps, rotation) {
    const out = [];
    for (let i = 0; i < steps; i++) out.push((mod(i + rotation, steps) * pulses) % steps < pulses);
    return out;
  }

  class Engine {
    constructor(params) {
      this.p = params;
      this.ctx = null;
      this.playing = false;
      this.events = []; // очередь {t, step, chord} для визуализации
      this.voices = new Set();
      this.strings = {}; // кэш буферов струн по ноте
      this.onSongChange = null;
      this.onParamsChange = null;
      this.auto = {}; // множитель слоя от дирижёра (0 или 1)
      for (const name in LAYERS) this.auto[name] = 1;
      this.resetConductor();
      this.setHome();
      this.regenerate();
    }

    // ---------- генерация материала ----------

    regenerate() {
      this.rng = mulberry32(hashSeed(String(this.p.seed)));
      this.song = {};
      this.newMaterial();
      this.p.leadInst = this.p.stream ? this.leadA : this.p.leadInst;
      if (this.onSongChange) this.onSongChange();
    }

    // Точка, вокруг которой дирижёр гуляет параметрами; обновляется при правках с панели
    setHome() {
      const { bpm, bright, density, drumStyle } = this.p;
      this.home = { bpm, bright, density, drumStyle };
    }

    pick(items, weights) {
      let r = this.rng() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    }

    nextChord(prev) {
      const n = SCALES[this.p.scale].length;
      const degs = n === 7 ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
      const w = (n === 7 ? [1, 0.6, 2, 3, 2, 3, 1.2] : [1, 2, 2, 2, 2]).map((v, d) =>
        // уменьшенные трезвучия звучат резко — оставляем как редкую краску
        this.isDim(d) ? v * 0.12 : v
      );
      let d;
      do d = this.pick(degs, w);
      while (d === prev);
      return d;
    }

    // Размер: 4/4 — такт из 16 шестнадцатых, 12/8 — четыре доли по три восьмых (джига)
    steps() {
      return this.p.meter === '12/8' ? 12 : 16;
    }

    beat() {
      return this.p.meter === '12/8' ? 3 : 4;
    }

    mood() {
      return MOODS[this.p.mood] || MOODS.calm;
    }

    genProg(first) {
      const prog = [first];
      for (let i = 1; i < 4; i++) prog.push(this.nextChord(prog[i - 1]));
      return prog;
    }

    genProgs() {
      const r = this.rng;
      const seven = SCALES[this.p.scale].length === 7;
      // ходы с уменьшенным аккордом в текущем ладу не берём
      const pool = (PROGS[this.p.scale] || []).filter((prog) => !prog.some((d) => this.isDim(d)));
      const fromPool = () => pool[Math.floor(r() * pool.length)].slice();
      const firsts = (seven ? [5, 3, 0] : [3, 2, 0]).filter((d) => !this.isDim(d));
      this.song.progA = pool.length && r() < 0.7 ? fromPool() : this.genProg(0);
      this.song.progB = pool.length && r() < 0.5 ? fromPool() : this.genProg(firsts[Math.floor(r() * firsts.length)]);
      this.song.prog = this.song.progA;
    }

    // Напев на 4 такта в форме A-B-A-C: ступени лада от тоники, конец — долгая тоника.
    // На сильных долях ноты при игре подтягиваются к звукам текущего аккорда.
    genMelody() {
      const r = this.rng;
      const n = SCALES[this.p.scale].length;
      const steps = this.steps();
      const beat = this.beat();
      const mood = this.mood();
      const d = this.p.density;
      // ритмические ячейки на одну долю и их веса
      const cells = beat === 3 ? [[1, 0, 1], [1, 0, 0], [1, 1, 1], [0, 0, 0]] : [[1, 0, 1, 0], [1, 0, 0, 0], [1, 0, 1, 1], [1, 1, 1, 0], [0, 0, 0, 0]];
      const weights = beat === 3 ? [3, 2.2 - d * 1.5, d * 2.5, mood.rest * 2] : [3, 2.4 - d * 1.5, d * 1.5, d * 0.7, mood.rest * 2];
      const moves = [-2, -1, 1, 2, 3, -3];
      const moveW = [1, 4, 4, 1, mood.leap * 2, mood.leap * 2]; // в основном поступенно
      const top = n + 4;

      const makeBar = (from) => {
        const bar = new Array(steps).fill(null);
        let deg = from;
        for (let b = 0; b < 4; b++) {
          let cell;
          if (b === 0) cell = cells[r() < 0.7 ? 0 : 1]; // такт начинается с ноты
          else if (b === 3) cell = cells[r() < mood.rest ? cells.length - 1 : 1]; // а кончается долгой нотой или паузой
          else cell = this.pick(cells, weights);
          cell.forEach((on, i) => {
            if (!on) return;
            deg += this.pick(moves, moveW);
            if (deg < 0 || deg > top) deg = clamp(deg, 2, top - 2);
            bar[b * beat + i] = deg;
          });
        }
        return { bar, end: deg };
      };

      const A = makeBar(this.pick([4, n, 2], [3, 2, 2]));
      const B = makeBar(A.end);
      const C = makeBar(A.end);
      for (let i = 2 * beat; i < steps; i++) C.bar[i] = null;
      C.bar[2 * beat] = C.end > n / 2 + 1 ? n : 0;

      // после напева — либо пауза на 4 такта (мелодия «дышит», играет аккомпанемент), либо повтор с другим концом
      const tune = [...A.bar, ...B.bar, ...A.bar, ...C.bar];
      const answer = r() < mood.rest * 1.6 ? new Array(steps * 4).fill(null) : [...A.bar, ...B.bar, ...A.bar, ...makeBar(B.end).bar];
      const flat = tune.concat(answer);
      // «сильные» ноты — на 1-й и 3-й долях: они всегда берутся из аккорда
      const melody = flat.map((deg, i) => (deg === null ? null : { d: deg, len: 1, strong: i % (beat * 2) === 0 }));
      let prev = null;
      flat.forEach((deg, i) => {
        if (deg === null) return;
        if (prev !== null) melody[prev].len = Math.min(i - prev, beat * 2);
        prev = i;
      });
      melody[prev].len = beat * 2;
      this.song.melody = melody;
    }

    genDrums() {
      const r = this.rng;
      const d = this.p.density;
      const style = this.p.drumStyle;
      const steps = this.steps();
      const beat = this.beat();
      const B = (n) => n * beat; // шаг, с которого начинается доля
      const kick = new Array(steps).fill(0);
      const snare = new Array(steps).fill(0);
      const hat = new Array(steps).fill(0);
      const open = new Array(steps).fill(false);
      const offbeats = [];
      for (let s = 1; s < steps; s++) if (s % beat !== 0) offbeats.push(s);

      if (this.theme().folk) {
        // рамочный барабан на 1 и 3, бубен на 2 и 4, шейкер держит пульс
        kick[0] = 1;
        kick[B(2)] = 0.6;
        if (r() < d * 0.6) kick[steps - 1] = 0.5;
        snare[B(1)] = snare[B(3)] = 0.8;
        for (let s = 0; s < steps; s++) {
          const pos = s % beat;
          const p = pos === 0 ? 0.9 : pos === beat - 1 ? 0.5 + d * 0.5 : d * 0.4;
          if (r() < p) hat[s] = pos === 0 ? 0.8 : 0.5;
        }
        Object.assign(this.song, { kick, snare, hat, open });
        return;
      }

      if (style === 'four') {
        [0, 1, 2, 3].forEach((n) => (kick[B(n)] = 1));
        if (r() < d * 0.5) kick[steps - 2] = 0.6;
        snare[B(1)] = snare[B(3)] = 0.9;
      } else if (style === 'half') {
        kick[0] = 1;
        if (r() < 0.6) kick[B(2) + beat - (r() < 0.5 ? 1 : 2)] = 0.8;
        if (r() < d * 0.6) kick[B(1) - 1] = 0.7;
        snare[B(2)] = 1;
      } else {
        kick[0] = 1;
        const extra = 1 + Math.round(d * 2);
        const pool = offbeats.filter((s) => s > beat && Math.floor(s / beat) !== 1 && Math.floor(s / beat) !== 3).concat([B(2) + 1, steps - 2]);
        for (let i = 0; i < extra; i++) kick[pool[Math.floor(r() * pool.length)]] = 0.85;
        snare[B(1)] = snare[B(3)] = 0.9;
      }
      offbeats.forEach((s) => {
        if (!snare[s] && !kick[s] && r() < d * 0.07) snare[s] = 0.3; // ghost-ноты
      });
      for (let s = 0; s < steps; s++) {
        const pos = s % beat;
        const main = beat === 4 ? pos % 2 === 0 : pos !== 1;
        if (r() < (main ? 0.45 + d * 0.55 : d * 0.5)) hat[s] = 0.4 + r() * 0.5;
      }
      if (r() < 0.5) {
        const s = r() < 0.5 ? steps - 2 : B(1) + 2;
        hat[s] = 0.7;
        open[s] = true;
      }
      Object.assign(this.song, { kick, snare, hat, open });
    }

    genBass() {
      const r = this.rng;
      const d = this.p.density;
      const steps = this.steps();
      const beat = this.beat();
      const bass = new Array(steps).fill(null);
      if (this.theme().folk) {
        // бурдон: основной тон аккорда тянется весь такт
        bass[0] = { off: 0, oct: 0, len: steps };
        this.song.bass = bass;
        return;
      }
      bass[0] = { off: 0, oct: 0, len: beat };
      for (let s = beat - 1; s < steps; s++) {
        const late = s % beat === beat - 1 || s === beat * 2 || s === beat * 2 + 2;
        if (late && r() < d * 0.4) {
          const k = r();
          bass[s] = { off: k < 0.2 ? 4 : 0, oct: k > 0.75 ? 1 : 0, len: 2 };
        }
      }
      this.song.bass = bass;
    }

    genArp() {
      const r = this.rng;
      const d = this.p.density;
      const steps = this.steps();
      const beat = this.beat();
      const arp = new Array(steps).fill(null);
      if (this.theme().folk) {
        // ровный перебор, как на лютне или арфе
        const shape = this.pick([[0, 1, 2, 3], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3, 2, 4], [0, 1, 2, 1]], [2, 3, 2, 2]);
        let k = 0;
        for (let s = 0; s < steps; s++) {
          const pos = s % beat;
          const on = beat === 3 ? d > 0.85 || pos !== 1 : pos % 2 === 0 || d > 0.85;
          if (on) arp[s] = shape[k++ % shape.length];
        }
        this.song.arp = arp;
        return;
      }
      const pulses = Math.round(((3 + d * 8) * steps) / 16);
      const pat = euclid(pulses, steps, Math.floor(r() * steps));
      let idx = Math.floor(r() * 4);
      for (let s = 0; s < steps; s++) {
        if (!pat[s]) continue;
        idx = Math.max(0, Math.min(6, idx + this.pick([-2, -1, 1, 2], [1, 3, 3, 1])));
        arp[s] = idx;
      }
      this.song.arp = arp;
    }

    // ---------- дирижёр ----------

    resetConductor() {
      this.sec = { type: 'free', start: 0, end: Infinity, drums: 'ksh', fill: 'none' };
      this.chapter = 1;
      this.secCount = 0;
      this.chapterLen = 6;
    }

    // Начать отсчёт тактов заново, не останавливая звук (смена размера, темы, настроения).
    // full — сразу играть полную секцию, чтобы новая тема была слышна с первого такта
    restart(full) {
      this.regenerate();
      this.resetConductor();
      this.stepIndex = 0;
      this.forceMain = !!full;
    }

    conduct(bar, t) {
      if (!this.p.stream) {
        if (this.sec.type !== 'free') {
          this.sec = { type: 'free', start: this.sec.start, end: Infinity, drums: 'ksh', fill: 'none' };
          for (const name in LAYERS) this.auto[name] = 1;
          this.apply(false, t, 0.5);
        }
        return;
      }
      if (this.sec.type === 'free' || bar >= this.sec.end) this.nextSection(bar, t);
    }

    // Материал главы: аккорды, два напева (основной и для вариации) и два мелодических инструмента
    newMaterial() {
      const r = this.rng;
      const leads = this.theme().leadInst;
      this.genProgs();
      this.genMelody();
      this.song.melodyA = this.song.melody;
      this.genMelody();
      this.song.melodyB = this.song.melody;
      // первый в списке — «фирменный» инструмент темы, он ведёт чаще остальных
      this.leadA = r() < 0.65 ? leads[0] : leads[Math.floor(r() * leads.length)];
      const others = leads.filter((x) => x !== this.leadA);
      this.leadB = others.length ? others[Math.floor(r() * others.length)] : this.leadA;
      this.genDrums();
      this.genBass();
      this.genArp();
    }

    nextSection(bar, t) {
      const r = this.rng;
      const p = this.p;
      const prev = SECTIONS[this.sec.type];
      const forced = this.forceMain;
      this.forceMain = false;
      let type;
      let fresh = bar === 0;
      this.secCount++;
      if (forced) type = 'main';
      else if (bar === 0) type = 'intro';
      else if (this.secCount > this.chapterLen) {
        this.newChapter();
        fresh = true;
        type = r() < 0.5 ? 'intro' : 'break';
      } else type = prev ? prev.next[Math.floor(r() * prev.next.length)] : 'main';

      // секция длится не меньше ~22 секунд, иначе в быстром темпе всё мелькает
      const def = SECTIONS[type];
      const barDur = (this.steps() * 60) / p.bpm / this.beat();
      let bars = def.bars[Math.floor(r() * def.bars.length)];
      while (bars * barDur < 22 && bars < 32) bars *= 2;
      this.sec = {
        type,
        start: bar,
        end: bar + Math.ceil(bars / p.chordBars) * p.chordBars,
        drums: def.drums && (type === 'main' || type === 'alt' || r() < 0.5 ? def.drums : 'h' + (r() < 0.5 ? 'k' : '')),
        fill: this.pick(['none', 'roll', 'drop'], [2, 2, 1]),
      };
      const mood = this.mood();
      for (const name in LAYERS) {
        if (name === 'drums') this.auto.drums = def.drums && r() < mood.drums ? 1 : 0;
        else this.auto[name] = name in def ? (r() < def[name] + (mood.bias[name] || 0) ? 1 : 0) : 1;
      }
      if (!this.auto.pad && !this.auto.choir) this.auto.pad = 1;
      // в каждой секции звучит хотя бы мелодия или аккомпанемент — по ним тема и узнаётся
      if (!this.auto.arp && !this.auto.lead) this.auto[r() < 0.5 ? 'arp' : 'lead'] = 1;
      if (forced) this.auto.arp = this.auto.lead = 1;

      if (fresh) this.newMaterial();
      else {
        // внутри главы меняем не больше одного паттерна за раз
        const what = this.pick(['none', 'arp', 'drums', 'bass'], [3, 2, 2, 1]);
        if (what === 'arp') this.genArp();
        else if (what === 'drums') this.genDrums();
        else if (what === 'bass') this.genBass();
      }
      // основа — главный напев и ход A; вариация — второй напев, второй инструмент и ход B
      const alt = type === 'alt';
      this.song.melody = alt ? this.song.melodyB : this.song.melodyA;
      this.song.prog = alt || type === 'break' ? this.song.progB : this.song.progA;
      p.leadInst = alt ? this.leadB : this.leadA;

      this.apply(false, t, 0.8);
      if (this.onParamsChange) this.onParamsChange();
      if (this.onSongChange) this.onSongChange();
    }

    // Новая «глава»: смена тональности, лада, темпа, инструментов и всего материала
    newChapter() {
      const r = this.rng;
      const p = this.p;
      this.chapter++;
      this.secCount = 1;
      this.chapterLen = 5 + Math.floor(r() * 4);
      p.root = mod(p.root + this.pick([5, 7, 3, -3, 2, -2], [3, 3, 2, 2, 1, 1]), 12);
      const th = this.theme();
      const any = (list) => list[Math.floor(r() * list.length)];
      if (r() < 0.7) p.scale = any(this.mood().scales);
      ['padInst', 'arpInst', 'bassInst', 'kit'].forEach((k) => (p[k] = any(th[k])));
      if (r() < 0.5) p.amb = any(th.amb);
      p.bpm = Math.round(clamp(this.home.bpm * (0.95 + r() * 0.1), 50, 150));
      p.density = clamp(this.home.density + (r() - 0.5) * 0.2, 0.05, 1);
      p.bright = clamp(this.home.bright + (r() - 0.5) * 0.2, 0.05, 1);
    }

    // ---------- теория ----------

    rootShift() {
      return this.p.root > 6 ? this.p.root - 12 : this.p.root;
    }

    degToMidi(deg, base) {
      const sc = SCALES[this.p.scale];
      return base + 12 * Math.floor(deg / sc.length) + sc[mod(deg, sc.length)];
    }

    // Аккорд в тесном расположении (все голоса в одной октаве) + корень октавой ниже
    chordMidis(deg) {
      const base = 48 + this.rootShift();
      const tones = (this.theme().triads ? [0, 2, 4] : [0, 2, 4, 6]).map((o) => base + mod(this.degToMidi(deg + o, base) - base, 12));
      tones.push(base - 12 + mod(this.degToMidi(deg, base) - base, 12));
      // нона сверху — только большая, малая звучит грязно
      if (this.theme().ninth && this.degToMidi(deg + 1, 0) - this.degToMidi(deg, 0) === 2) {
        tones.push(base + 12 + mod(this.degToMidi(deg + 1, base) - base, 12));
      }
      return tones;
    }

    isDim(deg) {
      return this.degToMidi(deg + 4, 0) - this.degToMidi(deg, 0) === 6;
    }

    theme() {
      return THEMES[this.p.theme] || THEMES.lofi;
    }

    chordName(deg) {
      const r = this.degToMidi(deg, 0);
      const i3 = this.degToMidi(deg + 2, 0) - r;
      const i5 = this.degToMidi(deg + 4, 0) - r;
      let q = '';
      if (i3 === 3) q = i5 === 6 ? 'dim' : 'm';
      else if (i3 === 4) q = i5 === 8 ? 'aug' : '';
      else if (i3 === 2) q = 'sus2';
      else if (i3 === 5) q = 'sus4';
      return NOTE_NAMES[mod(r + this.p.root, 12)] + q;
    }

    // ---------- аудио-граф ----------

    // offline — OfflineAudioContext для рендера «в файл» (см. analyze.js); без него играем вживую
    init(offline) {
      if (this.ctx) return;
      const ctx = (this.ctx = offline || new (window.AudioContext || window.webkitAudioContext)());

      this.master = ctx.createGain();
      this.gate = ctx.createGain();
      this.gate.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.attack.value = 0.01;
      comp.release.value = 0.25;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.82;
      this.tone = ctx.createBiquadFilter(); // общий «тон»: низкая яркость = приглушённый lo-fi
      this.tone.type = 'lowpass';
      this.tone.Q.value = 0.5;
      // «Плёнка»: короткая линия задержки с плавающим временем даёт детонацию, как на кассете
      const wow = ctx.createDelay(0.1);
      wow.delayTime.value = 0.02;
      this.wowDepth = ctx.createGain();
      this.flutterDepth = ctx.createGain();
      [[0.55, this.wowDepth], [6.3, this.flutterDepth]].forEach(([hz, depth]) => {
        const o = ctx.createOscillator();
        o.frequency.value = hz;
        o.connect(depth).connect(wow.delayTime);
        o.start();
      });
      this.master.connect(this.tone).connect(wow).connect(this.gate).connect(comp).connect(this.analyser).connect(ctx.destination);
      if (!offline) {
        this.recDest = ctx.createMediaStreamDestination();
        comp.connect(this.recDest);
      }

      this.noise = this.makeNoise(2, false);
      this.brown = this.makeNoise(4, true);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(3.8);
      this.revReturn = ctx.createGain();
      this.reverb.connect(this.revReturn).connect(this.master);

      this.delay = ctx.createDelay(2);
      const fbFilter = ctx.createBiquadFilter();
      fbFilter.type = 'lowpass';
      fbFilter.frequency.value = 2400;
      const fb = ctx.createGain();
      fb.gain.value = 0.45;
      this.delay.connect(fbFilter).connect(fb).connect(this.delay);
      this.delReturn = ctx.createGain();
      this.delay.connect(this.delReturn).connect(this.master);
      const delToRev = ctx.createGain();
      delToRev.gain.value = 0.3;
      this.delay.connect(delToRev).connect(this.reverb);

      this.bus = {};
      for (const name in LAYERS) {
        const b = (this.bus[name] = ctx.createGain());
        b.gain.value = 0;
        b.connect(this.master);
        const rs = ctx.createGain();
        rs.gain.value = LAYERS[name].rev;
        b.connect(rs).connect(this.reverb);
        if (LAYERS[name].del) {
          const ds = ctx.createGain();
          ds.gain.value = LAYERS[name].del;
          b.connect(ds).connect(this.delay);
        }
      }

      // Общий фильтр пэда с медленным LFO
      this.padFilter = ctx.createBiquadFilter();
      this.padFilter.type = 'lowpass';
      this.padFilter.Q.value = 0.8;
      this.padFilter.connect(this.bus.pad);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      this.padLfoGain = ctx.createGain();
      lfo.connect(this.padLfoGain).connect(this.padFilter.frequency);
      lfo.start();

      // Текстура: коричневый шум через плавающий bandpass
      const tex = ctx.createBufferSource();
      tex.buffer = this.brown;
      tex.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700;
      bp.Q.value = 0.5;
      const tl = ctx.createOscillator();
      tl.frequency.value = 0.045;
      const tlg = ctx.createGain();
      tlg.gain.value = 450;
      tl.connect(tlg).connect(bp.frequency);
      tex.connect(bp).connect(this.bus.texture);
      tex.start();
      tl.start();

      const vinyl = ctx.createBufferSource();
      vinyl.buffer = this.makeCrackle(6);
      vinyl.loop = true;
      const vhp = ctx.createBiquadFilter();
      vhp.type = 'highpass';
      vhp.frequency.value = 900;
      vinyl.connect(vhp).connect(this.bus.vinyl);
      vinyl.start();

      this.buildAmbience();

      try {
        const src = 'let id;onmessage=e=>{clearInterval(id);if(e.data)id=setInterval(()=>postMessage(0),e.data)}';
        this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        this.worker.onmessage = () => this.tick();
      } catch (e) {
        this.worker = null;
      }

      this.apply(true);
    }

    makeNoise(seconds, brown) {
      const len = Math.floor(this.ctx.sampleRate * seconds);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else d[i] = w;
      }
      return buf;
    }

    // Треск пластинки: редкие щелчки поверх тихого шипения
    makeCrackle(seconds, rate = 0.0005, hiss = 0.012) {
      const len = Math.floor(this.ctx.sampleRate * seconds);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * hiss;
        if (Math.random() < rate) d[i] += (Math.random() * 2 - 1) * Math.pow(Math.random(), 3) * 0.9;
      }
      return buf;
    }

    // Фоновые атмосферы: все звучат постоянно, слышна та, что выбрана в p.amb
    buildAmbience() {
      const ctx = this.ctx;
      this.amb = {};
      AMBIENCES.forEach((name) => {
        this.amb[name] = ctx.createGain();
        this.amb[name].gain.value = 0;
        this.amb[name].connect(this.bus.amb);
      });
      // шум из буфера через цепочку фильтров [тип, частота] в нужную атмосферу
      const bed = (buffer, filters, gain, dest) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        let node = src;
        filters.forEach(([type, freq]) => {
          const f = ctx.createBiquadFilter();
          f.type = type;
          f.frequency.value = freq;
          f.Q.value = 0.6;
          node = node.connect(f);
        });
        const g = ctx.createGain();
        g.gain.value = gain;
        node.connect(g).connect(dest);
        src.start(0, Math.random() * buffer.duration);
        return g;
      };
      // LFO, качающий параметр вокруг его текущего значения
      const sway = (param, hz, depth, type) => {
        const o = ctx.createOscillator();
        o.type = type || 'sine';
        o.frequency.value = hz;
        const d = ctx.createGain();
        d.gain.value = depth;
        o.connect(d).connect(param);
        o.start();
      };

      // дождь: шипение + капли + низкий гул
      bed(this.noise, [['highpass', 1800], ['lowpass', 8000]], 0.1, this.amb.rain);
      bed(this.makeCrackle(5, 0.006, 0), [['bandpass', 2600]], 0.9, this.amb.rain);
      bed(this.brown, [['lowpass', 400]], 0.35, this.amb.rain);

      // костёр: частый треск + дрожащий гул пламени
      bed(this.makeCrackle(7, 0.0025, 0), [['lowpass', 5000], ['highpass', 500]], 1.2, this.amb.fire);
      sway(bed(this.brown, [['lowpass', 320]], 0.6, this.amb.fire).gain, 7, 0.15);

      // волны: шум, медленно накатывающий и уходящий
      sway(bed(this.noise, [['lowpass', 900]], 0.09, this.amb.waves).gain, 0.09, 0.08);
      bed(this.brown, [['lowpass', 250]], 0.3, this.amb.waves);

      // лес: ветер в листве; птицы добавляются из планировщика
      sway(bed(this.brown, [['bandpass', 600]], 0.7, this.amb.forest).gain, 0.07, 0.3);

      // ночь: сверчки (тон, порезанный двумя LFO) + далёкий гул
      const cricket = ctx.createOscillator();
      cricket.frequency.value = 4300;
      const pulse = ctx.createGain();
      pulse.gain.value = 0.5;
      sway(pulse.gain, 29, 0.5, 'square');
      const phrase = ctx.createGain();
      phrase.gain.value = 0.5;
      sway(phrase.gain, 0.45, 0.5);
      const cg = ctx.createGain();
      cg.gain.value = 0.012;
      cricket.connect(pulse).connect(phrase).connect(cg).connect(this.amb.night);
      cricket.start();
      bed(this.brown, [['lowpass', 220]], 0.45, this.amb.night);
    }

    // Птичья трель: несколько коротких свистов со скользящей высотой
    bird(t) {
      const ctx = this.ctx;
      const f0 = 2200 + Math.random() * 2200;
      const count = 2 + Math.floor(Math.random() * 4);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i < count; i++) {
        const a = t + i * 0.13;
        o.frequency.setValueAtTime(f0 * (0.9 + Math.random() * 0.3), a);
        o.frequency.exponentialRampToValueAtTime(f0 * (0.8 + Math.random() * 0.6), a + 0.08);
        g.gain.setValueAtTime(0, a);
        g.gain.linearRampToValueAtTime(0.02 + Math.random() * 0.02, a + 0.015);
        g.gain.linearRampToValueAtTime(0, a + 0.09);
      }
      o.connect(g).connect(this.amb.forest);
      o.start(t);
      this.track(o, t + count * 0.13 + 0.05);
    }

    makeImpulse(seconds) {
      const len = Math.floor(this.ctx.sampleRate * seconds);
      const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
      }
      return buf;
    }

    // Применить параметры панели к графу
    apply(instant, when, tc = 0.05) {
      if (!this.ctx) return;
      const p = this.p;
      const t = when || this.ctx.currentTime;
      const set = (param, v, c = tc) => (instant ? param.setValueAtTime(v, t) : param.setTargetAtTime(v, t, c));
      set(this.tone.frequency, 2500 + p.bright * 14000);
      set(this.wowDepth.gain, p.tape * 0.0016);
      set(this.flutterDepth.gain, p.tape * 0.00012);
      AMBIENCES.forEach((name) => set(this.amb[name].gain, p.amb === name ? 1 : 0, Math.max(tc, 1.2)));
      set(this.master.gain, p.master);
      set(this.revReturn.gain, p.reverb * 1.2);
      set(this.delReturn.gain, p.delay);
      set(this.delay.delayTime, Math.min(1.9, (60 / p.bpm / this.beat()) * (this.beat() === 3 ? 2 : 3)));
      const cutoff = 250 + p.bright * p.bright * 5500;
      set(this.padFilter.frequency, cutoff);
      set(this.padLfoGain.gain, cutoff * 0.35);
      for (const name in LAYERS) {
        const l = p.layers[name];
        // ритм-секция входит и выходит резко, остальное — плавно
        const fast = name === 'drums' || name === 'bass';
        set(this.bus[name].gain, l.on ? l.vol * LAYERS[name].gain * this.auto[name] : 0, fast ? Math.min(tc, 0.03) : tc);
      }
    }

    // ---------- транспорт ----------

    start() {
      this.init();
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
        this.killVoices();
      }
      this.ctx.resume();
      this.playing = true;
      this.stepIndex = 0;
      this.events.length = 0;
      this.regenerate();
      this.resetConductor();
      this.nextTime = this.ctx.currentTime + 0.08;
      this.startedAt = this.nextTime;
      this.gate.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gate.gain.setTargetAtTime(1, this.ctx.currentTime, 0.03);
      if (this.worker) this.worker.postMessage(40);
      else this.interval = setInterval(() => this.tick(), 40);
      this.tick();
    }

    stop() {
      if (!this.playing) return;
      this.playing = false;
      if (this.worker) this.worker.postMessage(0);
      else clearInterval(this.interval);
      this.gate.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gate.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null;
        this.killVoices();
        this.ctx.suspend();
      }, 400);
    }

    killVoices() {
      this.voices.forEach((v) => {
        try {
          v.stop();
        } catch (e) {}
      });
      this.voices.clear();
    }

    tick() {
      if (!this.playing) return;
      const now = this.ctx.currentTime;
      // без воркера таймеры в фоновой вкладке срабатывают раз в секунду — берём запас
      const lookahead = !this.worker && document.hidden ? 2 : 0.25;
      if (this.nextTime < now) this.nextTime = now + 0.05;
      while (this.nextTime < now + lookahead) {
        this.scheduleStep(this.stepIndex, this.nextTime);
        this.nextTime += 60 / this.p.bpm / 4;
        this.stepIndex++;
      }
    }

    scheduleStep(i, t0) {
      const p = this.p;
      const steps = this.steps();
      const beat = this.beat();
      const s = i % steps;
      const bar = Math.floor(i / steps);
      if (s === 0) this.conduct(bar, t0);

      const song = this.song;
      const sec = this.sec;
      const auto = this.auto;
      const th = this.theme();
      const stepDur = 60 / p.bpm / beat;
      const rel = bar - sec.start;
      const chordIdx = Math.floor(rel / p.chordBars) % song.prog.length;
      const deg = song.prog[chordIdx];
      const t = t0 + (beat === 4 && s % 2 ? p.swing * stepDur * 0.6 : 0);
      const L = p.layers;
      const shift = this.rootShift();
      const n = SCALES[p.scale].length;
      const fold = (m, max) => {
        while (m > max) m -= 12;
        return m;
      };
      this.events.push({ t: t0, step: s, chord: chordIdx, sec: sec.type, chapter: this.chapter });

      if (s === 0 && rel % p.chordBars === 0) {
        const dur = p.chordBars * steps * stepDur;
        const m = this.chordMidis(deg);
        if (L.pad.on && auto.pad) this.pad(t0, m, dur);
        if (L.choir.on && auto.choir) this.choir(t0, [m[0], m[0] + 12, m[1] + 12, m[2] + 12], dur);
      }

      if (L.drums.on && auto.drums) {
        const last = bar === sec.end - 1;
        const on = (k) => sec.drums.includes(k);
        if (!(last && sec.fill === 'drop' && s >= steps / 2)) {
          if (song.kick[s] && on('k')) this.kick(t, song.kick[s]);
          if (song.snare[s] && on('s')) this.snare(t, song.snare[s]);
          if (song.hat[s] && on('h')) this.hat(t, song.hat[s], song.open[s]);
        }
        if (last && sec.fill === 'roll' && s >= steps - beat && on('s')) this.snare(t, 0.35 + (s - steps + beat) * 0.15);
      }

      const b = song.bass[s];
      if (b && L.bass.on && auto.bass) {
        const base = 36 + shift;
        const m = base + mod(this.degToMidi(deg + b.off, base) - base, 12) + 12 * b.oct;
        this.bass(t, m, stepDur * b.len);
      }

      const a = song.arp[s];
      if (a !== null && L.arp.on && auto.arp) {
        const ladder = [0, 2, 4, n, n + 2, n + 4, 2 * n];
        this.arpNote(t, fold(this.degToMidi(deg + ladder[a], 60 + shift), 88), 0.6 + Math.random() * 0.4);
      }

      const note = song.melody[(rel * steps + s) % song.melody.length];
      if (note && L.lead.on && auto.lead) {
        let d = note.d;
        // расстояние в полутонах от ступени до ближайшего звука аккорда
        const tones = [0, 2, 4].map((o) => mod(this.degToMidi(deg + o, 0), 12));
        const dist = (x) => {
          const pc = mod(this.degToMidi(x, 0), 12);
          return Math.min(...tones.map((c) => Math.min(mod(pc - c, 12), mod(c - pc, 12))));
        };
        const near = [d, d + 1, d - 1, d + 2, d - 2];
        // сильная доля — звук аккорда; остальные ноты свободны, но тянущаяся нота не должна тереться в полутон
        if (note.strong) d = near.find((x) => dist(x) === 0);
        else if (note.len > 1 && dist(d) === 1) d = near.find((x) => dist(x) !== 1);
        // флейта в фолке играет октавой выше, как вистл
        const high = th.folk && p.leadInst === 'flute';
        const m = fold(this.degToMidi(d, 60 + shift), high ? 79 : 84) + (high ? 12 : 0);
        const vel = 0.65 + Math.random() * 0.35;
        const len = stepDur * note.len * (this.mood().stacc && note.len <= beat ? 0.6 : 1);
        if (th.folk && p.leadInst === 'flute' && note.strong && Math.random() < 0.3) {
          // форшлаг: короткая верхняя соседняя нота перед основной
          this.lead(t, fold(this.degToMidi(d + 1, 60 + shift), high ? 79 : 84) + (high ? 12 : 0), 0.04, vel * 0.7);
          this.lead(t + 0.07, m, len, vel);
        } else this.lead(t, m, len, vel);
      }

      if (L.bells.on && auto.bells && s % 2 === 0 && Math.random() < 0.025 + p.density * 0.06) {
        const offs = [0, 2, 4, n, n + 2];
        const m = this.degToMidi(deg + offs[Math.floor(Math.random() * offs.length)], 72 + shift);
        this.bell(t, fold(m, 96), 0.4 + Math.random() * 0.6);
      }

      if (p.amb === 'forest' && L.amb.on && Math.random() < 0.035) this.bird(t + Math.random() * stepDur);
    }

    // ---------- голоса ----------

    track(src, stopAt) {
      this.voices.add(src);
      src.onended = () => this.voices.delete(src);
      src.stop(stopAt);
    }

    pad(t, midis, dur) {
      if (this.p.padInst === 'lute') return this.strum(t, midis, dur);
      const ctx = this.ctx;
      const def = PADS[this.p.padInst] || PADS.warm;
      // атака и хвост — доля длины аккорда, иначе соседние аккорды наслаиваются в кашу
      const att = Math.min(def.att, dur * 0.3);
      const rel = Math.min(3, dur * 0.3);
      const end = t + dur + rel + 0.05;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(def.peak, t + att);
      g.gain.setValueAtTime(def.peak, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + rel);
      g.connect(def.filtered ? this.padFilter : this.bus.pad);
      let vib = null;
      if (def.vib) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5;
        vib = ctx.createGain();
        vib.gain.value = def.vib;
        lfo.connect(vib);
        lfo.start(t);
        this.track(lfo, end);
      }
      midis.forEach((m, i) => {
        def.oscs.forEach(([type, det, semis, level]) => {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = mtof(m + semis);
          o.detune.value = det + i * 1.5;
          if (vib) vib.connect(o.detune);
          if (level === 1) o.connect(g);
          else {
            const og = ctx.createGain();
            og.gain.value = level;
            o.connect(og).connect(g);
          }
          o.start(t);
          this.track(o, end);
        });
      });
    }

    // Хор: пилы с вибрато и «дыханием» через банк формантных фильтров,
    // гласная плавно перетекает в другую за время аккорда
    choir(t, midis, dur) {
      const ctx = this.ctx;
      const att = Math.min(1.8, dur * 0.3);
      const rel = Math.min(2.5, dur * 0.3);
      const end = t + dur + rel;
      const names = Object.keys(VOWELS);
      const from = VOWELS[names[Math.floor(Math.random() * names.length)]];
      const to = VOWELS[names[Math.floor(Math.random() * names.length)]];

      const src = ctx.createGain();
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.5, t + att);
      out.gain.setValueAtTime(0.5, t + dur);
      out.gain.linearRampToValueAtTime(0, end);
      out.connect(this.bus.choir);
      from.forEach(([freq, gain], i) => {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 9 + i * 2;
        f.frequency.setValueAtTime(freq, t);
        f.frequency.linearRampToValueAtTime(to[i][0], t + dur);
        const fg = ctx.createGain();
        fg.gain.setValueAtTime(gain, t);
        fg.gain.linearRampToValueAtTime(to[i][1], t + dur);
        src.connect(f).connect(fg).connect(out);
      });

      midis.forEach((m) => {
        const vib = ctx.createOscillator();
        vib.frequency.value = 4.3 + Math.random() * 1.4;
        const vg = ctx.createGain();
        vg.gain.setValueAtTime(0, t);
        vg.gain.linearRampToValueAtTime(10 + Math.random() * 8, t + att + 0.8); // в центах
        vib.connect(vg);
        vib.start(t);
        this.track(vib, end);
        [-11, 9].forEach((det) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(m);
          o.detune.value = det + (Math.random() * 8 - 4);
          vg.connect(o.detune);
          o.connect(src);
          o.start(t);
          this.track(o, end);
        });
      });

      const breath = ctx.createBufferSource();
      breath.buffer = this.noise;
      breath.loop = true;
      const bg = ctx.createGain();
      bg.gain.value = 0.12;
      breath.connect(bg).connect(src);
      breath.start(t, Math.random() * 1.5);
      this.track(breath, end);
    }

    bass(t, midi, dur) {
      const ctx = this.ctx;
      const inst = this.p.bassInst;
      const freq = mtof(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.connect(this.bus.bass);

      if (inst === 'fm') {
        // упругий FM-бас в духе сити-попа
        const len = Math.min(dur, 0.55);
        const car = ctx.createOscillator();
        const mo = ctx.createOscillator();
        car.frequency.value = freq;
        mo.frequency.value = freq * 2;
        const mg = ctx.createGain();
        mg.gain.setValueAtTime(freq * 2.5, t);
        mg.gain.exponentialRampToValueAtTime(freq * 0.2, t + 0.12);
        mo.connect(mg).connect(car.frequency);
        g.gain.linearRampToValueAtTime(0.55, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, t + len);
        car.connect(g);
        [car, mo].forEach((o) => {
          o.start(t);
          this.track(o, t + len + 0.05);
        });
        return;
      }

      if (inst === 'bowed') {
        // смычковый бурдон: медленная атака, тянется всю длительность
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 280 + this.p.bright * 320;
        f.connect(g);
        g.gain.linearRampToValueAtTime(0.11, t + 0.12);
        g.gain.setValueAtTime(0.11, t + dur * 0.8);
        g.gain.linearRampToValueAtTime(0, t + dur + 0.25);
        [[-5, 0], [5, 0], [0, 7]].forEach(([det, semis]) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(midi + semis);
          o.detune.value = det;
          o.connect(f);
          o.start(t);
          this.track(o, t + dur + 0.3);
        });
        return;
      }

      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.connect(g);
      let types = ['sine', 'triangle'];
      let peak = 0.32;
      if (inst === 'synth') {
        // пила с резонансным фильтром
        types = ['sawtooth'];
        peak = 0.75;
        f.Q.value = 6;
        f.frequency.setValueAtTime(900 + this.p.bright * 1600, t);
        f.frequency.exponentialRampToValueAtTime(320, t + 0.22);
      } else f.frequency.value = 350 + this.p.bright * 700;
      g.gain.linearRampToValueAtTime(peak, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      types.forEach((type) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.connect(f);
        o.start(t);
        this.track(o, t + dur + 0.05);
      });
    }

    arpNote(t, midi, vel) {
      const inst = this.p.arpInst;
      if (inst === 'harp') this.harp(t, midi, vel * 0.8, this.bus.arp);
      else if (inst === 'chip') this.chip(t, midi, vel);
      else this.pluck(t, midi, vel);
    }

    lead(t, midi, dur, vel) {
      const inst = this.p.leadInst;
      if (inst === 'flute') this.flute(t, midi, dur, vel);
      else if (inst === 'harp') this.harp(t, midi, vel, this.bus.lead);
      else if (inst === 'musicbox') this.bell(t, midi + 12, vel * 1.3, this.bus.lead, 1.1);
      else if (inst === 'synth') this.synthLead(t, midi, dur, vel);
      else this.keys(t, midi, dur, vel);
    }

    // Щипок струны по Карплусу–Стронгу: шумовой импульс гоняется по кольцу с усреднением,
    // высокие гармоники гаснут быстрее низких — как у настоящей струны. Буфер на ноту кэшируется.
    stringBuffer(midi) {
      if (this.strings[midi]) return this.strings[midi];
      const sr = this.ctx.sampleRate;
      const freq = mtof(midi);
      const n = Math.max(2, Math.round(sr / freq - 0.5));
      const t60 = clamp(4.5 - (midi - 40) * 0.055, 1.2, 4.5); // низкие струны звенят дольше
      const loss = Math.pow(0.001, 1 / (freq * t60));
      const len = Math.floor(sr * t60);
      const buf = this.ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const ring = new Float32Array(n);
      let prev = 0;
      for (let i = 0; i < n; i++) {
        prev = prev * 0.45 + (Math.random() * 2 - 1) * 0.55; // чуть смягчаем щипок
        ring[i] = prev;
      }
      let peak = 0;
      for (let i = 0, k = 0; i < len; i++) {
        const next = k + 1 === n ? 0 : k + 1;
        d[i] = ring[k];
        ring[k] = (ring[k] + ring[next]) * 0.5 * loss;
        peak = Math.max(peak, Math.abs(d[i]));
        k = next;
      }
      const fade = Math.floor(sr * 0.03);
      for (let i = 0; i < len; i++) d[i] = (d[i] / peak) * Math.min(1, (len - i) / fade);
      // длина кольца целая, поэтому точную высоту добираем скоростью воспроизведения
      return (this.strings[midi] = { buf, rate: freq / (sr / (n + 0.5)) });
    }

    pluckString(t, midi, vel, bus, tone) {
      const ctx = this.ctx;
      const str = this.stringBuffer(midi);
      const src = ctx.createBufferSource();
      src.buffer = str.buf;
      src.playbackRate.value = str.rate;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = tone;
      const g = ctx.createGain();
      g.gain.value = vel;
      src.connect(f).connect(g).connect(bus);
      src.start(t);
      this.track(src, t + str.buf.duration);
    }

    harp(t, midi, vel, bus) {
      this.pluckString(t, midi, vel * 0.55, bus, 2200 + this.p.bright * 4500);
    }

    // Лютневый бой: аккорд перебором вниз, в середине такта — лёгкий удар вверх
    strum(t, midis, dur) {
      const notes = midis.slice().sort((a, b) => a - b);
      const tone = 1800 + this.p.bright * 3500;
      notes.forEach((m, i) => this.pluckString(t + i * 0.028, m, 0.28, this.bus.pad, tone));
      if (dur < 1.2) return;
      const half = Math.min(dur / 2, (this.steps() / 2) * (60 / this.p.bpm / this.beat()));
      notes.slice(-3).reverse().forEach((m, i) => this.pluckString(t + half + i * 0.022, m, 0.17, this.bus.pad, tone));
    }

    // Чиптюн: голый меандр, короткая нота
    chip(t, midi, vel) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.17, t);
      g.gain.setValueAtTime(vel * 0.17, t + 0.09);
      g.gain.linearRampToValueAtTime(0, t + 0.13);
      o.connect(g).connect(this.bus.arp);
      o.start(t);
      this.track(o, t + 0.15);
    }

    // Флейта: гармоники с «подъездом» к ноте, вибрато и шумом дыхания (сильный на атаке, тихий дальше)
    flute(t, midi, dur, vel) {
      const ctx = this.ctx;
      const freq = mtof(midi);
      const len = Math.max(0.05, dur * 0.92);
      const short = len < 0.15;
      const att = short ? 0.015 : 0.045;
      const rel = short ? 0.03 : 0.09;
      const end = t + len + rel + 0.02;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel * 0.15, t + att);
      g.gain.setValueAtTime(vel * 0.15, t + len);
      g.gain.linearRampToValueAtTime(0, t + len + rel);
      g.connect(this.bus.lead);
      const vib = ctx.createOscillator();
      vib.frequency.value = 4.8 + Math.random() * 0.6;
      const vg = ctx.createGain();
      vg.gain.value = 0;
      vg.gain.setValueAtTime(0, t + 0.18);
      vg.gain.linearRampToValueAtTime(12, t + 0.5);
      vib.connect(vg);
      vib.start(t);
      this.track(vib, end);
      [[1, 1], [2, 0.32], [3, 0.1], [4, 0.04]].forEach(([mult, level]) => {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(freq * mult * 0.985, t);
        o.frequency.exponentialRampToValueAtTime(freq * mult, t + 0.05);
        vg.connect(o.detune);
        const og = ctx.createGain();
        og.gain.value = level;
        o.connect(og).connect(g);
        o.start(t);
        this.track(o, end);
      });
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * 1.5;
      bp.Q.value = 1.2;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.9, t);
      bg.gain.exponentialRampToValueAtTime(0.16, t + 0.12);
      this.noiseSrc(t, Math.min(len + rel, 1.9)).connect(bp).connect(bg).connect(g);
    }

    // Синт-лид: пила + меандр, скольжение от предыдущей ноты
    synthLead(t, midi, dur, vel) {
      const ctx = this.ctx;
      const freq = mtof(midi);
      const from = this.lastLead && t - this.lastLead.t < 1.5 ? this.lastLead.freq : freq;
      this.lastLead = { freq, t };
      const len = Math.max(0.15, dur * 0.9);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 2;
      f.frequency.value = 1200 + this.p.bright * 3500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel * 0.1, t + 0.012);
      g.gain.setValueAtTime(vel * 0.1, t + len);
      g.gain.linearRampToValueAtTime(0, t + len + 0.12);
      f.connect(g).connect(this.bus.lead);
      [['sawtooth', -6], ['square', 6]].forEach(([type, det]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.detune.value = det;
        o.frequency.setValueAtTime(from, t);
        o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
        o.connect(f);
        o.start(t);
        this.track(o, t + len + 0.15);
      });
    }

    pluck(t, midi, vel) {
      const ctx = this.ctx;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 3;
      f.frequency.setValueAtTime(700 + this.p.bright * 5000, t);
      f.frequency.exponentialRampToValueAtTime(300, t + 0.28);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel * 0.3, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.5);
      f.connect(g).connect(this.bus.arp);
      [['sawtooth', -5], ['triangle', 6]].forEach(([type, det]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(midi);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        this.track(o, t + 0.55);
      });
    }

    // Электропиано: мягкий FM с быстро гаснущим «молоточком»
    keys(t, midi, dur, vel) {
      const ctx = this.ctx;
      const freq = mtof(midi);
      const len = Math.max(0.7, dur + 0.9);
      const mo = ctx.createOscillator();
      mo.frequency.value = freq;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(freq * (0.6 + this.p.bright * 1.2), t);
      mg.gain.exponentialRampToValueAtTime(freq * 0.08, t + 0.45);
      mo.connect(mg);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel * 0.075, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      g.connect(this.bus.lead);
      mo.start(t);
      this.track(mo, t + len + 0.05);
      [-4, 4].forEach((det) => {
        const car = ctx.createOscillator();
        car.frequency.value = freq;
        car.detune.value = det;
        mg.connect(car.frequency);
        car.connect(g);
        car.start(t);
        this.track(car, t + len + 0.05);
      });
    }

    bell(t, midi, vel, bus, decay = 2.6) {
      const ctx = this.ctx;
      const freq = mtof(midi);
      const car = ctx.createOscillator();
      const mo = ctx.createOscillator();
      mo.frequency.value = freq * 3.01;
      car.frequency.value = freq;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(freq * 1.8, t);
      mg.gain.exponentialRampToValueAtTime(freq * 0.01, t + 1.2);
      mo.connect(mg).connect(car.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel * 0.1, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      car.connect(g).connect(bus || this.bus.bells);
      car.start(t);
      mo.start(t);
      this.track(car, t + decay + 0.1);
      this.track(mo, t + decay + 0.1);
    }

    noiseSrc(t, dur) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.start(t, Math.random() * 1.5);
      this.track(src, t + dur);
      return src;
    }

    kit() {
      return KITS[this.p.kit] || KITS.lofi;
    }

    kick(t, vel) {
      const ctx = this.ctx;
      const [f0, f1, dec, gain] = this.kit().kick;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      o.connect(g).connect(this.bus.drums);
      o.start(t);
      this.track(o, t + dec + 0.02);
    }

    snare(t, vel) {
      const ctx = this.ctx;
      const k = this.kit().snare;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = k.hp;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * k.noise, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + k.dec);
      this.noiseSrc(t, k.dec + 0.02).connect(hp).connect(g).connect(this.bus.drums);
      if (!k.tone) return;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(k.tone, t);
      o.frequency.exponentialRampToValueAtTime(k.tone * 0.7, t + 0.08);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vel * k.toneGain, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(og).connect(this.bus.drums);
      o.start(t);
      this.track(o, t + 0.12);
    }

    hat(t, vel, open) {
      const ctx = this.ctx;
      const k = this.kit().hat;
      const dur = open ? 0.25 : k.dec;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = k.hp;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * k.gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      this.noiseSrc(t, dur + 0.02).connect(hp).connect(g).connect(this.bus.drums);
    }

    // ---------- запись ----------

    startRecording() {
      this.init();
      const chunks = [];
      this.recorder = new MediaRecorder(this.recDest.stream);
      this.recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      this.recorded = new Promise((resolve) => {
        this.recorder.onstop = () => resolve(new Blob(chunks, { type: this.recorder.mimeType }));
      });
      this.recorder.start();
    }

    stopRecording() {
      this.recorder.stop();
      return this.recorded;
    }
  }

  window.Synth = { Engine, SCALES, NOTE_NAMES, LAYERS, STEPS, THEMES, MOODS };
})();
