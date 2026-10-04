// Веб-панель: связывает контролы с параметрами движка, рисует визуализацию.
(function () {
  'use strict';

  const { Engine, SCALES, NOTE_NAMES, MOODS } = window.Synth;
  const $ = (id) => document.getElementById(id);
  const STORE = 'drift-params';

  const DEFAULTS = {
    seed: 'aurora',
    bpm: 84,
    root: 9,
    scale: 'minor',
    drumStyle: 'broken',
    chordBars: 2,
    master: 0.8,
    reverb: 0.55,
    delay: 0.4,
    bright: 0.5,
    density: 0.5,
    swing: 0.15,
    stream: true,
    theme: 'lofi',
    mood: 'calm',
    meter: '4/4',
    tape: 0.4,
    amb: 'rain',
    padInst: 'warm',
    leadInst: 'ep',
    arpInst: 'pluck',
    bassInst: 'sub',
    kit: 'lofi',
    layers: {
      pad: { on: true, vol: 0.8 },
      choir: { on: true, vol: 0.6 },
      bass: { on: true, vol: 0.7 },
      arp: { on: true, vol: 0.6 },
      bells: { on: true, vol: 0.6 },
      drums: { on: true, vol: 0.7 },
      lead: { on: true, vol: 0.6 },
      texture: { on: true, vol: 0.4 },
      vinyl: { on: false, vol: 0.5 },
      amb: { on: true, vol: 0.5 },
    },
  };

  // слои, не указанные в пресете, выключены
  const L = (vols) => {
    const out = {};
    for (const name in DEFAULTS.layers) out[name] = { on: name in vols, vol: vols[name] || 0.5 };
    return out;
  };

  // Тема задаёт стартовые настройки; дальше в стриме дирижёр меняет инструменты в её рамках
  const PRESETS = {
    'Lo-fi': {
      theme: 'lofi', bpm: 86, meter: '4/4', scale: 'dorian', drumStyle: 'broken', chordBars: 1, reverb: 0.4, delay: 0.3, bright: 0.32, density: 0.5, swing: 0.45, tape: 0.6,
      amb: 'rain', padInst: 'warm', leadInst: 'ep', arpInst: 'pluck', bassInst: 'sub', kit: 'lofi',
      layers: L({ pad: 0.8, bass: 0.75, arp: 0.4, bells: 0.3, drums: 0.75, lead: 0.7, vinyl: 0.6, amb: 0.5 }),
    },
    'Фэнтези': {
      theme: 'fantasy', bpm: 100, meter: '12/8', scale: 'dorian', drumStyle: 'half', chordBars: 1, reverb: 0.45, delay: 0.08, bright: 0.6, density: 0.5, swing: 0, tape: 0.05,
      amb: 'forest', padInst: 'lute', leadInst: 'flute', arpInst: 'harp', bassInst: 'bowed', kit: 'folk',
      layers: L({ pad: 0.8, choir: 0.35, bass: 0.5, arp: 0.7, drums: 0.6, lead: 0.9, amb: 0.6 }),
    },
    'Ретро-аниме': {
      theme: 'anime', bpm: 96, meter: '4/4', scale: 'major', drumStyle: 'broken', chordBars: 1, reverb: 0.5, delay: 0.4, bright: 0.68, density: 0.6, swing: 0.15, tape: 0.35,
      amb: 'night', padInst: 'glass', leadInst: 'synth', arpInst: 'chip', bassInst: 'fm', kit: '80s',
      layers: L({ pad: 0.8, bass: 0.8, arp: 0.5, bells: 0.4, drums: 0.75, lead: 0.65, amb: 0.35 }),
    },
    'Эмбиент': {
      theme: 'ambient', bpm: 74, meter: '4/4', scale: 'lydian', drumStyle: 'half', chordBars: 2, reverb: 0.85, delay: 0.5, bright: 0.45, density: 0.3, swing: 0, tape: 0.2,
      amb: 'waves', padInst: 'glass', leadInst: 'musicbox', arpInst: 'harp', bassInst: 'sub', kit: 'lofi',
      layers: L({ pad: 0.8, choir: 0.6, bass: 0.5, arp: 0.7, bells: 0.7, lead: 0.8, texture: 0.4, amb: 0.5 }),
    },
    'Синтвейв': {
      theme: 'synthwave', bpm: 104, meter: '4/4', scale: 'minor', drumStyle: 'four', chordBars: 1, reverb: 0.5, delay: 0.5, bright: 0.8, density: 0.75, swing: 0, tape: 0.15,
      amb: 'none', padInst: 'warm', leadInst: 'synth', arpInst: 'pluck', bassInst: 'synth', kit: '80s',
      layers: L({ pad: 0.7, bass: 0.8, arp: 0.8, bells: 0.3, drums: 0.75, lead: 0.55 }),
    },
  };

  const MOOD_NAMES = { happy: 'Весёлое', calm: 'Спокойное', sad: 'Грустное', dark: 'Таинственное', epic: 'Эпичное' };

  const pct = (v) => Math.round(v * 100) + '%';
  const SLIDERS = [
    ['bpm', 'Темп', 50, 150, 1, (v) => v + ' bpm'],
    ['master', 'Громкость', 0, 1, 0.01, pct],
    ['reverb', 'Реверб', 0, 1, 0.01, pct],
    ['delay', 'Дилей', 0, 1, 0.01, pct],
    ['bright', 'Яркость', 0, 1, 0.01, pct],
    ['density', 'Плотность', 0, 1, 0.01, pct],
    ['swing', 'Свинг', 0, 0.6, 0.01, pct],
    ['tape', 'Плёнка', 0, 1, 0.01, pct],
  ];

  const SELECTS = [
    ['root', 'Тональность', NOTE_NAMES.map((n, i) => [i, n])],
    ['scale', 'Лад', [['minor', 'Минор'], ['dorian', 'Дорийский'], ['phrygian', 'Фригийский'], ['major', 'Мажор'], ['lydian', 'Лидийский'], ['mixolydian', 'Миксолидийский'], ['pentatonic', 'Пентатоника']]],
    ['drumStyle', 'Бит', [['broken', 'Ломаный'], ['four', 'Прямая бочка'], ['half', 'Half-time']]],
    ['chordBars', 'Тактов на аккорд', [[1, '1'], [2, '2'], [4, '4']]],
    ['meter', 'Размер', [['4/4', '4/4'], ['12/8', '12/8 (джига)']]],
    ['amb', 'Атмосфера', [['none', 'Нет'], ['rain', 'Дождь'], ['fire', 'Костёр'], ['forest', 'Лес'], ['waves', 'Волны'], ['night', 'Ночь']]],
    ['leadInst', 'Мелодия', [['ep', 'Электропиано'], ['flute', 'Флейта'], ['harp', 'Арфа'], ['musicbox', 'Шкатулка'], ['synth', 'Синт-лид']]],
    ['padInst', 'Аккорды', [['warm', 'Тёплый пэд'], ['strings', 'Струнные'], ['glass', 'Стеклянный пэд'], ['lute', 'Лютня (бой)']]],
    ['arpInst', 'Арпеджио', [['pluck', 'Щипок'], ['harp', 'Арфа'], ['chip', 'Чиптюн']]],
    ['bassInst', 'Бас', [['sub', 'Саб'], ['fm', 'FM'], ['synth', 'Синт'], ['bowed', 'Смычковый']]],
    ['kit', 'Ударные', [['lofi', 'Lo-fi'], ['80s', '80-е'], ['folk', 'Фолк']]],
  ];

  const LAYER_NAMES = { pad: 'Аккорды', choir: 'Хор', bass: 'Бас', arp: 'Арпеджио', bells: 'Колокольчики', lead: 'Мелодия', drums: 'Ударные', texture: 'Ветер', vinyl: 'Винил', amb: 'Атмосфера' };
  const GRID_ROWS = [['kick', 'kick'], ['snare', 'snare'], ['hat', 'hat'], ['bass', 'bass'], ['arp', 'arp']];
  const REGEN = new Set(['density', 'drumStyle', 'scale', 'theme', 'mood']); // меняют сами паттерны

  // ---------- состояние ----------

  const params = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved) {
      Object.assign(params, saved, { layers: params.layers });
      for (const k in params.layers) Object.assign(params.layers[k], saved.layers && saved.layers[k]);
      if (!SCALES[params.scale]) params.scale = DEFAULTS.scale;
    }
  } catch (e) {}

  const engine = new Engine(params);
  window.drift = engine; // для отладки из консоли
  const refresh = []; // функции, синхронизирующие контролы с params

  // сохраняем «домашние» значения, а не те, куда их увёл дирижёр
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(Object.assign({}, params, engine.home)));
    } catch (e) {}
  }

  function changed(key) {
    if (key === 'meter') engine.restart(); // длина такта изменилась — считаем такты заново
    else if (key === 'style') engine.restart(true); // новая тема или настроение — сразу полная секция
    else if (REGEN.has(key) || key === 'seed') engine.regenerate();
    else if (key === 'root') renderSong();
    engine.setHome();
    engine.apply();
    save();
  }

  // ---------- контролы ----------

  SLIDERS.forEach(([key, label, min, max, step, fmt]) => {
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    const sync = () => {
      input.value = params[key];
      out.textContent = fmt(params[key]);
    };
    input.addEventListener('input', () => {
      params[key] = +input.value;
      out.textContent = fmt(params[key]);
    });
    // паттерны пересобираем по отпусканию, а не на каждое движение
    input.addEventListener(REGEN.has(key) ? 'change' : 'input', () => changed(key));
    refresh.push(sync);
    $('sliders').appendChild(row);
  });

  SELECTS.forEach(([key, label, options]) => {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    const sel = document.createElement('select');
    options.forEach(([v, text]) => sel.add(new Option(text, v)));
    sel.addEventListener('change', () => {
      params[key] = typeof DEFAULTS[key] === 'number' ? +sel.value : sel.value;
      changed(key);
    });
    refresh.push(() => (sel.value = params[key]));
    wrap.appendChild(sel);
    $('selects').appendChild(wrap);
  });

  Object.keys(LAYER_NAMES).forEach((name) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<button></button><input type="range" min="0" max="1" step="0.01"><output></output>`;
    const btn = row.querySelector('button');
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    const sync = () => {
      const l = params.layers[name];
      btn.textContent = LAYER_NAMES[name];
      btn.classList.toggle('active', l.on);
      row.classList.toggle('off', !l.on);
      input.value = l.vol;
      out.textContent = pct(l.vol);
    };
    btn.addEventListener('click', () => {
      params.layers[name].on = !params.layers[name].on;
      sync();
      changed('layers');
    });
    input.addEventListener('input', () => {
      params.layers[name].vol = +input.value;
      sync();
      changed('layers');
    });
    refresh.push(sync);
    $('layers').appendChild(row);
  });

  // Настроение сдвигает темп, плотность и яркость относительно базовых значений темы и задаёт лад
  function applyMood() {
    const base = Object.values(PRESETS).find((x) => x.theme === params.theme);
    const mood = MOODS[params.mood];
    params.bpm = Math.round(Math.min(150, Math.max(50, base.bpm * mood.tempo)));
    params.density = Math.min(1, Math.max(0.05, base.density + mood.density));
    params.bright = Math.min(1, Math.max(0.05, base.bright + mood.bright));
    params.scale = mood.scales[0];
  }

  function restyle() {
    applyMood();
    changed('style');
    refreshAll();
  }

  Object.keys(PRESETS).forEach((name) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => {
      Object.assign(params, JSON.parse(JSON.stringify(PRESETS[name])));
      restyle();
    });
    refresh.push(() => b.classList.toggle('active', PRESETS[name].theme === params.theme));
    $('presets').appendChild(b);
  });

  Object.keys(MOOD_NAMES).forEach((key) => {
    const b = document.createElement('button');
    b.textContent = MOOD_NAMES[key];
    b.addEventListener('click', () => {
      params.mood = key;
      restyle();
    });
    refresh.push(() => b.classList.toggle('active', params.mood === key));
    $('moods').appendChild(b);
  });

  const seedInput = $('seed');
  seedInput.addEventListener('change', () => {
    params.seed = seedInput.value.trim() || DEFAULTS.seed;
    changed('seed');
  });
  refresh.push(() => (seedInput.value = params.seed));

  const SYL = ['ka', 'lu', 'mi', 'no', 'ra', 'so', 'te', 'vi', 'zen', 'aru', 'io', 'ne', 'shi', 'mo', 'el', 'ty'];
  $('dice').addEventListener('click', () => {
    let s = '';
    for (let i = 0; i < 3; i++) s += SYL[Math.floor(Math.random() * SYL.length)];
    params.seed = s;
    seedInput.value = s;
    changed('seed');
  });

  const stream = $('stream');
  stream.addEventListener('change', () => {
    params.stream = stream.checked;
    changed('stream');
  });
  refresh.push(() => (stream.checked = params.stream));

  function refreshAll() {
    refresh.forEach((f) => f());
  }

  // ---------- транспорт ----------

  const playBtn = $('play');
  function setPlaying(on) {
    if (on) engine.start();
    else engine.stop();
    playBtn.textContent = on ? '■ Стоп' : '▶ Играть';
    if (!on) {
      setHead(-1, -1);
      $('status').textContent = '';
    }
  }
  playBtn.addEventListener('click', () => setPlaying(!engine.playing));

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || /INPUT|SELECT|BUTTON/.test(e.target.tagName)) return;
    e.preventDefault();
    setPlaying(!engine.playing);
  });

  const recBtn = $('rec');
  let recording = false;
  recBtn.addEventListener('click', async () => {
    if (!recording) {
      if (!window.MediaRecorder) return alert('Запись не поддерживается этим браузером');
      if (!engine.playing) setPlaying(true);
      engine.startRecording();
      recording = true;
      recBtn.textContent = '■ Сохранить';
      recBtn.classList.add('active');
      return;
    }
    const blob = await engine.stopRecording();
    recording = false;
    recBtn.textContent = '● Запись';
    recBtn.classList.remove('active');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `drift-${params.seed}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // ---------- аккорды и сетка паттернов ----------

  let chordEls = [];
  let cells = []; // cells[step] = [ячейки колонки]

  function renderSong() {
    const song = engine.song;
    $('chords').innerHTML = '';
    chordEls = song.prog.map((deg) => {
      const el = document.createElement('div');
      el.className = 'chord';
      el.textContent = engine.chordName(deg);
      $('chords').appendChild(el);
      return el;
    });

    const grid = $('grid');
    grid.innerHTML = '';
    const steps = engine.steps();
    const beat = engine.beat();
    grid.style.gridTemplateColumns = `44px repeat(${steps}, 1fr)`;
    cells = Array.from({ length: steps }, () => []);
    GRID_ROWS.forEach(([key, label]) => {
      const name = document.createElement('span');
      name.textContent = label;
      grid.appendChild(name);
      for (let s = 0; s < steps; s++) {
        const c = document.createElement('div');
        const v = song[key][s];
        c.className = 'cell' + (s % beat === 0 ? ' beat' : '') + (v !== null && v !== 0 ? ' hit' : '');
        grid.appendChild(c);
        cells[s].push(c);
      }
    });
    head = { step: -1, chord: -1 };
  }

  let head = { step: -1, chord: -1 };
  function setHead(step, chord) {
    if (step !== head.step) {
      if (cells[head.step]) cells[head.step].forEach((c) => c.classList.remove('head'));
      if (cells[step]) cells[step].forEach((c) => c.classList.add('head'));
    }
    if (chord !== head.chord) {
      chordEls.forEach((el, i) => el.classList.toggle('on', i === chord));
    }
    head = { step, chord };
  }

  engine.onSongChange = renderSong;
  engine.onParamsChange = () => {
    refreshAll();
    save();
  };

  const SECTION_NAMES = { intro: 'Вступление', build: 'Нарастание', main: 'Основа', alt: 'Вариация', break: 'Брейк', sparse: 'Минимал', free: 'Петля' };
  const SCALE_NAMES = Object.fromEntries(SELECTS[1][2]);
  function setStatus(ev, now) {
    const sec = Math.max(0, Math.floor(now - engine.startedAt));
    const time = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    const where = MOOD_NAMES[params.mood] + ' · ' + (ev.sec === 'free' ? SECTION_NAMES.free : `глава ${ev.chapter} · ${SECTION_NAMES[ev.sec].toLowerCase()}`);
    $('status').textContent = `${where} · ${NOTE_NAMES[params.root]} ${SCALE_NAMES[params.scale].toLowerCase()} · ${params.bpm} bpm · ${time}`;
  }

  // ---------- визуализация ----------

  const canvas = $('viz');
  const g = canvas.getContext('2d');
  const BARS = 72;
  let freq = null;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  }
  window.addEventListener('resize', resize);

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#6ee7d2');
    grad.addColorStop(1, '#9b8cff');
    g.fillStyle = grad;
    const bw = w / BARS;
    for (let i = 0; i < BARS; i++) {
      let v = 0;
      if (freq) {
        // логарифмическая шкала: ~40 Гц … 16 кГц
        const a = Math.floor(2 * Math.pow(400, i / BARS));
        const b = Math.max(a + 1, Math.floor(2 * Math.pow(400, (i + 1) / BARS)));
        for (let k = a; k < b; k++) v = Math.max(v, freq[k]);
        v /= 255;
      }
      const bh = Math.max(2, v * v * h * 0.92);
      g.globalAlpha = 0.35 + v * 0.65;
      g.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh);
    }
    g.globalAlpha = 1;
  }

  function frame() {
    requestAnimationFrame(frame);
    if (engine.ctx) {
      if (!freq) freq = new Uint8Array(engine.analyser.frequencyBinCount);
      engine.analyser.getByteFrequencyData(freq);
      if (engine.playing) {
        const now = engine.ctx.currentTime;
        let ev = null;
        while (engine.events.length && engine.events[0].t <= now) ev = engine.events.shift();
        if (ev) {
          setHead(ev.step, ev.chord);
          setStatus(ev, now);
        }
      }
    }
    draw();
  }

  refreshAll();
  renderSong();
  resize();
  frame();
})();
