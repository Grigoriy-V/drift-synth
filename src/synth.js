// Синтез: аудио-граф (шины, эффекты, мастер-цепь) и все голоса. Сэмплов нет — только осцилляторы,
// шум и модель струны. Параметры звука читаются из this.p — текущего трека.
(function () {
  'use strict';

  const D = (window.Drift = window.Drift || {});
  const { METERS, mtof, mod, clamp } = D;

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

  const DUCKED = ['pad', 'choir', 'arp', 'bells', 'bass'];

  const AMBIENCES = ['rain', 'fire', 'forest', 'waves', 'night'];

  // kick: [старт Гц, конец Гц, затухание с, громкость]
  const KITS = {
    lofi: { click: 0.12, kick: [150, 45, 0.35, 0.7], snare: { hp: 1200, dec: 0.16, noise: 0.3, tone: 200, toneGain: 0.25 }, hat: { hp: 7000, dec: 0.04, gain: 0.11 } },
    '80s': { click: 0.28, kick: [190, 50, 0.3, 0.75], snare: { hp: 700, dec: 0.3, noise: 0.28, tone: 180, toneGain: 0.3 }, hat: { hp: 9000, dec: 0.05, gain: 0.13 } },
    folk: { click: 0, kick: [95, 55, 0.5, 0.5], snare: { hp: 5000, dec: 0.09, noise: 0.42, tone: 0, toneGain: 0 }, hat: { hp: 8500, dec: 0.03, gain: 0.13 } },
  };

  // oscs: [форма, расстройка в центах, сдвиг в полутонах, уровень]
  const PADS = {
    warm: { oscs: [['sawtooth', -8, 0, 1], ['sawtooth', 7, 0, 1]], peak: 0.045, att: 2.5, filtered: true, vib: 0 },
    strings: { oscs: [['sawtooth', -12, 0, 1], ['sawtooth', 0, 0, 1], ['sawtooth', 11, 0, 1], ['sawtooth', 4, 12, 0.4]], peak: 0.026, att: 1.2, filtered: true, vib: 7 },
    glass: { oscs: [['sine', -4, 0, 1], ['sine', 5, 0, 1], ['triangle', 0, 12, 0.3]], peak: 0.03, att: 2, filtered: false, vib: 0 },
  };

  // Форманты гласных: [частота, Гц; усиление] для F1–F3
  const VOWELS = {
    a: [[800, 1], [1150, 0.5], [2900, 0.25]],
    o: [[450, 1], [800, 0.35], [2830, 0.1]],
    u: [[325, 1], [700, 0.25], [2700, 0.06]],
    e: [[400, 1], [1700, 0.3], [2600, 0.2]],
  };

  class Synth {
    constructor() {
      this.p = null; // трек, задаётся движком
      this.ctx = null;
      this.level = 0.8; // громкость с панели
      this.voices = new Set();
      this.strings = {}; // кэш буферов струн по ноте
      this.auto = {}; // множитель слоя от дирижёра (0 или 1)
      for (const name in LAYERS) this.auto[name] = 1;
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
      // сатурация: мягкое «ленточное» ограничение пиков, кривая задаётся в apply()
      this.shaper = ctx.createWaveShaper();
      this.shaper.oversample = '2x';
      // подъём громкости под стрим + лимитер, чтобы пики не клиппировали
      const makeup = ctx.createGain();
      makeup.gain.value = 1.9;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      this.volume = ctx.createGain(); // громкость с панели — после всей обработки
      this.air = ctx.createBiquadFilter(); // полка верхов: чем выше яркость, тем больше «воздуха»
      this.air.type = 'highshelf';
      this.air.frequency.value = 4500;
      this.master
        .connect(this.shaper)
        .connect(this.air)
        .connect(this.tone)
        .connect(wow)
        .connect(this.gate)
        .connect(comp)
        .connect(makeup)
        .connect(limiter)
        .connect(this.volume)
        .connect(this.analyser)
        .connect(ctx.destination);
      if (!offline) {
        this.recDest = ctx.createMediaStreamDestination();
        this.volume.connect(this.recDest);
      }

      // «качание»: эти слои приседают под каждую бочку (сайдчейн)
      this.duck = ctx.createGain();
      this.duck.connect(this.master);

      this.noise = this.makeNoise(2, false);
      this.brown = this.makeNoise(4, true);
      this.metal = this.makeMetal(1);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(3.8);
      this.revReturn = ctx.createGain();
      // низ из реверба убираем, иначе хвост гудит и мутит бас
      const revHp = ctx.createBiquadFilter();
      revHp.type = 'highpass';
      revHp.frequency.value = 220;
      this.fxGate = ctx.createGain(); // общий выход реверба и дилея — глушится при смене трека
      this.fxGate.connect(this.master);
      this.reverb.connect(revHp).connect(this.revReturn).connect(this.fxGate);

      this.delay = ctx.createDelay(2);
      const fbFilter = ctx.createBiquadFilter();
      fbFilter.type = 'lowpass';
      fbFilter.frequency.value = 2400;
      const fb = ctx.createGain();
      fb.gain.value = 0.45;
      this.delay.connect(fbFilter).connect(fb).connect(this.delay);
      this.delReturn = ctx.createGain();
      this.delay.connect(this.delReturn).connect(this.fxGate);
      const delToRev = ctx.createGain();
      delToRev.gain.value = 0.3;
      this.delay.connect(delToRev).connect(this.reverb);

      this.bus = {};
      for (const name in LAYERS) {
        const b = (this.bus[name] = ctx.createGain());
        b.gain.value = 0;
        b.connect(DUCKED.includes(name) ? this.duck : this.master);
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
      // хорус: две плавающие задержки по краям панорамы делают пэд шире и «живее»
      this.padIn = ctx.createGain();
      const padHp = ctx.createBiquadFilter(); // низ у пэдов срезаем — это место баса
      padHp.type = 'highpass';
      padHp.frequency.value = 120;
      this.padIn.connect(padHp).connect(this.bus.pad);
      [[0.017, 0.31, 0.0035, -0.8], [0.023, 0.43, 0.004, 0.8]].forEach(([time, hz, depth, pan]) => {
        const d = ctx.createDelay(0.1);
        d.delayTime.value = time;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = hz;
        const lg = ctx.createGain();
        lg.gain.value = depth;
        lfo.connect(lg).connect(d.delayTime);
        lfo.start();
        const wet = ctx.createGain();
        wet.gain.value = 0.35;
        padHp.connect(d).connect(wet).connect(this.pan(this.bus.pad, pan));
      });
      this.padFilter.connect(this.padIn);
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

    // Импульс реверба: шум с затуханием, в котором верха гаснут быстрее низов (как в реальном зале),
    // с небольшой предзадержкой и несколькими ранними отражениями
    makeImpulse(seconds) {
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * seconds);
      const pre = Math.floor(sr * 0.012);
      const buf = this.ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let y = 0;
        for (let i = pre; i < len; i++) {
          const k = (i - pre) / (len - pre);
          const x = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.8);
          y += (0.06 + 0.9 * Math.pow(1 - k, 1.5)) * (x - y); // фильтр закрывается к хвосту
          d[i] = y * 1.5;
        }
        for (let n = 0; n < 6; n++) d[pre + Math.floor(sr * (0.005 + Math.random() * 0.07))] += (Math.random() < 0.5 ? -1 : 1) * (0.7 - n * 0.08);
      }
      return buf;
    }

    // «Металл» для хэтов: шесть негармоничных меандров, как в классических драм-машинах, плюс шум
    makeMetal(seconds) {
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * seconds);
      const buf = this.ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const freqs = [263, 400, 421, 474, 587, 845].map((f) => f * 5.2);
      for (let i = 0; i < len; i++) {
        let v = 0;
        freqs.forEach((f) => (v += ((i * f) / sr) % 1 < 0.5 ? 1 : -1));
        d[i] = (v / 6) * 0.65 + (Math.random() * 2 - 1) * 0.35;
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
      const bed = (buffer, filters, gain, dest, wide) => {
        if (wide) {
          // два источника с разных мест буфера по краям панорамы — шум звучит объёмно
          bed(buffer, filters, gain * 0.75, this.pan(dest, -0.85));
          return bed(buffer, filters, gain * 0.75, this.pan(dest, 0.85));
        }
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
      bed(this.noise, [['highpass', 1800], ['lowpass', 8000]], 0.1, this.amb.rain, true);
      bed(this.makeCrackle(5, 0.006, 0), [['bandpass', 2600]], 0.9, this.amb.rain, true);
      bed(this.brown, [['lowpass', 400]], 0.35, this.amb.rain);

      // костёр: частый треск + дрожащий гул пламени
      bed(this.makeCrackle(7, 0.0025, 0), [['lowpass', 5000], ['highpass', 500]], 1.2, this.amb.fire);
      sway(bed(this.brown, [['lowpass', 320]], 0.6, this.amb.fire).gain, 7, 0.15);

      // волны: шум, медленно накатывающий и уходящий
      sway(bed(this.noise, [['lowpass', 900]], 0.09, this.amb.waves).gain, 0.09, 0.08);
      bed(this.brown, [['lowpass', 250]], 0.3, this.amb.waves);

      // лес: ветер в листве; птицы добавляются из планировщика
      sway(bed(this.brown, [['bandpass', 600]], 0.7, this.amb.forest, true).gain, 0.07, 0.3);

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

    pan(dest, value) {
      if (!value) return dest;
      const node = this.ctx.createStereoPanner();
      node.pan.value = value;
      node.connect(dest);
      return node;
    }

    apply(instant, when, tc = 0.05) {
      if (!this.ctx) return;
      const p = this.p;
      const t = when || this.ctx.currentTime;
      const set = (param, v, c = tc) => (instant ? param.setValueAtTime(v, t) : param.setTargetAtTime(v, t, c));
      set(this.tone.frequency, 2500 + p.bright * 14000);
      set(this.air.gain, -1 + p.bright * 7);
      set(this.wowDepth.gain, p.tape * 0.0016);
      set(this.flutterDepth.gain, p.tape * 0.00012);
      AMBIENCES.forEach((name) => set(this.amb[name].gain, p.amb === name ? 1 : 0, Math.max(tc, 1.2)));
      set(this.volume.gain, this.level);
      if (this.driveSet !== p.drive) {
        // y = tanh(kx)/k: тихое проходит без изменений, пики мягко сжимаются
        this.driveSet = p.drive;
        const k = 1 + p.drive * 4;
        const curve = new Float32Array(1025);
        for (let i = 0; i < 1025; i++) curve[i] = Math.tanh(k * (i / 512 - 1)) / k;
        this.shaper.curve = curve;
      }
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

    // ---------- включение, остановка, смена трека ----------

    resume() {
      this.init();
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
        this.killVoices();
      }
      this.ctx.resume();
      const now = this.ctx.currentTime;
      this.gate.gain.cancelScheduledValues(now);
      this.gate.gain.setTargetAtTime(1, now, 0.03);
    }

    suspend() {
      const now = this.ctx.currentTime;
      this.gate.gain.cancelScheduledValues(now);
      this.gate.gain.setTargetAtTime(0, now, 0.06);
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null;
        this.killVoices();
        this.ctx.suspend();
      }, 400);
    }

    // Чистый переход на новый трек: короткий провал громкости, старые голоса снимаются,
    // хвосты реверба и дилея приглушаются, пока не затухнут. Возвращает время, с которого можно играть дальше
    cut() {
      const now = this.ctx.currentTime;
      const old = [...this.voices];
      this.voices = new Set();
      setTimeout(() => old.forEach((v) => {
        try {
          v.stop();
        } catch (e) {}
      }), 90);
      this.gate.gain.cancelScheduledValues(now);
      this.gate.gain.setTargetAtTime(0, now, 0.015);
      this.gate.gain.setTargetAtTime(1, now + 0.11, 0.03);
      this.fxGate.gain.cancelScheduledValues(now);
      this.fxGate.gain.setTargetAtTime(0, now, 0.02);
      this.fxGate.gain.setTargetAtTime(1, now + 0.9, 0.5);
      this.duck.gain.cancelScheduledValues(now);
      this.duck.gain.setValueAtTime(1, now);
      return now + 0.14;
    }

    killVoices() {
      this.voices.forEach((v) => {
        try {
          v.stop();
        } catch (e) {}
      });
      this.voices.clear();
    }

    track(src, stopAt) {
      this.voices.add(src);
      src.onended = () => this.voices.delete(src);
      src.stop(stopAt);
    }

    // ---------- голоса ----------

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
      g.connect(def.filtered ? this.padFilter : this.padIn);
      const left = this.pan(g, -0.6);
      const right = this.pan(g, 0.6);
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
          // расстроенные вниз — влево, вверх — вправо
          const side = det < 0 ? left : det > 0 ? right : g;
          if (level === 1) o.connect(side);
          else {
            const og = ctx.createGain();
            og.gain.value = level;
            o.connect(og).connect(side);
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

      midis.forEach((m, voice) => {
        const place = this.pan(src, [-0.6, 0.6, -0.25, 0.25][voice % 4]);
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
          o.connect(place);
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

      if (inst === 'upright') {
        // щипковый контрабас на модели струны
        g.disconnect();
        this.pluckString(t, midi, 0.85, this.bus.bass, 600 + this.p.bright * 700, 0, Math.max(0.25, dur));
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
      let peak = 0.2;
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
      this.arpSide = -(this.arpSide || 0.45); // ноты поочерёдно слева и справа
      const pan = this.arpSide;
      if (inst === 'harp') this.harp(t, midi, vel * 1.08, this.bus.arp, pan);
      else if (inst === 'guitar') this.guitar(t, midi, vel * 0.8, this.bus.arp, pan);
      else if (inst === 'chip') this.chip(t, midi, vel, pan);
      else this.pluck(t, midi, vel, pan);
    }

    lead(t, midi, dur, vel) {
      const inst = this.p.leadInst;
      const bus = this.bus.lead;
      if (inst === 'flute') this.flute(t, midi, dur, vel);
      else if (inst === 'harp') this.harp(t, midi, vel * 0.87, bus, 0.1);
      else if (inst === 'guitar') this.guitar(t, midi, vel * 0.85, bus, -0.1);
      else if (inst === 'vibes') this.vibes(t, midi, vel, bus, 0.1);
      else if (inst === 'musicbox') this.bell(t, midi + 12, vel * 2.6, bus, 1.1);
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

    // hold — через сколько секунд струну глушат (для баса); без него звенит до конца
    pluckString(t, midi, vel, bus, tone, pan, hold) {
      const ctx = this.ctx;
      const str = this.stringBuffer(midi);
      const src = ctx.createBufferSource();
      src.buffer = str.buf;
      src.playbackRate.value = str.rate;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = tone;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel, t);
      let end = t + str.buf.duration;
      if (hold && t + hold + 0.12 < end) {
        g.gain.setValueAtTime(vel, t + hold);
        g.gain.linearRampToValueAtTime(0, t + hold + 0.1);
        end = t + hold + 0.12;
      }
      src.connect(f).connect(g).connect(this.pan(bus, pan));
      src.start(t);
      this.track(src, end);
    }

    harp(t, midi, vel, bus, pan) {
      this.pluckString(t, midi, vel * 0.55, bus, 2200 + this.p.bright * 4500, pan);
    }

    // Гитара: та же струна, но глуше и суше — нейлон
    guitar(t, midi, vel, bus, pan) {
      this.pluckString(t, midi, vel * 0.6, bus, 1300 + this.p.bright * 2200, pan);
    }

    // Вибрафон: синус с быстро гаснущим призвуком и медленным тремоло
    vibes(t, midi, vel, bus, pan) {
      const ctx = this.ctx;
      const freq = mtof(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel * 0.32, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0002, t + 1.9);
      const trem = ctx.createGain();
      trem.gain.value = 0.78;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = ctx.createGain();
      depth.gain.value = 0.22;
      lfo.connect(depth).connect(trem.gain);
      g.connect(trem).connect(this.pan(bus, pan));
      [[1, 1, 1.9], [4, 0.28, 0.35]].forEach(([mult, level, dec]) => {
        const o = ctx.createOscillator();
        o.frequency.value = freq * mult;
        const og = ctx.createGain();
        og.gain.setValueAtTime(level, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + dec);
        o.connect(og).connect(g);
        o.start(t);
        this.track(o, t + 1.95);
      });
      lfo.start(t);
      this.track(lfo, t + 1.95);
    }

    // Лютневый бой: аккорд перебором вниз, в середине такта — лёгкий удар вверх
    strum(t, midis, dur) {
      const notes = midis.slice().sort((a, b) => a - b);
      const tone = 1800 + this.p.bright * 3500;
      const place = (i, n) => (n > 1 ? (i / (n - 1) - 0.5) * 0.8 : 0); // струны разложены по панораме
      notes.forEach((m, i) => this.pluckString(t + i * 0.028, m, 0.28, this.bus.pad, tone, place(i, notes.length)));
      if (dur < 1.2) return;
      const half = Math.min(dur / 2, (this.steps() / 2) * (60 / this.p.bpm / this.beat()));
      notes.slice(-3).reverse().forEach((m, i) => this.pluckString(t + half + i * 0.022, m, 0.17, this.bus.pad, tone, place(2 - i, 3)));
    }

    // Чиптюн: голый меандр, короткая нота
    chip(t, midi, vel, pan) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.21, t);
      g.gain.setValueAtTime(vel * 0.21, t + 0.09);
      g.gain.linearRampToValueAtTime(0, t + 0.13);
      o.connect(g).connect(this.pan(this.bus.arp, pan));
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
      g.connect(this.pan(this.bus.lead, 0.12));
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
      f.connect(g).connect(this.pan(this.bus.lead, -0.1));
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

    pluck(t, midi, vel, pan) {
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
      f.connect(g).connect(this.pan(this.bus.arp, pan));
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
      g.gain.linearRampToValueAtTime(vel * 0.14, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      g.connect(this.pan(this.bus.lead, 0.12));
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
      car.connect(g).connect(bus ? this.pan(bus, 0.1) : this.pan(this.bus.bells, (Math.random() - 0.5) * 1.4));
      car.start(t);
      mo.start(t);
      this.track(car, t + decay + 0.1);
      this.track(mo, t + decay + 0.1);
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

    noiseSrc(t, dur, buffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer || this.noise;
      src.start(t, Math.random() * (src.buffer.duration - 0.5));
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
      const click = this.kit().click;
      if (click) {
        // короткий щелчок атаки, чтобы бочку было слышно и на маленьких колонках
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1800;
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(vel * click, t);
        cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
        this.noiseSrc(t, 0.02).connect(hp).connect(cg).connect(this.bus.drums);
      }
      // «качание»: слои на шине duck приседают под бочку и возвращаются
      const pump = this.p.pump * vel;
      if (pump > 0.01) {
        this.duck.gain.setTargetAtTime(1 - pump, t, 0.006);
        this.duck.gain.setTargetAtTime(1, t + 0.07, 0.11);
      }
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
      this.noiseSrc(t, k.dec + 0.02).connect(hp).connect(g).connect(this.pan(this.bus.drums, -0.12));
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
      this.noiseSrc(t, dur + 0.02, this.metal).connect(hp).connect(g).connect(this.pan(this.bus.drums, 0.3));
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

  Object.assign(D, { Synth, LAYERS });
})();
