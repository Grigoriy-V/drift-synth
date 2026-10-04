// Движок: транспорт, дирижёр (секции и главы стрима) и планировщик шагов.
//
// Состояние разделено на две части:
//   settings — то, что выбрал пользователь: сид, тема, настроение, громкость и ручные правки;
//   track    — трек, целиком выведенный из сида (тональность, темп, инструменты, слои, звук).
// Ручная правка любого параметра хранится в settings.overrides / settings.layers и накладывается
// поверх каждого нового трека и каждой главы, пока её не сбросят.
(function () {
  'use strict';

  const D = window.Drift;
  const { LAYERS, SECTIONS, rngFrom, mod } = D;

  // правки этих параметров меняют сам материал — трек пересобирается до текущего места
  const STRUCTURAL = ['scale', 'density', 'drumStyle', 'meter', 'chordBars'];

  class Engine {
    constructor(settings) {
      this.settings = settings;
      this.composer = new D.Composer();
      this.synth = new D.Synth();
      this.auto = this.synth.auto;
      this.events = []; // очередь {t, step, chord, sec, chapter} для визуализации
      this.playing = false;
      this.onChange = null; // трек или материал изменились — панели пора перерисоваться
      this.bar = 0; // такт и шаг в нём, которые будут запланированы следующими
      this.step = 0;
      this.offset = 0; // положение на шкале времени в момент startedAt, секунды
      this.startFull = false; // трек начинается сразу с полной секции, без вступления
      this.build();
    }

    get ctx() {
      return this.synth.ctx;
    }

    get track() {
      return this.composer.p;
    }

    get song() {
      return this.composer.song;
    }

    // ---------- сборка трека ----------

    // Собрать трек с нуля: профиль по сиду, поверх — ручные правки, затем материал
    build() {
      const s = this.settings;
      const C = this.composer;
      C.rng = rngFrom(s.seed);
      C.rollTrack(s.theme, s.mood, false);
      this.applyOverrides();
      C.newMaterial();
      this.synth.p = C.p;
      this.synth.level = s.master;
      this.resetConductor();
      this.useMaterial();
    }

    applyOverrides() {
      const s = this.settings;
      Object.assign(this.track, s.overrides);
      for (const name in s.layers) Object.assign(this.track.layers[name], s.layers[name]);
    }

    // Какой напев, ход и мелодические инструменты звучат в текущей секции:
    // вариация — второй напев, ход B, а инструменты меняются ролями; брейк — ход B
    useMaterial() {
      const C = this.composer;
      const song = C.song;
      const alt = this.sec.type === 'alt';
      song.melody = alt ? song.melodyB : song.melodyA;
      song.prog = alt || this.sec.type === 'break' ? song.progB : song.progA;
      this.track.leadInst = this.settings.overrides.leadInst || (alt ? C.leadB : C.leadA);
      this.replyInst = alt ? C.leadA : C.leadB; // кто играет ответные реплики
    }

    changed() {
      if (this.onChange) this.onChange();
    }

    // Собрать трек заново и беззвучно провести дирижёра от начала до такта, на котором stop(bar, t, dur)
    // вернёт true. Трек полностью задан сидом, поэтому секции, главы и материал получаются теми же,
    // что и при обычном прослушивании. Возвращает время начала этого такта
    replay(stop) {
      this.build();
      this.quiet = true;
      let bar = 0;
      let t = 0;
      for (;;) {
        this.conduct(bar, 0);
        const dur = this.stepDur() * this.composer.steps();
        if (stop(bar, t, dur)) break;
        t += dur;
        bar++;
      }
      this.quiet = false;
      this.bar = bar;
      return t;
    }

    // ---------- управление с панели ----------

    // Новый трек (сменился сид, тема или настроение): звучит сразу с полной секции
    newTrack() {
      this.startFull = true;
      this.seek(0);
    }

    // Ручная правка параметра трека
    set(key, value) {
      this.settings.overrides[key] = value;
      this.track[key] = value;
      if (key === 'meter') return this.seek(this.position); // длина такта изменилась — встаём на то же время
      if (STRUCTURAL.includes(key)) {
        // материал пересочиняется, место в треке остаётся прежним
        const bar = this.bar;
        this.replay((b) => b >= bar);
      }
      this.synth.apply();
      this.changed();
    }

    setLayer(name, patch) {
      const s = this.settings;
      s.layers[name] = Object.assign(s.layers[name] || {}, patch);
      Object.assign(this.track.layers[name], patch);
      this.synth.apply();
      this.changed();
    }

    setMaster(value) {
      this.settings.master = this.synth.level = value;
      this.synth.apply();
    }

    setStream(on) {
      this.settings.stream = on;
    }

    // Сбросить ручные правки и вернуться к тому, что даёт сид
    reset() {
      this.settings.overrides = {};
      this.settings.layers = {};
      this.newTrack();
    }

    // ---------- дирижёр ----------

    freeSection(start) {
      return { type: 'free', start, end: Infinity, drums: 'kshp', fill: 'none', energy: 1, tune: 0 };
    }

    resetConductor() {
      this.sec = this.freeSection(0);
      this.chapter = 1;
      this.secCount = 0;
      this.chapterLen = 6;
      this.turn = 0; // счётчик секций: чётные играют первую половину напева, нечётные — вторую
      for (const name in LAYERS) this.auto[name] = 1;
    }

    conduct(bar, t) {
      if (!this.settings.stream) {
        // без стрима играет одна петля со всеми слоями
        if (this.sec.type !== 'free') {
          this.sec = this.freeSection(this.sec.start);
          for (const name in LAYERS) this.auto[name] = 1;
          this.useMaterial();
          if (!this.quiet) this.synth.apply(false, t, 0.5);
        }
        return;
      }
      if (this.sec.type === 'free' || bar >= this.sec.end) this.nextSection(bar, t);
    }

    nextSection(bar, t) {
      const C = this.composer;
      const r = C.rng;
      const before = this.sec.type;
      const prev = SECTIONS[before];
      const full = bar === 0 && this.startFull;
      let type;
      let fresh = false;
      this.secCount++;
      if (bar === 0) type = full ? 'main' : 'intro';
      else if (this.secCount > this.chapterLen) {
        this.newChapter();
        fresh = true;
        type = r() < 0.5 ? 'intro' : 'break';
      } else type = prev ? prev.next[Math.floor(r() * prev.next.length)] : 'main';

      // секция длится не меньше ~22 секунд, иначе в быстром темпе всё мелькает
      const def = SECTIONS[type];
      const barDur = this.stepDur() * C.steps();
      const slot = C.slotBars();
      let bars = def.bars[Math.floor(r() * def.bars.length)];
      while (bars * barDur < 22 && bars < 32) bars *= 2;
      this.sec = {
        type,
        start: bar,
        end: bar + Math.ceil(bars / slot) * slot,
        drums: def.drums && (type === 'main' || type === 'alt' || r() < 0.5 ? def.drums : 'h' + (r() < 0.5 ? 'k' : '')),
        fill: C.pick(['none', 'roll', 'drop'], [2, 2, 1]),
        energy: def.energy,
        ramp: !!def.ramp,
        // во вступлении и брейке бас иногда стоит на тонике под сменой аккордов
        pedal: (type === 'intro' || type === 'break') && r() < 0.5,
        riser: type === 'build' && r() < (C.theme().riser || 0),
        crash: type === 'main' && before !== 'main' && before !== 'free',
        tune: (this.turn++ % 2) * 8, // с какого такта напева начинать
      };

      // какие слои звучат в секции: вероятности секции с поправкой на настроение
      const mood = C.mood();
      for (const name in LAYERS) {
        if (name === 'drums') this.auto.drums = def.drums && r() < mood.drums ? 1 : 0;
        else this.auto[name] = name in def ? (r() < def[name] + (mood.bias[name] || 0) ? 1 : 0) : 1;
      }
      if (!this.auto.pad && !this.auto.choir) this.auto.pad = 1;
      // в каждой секции звучит хотя бы мелодия или аккомпанемент — по ним тема и узнаётся
      if (!this.auto.arp && !this.auto.lead) this.auto[r() < 0.5 ? 'arp' : 'lead'] = 1;
      if (full) this.auto.arp = this.auto.lead = 1;

      if (!fresh) {
        // внутри главы меняем не больше одного паттерна за раз
        const what = C.pick(['none', 'arp', 'drums', 'bass'], [3, 2, 2, 1]);
        if (what === 'arp') C.fork(() => C.genArp());
        else if (what === 'drums') {
          C.fork(() => C.genDrums());
          C.fork(() => C.genBass()); // бас привязан к бочке
        } else if (what === 'bass') C.fork(() => C.genBass());
      }
      this.useMaterial();
      if (this.quiet) return; // беззвучная перемотка: звук и панель обновятся один раз в конце
      this.synth.apply(false, t, 0.8);
      this.changed();
    }

    // Новая «глава»: смена тональности, лада, темпа, инструментов, иногда размера и всего материала
    newChapter() {
      const C = this.composer;
      this.chapter++;
      this.secCount = 1;
      this.chapterLen = 5 + Math.floor(C.rng() * 4);
      C.rollTrack(this.settings.theme, this.settings.mood, true);
      this.applyOverrides();
      C.newMaterial();
    }

    // ---------- транспорт ----------

    stepDur() {
      return 60 / this.track.bpm / this.composer.beat();
    }

    // Положение на шкале времени трека, секунды
    get position() {
      return this.playing ? Math.max(0, this.offset + this.ctx.currentTime - this.startedAt) : this.offset;
    }

    start() {
      const S = this.synth;
      S.resume();
      if (this.worker === undefined) {
        // таймер в воркере: в фоновой вкладке обычные таймеры срабатывают раз в секунду
        try {
          const src = 'let id;onmessage=e=>{clearInterval(id);if(e.data)id=setInterval(()=>postMessage(0),e.data)}';
          this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
          this.worker.onmessage = () => this.tick();
        } catch (e) {
          this.worker = null;
        }
      }
      this.playing = true;
      this.events.length = 0;
      this.nextTime = this.startedAt = S.ctx.currentTime + 0.08;
      if (this.worker) this.worker.postMessage(40);
      else this.interval = setInterval(() => this.tick(), 40);
      this.tick();
    }

    // Пауза: положение запоминается, продолжение — с начала текущего такта
    pause() {
      if (!this.playing) return;
      const at = this.position;
      this.playing = false;
      if (this.worker) this.worker.postMessage(0);
      else clearInterval(this.interval);
      this.synth.suspend();
      this.seek(at);
    }

    // Перейти к моменту времени — к началу такта, на который он приходится
    seek(seconds) {
      this.offset = this.replay((bar, t, dur) => t + dur > seconds);
      this.step = 0;
      this.rekick = true; // аккорд мог начаться раньше этого такта — пэд надо взять заново
      if (this.playing) {
        this.events.length = 0;
        this.nextTime = this.startedAt = this.synth.cut();
      }
      this.synth.apply();
      this.changed();
    }

    tick() {
      if (!this.playing) return;
      const now = this.ctx.currentTime;
      // без воркера в фоновой вкладке планируем с запасом
      const lookahead = !this.worker && document.hidden ? 2 : 0.25;
      if (this.nextTime < now) this.nextTime = now + 0.05;
      while (this.nextTime < now + lookahead) {
        this.scheduleStep(this.nextTime);
        this.nextTime += this.stepDur();
        this.advance();
      }
    }

    advance() {
      if (++this.step >= this.composer.steps()) {
        this.step = 0;
        this.bar++;
      }
    }

    // Один шаг сетки: спросить дирижёра и запустить голоса всех слоёв
    scheduleStep(t0) {
      const S = this.synth;
      const C = this.composer;
      const bar = this.bar;
      if (this.step === 0) this.conduct(bar, t0);
      const steps = C.steps();
      const s = this.step < steps ? this.step : (this.step = 0);
      // мелкие случайности исполнения заданы сидом и номером такта: то же место всегда звучит одинаково
      if (s === 0 || this.rndBar !== bar) {
        this.rnd = rngFrom(this.settings.seed + '#' + bar + '#' + s);
        this.rndBar = bar;
      }
      const rnd = this.rnd;

      const p = this.track;
      const beat = C.beat();
      const song = C.song;
      const sec = this.sec;
      const auto = this.auto;
      const th = C.theme();
      const st = C.style();
      const stepDur = this.stepDur();
      const rel = bar - sec.start;
      const pos = rel * steps + s; // шаг от начала секции — паттерны длиннее такта идут по нему
      const L = p.layers;
      const shift = C.rootShift();
      const fold = (m, max) => {
        while (m > max) m -= 12;
        return m;
      };

      // аккорд: у слота может быть второй аккорд (tail), вступающий с середины последнего такта
      const slot = C.slotBars();
      const split = C.split();
      const chordIdx = Math.floor(rel / slot) % song.prog.length;
      const base = song.prog[chordIdx];
      const lastOfSlot = rel % slot === slot - 1;
      const tailBar = !!base.tail && lastOfSlot;
      const ch = tailBar && s >= split ? base.tail : base;
      // на каком шаге этого такта аккорд сменится и каким станет
      const changeAt = tailBar && s < split ? split : lastOfSlot ? steps : null;
      const nextCh = tailBar && s < split ? base.tail : song.prog[(chordIdx + 1) % song.prog.length];

      const t = t0 + (beat === 4 && s % 2 ? p.swing * stepDur * 0.6 : 0);
      this.events.push({ t: t0, step: s, chord: chordIdx, sec: sec.type, chapter: this.chapter });
      if (this.events.length > 256) this.events.shift(); // вкладка в фоне не читает очередь — не даём ей расти
      // неровность исполнения: ноты слегка гуляют вокруг сетки, малый барабан чуть опаздывает
      const loose = th.human * 0.011;
      const jit = (k) => (rnd() - 0.5) * 2 * loose * (k || 1);
      // сила исполнения: в нарастании растёт к концу секции
      const dyn = sec.energy * (sec.ramp ? 0.7 + (0.3 * rel) / (sec.end - sec.start) : 1);
      const last = bar === sec.end - 1;

      if ((s === 0 && (rel % slot === 0 || this.rekick)) || (tailBar && s === split)) {
        const left = ch === base ? (slot - (rel % slot)) * steps - (base.tail ? steps - split : 0) : steps - split;
        const dur = left * stepDur;
        const m = C.chordMidis(ch, sec.pedal);
        if (L.pad.on && auto.pad) S.pad(t0, m, dur);
        if (L.choir.on && auto.choir) S.choir(t0, [m[m.length - 1] + 12, m[0] + 12, m[1] + 12, m[2] + 12], dur);
      }
      this.rekick = false;

      if (L.drums.on && auto.drums) {
        const on = (k) => sec.drums.includes(k);
        const at = (row) => row[pos % row.length];
        const v = 0.75 + 0.25 * dyn;
        if (sec.crash && pos === 0 && on('k')) S.crash(t0, 0.8);
        if (!(last && sec.fill === 'drop' && s >= steps / 2)) {
          if (at(song.kick) && on('k')) S.kick(t, at(song.kick) * v);
          if (at(song.snare) && on('s')) S.snare(t + loose * 0.8 + jit(0.4), at(song.snare) * v);
          if (at(song.hat) && on('h')) S.hat(t + jit(0.6), at(song.hat) * v, at(song.open));
          if (at(song.tom) && on('s')) S.tom(t, at(song.tom), 0.8 * v);
          if (at(song.perc) && on('p')) S.shaker(t + jit(0.5), at(song.perc) * v);
        }
        if (last && sec.fill === 'roll' && s >= steps - beat && on('s')) S.snare(t, 0.35 + (s - steps + beat) * 0.15);
        if (last && sec.riser && s === 0) S.riser(t0, steps * stepDur);
      }

      if (L.bass.on && auto.bass) {
        const b = song.bass[pos % song.bass.length];
        const low = (pc) => 36 + shift + mod(pc, 12);
        const root = sec.pedal ? 0 : ch.root;
        if (b && b.approach) {
          // подводка: ступенью (в джазовых темах — полутоном) к основному тону следующего аккорда
          if (!sec.pedal && !last && changeAt !== null && s + b.len >= changeAt && nextCh.root !== ch.root) {
            const inScale = (pc) => D.SCALES[p.scale].includes(mod(pc, 12));
            const by = th.harmony.subs ? (rnd() < 0.5 ? -1 : 1) : inScale(nextCh.root - 2) ? -2 : -1;
            S.bass(t + jit(0.4), low(nextCh.root) + by, stepDur * b.len);
          }
        } else if (b) {
          const len = changeAt !== null && changeAt > s ? Math.min(b.len, changeAt - s) : b.len; // не тянем через смену аккорда
          S.bass(t + jit(0.4), low(root + (b.fifth ? ch.fifth : 0)) + 12 * b.oct, stepDur * len);
        } else if (tailBar && s === split && !sec.pedal) {
          S.bass(t, low(ch.root), stepDur * Math.min(steps - split, st.drone ? steps : beat * 2));
        }
      }

      const a = song.arp[pos % song.arp.length];
      if (a && L.arp.on && auto.arp) {
        // лесенка из звуков аккорда через октавы
        const m = 60 + shift + ch.root + ch.arp[a.i % ch.arp.length] + 12 * Math.floor(a.i / ch.arp.length);
        S.arpNote(t + jit(), fold(m, 88), a.v * (0.85 + rnd() * 0.3) * (0.7 + 0.3 * dyn));
      }

      const note = song.melody[(pos + sec.tune * steps) % song.melody.length];
      if (note && L.lead.on && auto.lead) {
        const inst = note.voice ? this.replyInst : p.leadInst;
        // высота в полутонах от тоники; расстояние до ближайшего звука из набора
        let semi = C.degToMidi(note.d, 0);
        const dist = (x, set) => Math.min(...set.map((c) => Math.min(mod(x - c, 12), mod(c - x, 12))));
        const snap = (set, moves) => {
          const k = moves.find((m) => dist(semi + m, set) === 0);
          if (k !== undefined) semi += k;
        };
        // сильная доля — звук аккорда (даже если он вне лада); остальные ноты свободны,
        // но тянущаяся нота не должна тереться в полутон ни с одним звуком аккорда
        if (note.strong) snap(ch.mel, [0, -1, 1, -2, 2, -3, 3]);
        else if (note.len > 1) {
          const all = ch.ints.map((i) => mod(ch.root + i, 12));
          if (dist(semi, all) === 1) snap(all, [-1, 1]);
        }
        // в танцевальных стилях флейта играет октавой выше, как вистл
        const high = st.high && inst === 'flute';
        const pitch = (x) => fold(60 + shift + x, high ? 79 : 84) + (high ? 12 : 0);
        const vel = (0.65 + rnd() * 0.3) * (0.8 + 0.2 * dyn) * (note.voice ? 0.8 : note.strong ? 1.06 : 0.95);
        const len = stepDur * note.len * (C.mood().stacc && note.len <= beat ? 0.6 : 1);
        if (st.grace && inst === 'flute' && note.strong && rnd() < 0.3) {
          // форшлаг: короткая верхняя соседняя нота перед основной
          S.lead(t, pitch(semi + 2), 0.04, vel * 0.7, inst);
          S.lead(t + 0.07, pitch(semi), len, vel, inst);
        } else S.lead(t + jit(), pitch(semi), len, vel, inst);
      }

      if (L.bells.on && auto.bells && s % 2 === 0 && rnd() < 0.025 + p.density * 0.06) {
        const int = ch.arp[Math.floor(rnd() * ch.arp.length)];
        S.bell(t, fold(72 + shift + ch.root + int, 96), 0.4 + rnd() * 0.6);
      }

      if (p.amb === 'forest' && L.amb.on && rnd() < 0.035) S.bird(t + rnd() * stepDur);
    }
  }

  D.Engine = Engine;
})();
