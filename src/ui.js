// Панель: показывает текущий трек и передаёт движку выбор пользователя.
// Контролы блоков «Звук» и «Слои» отражают трек, собранный из сида; ручная правка становится
// закреплённой (подсвечивается) и действует на все следующие треки до кнопки «Сбросить правки».
(function () {
  'use strict';

  const D = window.Drift;
  const { Engine, THEMES, MOODS, NOTE_NAMES, LAYERS } = D;
  const $ = (id) => document.getElementById(id);
  const STORE = 'drift-settings-v2';

  const THEME_NAMES = { lofi: 'Lo-fi', fantasy: 'Фэнтези', anime: 'Ретро-аниме', ambient: 'Эмбиент', synthwave: 'Синтвейв' };
  const MOOD_NAMES = { happy: 'Весёлое', calm: 'Спокойное', sad: 'Грустное', dark: 'Таинственное', epic: 'Эпичное' };
  const STYLE_NAMES = { tavern: 'Таверна', ballad: 'Баллада', lament: 'Плач', mystic: 'Мистика', march: 'Марш' };
  const SECTION_NAMES = { intro: 'вступление', build: 'нарастание', main: 'основа', alt: 'вариация', break: 'брейк', sparse: 'минимал', free: 'петля' };
  const LAYER_NAMES = { pad: 'Аккорды', choir: 'Хор', bass: 'Бас', arp: 'Арпеджио', bells: 'Колокольчики', lead: 'Мелодия', drums: 'Ударные', texture: 'Ветер', vinyl: 'Винил', amb: 'Атмосфера' };
  const SCALES = [['minor', 'Минор'], ['dorian', 'Дорийский'], ['phrygian', 'Фригийский'], ['major', 'Мажор'], ['lydian', 'Лидийский'], ['mixolydian', 'Миксолидийский'], ['pentatonic', 'Пентатоника']];

  const pct = (v) => Math.round(v * 100) + '%';
  // [параметр трека, подпись, мин, макс, шаг, формат]
  const SLIDERS = [
    ['bpm', 'Темп', 50, 150, 1, (v) => v + ' bpm'],
    ['reverb', 'Реверб', 0, 1, 0.01, pct],
    ['delay', 'Дилей', 0, 1, 0.01, pct],
    ['bright', 'Яркость', 0, 1, 0.01, pct],
    ['density', 'Плотность', 0, 1, 0.01, pct],
    ['swing', 'Свинг', 0, 0.6, 0.01, pct],
    ['tape', 'Плёнка', 0, 1, 0.01, pct],
    ['pump', 'Качание', 0, 0.7, 0.01, pct],
    ['drive', 'Сатурация', 0, 1, 0.01, pct],
  ];
  const SELECTS = [
    ['root', 'Тональность', NOTE_NAMES.map((n, i) => [i, n])],
    ['scale', 'Лад', SCALES],
    ['meter', 'Размер', [['4/4', '4/4'], ['3/4', '3/4 (вальс)'], ['5/4', '5/4'], ['6/8', '6/8'], ['9/8', '9/8 (слип-джига)'], ['12/8', '12/8 (джига)']]],
    ['chordBars', 'Тактов на аккорд', [[1, '1'], [2, '2'], [4, '4']]],
    ['drumStyle', 'Бит', [['broken', 'Ломаный'], ['four', 'Прямая бочка'], ['half', 'Half-time']]],
    ['kit', 'Ударные', [['lofi', 'Lo-fi'], ['80s', '80-е'], ['folk', 'Фолк']]],
    ['leadInst', 'Мелодия', [['ep', 'Электропиано'], ['flute', 'Флейта'], ['harp', 'Арфа'], ['guitar', 'Гитара'], ['vibes', 'Вибрафон'], ['musicbox', 'Шкатулка'], ['synth', 'Синт-лид']]],
    ['padInst', 'Аккорды', [['warm', 'Тёплый пэд'], ['strings', 'Струнные'], ['glass', 'Стеклянный пэд'], ['lute', 'Лютня (бой)']]],
    ['arpInst', 'Арпеджио', [['pluck', 'Щипок'], ['harp', 'Арфа'], ['guitar', 'Гитара'], ['chip', 'Чиптюн']]],
    ['bassInst', 'Бас', [['sub', 'Саб'], ['fm', 'FM'], ['synth', 'Синт'], ['bowed', 'Смычковый'], ['upright', 'Контрабас']]],
    ['amb', 'Атмосфера', [['none', 'Нет'], ['rain', 'Дождь'], ['fire', 'Костёр'], ['forest', 'Лес'], ['waves', 'Волны'], ['night', 'Ночь']]],
  ];
  const GRID_ROWS = ['kick', 'snare', 'hat', 'bass', 'arp'];

  // ---------- состояние ----------

  const settings = { seed: 'aurora', theme: 'lofi', mood: 'calm', stream: true, master: 0.8, overrides: {}, layers: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && THEMES[saved.theme] && MOODS[saved.mood]) Object.assign(settings, saved);
  } catch (e) {}

  const engine = new Engine(settings);
  window.drift = engine; // для отладки из консоли и для analyze.js

  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(settings));
    } catch (e) {}
  };

  const refresh = []; // функции, приводящие контролы в соответствие с треком
  const refreshAll = () => refresh.forEach((f) => f());

  // ---------- тема, настроение, сид ----------

  function chips(container, names, key) {
    Object.keys(names).forEach((value) => {
      const b = document.createElement('button');
      b.textContent = names[value];
      b.addEventListener('click', () => {
        settings[key] = value;
        engine.newTrack();
      });
      refresh.push(() => b.classList.toggle('active', settings[key] === value));
      container.appendChild(b);
    });
  }
  chips($('presets'), THEME_NAMES, 'theme');
  chips($('moods'), MOOD_NAMES, 'mood');

  const seedInput = $('seed');
  seedInput.addEventListener('change', () => {
    settings.seed = seedInput.value.trim() || 'aurora';
    engine.newTrack();
  });
  refresh.push(() => (seedInput.value = settings.seed));

  const SYLLABLES = ['ka', 'lu', 'mi', 'no', 'ra', 'so', 'te', 'vi', 'zen', 'aru', 'io', 'ne', 'shi', 'mo', 'el', 'ty'];
  $('dice').addEventListener('click', () => {
    settings.seed = Array.from({ length: 3 }, () => SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)]).join('');
    engine.newTrack();
  });

  const stream = $('stream');
  stream.addEventListener('change', () => {
    engine.setStream(stream.checked);
    save();
  });
  refresh.push(() => (stream.checked = settings.stream));

  const resetBtn = $('reset');
  resetBtn.addEventListener('click', () => engine.reset());
  refresh.push(() => {
    const n = Object.keys(settings.overrides).length + Object.keys(settings.layers).length;
    resetBtn.disabled = n === 0;
    resetBtn.textContent = n ? `Сбросить правки (${n})` : 'Правок нет';
  });

  // ---------- блок «Звук» ----------

  function sliderRow(label, min, max, step) {
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
    return { row, input: row.querySelector('input'), out: row.querySelector('output') };
  }

  {
    const { row, input, out } = sliderRow('Громкость', 0, 1, 0.01);
    input.addEventListener('input', () => {
      engine.setMaster(+input.value);
      out.textContent = pct(settings.master);
      save();
    });
    refresh.push(() => {
      input.value = settings.master;
      out.textContent = pct(settings.master);
    });
    $('sliders').appendChild(row);
  }

  SLIDERS.forEach(([key, label, min, max, step, fmt]) => {
    const { row, input, out } = sliderRow(label, min, max, step);
    input.addEventListener('input', () => (out.textContent = fmt(+input.value)));
    // плотность пересочиняет паттерны — применяем по отпусканию, а не на каждое движение
    input.addEventListener(key === 'density' ? 'change' : 'input', () => engine.set(key, +input.value));
    refresh.push(() => {
      input.value = engine.track[key];
      out.textContent = fmt(engine.track[key]);
      row.classList.toggle('locked', key in settings.overrides);
    });
    $('sliders').appendChild(row);
  });

  SELECTS.forEach(([key, label, options]) => {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    const sel = document.createElement('select');
    options.forEach(([value, text]) => sel.add(new Option(text, value)));
    const numeric = typeof options[0][0] === 'number';
    sel.addEventListener('change', () => engine.set(key, numeric ? +sel.value : sel.value));
    refresh.push(() => {
      sel.value = engine.track[key];
      wrap.classList.toggle('locked', key in settings.overrides);
    });
    wrap.appendChild(sel);
    $('selects').appendChild(wrap);
  });

  // ---------- блок «Слои» ----------

  Object.keys(LAYERS).forEach((name) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<button>${LAYER_NAMES[name]}</button><input type="range" min="0" max="1" step="0.01"><output></output>`;
    const btn = row.querySelector('button');
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    btn.addEventListener('click', () => engine.setLayer(name, { on: !engine.track.layers[name].on }));
    input.addEventListener('input', () => engine.setLayer(name, { vol: +input.value }));
    refresh.push(() => {
      const layer = engine.track.layers[name];
      btn.classList.toggle('active', layer.on);
      row.classList.toggle('off', !layer.on);
      row.classList.toggle('locked', name in settings.layers);
      input.value = layer.vol;
      out.textContent = pct(layer.vol);
    });
    $('layers').appendChild(row);
  });

  // ---------- транспорт ----------

  const playBtn = $('play');
  function setPlaying(on) {
    if (on) engine.start();
    else engine.pause();
    playBtn.textContent = on ? '❚❚ Пауза' : '▶ Играть';
  }
  $('rewind').addEventListener('click', () => engine.seek(0));

  // ---------- шкала времени ----------
  // Стрим бесконечный, поэтому шкала показывает первые полчаса и удлиняется, когда трек подходит к её концу

  const seekbar = $('seekbar');
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  let dragging = false;
  seekbar.addEventListener('input', () => {
    dragging = true;
    $('pos').textContent = clock(+seekbar.value);
  });
  seekbar.addEventListener('change', () => {
    dragging = false;
    engine.seek(+seekbar.value);
  });
  function showPosition() {
    const pos = engine.position;
    while (pos > +seekbar.max * 0.9) seekbar.max = +seekbar.max * 2;
    $('dur').textContent = clock(+seekbar.max);
    if (dragging) return;
    seekbar.value = pos;
    $('pos').textContent = clock(pos);
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
      engine.synth.startRecording();
      recording = true;
      recBtn.textContent = '■ Сохранить';
      recBtn.classList.add('active');
      return;
    }
    const blob = await engine.synth.stopRecording();
    recording = false;
    recBtn.textContent = '● Запись';
    recBtn.classList.remove('active');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `drift-${settings.seed}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // ---------- аккорды и сетка паттернов ----------

  let chordEls = [];
  let cells = []; // cells[шаг] = ячейки колонки
  let head = { step: -1, chord: -1 };

  function renderSong() {
    const song = engine.song;
    const C = engine.composer;
    $('chords').innerHTML = '';
    chordEls = song.prog.map((ch) => {
      const el = document.createElement('div');
      el.className = 'chord';
      el.textContent = C.chordName(ch);
      $('chords').appendChild(el);
      return el;
    });

    const grid = $('grid');
    const steps = C.steps();
    const beat = C.beat();
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `44px repeat(${steps}, 1fr)`;
    cells = Array.from({ length: steps }, () => []);
    GRID_ROWS.forEach((key) => {
      const name = document.createElement('span');
      name.textContent = key;
      grid.appendChild(name);
      for (let s = 0; s < steps; s++) {
        const c = document.createElement('div');
        const v = song[key][s];
        c.className = 'cell' + (s % beat === 0 ? ' beat' : '') + (v ? ' hit' : v === 0 && key === 'arp' ? ' hit' : '');
        grid.appendChild(c);
        cells[s].push(c);
      }
    });
    head = { step: -1, chord: -1 };
  }

  function setHead(step, chord) {
    if (step !== head.step) {
      if (cells[head.step]) cells[head.step].forEach((c) => c.classList.remove('head'));
      if (cells[step]) cells[step].forEach((c) => c.classList.add('head'));
    }
    if (chord !== head.chord) chordEls.forEach((el, i) => el.classList.toggle('on', i === chord));
    head = { step, chord };
  }

  function setStatus(ev) {
    const t = engine.track;
    const parts = [
      STYLE_NAMES[t.style] || THEME_NAMES[t.theme],
      MOOD_NAMES[t.mood].toLowerCase(),
      ev.sec === 'free' ? SECTION_NAMES.free : `глава ${ev.chapter}, ${SECTION_NAMES[ev.sec]}`,
      `${NOTE_NAMES[t.root]} ${SCALES.find((x) => x[0] === t.scale)[1].toLowerCase()}`,
      `${t.meter}, ${t.bpm} bpm`,
    ];
    $('status').textContent = parts.join(' · ');
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
      const analyser = engine.synth.analyser;
      if (!freq) freq = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freq);
      if (engine.playing) {
        const now = engine.ctx.currentTime;
        let ev = null;
        while (engine.events.length && engine.events[0].t <= now) ev = engine.events.shift();
        if (ev) {
          setHead(ev.step, ev.chord);
          setStatus(ev);
        }
      }
    }
    showPosition();
    draw();
  }

  engine.onChange = () => {
    refreshAll();
    renderSong();
    save();
  };

  refreshAll();
  renderSong();
  resize();
  frame();
})();
