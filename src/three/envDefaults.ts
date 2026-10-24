import type { SoundBinding } from './audio.ts';

export interface EffectFlags {
  dust: boolean;     // взвешенная пыль в воздухе
  fog: boolean;      // туман / дымка
  sky: boolean;      // небо и купол
  sun: boolean;      // солнце и направленный свет
  shadows: boolean;  // тени
  postfx: boolean;   // постобработка: блум, виньетка, ночное видение/тепловизор
  ground: boolean;   // земля
}

export const DEFAULT_FX: EffectFlags = {
  dust: true, fog: true, sky: true, sun: true, shadows: true, postfx: true, ground: true,
};

export interface EnvState {
  fogDensity: number;
  dust: number;
  sunIntensity: number;
  sunAngle: number;
  exposure: number;
  skyColor: string;
  groundTint: string;
  grid: boolean;
  showCollisions: boolean;
  snap: boolean;
  snapSize: number;
  timePreset: string;
  soundBindings: SoundBinding[];
  fx: EffectFlags;
}

export const DEFAULT_ENV: EnvState = {
  fogDensity: 0.016,
  // Пыль в воздухе по умолчанию выключена — включается в панели «Эффекты»
  dust: 0,
  sunIntensity: 2.4,
  sunAngle: 35,
  exposure: 1.05,
  skyColor: '#c97a2e',
  groundTint: '#bfae98',
  grid: true,
  showCollisions: false,
  snap: true,
  snapSize: 0.5,
  timePreset: 'dust-storm',
  soundBindings: [],
  fx: { ...DEFAULT_FX, dust: false },
};

export const TIME_PRESETS: Record<string, Partial<EnvState> & { label: string }> = {
  'dust-storm': { label: 'Пыльная буря', fogDensity: 0.022, dust: 1.0, sunIntensity: 1.8, exposure: 1.05, skyColor: '#c97a2e', sunAngle: 35 },
  'noon': { label: 'Полдень', fogDensity: 0.008, dust: 0.35, sunIntensity: 3.0, exposure: 1.0, skyColor: '#d8a05a', sunAngle: 60 },
  'sunset': { label: 'Закат', fogDensity: 0.014, dust: 0.6, sunIntensity: 2.0, exposure: 1.1, skyColor: '#b5431f', sunAngle: 12 },
  'night': { label: 'Ночь', fogDensity: 0.012, dust: 0.25, sunIntensity: 0.5, exposure: 0.9, skyColor: '#1a2233', sunAngle: 80 },
};