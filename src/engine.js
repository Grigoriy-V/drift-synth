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

  // правки этих параметров требуют пересочинить материал
  const STRUCTURAL = ['scale', 'density', 'drumStyle', 'meter'];

  class Engine {
    constructor(settings) {
      this.settings = settings;
      this.composer = new D.Composer();
      this.synth = new D.Synth();
      this.auto = this.synth.auto;
      this.events = []; // очередь {t, step, chord, sec, chapter} для визуализации
      this.playing = false;
      this.onChange = null; // трек или материал изменились — панели пора перерисоваться
      this.stepIndex = 0;
      this.offset = 0; // положение на шкале времени в момент startedAt, секунды
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

    // Какой напев, ход и мелодический инструмент звучат в текущей секции:
    // вариация — второй напев, второй инструмент и ход B; брейк — ход B
    useMaterial() {
      const C = this.composer;
      const song = C.song;
      const alt = this.sec.type === 'alt';
      song.melody = alt ? song.melodyB : song.melodyA;
      song.prog = alt || this.sec.type === 'break' ? song.progB : song.progA;
      this.track.leadInst = this.settings.overrides.leadInst || (alt ? C.leadB : C.leadA);
    }

    changed() {
      if (this.onChange) this.onChange();
    }

    // ---------- управление с панели ----------

    // Новый трек (сменился сид, тема или настроение): звучит сразу с полной секции
    newTrack() {
      this.forceMain = true;
      this.seek(0);
    }

    // Ручная правка параметра трека
    set(key, value) {
      const C = this.composer;
      this.settings.overrides[key] = value;
      this.track[key] = value;
      if (STRUCTURAL.includes(key)) {
        C.rng = rngFrom(this.settings.seed + '/' + this.chapter);
        C.newMaterial();
        if (key === 'meter') {
          // длина такта изменилась — трек начинается заново
          this.forceMain = true;
          this.seek(0);
          return;
        }
        this.useMaterial();
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

    resetConductor() {
      this.sec = { type: 'free', start: 0, end: Infinity, drums: 'ksh', fill: 'none' };
      this.chapter = 1;
      this.secCount = 0;
      this.chapterLen = 6;
      for (const name in LAYERS) this.auto[name] = 1;
    }

    conduct(bar, t) {
      if (!this.settings.stream) {
        // без стрима играет одна петля со всеми слоями
        if (this.sec.type !== 'free') {
          this.sec = { type: 'free', start: this.sec.start, end: Infinity, drums: 'ksh', fill: 'none' };
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
      const p = this.track;
      const prev = SECTIONS[this.sec.type];
      const forced = this.forceMain;
      this.forceMain = false;
      let type;
      let fresh = false;
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
      const barDur = (C.steps() * 60) / p.bpm / C.beat();
      let bars = def.bars[Math.floor(r() * def.bars.length)];
      while (bars * barDur < 22 && bars < 32) bars *= 2;
      this.sec = {
        type,
        start: bar,
        end: bar + Math.ceil(bars / p.chordBars) * p.chordBars,
        drums: def.drums && (type === 'main' || type === 'alt' || r() < 0.5 ? def.drums : 'h' + (r() < 0.5 ? 'k' : '')),
        fill: C.pick(['none', 'roll', 'drop'], [2, 2, 1]),
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
      if (forced) this.auto.arp = this.auto.lead = 1;

      if (!fresh) {
        // внутри главы меняем не больше одного паттерна за раз
        const what = C.pick(['none', 'arp', 'drums', 'bass'], [3, 2, 2, 1]);
        if (what === 'arp') C.genArp();
        else if (what === 'drums') {
          C.genDrums();
          C.genBass(); // бас привязан к бочке
        } else if (what === 'bass') C.genBass();
      }
      this.useMaterial();
      if (this.quiet) return; // беззвучная перемотка: звук и панель обновятся один раз в конце
      this.synth.apply(false, t, 0.8);
      this.changed();
    }

    // Новая «глава»: смена тональности, лада, темпа, инструментов и всего материала
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

    // Перейти к моменту времени. Трек полностью задан сидом, поэтому дирижёр беззвучно
    // проигрывается от начала до нужного такта: секции, главы и материал получаются теми же,
    // что и при обычном прослушивании, — и для уже сыгранного, и для ещё не сыгранного.
    seek(seconds) {
      const C = this.composer;
      this.build();
      this.quiet = true;
      let bar = 0;
      let t = 0;
      for (;;) {
        this.conduct(bar, 0);
        const barDur = (C.steps() * 60) / this.track.bpm / C.beat();
        if (t + barDur > seconds) break;
        t += barDur;
        bar++;
      }
      this.quiet = false;
      this.stepIndex = bar * C.steps();
      this.offset = t;
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
        this.scheduleStep(this.stepIndex, this.nextTime);
        this.nextTime += 60 / this.track.bpm / this.composer.beat();
        this.stepIndex++;
      }
    }

    // Один шаг сетки: спросить дирижёра и запустить голоса всех слоёв
    scheduleStep(i, t0) {
      const S = this.synth;
      const C = this.composer;
      const p = this.track;
      const steps = C.steps();
      const beat = C.beat();
      const s = i % steps;
      const bar = Math.floor(i / steps);
      if (s === 0) this.conduct(bar, t0);

      const song = C.song;
      const sec = this.sec;
      const auto = this.auto;
      const th = C.theme();
      const st = C.style();
      const stepDur = 60 / p.bpm / beat;
      const rel = bar - sec.start;
      const pos = rel * steps + s; // шаг от начала секции — паттерны длиннее такта идут по нему
      const chordIdx = Math.floor(rel / p.chordBars) % song.prog.length;
      const ch = song.prog[chordIdx];
      const t = t0 + (beat === 4 && s % 2 ? p.swing * stepDur * 0.6 : 0);
      const L = p.layers;
      const shift = C.rootShift();
      const fold = (m, max) => {
        while (m > max) m -= 12;
        return m;
      };
      this.events.push({ t: t0, step: s, chord: chordIdx, sec: sec.type, chapter: this.chapter });
      if (this.events.length > 256) this.events.shift(); // вкладка в фоне не читает очередь — не даём ей расти
      // неровность исполнения: ноты слегка гуляют вокруг сетки, малый барабан чуть опаздывает
      const loose = th.human * 0.011;
      const jit = (k) => (Math.random() - 0.5) * 2 * loose * (k || 1);

      if (s === 0 && rel % p.chordBars === 0) {
        const dur = p.chordBars * steps * stepDur;
        const m = C.chordMidis(ch);
        if (L.pad.on && auto.pad) S.pad(t0, m, dur);
        if (L.choir.on && auto.choir) S.choir(t0, [m[m.length - 1] + 12, m[0] + 12, m[1] + 12, m[2] + 12], dur);
      }

      if (L.drums.on && auto.drums) {
        const last = bar === sec.end - 1;
        const on = (k) => sec.drums.includes(k);
        const at = (row) => row[pos % row.length];
        if (!(last && sec.fill === 'drop' && s >= steps / 2)) {
          if (at(song.kick) && on('k')) S.kick(t, at(song.kick));
          if (at(song.snare) && on('s')) S.snare(t + loose * 0.8 + jit(0.4), at(song.snare));
          if (at(song.hat) && on('h')) S.hat(t + jit(0.6), at(song.hat), at(song.open));
        }
        if (last && sec.fill === 'roll' && s >= steps - beat && on('s')) S.snare(t, 0.35 + (s - steps + beat) * 0.15);
      }

      const b = song.bass[pos % song.bass.length];
      if (b && L.bass.on && auto.bass) {
        const m = 36 + shift + mod(ch.root + (b.fifth ? ch.fifth : 0), 12) + 12 * b.oct;
        S.bass(t + jit(0.4), m, stepDur * b.len);
      }

      const a = song.arp[s];
      if (a !== null && L.arp.on && auto.arp) {
        // лесенка из звуков аккорда через октавы
        const m = 60 + shift + ch.root + ch.arp[a % ch.arp.length] + 12 * Math.floor(a / ch.arp.length);
        S.arpNote(t + jit(), fold(m, 88), 0.6 + Math.random() * 0.4);
      }

      const note = song.melody[pos % song.melody.length];
      if (note && L.lead.on && auto.lead) {
        let d = note.d;
        // расстояние в полутонах от ступени до ближайшего звука аккорда
        const dist = (x) => {
          const pc = mod(C.degToMidi(x, 0), 12);
          return Math.min(...ch.mel.map((c) => Math.min(mod(pc - c, 12), mod(c - pc, 12))));
        };
        const near = [d, d + 1, d - 1, d + 2, d - 2];
        const closest = () => near.reduce((best, x) => (dist(x) < dist(best) ? x : best));
        // сильная доля — звук аккорда; остальные ноты свободны, но тянущаяся нота не должна тереться в полутон
        if (note.strong) d = closest();
        else if (note.len > 1 && dist(d) === 1) d = near.find((x) => dist(x) !== 1) ?? closest();
        // в танцевальных стилях флейта играет октавой выше, как вистл
        const high = st.high && p.leadInst === 'flute';
        const m = fold(C.degToMidi(d, 60 + shift), high ? 79 : 84) + (high ? 12 : 0);
        const vel = 0.65 + Math.random() * 0.35;
        const len = stepDur * note.len * (C.mood().stacc && note.len <= beat ? 0.6 : 1);
        if (st.grace && p.leadInst === 'flute' && note.strong && Math.random() < 0.3) {
          // форшлаг: короткая верхняя соседняя нота перед основной
          S.lead(t, fold(C.degToMidi(d + 1, 60 + shift), high ? 79 : 84) + (high ? 12 : 0), 0.04, vel * 0.7);
          S.lead(t + 0.07, m, len, vel);
        } else S.lead(t + jit(), m, len, vel);
      }

      if (L.bells.on && auto.bells && s % 2 === 0 && Math.random() < 0.025 + p.density * 0.06) {
        const int = ch.arp[Math.floor(Math.random() * ch.arp.length)];
        S.bell(t, fold(72 + shift + ch.root + int, 96), 0.4 + Math.random() * 0.6);
      }

      if (p.amb === 'forest' && L.amb.on && Math.random() < 0.035) S.bird(t + Math.random() * stepDur);
    }
  }

  D.Engine = Engine;
})();
