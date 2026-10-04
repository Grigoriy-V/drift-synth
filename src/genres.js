// Жанровые параметры: темы, настроения, характер ударных, секции стрима.
// Здесь только числа и пулы для выбора — ни нот, ни готовых рисунков.
(function () {
  'use strict';

  const D = (window.Drift = window.Drift || {});

  // Темы: из этих пулов дирижёр выбирает инструменты, атмосферу, лад и аккордовые ходы
  // Темы — единственное описание жанра. Из пулов сид (и дирижёр между главами) выбирает
  // инструменты, атмосферу, бит и размер.
  // ensemble — вероятность, что слой участвует в треке; human — неровность исполнения (0–1)
  const THEMES = {
    lofi: {
      padInst: ['warm', 'glass'], leadInst: ['ep', 'guitar', 'vibes', 'musicbox', 'flute'], arpInst: ['pluck', 'guitar', 'harp'],
      bassInst: ['sub', 'upright'], kit: ['lofi'], amb: ['rain', 'night', 'fire', 'none'],
      chordBars: [1, 1, 2], drumStyle: ['broken', 'broken', 'half'], meter: ['4/4', '4/4', '4/4', '4/4', '3/4'],
      feel: 'lofi',
      ensemble: { pad: 1, bass: 1, lead: 0.95, drums: 0.95, arp: 0.6, bells: 0.45, choir: 0.12, texture: 0.25, vinyl: 0.85, amb: 0.75 },
      human: 0.8, harmony: { ext: 'ninth', subs: 0.35, harmonicV: 0.5 },
      // mix — средние значения настроек звука, vols — громкости слоёв; сид варьирует их вокруг этих чисел
      mix: { bpm: 86, reverb: 0.4, delay: 0.3, bright: 0.32, density: 0.5, swing: 0.45, tape: 0.6, pump: 0.3, drive: 0.45 },
      vols: { pad: 0.8, bass: 0.75, arp: 0.4, bells: 0.3, drums: 0.75, lead: 0.7, vinyl: 0.6 },
    },
    fantasy: {
      padInst: ['lute', 'lute', 'strings'], leadInst: ['flute', 'harp', 'guitar'], arpInst: ['harp', 'guitar'],
      bassInst: ['bowed', 'upright'], kit: ['folk'], amb: ['forest', 'fire', 'waves', 'none'],
      chordBars: [1, 1, 2], drumStyle: ['half'], meter: ['12/8', '12/8', '4/4'],
      ensemble: { pad: 0.9, bass: 0.85, lead: 1, drums: 0.75, arp: 0.8, bells: 0.2, choir: 0.45, texture: 0.3, vinyl: 0, amb: 0.85 },
      human: 0.6, harmony: { ext: 'triad', open: 0.2, sus: 0.12, harmonicV: 0.25 },
      // mix — средние значения настроек звука, vols — громкости слоёв; сид варьирует их вокруг этих чисел
      mix: { bpm: 100, reverb: 0.45, delay: 0.08, bright: 0.6, density: 0.5, swing: 0, tape: 0.05, pump: 0, drive: 0.1 },
      vols: { pad: 0.8, choir: 0.35, bass: 0.5, arp: 0.7, drums: 0.6, lead: 0.9, amb: 0.6 },
      // Стили внутри темы: каждый переопределяет инструменты, размер, грув и состав.
      // arp — рисунок аккомпанемента, drone — бас-бурдон, high/grace — флейта октавой выше с форшлагами
      styles: {
        tavern: {
          meter: ['12/8', '12/8', '4/4', '6/8', '9/8'], feel: 'tavern', padInst: ['lute'], leadInst: ['flute', 'guitar'], arpInst: ['harp', 'guitar'],
          amb: ['fire', 'forest', 'none'], chordBars: [1], arp: 'roll', drone: true, high: true, grace: true,
          ensemble: { drums: 0.85, choir: 0.1, arp: 0.8, pad: 1, bells: 0.1, texture: 0.1 },
        },
        ballad: {
          meter: ['4/4', '12/8', '3/4', '6/8'], feel: 'soft', padInst: ['strings', 'glass'], leadInst: ['flute', 'harp', 'guitar'], arpInst: ['harp', 'guitar'],
          bassInst: ['bowed', 'upright'], amb: ['forest', 'waves', 'night', 'rain'], chordBars: [2, 2, 1], arp: 'broken', drone: true,
          tempo: 0.8, density: -0.12,
          ensemble: { drums: 0.15, choir: 0.35, arp: 0.95, pad: 0.85, bells: 0.3, texture: 0.4 },
        },
        lament: {
          // плач: одинокий инструмент над тянущимися струнными, редкие ноты аккомпанемента
          meter: ['4/4', '3/4', '6/8'], feel: 'soft', padInst: ['strings'], leadInst: ['flute', 'guitar'], arpInst: ['guitar', 'harp'],
          bassInst: ['bowed'], amb: ['rain', 'night', 'fire'], chordBars: [2], arp: 'sparse', drone: true,
          tempo: 0.85, density: -0.1,
          ensemble: { drums: 0.05, choir: 0.5, arp: 0.5, pad: 1, bass: 0.6, bells: 0.1, texture: 0.5 },
        },
        mystic: {
          meter: ['4/4', '4/4', '3/4', '5/4'], feel: 'soft', padInst: ['strings', 'warm', 'glass'], leadInst: ['flute', 'musicbox', 'harp'], arpInst: ['harp'],
          amb: ['night', 'waves', 'fire'], chordBars: [2, 4], arp: 'sparse', drone: true,
          tempo: 0.8, density: -0.15,
          ensemble: { drums: 0.2, choir: 0.85, arp: 0.55, pad: 1, bells: 0.5, texture: 0.7 },
        },
        march: {
          meter: ['4/4'], feel: 'march', padInst: ['strings'], leadInst: ['flute', 'guitar'], arpInst: ['harp', 'guitar'],
          bassInst: ['bowed', 'upright'], amb: ['none', 'fire'], chordBars: [1, 2], arp: 'roll', high: true,
          ensemble: { drums: 1, choir: 0.7, arp: 0.6, pad: 1, bells: 0.1, texture: 0.1 },
        },
      },
      moodStyles: { happy: ['tavern', 'tavern', 'tavern', 'march'], calm: ['ballad', 'ballad', 'ballad', 'mystic'], sad: ['lament', 'lament', 'lament', 'ballad'], dark: ['mystic', 'mystic', 'ballad'], epic: ['march', 'march', 'tavern'] },
    },
    anime: {
      padInst: ['glass', 'warm'], leadInst: ['synth', 'ep', 'vibes', 'musicbox'], arpInst: ['chip', 'pluck', 'harp'],
      bassInst: ['fm', 'synth'], kit: ['80s', 'lofi'], amb: ['night', 'rain', 'none'],
      chordBars: [1, 1, 2], drumStyle: ['broken', 'four'], meter: ['4/4'],
      ensemble: { pad: 1, bass: 1, lead: 1, drums: 0.95, arp: 0.7, bells: 0.5, choir: 0.15, texture: 0.1, vinyl: 0.3, amb: 0.5 },
      human: 0.3, harmony: { ext: 'ninth', subs: 0.2, harmonicV: 0.5 },
      // mix — средние значения настроек звука, vols — громкости слоёв; сид варьирует их вокруг этих чисел
      mix: { bpm: 96, reverb: 0.5, delay: 0.4, bright: 0.68, density: 0.6, swing: 0.15, tape: 0.35, pump: 0.2, drive: 0.25 },
      vols: { pad: 0.8, bass: 0.8, arp: 0.5, bells: 0.4, drums: 0.75, lead: 0.65, amb: 0.35 },
    },
    ambient: {
      padInst: ['glass', 'strings', 'warm'], leadInst: ['musicbox', 'vibes', 'flute', 'ep', 'guitar'], arpInst: ['harp', 'pluck', 'guitar'],
      bassInst: ['sub'], kit: ['lofi'], amb: ['waves', 'rain', 'forest', 'night'],
      chordBars: [2, 2, 4], drumStyle: ['half'], meter: ['4/4', '4/4', '12/8', '3/4', '5/4'],
      ensemble: { pad: 1, bass: 0.6, lead: 0.7, drums: 0.12, arp: 0.6, bells: 0.8, choir: 0.6, texture: 0.6, vinyl: 0.15, amb: 0.8 },
      human: 0.5, harmony: { ext: 'ninth', open: 0.1 },
      // mix — средние значения настроек звука, vols — громкости слоёв; сид варьирует их вокруг этих чисел
      mix: { bpm: 74, reverb: 0.85, delay: 0.5, bright: 0.45, density: 0.3, swing: 0, tape: 0.2, pump: 0, drive: 0.1 },
      vols: { pad: 0.8, choir: 0.6, bass: 0.5, arp: 0.7, bells: 0.7, lead: 0.8 },
    },
    synthwave: {
      padInst: ['warm', 'strings'], leadInst: ['synth', 'ep'], arpInst: ['pluck', 'chip'],
      bassInst: ['synth', 'fm'], kit: ['80s'], amb: ['night', 'none'],
      chordBars: [1, 1, 2], drumStyle: ['four', 'four', 'broken'], meter: ['4/4'],
      ensemble: { pad: 1, bass: 1, lead: 0.9, drums: 1, arp: 0.9, bells: 0.3, choir: 0.1, texture: 0, vinyl: 0.1, amb: 0.3 },
      human: 0, harmony: { ext: 'triad', seventh: 0.25, harmonicV: 0.3 },
      // mix — средние значения настроек звука, vols — громкости слоёв; сид варьирует их вокруг этих чисел
      mix: { bpm: 104, reverb: 0.5, delay: 0.5, bright: 0.8, density: 0.75, swing: 0, tape: 0.15, pump: 0.4, drive: 0.3 },
      vols: { pad: 0.7, bass: 0.8, arp: 0.8, bells: 0.3, drums: 0.75, lead: 0.55 },
    },
  };

  // Настроение: лады, из которых выбирает дирижёр, характер мелодии (leap — скачки, rest — паузы,
  // stacc — отрывисто), как часто вступают ударные и поправки к вероятности слоёв в секциях.
  // tempo/density/bright — поправки к базовым значениям темы (их применяет панель)
  // dir — куда тянется мелодия (больше нуля — вверх, меньше — вниз), reverb — поправка к ревербу
  const MOODS = {
    happy: { scales: ['major', 'mixolydian', 'lydian'], tempo: 1.18, density: 0.18, bright: 0.12, drums: 1, leap: 0.35, rest: 0.1, stacc: true, dir: 0.25, bias: { arp: 0.2, lead: 0.2 } },
    calm: { scales: ['major', 'lydian', 'mixolydian'], tempo: 0.86, density: -0.18, bright: -0.04, drums: 0.5, leap: 0.1, rest: 0.5, stacc: false, dir: 0, reverb: 0.05, bias: { choir: 0.1, bells: 0.1 } },
    sad: { scales: ['minor', 'minor', 'dorian'], tempo: 0.76, density: -0.2, bright: -0.16, drums: 0.3, leap: 0.15, rest: 0.55, stacc: false, dir: -0.45, reverb: 0.12, bias: { lead: 0.3, arp: -0.2, bells: -0.2 } },
    dark: { scales: ['phrygian', 'minor'], tempo: 0.8, density: -0.15, bright: -0.2, drums: 0.5, leap: 0.2, rest: 0.5, stacc: false, dir: -0.15, reverb: 0.1, bias: { choir: 0.4, arp: -0.2, bells: 0.2 } },
    epic: { scales: ['minor', 'dorian', 'mixolydian'], tempo: 1.02, density: 0.1, bright: 0.05, drums: 1, leap: 0.4, rest: 0.15, stacc: false, dir: 0.15, bias: { choir: 0.5, lead: 0.1 } },
  };

  // Характер ударных — только вероятности, сами рисунки генерируются в genDrums():
  // sync — сколько синкоп у бочки, kick3 — шанс бочки на третью долю, snare — шанс малого на 2 и 4,
  // ghost — тихие удары между долями, hats — возможные рисунки хэта, open — открытый хэт, roll — подводка
  const FEELS = {
    lofi: { sync: 1, ghost: 1, hats: ['8', '8', 'off', '16', 'skip'], open: 0.4, roll: 0.3 },
    tavern: { sync: 0.5, kick3: 0.9, snare: 0.8, ghost: 0.8, hats: ['off', '8', 'skip'], open: 0, roll: 0.5 },
    soft: { sparse: true, hats: ['4'], open: 0, roll: 0 },
    march: { sync: 0.4, kick3: 1, ghost: 1.2, hats: ['8', '4'], open: 0.2, roll: 0.9 },
    plain: { sync: 0.7, ghost: 0.4, hats: ['8', '16', 'off'], open: 0.5, roll: 0.4 },
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

  // громкость слоя, если тема её не задаёт
  const DEFAULT_VOLS = { pad: 0.8, choir: 0.4, bass: 0.7, arp: 0.6, bells: 0.5, drums: 0.7, lead: 0.7, texture: 0.4, vinyl: 0.5, amb: 0.5 };

  Object.assign(D, { THEMES, MOODS, FEELS, SECTIONS, DEFAULT_VOLS });
})();
