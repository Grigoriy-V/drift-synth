// Сочинение: из сида и жанровых параметров выводятся профиль трека, аккорды, мелодия,
// ударные, бас и аккомпанемент. Всё строится по правилам, готовых паттернов нет.
(function () {
  'use strict';

  const D = (window.Drift = window.Drift || {});
  const { SCALES, METERS, NOTE_NAMES, THEMES, MOODS, FEELS, DEFAULT_VOLS, LAYERS, mod, clamp, euclid, makeChord, rngFrom } = D;

  class Composer {
    constructor() {
      this.p = { layers: {} }; // трек: тональность, темп, инструменты, настройки звука, слои
      this.song = {}; // материал: аккорды, напевы, паттерны
      this.rng = null; // задаётся движком
    }

    // Профиль трека в рамках темы и настроения. evolve — следующая глава того же трека:
    // тональность сдвигается от текущей, размер сохраняется
    rollTrack(theme, mood, evolve) {
      const p = this.p;
      const r = this.rng;
      p.theme = theme;
      p.mood = mood;
      const th = this.theme();
      const md = this.mood();
      const any = (list) => list[Math.floor(r() * list.length)];
      if (evolve) {
        p.root = mod(p.root + this.pick([5, 7, 3, -3, 2, -2], [3, 3, 2, 2, 1, 1]), 12);
        if (r() < 0.7) p.scale = any(md.scales);
      } else {
        p.root = Math.floor(r() * 12);
        p.scale = any(md.scales);
      }
      p.style = th.styles ? any(th.moodStyles[mood] || Object.keys(th.styles)) : '';
      const st = this.style();
      const from = (k) => st[k] || th[k];
      ['padInst', 'arpInst', 'bassInst', 'kit', 'amb'].forEach((k) => (p[k] = any(from(k))));
      p.leadInst = from('leadInst')[0];
      p.chordBars = any(from('chordBars'));
      p.drumStyle = any(from('drumStyle'));
      if (!evolve || r() < 0.3) p.meter = any(from('meter')); // новая глава иногда меняет и размер

      const m = th.mix;
      const around = (base, width, lo = 0, hi = 1) => +clamp(base + (r() - 0.5) * 2 * width, lo, hi).toFixed(2);
      p.reverb = around(m.reverb + (md.reverb || 0), 0.15);
      p.delay = around(m.delay, 0.15);
      p.bright = around(m.bright + md.bright, 0.12, 0.05);
      p.density = around(m.density + md.density + (st.density || 0), 0.15, 0.05);
      p.tape = around(m.tape, 0.15);
      p.pump = around(m.pump, 0.1, 0, 0.7);
      p.drive = around(m.drive, 0.12);
      p.swing = m.swing > 0.02 ? around(m.swing, 0.1, 0, 0.6) : 0;
      p.bpm = Math.round(clamp(m.bpm * md.tempo * (st.tempo || 1) * (0.94 + r() * 0.12), 50, 150));

      const ensemble = Object.assign({}, th.ensemble, st.ensemble);
      p.layers = {};
      for (const name in LAYERS) {
        const vol = (th.vols[name] || DEFAULT_VOLS[name]) * (0.8 + r() * 0.4);
        p.layers[name] = { on: r() < ensemble[name], vol: +clamp(vol, 0.05, 1).toFixed(2) };
      }
    }

    // Материал главы: аккорды, два напева (основной и для вариации) и два мелодических инструмента
    newMaterial() {
      const r = this.rng;
      const leads = this.style().leadInst || this.theme().leadInst;
      this.fork(() => this.genProgs());
      this.song.melodyA = this.fork(() => this.genMelody());
      this.song.melodyB = this.fork(() => this.genMelody());
      this.song.melody = this.song.melodyA;
      // первый в списке — «фирменный» инструмент темы, он ведёт чаще остальных
      this.leadA = r() < 0.3 ? leads[0] : leads[Math.floor(r() * leads.length)];
      const others = leads.filter((x) => x !== this.leadA);
      this.leadB = others.length ? others[Math.floor(r() * others.length)] : this.leadA;
      this.fork(() => this.genDrums());
      this.fork(() => this.genBass());
      this.fork(() => this.genArp());
    }

    // Выполнить генератор на собственном потоке случайных чисел. Основной поток тратит на это ровно
    // одно число, поэтому правка, меняющая один рисунок (например плотность), не сдвигает остальное:
    // аккорды, порядок секций и главы остаются прежними
    fork(gen) {
      const main = this.rng;
      this.rng = rngFrom(main());
      const out = gen();
      this.rng = main;
      return out;
    }

    pick(items, weights) {
      let r = this.rng() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    }

    // Размер: 4/4 — такт из 16 шестнадцатых, 12/8 — четыре доли по три восьмых (джига)
    steps() {
      return this.beats() * this.beat();
    }

    beat() {
      return (METERS[this.p.meter] || METERS['4/4']).sub;
    }

    beats() {
      return (METERS[this.p.meter] || METERS['4/4']).beats;
    }

    // Сколько тактов держится один аккорд; такт из двух долей короткий — держим вдвое дольше
    slotBars() {
      return this.p.chordBars * (this.beats() <= 2 ? 2 : 1);
    }

    // Шаг такта, с которого может вступить второй аккорд (середина такта по долям)
    split() {
      return Math.ceil(this.beats() / 2) * this.beat();
    }

    theme() {
      return THEMES[this.p.theme] || THEMES.lofi;
    }

    style() {
      const th = this.theme();
      return (th.styles && th.styles[this.p.style]) || {};
    }

    mood() {
      return MOODS[this.p.mood] || MOODS.calm;
    }

    // ---------- гармония ----------

    // Аккорд на ступени лада; тип (трезвучие, септ-, нонаккорд, открытая квинта, sus) — по правилам темы.
    // scale — другой лад от той же тоники: так берутся аккорды, заимствованные из параллельного лада
    buildChord(deg, scale) {
      const r = this.rng;
      const h = this.theme().harmony;
      const at = (o) => this.degToMidi(deg + o, 0, scale) - this.degToMidi(deg, 0, scale);
      let ints = [0, at(2), at(4)];
      if (h.ext === 'ninth' || (h.seventh && r() < h.seventh)) {
        ints.push(at(6));
        if (h.ext === 'ninth' && at(1) === 2 && r() < 0.55) ints.push(14); // нона — только большая
      } else if (ints[2] === 7) {
        if (h.open && r() < h.open) ints = [0, 7, 12];
        else if (h.sus && at(3) === 5 && r() < h.sus) ints = [0, 5, 7];
      }
      return makeChord(mod(this.degToMidi(deg, 0, scale), 12), ints);
    }

    // Ход на 8 аккордов сочиняется по правилам:
    //   две фразы по 4 аккорда; корни движутся предпочтительно на кварту вверх, на секунду и на терцию вниз;
    //   характерные ступени лада (bVII, мажорная II, bII) весят больше, уменьшенные почти исключены;
    //   первая фраза не кончается тоникой, вторая начинается как первая и приходит к каденции;
    //   затем краски: мажорная доминанта, побочные доминанты, аккорд из параллельного лада,
    //   и в конце фразы — два аккорда на месте одного (гармония «ускоряется» к каденции).
    genProg(first) {
      const r = this.rng;
      const p = this.p;
      const n = SCALES[p.scale].length;
      const semis = (d) => mod(this.degToMidi(d, 0), 12);
      const third = (d) => this.degToMidi(d + 2, 0) - this.degToMidi(d, 0);
      const weight = (d) => {
        if (this.isDim(d)) return 0.08;
        let w = [1.2, 1, 0.7, 1.5, 1.5, 1.2, 0.9][d] || 1;
        const major = third(d) === 4;
        if (major && (semis(d) === 10 || semis(d) === 2 || semis(d) === 1)) w *= 1.7; // краска лада
        return w;
      };
      const motion = { 3: 4, 1: 2, [n - 1]: 2, [n - 2]: 2.5, 2: 1, 4: 1.5 }; // на сколько ступеней вверх → вес
      const next = (prev, ban) => {
        const degs = [];
        const ws = [];
        for (let d = 0; d < n; d++) {
          if (d === prev || d === ban) continue;
          degs.push(d);
          ws.push((motion[mod(d - prev, n)] || 0.6) * weight(d));
        }
        return this.pick(degs, ws);
      };
      const among = (list) => {
        const ok = list.filter((d) => d < n && !this.isDim(d));
        return ok.length ? this.pick(ok, ok.map(weight)) : n - 1;
      };
      const dominant = () => among([4, 6]);
      const predominant = () => among([3, 1, 5]);

      const degs = [first];
      degs.push(next(degs[0]));
      degs.push(next(degs[1]));
      degs.push(next(degs[2], 0)); // половинная каденция: не тоника
      degs.push(degs[0]);
      degs.push(r() < 0.6 ? degs[1] : next(degs[4]));
      if (r() < 0.55) degs.push(dominant(), 0);
      else degs.push(predominant(), dominant());

      const h = this.theme().harmony;
      const chords = degs.map((d) => this.buildChord(d));
      const dom7 = (root) => makeChord(mod(root, 12), [0, 4, 7, 10]);
      // минорная доминанта перед тоникой иногда становится мажорной (гармонический минор)
      chords.forEach((ch, i) => {
        const to = chords[(i + 1) % 8];
        if (h.harmonicV && ch.root === 7 && ch.ints[1] === 3 && to.root === 0 && r() < h.harmonicV) {
          chords[i] = makeChord(7, h.ext === 'triad' ? [0, 4, 7] : [0, 4, 7, 10]);
        }
      });
      // аккорд из параллельного лада: в мажоре — минорная субдоминанта, bVI, bVII; в миноре — мажорная IV
      if (h.borrow && r() < h.borrow) {
        const par = SCALES[p.scale][2] === 4 || p.scale === 'dorian' ? 'minor' : 'dorian';
        const spots = [2, 3, 5, 6].filter((i) => degs[i] !== 0 && chords[i].root === semis(degs[i]));
        if (spots.length) {
          const i = spots[Math.floor(r() * spots.length)];
          const b = this.buildChord(degs[i], par);
          const dim = b.ints.includes(6) && !b.ints.includes(7);
          if (!dim && (b.root !== chords[i].root || b.ints[1] !== chords[i].ints[1])) chords[i] = b;
        }
      }
      // джазовые замены: побочная доминанта перед аккордом или тритоновая замена доминанты
      if (h.subs) {
        let left = 2;
        for (let i = 1; i < 8 && left; i++) {
          if (i === 4 || r() > h.subs) continue;
          const to = chords[(i + 1) % 8];
          const cur = chords[i];
          const isDom = cur.ints[1] === 4 && cur.ints.includes(10) && mod(cur.root - to.root, 12) === 7;
          if (isDom) chords[i] = dom7(to.root + 1);
          else if (to.root !== cur.root) chords[i] = dom7(to.root + 7);
          else continue;
          left--;
        }
      }
      // второй аккорд в конце фразы (tail): вступает с середины последнего такта
      if (h.split) {
        [3, 6].forEach((i) => {
          if (r() > h.split) return;
          const t = i === 3 ? dominant() : next(degs[i], degs[i + 1]);
          const tail = this.buildChord(t);
          if (tail.root !== chords[i].root && tail.root !== chords[(i + 1) % 8].root) chords[i].tail = tail;
        });
      }
      return chords;
    }

    genProgs() {
      const n = SCALES[this.p.scale].length;
      const starts = [0, 0, 0, 3, 5].filter((d) => d < n && !this.isDim(d));
      this.song.progA = this.genProg(starts[Math.floor(this.rng() * starts.length)]);
      // ход для вариаций начинается с другой ступени — контраст с основным
      const other = [3, 5, 1, 2].filter((d) => d < n && !this.isDim(d));
      this.song.progB = this.genProg(other[Math.floor(this.rng() * other.length)] ?? 0);
      this.song.prog = this.song.progA;
    }

    isDim(deg) {
      return this.degToMidi(deg + 4, 0) - this.degToMidi(deg, 0) === 6;
    }

    rootShift() {
      return this.p.root > 6 ? this.p.root - 12 : this.p.root;
    }

    degToMidi(deg, base, scale) {
      const sc = SCALES[scale || this.p.scale];
      return base + 12 * Math.floor(deg / sc.length) + sc[mod(deg, sc.length)];
    }

    // Аккорд в тесном расположении (голоса в одной октаве) + корень октавой ниже.
    // У пятизвучий верхний корень опускаем — он уже есть в басу, так аккорд звучит прозрачнее.
    // pedal — органный пункт: в басу остаётся тоника, какой бы аккорд ни звучал
    chordMidis(ch, pedal) {
      const base = 48 + this.rootShift();
      const upper = ch.ints.length >= 5 ? ch.ints.slice(1) : ch.ints;
      const tones = upper.map((i) => base + mod(ch.root + i, 12) + (i >= 12 ? 12 : 0));
      tones.push(base - 12 + (pedal ? 0 : ch.root));
      return tones;
    }

    chordName(ch) {
      const name = (c) => NOTE_NAMES[mod(c.root + this.p.root, 12)] + c.label;
      return name(ch) + (ch.tail ? ' › ' + name(ch.tail) : '');
    }

    // ---------- мелодия ----------

    // Напев на 16 тактов строится из мотива — ритма на такт и рисунка интервалов — и его развития:
    //   фраза 1 (4 такта): мотив и его развитие по одной из схем, в конце — «открытая» долгая нота;
    //   фраза 2: ответ с закрытой каденцией, либо пауза, либо короткая реплика второго инструмента;
    //   фраза 3: повтор первой с вариацией (проходящие ноты или прореживание);
    //   фраза 4: заключение на тонике.
    // Перед началом фраз бывает затакт. Ступени считаются от тоники; при игре ноты сильных долей
    // подтягиваются к звучащему аккорду. Нота: d — ступень, len — длина в шагах, voice — 1 для реплики.
    genMelody() {
      const r = this.rng;
      const n = SCALES[this.p.scale].length;
      const steps = this.steps();
      const beat = this.beat();
      const nb = this.beats();
      const mood = this.mood();
      const d = this.p.density;
      const synco = this.theme().synco || 0;
      // ритмические ячейки на одну долю и их веса; последние — синкопы
      const cells = beat === 3 ? [[1, 0, 1], [1, 0, 0], [1, 1, 1], [0, 0, 0], [0, 1, 1]] : [[1, 0, 1, 0], [1, 0, 0, 0], [1, 0, 1, 1], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 1, 0], [1, 0, 0, 1]];
      const weights = beat === 3 ? [3, 2.2 - d * 1.5, d * 2.5, mood.rest * 2, synco] : [3, 2.4 - d * 1.5, d * 1.5, d * 0.7, mood.rest * 2, synco * 1.5, synco * 1.5];
      const REST = beat === 3 ? 3 : 4;
      const moves = [-2, -1, 1, 2, 3, -3];
      // в основном поступенно; настроение смещает движение вверх или вниз
      const dir = mood.dir || 0;
      const moveW = [1 - dir, 4 * (1 - dir), 4 * (1 + dir), 1 + dir, mood.leap * 2 * (1 + dir), mood.leap * 2 * (1 - dir)];
      const top = n + 4;

      const rhythm = () => {
        const bar = [];
        for (let b = 0; b < nb; b++) {
          let cell;
          if (b === 0) cell = cells[r() < 0.7 ? 0 : 1]; // такт начинается с ноты
          else if (b === nb - 1) cell = cells[r() < mood.rest ? REST : 1]; // а кончается долгой нотой или паузой
          else cell = this.pick(cells, weights);
          bar.push(...cell);
        }
        return bar;
      };
      const contour = (rh) => rh.filter(Boolean).slice(1).map(() => this.pick(moves, moveW));
      // положить рисунок на ритм, начиная со ступени from; за край диапазона не выходим
      const realize = (from, rh, mv) => {
        const bar = new Array(steps).fill(null);
        let deg = clamp(from, 0, top);
        let k = 0;
        rh.forEach((on, i) => {
          if (!on) return;
          if (k > 0) deg += mv[k - 1];
          if (deg < 0 || deg > top) deg = clamp(deg, 0, top) + (deg < 0 ? 1 : -1);
          bar[i] = { d: deg };
          k++;
        });
        return { bar, end: deg };
      };
      const empty = () => new Array(steps).fill(null);
      const hold = Math.floor(nb / 2) * beat; // с середины такта — долгая заключительная нота
      const cadence = (from, rh, mv, final) => {
        const c = realize(from, rh, mv).bar;
        for (let i = hold; i < steps; i++) c[i] = null;
        c[hold] = { d: final, long: true, strong: true };
        return c;
      };

      // мотив a и контрастный мотив b
      const R = rhythm();
      const M = contour(R);
      const R2 = rhythm();
      const M2 = contour(R2);
      // нисходящая мелодия начинает выше и секвенцируется вниз
      const falling = dir < -0.2;
      const start = falling ? this.pick([n, n + 2, 4], [3, 2, 2]) : this.pick([4, n, 2], [3, 2, 2]);
      const up = this.pick([1, 2], [2, 1]) * (falling ? -1 : 1);
      const near = (deg) => clamp(Math.abs(deg + n - start) < Math.abs(deg - start) ? deg + n : deg, 0, top); // в ближайшей октаве
      const home = near(0);
      const open = near(this.pick([4, 1, 2], [3, 2, 1]));
      const a = (shift, inv) => realize(start + shift, R, inv ? M.map((x) => -x) : M);
      // схемы развития: seq — мотив трижды всё выше (или в обращении), period — a b a, sentence — a a' b
      const phrase = (form, final) => {
        const b1 = a(0);
        let b2;
        let b3;
        if (form === 'period') {
          b2 = realize(b1.end, R2, M2);
          b3 = a(0);
        } else if (form === 'sentence') {
          b2 = a(up);
          b3 = realize(b2.end, R2, M2);
        } else {
          b2 = a(up);
          b3 = r() < 0.5 ? a(up * 2) : a(up, true);
        }
        return [b1.bar, b2.bar, b3.bar, cadence(start, R, M, final)];
      };
      const forms = ['seq', 'period', 'sentence'];
      const form = this.pick(forms, [3, 2, 2]);

      const p1 = phrase(form, open);
      let p2;
      if (r() < mood.rest * 1.2) {
        // мелодия «дышит»: тишина либо короткая реплика второго инструмента
        p2 = [empty(), empty(), empty(), empty()];
        if (r() < 0.6) {
          const reply = realize(start - 2, R, M.map((x) => -x)).bar;
          const last = empty();
          last[0] = { d: home, long: true, strong: true };
          p2 = [reply, last, empty(), empty()];
          p2.forEach((bar) => bar.forEach((x) => x && (x.voice = 1)));
        }
      } else p2 = phrase(this.pick(forms, [2, 2, 2]), r() < 0.4 ? open : home);

      // вариация при повторе: проходящие и вспомогательные ноты либо прореживание
      const ornament = (bar) => {
        const out = bar.slice();
        let prev = -1;
        bar.forEach((x, i) => {
          if (!x) return;
          if (prev >= 0 && i - prev >= 2 && r() < 0.6) {
            const diff = x.d - bar[prev].d;
            const mid = prev + Math.floor((i - prev) / 2);
            if (Math.abs(diff) === 2) out[mid] = { d: bar[prev].d + diff / 2 };
            else if (diff === 0) out[mid] = { d: Math.min(top, x.d + 1) };
          }
          prev = i;
        });
        return out;
      };
      const thin = (bar) => bar.map((x, i) => (x && i % (beat * 2) !== 0 && r() < 0.4 ? null : x));
      const how = this.pick([ornament, thin, (bar) => bar], [1 + d * 2, mood.rest * 3, 1]);
      const p3 = p1.map((bar, i) => (i < 3 ? how(bar) : bar));
      const p4 = phrase(form === 'seq' ? 'sentence' : 'seq', home);

      // ноты мотива встречаются в нескольких тактах — каждой позиции нужна своя копия
      const flat = [...p1, ...p2, ...p3, ...p4].flat().map((x) => x && Object.assign({}, x));
      // затакт: одна-две ноты, подводящие к первой ноте фразы
      const unit = beat === 4 ? 2 : 1;
      [0, 8, 12].forEach((bar) => {
        const at = bar * steps;
        if (!flat[at] || r() > 0.25 + d * 0.3) return;
        const side = r() < 0.65 ? -1 : 1;
        const count = r() < 0.5 ? 2 : 1;
        for (let k = 1; k <= count; k++) {
          const pos = mod(at - k * unit, flat.length);
          if (!flat[pos]) flat[pos] = { d: clamp(flat[at].d + side * k, 0, top) };
        }
      });

      // длительности: до следующей ноты, но не дольше двух долей; заключительная нота тянется до конца такта
      const idx = [];
      flat.forEach((x, i) => x && idx.push(i));
      idx.forEach((i, k) => {
        const x = flat[i];
        const next = k + 1 < idx.length ? idx[k + 1] : flat.length + idx[0];
        x.len = Math.min(next - i, x.long ? steps - (i % steps) : beat * 2);
        // «сильные» ноты — на 1-й и 3-й долях: они всегда берутся из аккорда
        x.strong = x.strong || (i % steps) % (beat * 2) === 0;
      });
      return flat;
    }

    // ---------- ударные, бас, перебор ----------

    // Ударные сочиняются на 4 такта: A, вариация A, снова A, вариация с подводкой.
    // Рисунок строится по правилам: опорные доли, синкопы бочки по взвешенным позициям,
    // тихие удары между долями, один из типов рисунка хэта, шейкер. Характер задают вероятности из FEELS.
    genDrums() {
      const r = this.rng;
      const d = this.p.density;
      const steps = this.steps();
      const beat = this.beat();
      const feel = FEELS[this.style().feel || this.theme().feel] || FEELS.plain;
      const style = this.p.drumStyle;
      const B = (n) => n * beat; // шаг, с которого начинается доля
      const chance = (p) => r() < p;
      const zeros = () => new Array(steps).fill(0);
      const A = { k: zeros(), s: zeros(), h: zeros(), o: new Array(steps).fill(false), p: zeros(), t: zeros() };
      const free = (bar, s) => !bar.k[s] && !bar.k[s - 1] && !bar.k[s + 1];
      const nb = this.beats();
      // слабые доли для малого барабана и «середина» такта для второй опоры бочки
      const backs = { 2: [1], 3: [1, 2], 4: [1, 3], 5: [2, 4] }[nb];
      const mid = { 4: 2, 5: 3 }[nb];
      const lastBack = B(backs[backs.length - 1]);
      const backbeat = (s) => backs.some((n) => s === B(n));

      // бочка
      A.k[0] = 1;
      if (feel.sparse) {
        if (chance(0.5)) A.k[B(mid || nb - 1) + (chance(0.5) ? 0 : beat - 1)] = 0.6;
      } else if (style === 'four') {
        for (let n = 1; n < nb; n++) A.k[B(n)] = 1;
      } else {
        if (mid && feel.kick3 && chance(feel.kick3)) A.k[B(mid)] = 0.8;
        const count = style === 'half' ? (chance(0.6) ? 1 : 0) : Math.round(feel.sync * (0.6 + d * 1.6));
        for (let i = 0; i < count; i++) {
          const cand = [];
          const ws = [];
          for (let s = 2; s < steps; s++) {
            if (backbeat(s) || !free(A, s)) continue;
            const pos = s % beat;
            const w = pos === 0 ? 1.2 : beat === 4 ? (pos === 2 ? 2 : 1) : pos === 2 ? 2 : 0.6;
            cand.push(s);
            ws.push(w * (s >= steps / 2 ? 1.5 : 1));
          }
          if (cand.length) A.k[this.pick(cand, ws)] = 0.85;
        }
      }

      // малый барабан и ghost-ноты
      if (!feel.sparse) {
        if (style === 'half') A.s[mid ? B(mid) : lastBack] = 1;
        else if (feel.snare === undefined || chance(feel.snare)) backs.forEach((n) => (A.s[B(n)] = nb === 3 ? 0.6 : 0.9)); // в трёхдольных — мягче: «ум-па-па»
        for (let s = 1; s < steps; s++) {
          if (s % beat !== 0 && !A.k[s] && !A.s[s] && chance(feel.ghost * (0.03 + d * 0.1))) A.s[s] = 0.3;
        }
      }

      // хэт: один из рисунков
      const type = feel.hats[Math.floor(r() * feel.hats.length)];
      for (let s = 0; s < steps; s++) {
        const pos = s % beat;
        let v = 0;
        if (type === '4') v = pos === 0 && (!feel.sparse || chance(0.6)) ? (feel.sparse ? 0.4 : 0.7) : 0;
        else if (type === 'off') v = pos === 2 ? 0.8 : beat === 3 && pos === 0 ? 0.5 : 0;
        else if (type === '16') v = pos === 0 ? 0.8 : beat === 4 && pos === 2 ? 0.6 : 0.35;
        else if (type === 'skip') v = pos === 0 ? 0.8 : (beat === 3 || pos === 2) && chance(0.6) ? 0.45 : 0;
        else v = pos === 0 ? 0.8 : beat === 4 ? (pos === 2 ? 0.55 : 0) : 0.4;
        if (v > 0 && v < 0.5 && !feel.sparse && r() > 0.45 + d) v = 0; // при низкой плотности тихие удары выпадают
        A.h[s] = v;
      }
      if (chance(feel.open)) {
        const s = steps - (beat === 4 ? 2 : 1);
        A.h[s] = 0.7;
        A.o[s] = true;
      }

      // шейкер (в народном наборе — бубен): акцент между долями, иногда ровная пульсация
      if (!feel.sparse && chance(feel.perc || 0)) {
        const even = chance(0.5);
        for (let s = 0; s < steps; s++) {
          const pos = s % beat;
          const off = beat === 4 ? pos === 2 : pos === beat - 1;
          A.p[s] = off ? 0.8 : even ? (pos === 0 ? 0.5 : 0.3) : 0;
        }
      }

      // вариация такта: сдвиг или добавление одного удара бочки, ghost перед сильной долей
      const vary = (fill) => {
        const v = {};
        for (const key in A) v[key] = A[key].slice();
        if (!feel.sparse && style !== 'four') {
          const sync = [];
          v.k.forEach((x, s) => x && x < 1 && s % beat !== 0 && sync.push(s));
          const pickup = steps - (beat === 4 ? 2 : 1);
          if (sync.length && chance(0.5)) {
            const s = sync[Math.floor(r() * sync.length)];
            const to = s + (chance(0.5) ? 1 : -1);
            if (to > 1 && to < steps && !backbeat(to) && !v.k[to]) {
              v.k[to] = v.k[s];
              v.k[s] = 0;
            }
          } else if (!v.k[pickup]) v.k[pickup] = 0.7;
        }
        if (!feel.sparse && chance(0.5 * (feel.ghost || 0))) v.s[lastBack - 1] = v.s[lastBack - 1] || 0.3;
        if (fill && chance(feel.roll)) {
          if (chance(feel.toms || 0)) {
            // сбивка по томам сверху вниз вместо остального рисунка
            const from = steps - beat * (nb >= 4 && chance(0.4) ? 2 : 1);
            for (let s = from; s < steps; s++) {
              v.s[s] = v.h[s] = v.p[s] = 0;
              if (beat === 3 || s % 2 === 0 || chance(0.4)) v.t[s] = 3 - Math.floor(((s - from) / (steps - from)) * 3);
            }
          } else {
            // подводка: дробь малого, нарастающая к концу такта
            for (let s = steps - beat; s < steps; s++) if (beat === 3 || s % 2 === 0 || chance(0.5)) v.s[s] = 0.35 + ((s - steps + beat) / beat) * 0.5;
          }
        }
        return v;
      };
      const bars = [A, vary(false), A, vary(true)];
      const join = (key) => bars.reduce((all, b) => all.concat(b[key]), []);
      Object.assign(this.song, { kick: join('k'), snare: join('s'), hat: join('h'), open: join('o'), perc: join('p'), tom: join('t') });
    }

    // Бас играет вместе с бочкой: нота на каждый её удар и на начало каждого такта.
    // approach — подводка к следующему аккорду: звучит, только если аккорд после неё меняется
    genBass() {
      const r = this.rng;
      const d = this.p.density;
      const steps = this.steps();
      const beat = this.beat();
      const kick = this.song.kick;
      const bass = new Array(kick.length).fill(null);
      if (this.style().drone) {
        // бурдон: основной тон аккорда тянется весь такт
        for (let s = 0; s < bass.length; s += steps) bass[s] = { fifth: false, oct: 0, len: steps };
        this.song.bass = bass;
        return;
      }
      kick.forEach((v, s) => {
        if (v < 0.6 && s % steps !== 0) return;
        const down = s % steps === 0;
        const k = r();
        bass[s] = { fifth: !down && k < 0.2, oct: !down && k > 0.82 ? 1 : 0 };
      });
      for (let end = steps; end <= bass.length; end += steps) {
        const s = end - (beat === 4 ? 2 : 1);
        if (!bass[s] && r() < 0.25 + d * 0.5) bass[s] = { approach: true };
      }
      let next = bass.length;
      for (let s = bass.length - 1; s >= 0; s--) {
        if (!bass[s]) continue;
        bass[s].len = Math.min(next - s, beat * 2);
        next = s;
      }
      this.song.bass = bass;
    }

    // Перебор на два такта: нота — номер звука в «лесенке» аккорда (i) и сила (v).
    // Рисунок — либо ровная фигура (roll, broken, sparse), либо евклидов ритм со случайным блужданием
    genArp() {
      const r = this.rng;
      const d = this.p.density;
      const steps = this.steps();
      const beat = this.beat();
      const arp = new Array(steps * 2).fill(null);
      const accent = (s) => (s % steps === 0 ? 1 : s % beat === 0 ? 0.85 : 0.65);
      let mode = this.style().arp;
      if (!mode && r() < 0.4) mode = r() < 0.5 ? 'roll' : 'broken';
      if (mode) {
        // ровный перебор, как на лютне или арфе: roll — танцевальный, broken — плавный, sparse — редкие ноты
        const shape = this.pick([[0, 1, 2, 3], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3, 2, 4], [0, 1, 2, 1], [0, 2, 3, 2]], [2, 3, 2, 2, 2]);
        let k = 0;
        for (let s = 0; s < arp.length; s++) {
          const pos = s % beat;
          let on;
          if (mode === 'sparse') on = pos === 0 || (r() < d * 0.5 && pos === beat - 1);
          else if (mode === 'broken') on = beat === 3 || pos % 2 === 0;
          else on = beat === 3 ? d > 0.85 || pos !== 1 : pos % 2 === 0 || d > 0.85;
          if (s === steps) k = 0; // второй такт начинает фигуру заново
          if (on) arp[s] = { i: shape[k++ % shape.length], v: accent(s) };
        }
        // конец второго такта уходит вверх — фигура не стоит на месте
        if (r() < 0.6) for (let s = arp.length - beat; s < arp.length; s++) if (arp[s]) arp[s].i += 2;
      } else {
        const pulses = Math.round(((3 + d * 8) * steps) / 16);
        const pat = euclid(pulses, steps, Math.floor(r() * steps));
        let idx = Math.floor(r() * 4);
        for (let s = 0; s < arp.length; s++) {
          if (!pat[s % steps]) continue;
          idx = clamp(idx + this.pick([-2, -1, 1, 2], [1, 3, 3, 1]), 0, 6);
          arp[s] = { i: idx, v: accent(s) };
        }
      }
      this.song.arp = arp;
    }
  }

  D.Composer = Composer;
})();
