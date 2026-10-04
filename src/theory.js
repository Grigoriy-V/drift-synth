// Теория и общие помощники: лады, размеры, аккорды, генератор случайных чисел по сиду.
(function () {
  'use strict';

  const D = (window.Drift = window.Drift || {});

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

  // Размер: число долей в такте и на сколько шагов делится доля (4 — шестнадцатые, 3 — триоли восьмых)
  const METERS = {
    '4/4': { beats: 4, sub: 4 },
    '3/4': { beats: 3, sub: 4 },
    '5/4': { beats: 5, sub: 4 },
    '6/8': { beats: 2, sub: 3 },
    '9/8': { beats: 3, sub: 3 },
    '12/8': { beats: 4, sub: 3 },
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

  // Аккорд: root — полутоны от тоники, ints — интервалы от корня, mel — звуки для мелодии (от тоники),
  // arp — интервалы для переборов, fifth — квинта для баса. Обозначение выводится из интервалов
  function makeChord(root, ints) {
    const has = (i) => ints.includes(i);
    const dim5 = has(6) && !has(7);
    let label;
    if (!has(3) && !has(4)) label = has(5) ? 'sus' : has(2) ? 'sus2' : '5';
    else if (dim5) label = has(10) ? 'm7b5' : 'dim';
    else label = (has(3) ? 'm' : '') + (has(11) ? (has(14) ? 'maj9' : 'maj7') : has(10) ? (has(14) ? '9' : '7') : '');
    return {
      root,
      ints,
      label,
      mel: ints.slice(0, 3).map((i) => (root + i) % 12),
      arp: [...new Set(ints.filter((i) => i < 12))],
      fifth: ints.find((i) => i >= 6 && i <= 8) || 7,
    };
  }

  // Генератор случайных чисел, однозначно заданный строкой-сидом
  const rngFrom = (seed) => mulberry32(hashSeed(String(seed)));

  Object.assign(D, { NOTE_NAMES, SCALES, METERS, clamp, mtof, mod, euclid, makeChord, rngFrom });
})();
