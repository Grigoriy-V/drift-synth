// Сочинение: из сида и жанровых параметров выводятся профиль трека, аккорды, мелодия,
// ударные, бас и аккомпанемент. Всё строится по правилам, готовых паттернов нет.
(function () {
  'use strict';

  const D = (window.Drift = window.Drift || {});
  const { SCALES, METERS, NOTE_NAMES, THEMES, MOODS, FEELS, DEFAULT_VOLS, LAYERS, mod, clamp, euclid, makeChord } = D;

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
      if (!evolve) p.meter = any(from('meter'));
      if (this.beats() <= 2) p.chordBars *= 2; // такт из двух долей короткий — аккорд держим дольше

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
      this.genProgs();
      this.genMelody();
      this.song.melodyA = this.song.melody;
      this.genMelody();
      this.song.melodyB = this.song.melody;
      // первый в списке — «фирменный» инструмент темы, он ведёт чаще остальных
      this.leadA = r() < 0.3 ? leads[0] : leads[Math.floor(r() * leads.length)];
      const others = leads.filter((x) => x !== this.leadA);
      this.leadB = others.length ? others[Math.floor(r() * others.length)] : this.leadA;
      this.genDrums();
      this.genBass();
      this.genArp();
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

    // Аккорд на ступени лада; тип (трезвучие, септ-, нонаккорд, открытая квинта, sus) — по правилам темы
    buildChord(deg) {
      const r = this.rng;
      const h = this.theme().harmony;
      const at = (o) => this.degToMidi(deg + o, 0) - this.degToMidi(deg, 0);
      let ints = [0, at(2), at(4)];
      if (h.ext === 'ninth' || (h.seventh && r() < h.seventh)) {
        ints.push(at(6));
        if (h.ext === 'ninth' && at(1) === 2 && r() < 0.55) ints.push(14); // нона — только большая
      } else if (ints[2] === 7) {
        if (h.open && r() < h.open) ints = [0, 7, 12];
        else if (h.sus && at(3) === 5 && r() < h.sus) ints = [0, 5, 7];
      }
      return makeChord(mod(this.degToMidi(deg, 0), 12), ints);
    }

    // Ход на 8 аккордов сочиняется по правилам:
    //   две фразы по 4 аккорда; корни движутся предпочтительно на кварту вверх, на секунду и на терцию вниз;
    //   характерные ступени лада (bVII, мажорная II, bII) весят больше, уменьшенные почти исключены;
    //   первая фраза не кончается тоникой, вторая начинается как первая и приходит к каденции.
    genProg(first) {
      const r = this.rng;
      const n = SCALES[this.p.scale].length;
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

    degToMidi(deg, base) {
      const sc = SCALES[this.p.scale];
      return base + 12 * Math.floor(deg / sc.length) + sc[mod(deg, sc.length)];
    }

    // Аккорд в тесном расположении (голоса в одной октаве) + корень октавой ниже.
    // У пятизвучий верхний корень опускаем — он уже есть в басу, так аккорд звучит прозрачнее
    chordMidis(ch) {
      const base = 48 + this.rootShift();
      const upper = ch.ints.length >= 5 ? ch.ints.slice(1) : ch.ints;
      const tones = upper.map((i) => base + mod(ch.root + i, 12) + (i >= 12 ? 12 : 0));
      tones.push(base - 12 + ch.root);
      return tones;
    }

    chordName(ch) {
      return NOTE_NAMES[mod(ch.root + this.p.root, 12)] + ch.label;
    }

    // ---------- мелодия и паттерны ----------

    // Напев строится из мотива — ритма на один такт и рисунка интервалов:
    //   такт 1 — мотив, такт 2 — он же выше (секвенция), такт 3 — на вершине или в обращении,
    //   такт 4 — начало мотива и долгая тоника. Потом ответная фраза или пауза.
    // Ступени считаются от тоники; на сильных долях ноты при игре подтягиваются к аккорду.
    genMelody() {
      const r = this.rng;
      const n = SCALES[this.p.scale].length;
      const steps = this.steps();
      const beat = this.beat();
      const nb = this.beats();
      const mood = this.mood();
      const d = this.p.density;
      // ритмические ячейки на одну долю и их веса
      const cells = beat === 3 ? [[1, 0, 1], [1, 0, 0], [1, 1, 1], [0, 0, 0]] : [[1, 0, 1, 0], [1, 0, 0, 0], [1, 0, 1, 1], [1, 1, 1, 0], [0, 0, 0, 0]];
      const weights = beat === 3 ? [3, 2.2 - d * 1.5, d * 2.5, mood.rest * 2] : [3, 2.4 - d * 1.5, d * 1.5, d * 0.7, mood.rest * 2];
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
          else if (b === nb - 1) cell = cells[r() < mood.rest ? cells.length - 1 : 1]; // а кончается долгой нотой или паузой
          else cell = this.pick(cells, weights);
          bar.push(...cell);
        }
        return bar;
      };
      const contour = (rh) => rh.filter(Boolean).slice(1).map(() => this.pick(moves, moveW));
      // положить рисунок на ритм, начиная со ступени start; за край диапазона не выходим
      const realize = (start, rh, mv) => {
        const bar = new Array(steps).fill(null);
        let deg = clamp(start, 0, top);
        let k = 0;
        rh.forEach((on, i) => {
          if (!on) return;
          if (k > 0) deg += mv[k - 1];
          if (deg < 0 || deg > top) deg = clamp(deg, 0, top) + (deg < 0 ? 1 : -1);
          bar[i] = deg;
          k++;
        });
        return { bar, end: deg };
      };
      const cadence = (start, rh, mv, final) => {
        const c = realize(start, rh, mv).bar;
        const hold = Math.floor(nb / 2) * beat; // с середины такта — долгая заключительная нота
        for (let i = hold; i < steps; i++) c[i] = null;
        c[hold] = final;
        return c;
      };

      const R = rhythm();
      const M = contour(R);
      // нисходящая мелодия начинает выше и секвенцируется вниз
      const falling = dir < -0.2;
      const start = falling ? this.pick([n, n + 2, 4], [3, 2, 2]) : this.pick([4, n, 2], [3, 2, 2]);
      const up = this.pick([1, 2], [2, 1]) * (falling ? -1 : 1);
      const b1 = realize(start, R, M);
      const b2 = realize(start + up, R, M);
      const b3 = r() < 0.5 ? realize(start + up * 2, R, M) : realize(start + up, R, M.map((x) => -x));
      const home = start > n / 2 + 1 ? n : 0;
      const tune = [...b1.bar, ...b2.bar, ...b3.bar, ...cadence(start, R, M, home)];

      // ответ: пауза на 4 такта (мелодия «дышит») либо мотив с новым вторым тактом и концом на квинте
      let answer;
      if (r() < mood.rest * 1.6) answer = new Array(steps * 4).fill(null);
      else {
        const R2 = rhythm();
        const fresh = realize(b1.end, R2, contour(R2));
        answer = [...b1.bar, ...fresh.bar, ...b2.bar, ...cadence(start, R, M, r() < 0.5 ? 4 : home)];
      }

      const flat = tune.concat(answer);
      // «сильные» ноты — на 1-й и 3-й долях: они всегда берутся из аккорда
      const melody = flat.map((deg, i) => (deg === null ? null : { d: deg, len: 1, strong: (i % steps) % (beat * 2) === 0 }));
      let prev = null;
      flat.forEach((deg, i) => {
        if (deg === null) return;
        if (prev !== null) melody[prev].len = Math.min(i - prev, beat * 2);
        prev = i;
      });
      melody[prev].len = beat * 2;
      this.song.melody = melody;
    }

    // Ударные сочиняются на 4 такта: A, вариация A, снова A, вариация с подводкой.
    // Рисунок строится по правилам: опорные доли, синкопы бочки по взвешенным позициям,
    // тихие удары между долями, один из типов рисунка хэта. Характер задают вероятности из FEELS.
    genDrums() {
      const r = this.rng;
      const d = this.p.density;
      const steps = this.steps();
      const beat = this.beat();
      const feel = FEELS[this.style().feel || this.theme().feel] || FEELS.plain;
      const style = this.p.drumStyle;
      const B = (n) => n * beat; // шаг, с которого начинается доля
      const chance = (p) => r() < p;
      const A = { k: new Array(steps).fill(0), s: new Array(steps).fill(0), h: new Array(steps).fill(0), o: new Array(steps).fill(false) };
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

      // вариация такта: сдвиг или добавление одного удара бочки, ghost перед сильной долей
      const vary = (fill) => {
        const v = { k: A.k.slice(), s: A.s.slice(), h: A.h.slice(), o: A.o.slice() };
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
          // подводка: дробь малого, нарастающая к концу такта
          for (let s = steps - beat; s < steps; s++) if (beat === 3 || s % 2 === 0 || chance(0.5)) v.s[s] = 0.35 + ((s - steps + beat) / beat) * 0.5;
        }
        return v;
      };
      const bars = [A, vary(false), A, vary(true)];
      const join = (key) => bars.reduce((all, b) => all.concat(b[key]), []);
      Object.assign(this.song, { kick: join('k'), snare: join('s'), hat: join('h'), open: join('o') });
    }

    // Бас играет вместе с бочкой: нота на каждый её удар и на начало каждого такта
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
      const hits = [];
      kick.forEach((v, s) => {
        if (v >= 0.6 || s % steps === 0) hits.push(s);
      });
      hits.forEach((s, i) => {
        const next = i + 1 < hits.length ? hits[i + 1] : bass.length;
        const down = s % steps === 0;
        const k = r();
        bass[s] = { fifth: !down && k < 0.2, oct: !down && k > 0.82 ? 1 : 0, len: Math.min(next - s, beat * 2) };
      });
      // подводка к следующему кругу: квинта на последней восьмой
      const pickup = bass.length - (beat === 4 ? 2 : 1);
      if (!bass[pickup] && r() < d * 0.6) bass[pickup] = { fifth: true, oct: 0, len: beat === 4 ? 2 : 1 };
      this.song.bass = bass;
    }

    genArp() {
      const r = this.rng;
      const d = this.p.density;
      const steps = this.steps();
      const beat = this.beat();
      const arp = new Array(steps).fill(null);
      const mode = this.style().arp;
      if (mode) {
        // ровный перебор, как на лютне или арфе: roll — танцевальный, broken — плавный, sparse — редкие ноты
        const shape = this.pick([[0, 1, 2, 3], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3, 2, 4], [0, 1, 2, 1], [0, 2, 3, 2]], [2, 3, 2, 2, 2]);
        let k = 0;
        for (let s = 0; s < steps; s++) {
          const pos = s % beat;
          let on;
          if (mode === 'sparse') on = pos === 0 || (r() < d * 0.5 && pos === beat - 1);
          else if (mode === 'broken') on = beat === 3 || pos % 2 === 0;
          else on = beat === 3 ? d > 0.85 || pos !== 1 : pos % 2 === 0 || d > 0.85;
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
  }

  D.Composer = Composer;
})();
