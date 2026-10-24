// Custom audio asset support — load external sound files and bind them to game events.
import * as THREE from 'three';
import { base64ToBytes, bytesToBase64, deleteSound, getSound, listSounds, putSound } from './soundStore.ts';

export interface SoundAsset {
  id: string;
  name: string;
  duration: number;
  loaded: boolean;
  mime?: string;
  bytes?: number;
}

export interface SoundBinding {
  eventId: string;
  soundId: string;
  volume?: number;       // 0..1
  spatial?: boolean;     // positional 3D sound
  loop?: boolean;        // loop playback
  minDistance?: number;
  maxDistance?: number;
  // --- advanced shaping ---
  trimStart?: number;    // sec to skip at the beginning of the file
  trimEnd?: number;      // sec to cut off the end of the file
  rate?: number;         // playbackRate (pitch/speed) 0.25..4
  fadeIn?: number;       // sec ramp up
  fadeOut?: number;      // sec ramp down before end
  delay?: number;        // sec before start
  cooldown?: number;     // min interval between plays of this binding (anti-stacking), sec
  maxVoices?: number;    // max simultaneous instances of this binding
  overflow?: 'cut' | 'skip'; // what to do when voices are full
  restart?: boolean;     // new play cuts previous instances (mono mode)
}

export interface SoundPlayOptions {
  volume?: number;
  spatial?: boolean;
  position?: { x: number; y: number; z: number };
  loop?: boolean;
}

interface Voice { src: AudioBufferSourceNode; gain: GainNode; started: number; }
interface SoundMeta { lastPlayed: number; voices: Set<Voice>; }

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private assets = new Map<string, SoundAsset>();
  private bindings = new Map<string, SoundBinding[]>(); // eventId -> bindings

  // per-binding playback state: last play time + live voices (voice limiting, cooldown)
  private voMeta = new WeakMap<SoundBinding, SoundMeta>();
  private metaOf(b: SoundBinding): SoundMeta {
    let m = this.voMeta.get(b);
    if (!m) { m = { lastPlayed: -999, voices: new Set() }; this.voMeta.set(b, m); }
    return m;
  }
  private stopVoice(v: Voice) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.012);
      v.src.stop(t + 0.08);
    } catch { /* already stopped */ }
  }

  init(): boolean {
    if (this.ctx) return true;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    return true;
  }

  resume() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  async load(id: string, name: string, arrayBuffer: ArrayBuffer, mime = 'audio/mpeg'): Promise<void> {
    if (!this.ctx) throw new Error('AudioContext not initialized');
    // decodeAudioData отсоединяет (detach) переданный буфер — копируем ДО декодирования,
    // иначе в IndexedDB уйдёт мёртвый ArrayBuffer и звук не сохранится
    const bytes = arrayBuffer.slice(0);
    const buffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.buffers.set(id, buffer);
    this.assets.set(id, { id, name, duration: buffer.duration, loaded: true, mime, bytes: bytes.byteLength });
    await putSound({ id, name, mime, bytes });
  }

  /** Поднять ранее загруженные звуки (перезагрузка страницы/перезапуск редактора). */
  async restore(): Promise<number> {
    if (!this.ctx) return 0;
    const stored = await listSounds();
    let restored = 0;
    for (const s of stored) {
      if (this.buffers.has(s.id)) continue;
      try {
        const buffer = await this.ctx.decodeAudioData(s.bytes.slice(0));
        this.buffers.set(s.id, buffer);
        this.assets.set(s.id, { id: s.id, name: s.name, duration: buffer.duration, loaded: true, mime: s.mime, bytes: s.bytes.byteLength });
        restored += 1;
      } catch { /* повреждённый файл пропускаем */ }
    }
    return restored;
  }

  /** Переименовать звук (имя хранится вместе с файлом — переживает перезагрузку). */
  async rename(id: string, name: string): Promise<boolean> {
    const asset = this.assets.get(id);
    if (!asset) return false;
    asset.name = name;
    const stored = await getSound(id);
    if (stored) await putSound({ ...stored, name });
    return true;
  }

  /** Исходные байты звука — для экспорта проекта. */
  async rawBytes(id: string): Promise<{ id: string; name: string; mime: string; data: string } | null> {
    const asset = this.assets.get(id);
    const stored = await getSound(id);
    if (!stored) return null;
    return { id, name: asset?.name ?? stored.name, mime: stored.mime, data: bytesToBase64(stored.bytes.slice(0)) };
  }

  async importAsset(id: string, name: string, mime: string, base64: string): Promise<boolean> {
    if (!this.ctx) return false;
    try {
      const bytes = base64ToBytes(base64);
      await this.load(id, name, bytes, mime);
      return true;
    } catch {
      return false;
    }
  }

  unload(id: string) {
    this.buffers.delete(id);
    this.assets.delete(id);
    void deleteSound(id);
    for (const [eventId, bs] of this.bindings) {
      this.bindings.set(eventId, bs.filter((b) => b.soundId !== id));
    }
  }

  bind(eventId: string, soundId: string, opts: Partial<SoundBinding> = {}): boolean {
    if (!this.buffers.has(soundId)) return false;
    const binding: SoundBinding = {
      eventId,
      soundId,
      volume: opts.volume ?? 1,
      spatial: opts.spatial ?? false,
      loop: opts.loop ?? false,
      minDistance: opts.minDistance ?? 1,
      maxDistance: opts.maxDistance ?? 50,
      trimStart: opts.trimStart,
      trimEnd: opts.trimEnd,
      rate: opts.rate,
      fadeIn: opts.fadeIn,
      fadeOut: opts.fadeOut,
      delay: opts.delay,
      cooldown: opts.cooldown,
      maxVoices: opts.maxVoices,
      overflow: opts.overflow,
      restart: opts.restart,
    };
    return this.addBinding(binding);
  }

  private addBinding(b: SoundBinding): boolean {
    if (!this.buffers.has(b.soundId)) return false;
    if (!this.bindings.has(b.eventId)) this.bindings.set(b.eventId, []);
    this.bindings.get(b.eventId)!.push(b);
    return true;
  }

  unbind(eventId: string, soundId?: string) {
    if (!this.bindings.has(eventId)) return;
    if (soundId) {
      this.bindings.set(eventId, this.bindings.get(eventId)!.filter((b) => b.soundId !== soundId));
    } else {
      this.bindings.delete(eventId);
    }
  }

  getBindingsForEvent(eventId: string): SoundBinding[] {
    return this.bindings.get(eventId) ?? [];
  }

  getAllBindings(): SoundBinding[] {
    const result: SoundBinding[] = [];
    for (const bs of this.bindings.values()) result.push(...bs);
    return result;
  }

  setBindings(bindings: SoundBinding[]) {
    this.bindings.clear();
    for (const b of bindings) this.addBinding(b);
  }

  getAssets(): SoundAsset[] {
    return Array.from(this.assets.values());
  }

  // Returns true if at least one custom binding was played.
  // Per-binding advanced options: trimming, rate, fades, voice limiting, cooldown.
  play(eventId: string, opts: SoundPlayOptions = {}): boolean {
    if (!this.ctx || !this.master) return false;
    const bindings = this.bindings.get(eventId);
    if (!bindings || bindings.length === 0) return false;

    const ctx = this.ctx;
    const t = ctx.currentTime;
    let played = false;

    for (const b of bindings) {
      const buffer = this.buffers.get(b.soundId);
      if (!buffer) continue;
      const meta = this.metaOf(b);

      // anti-stacking: cooldown between plays
      if ((b.cooldown ?? 0) > 0 && t - meta.lastPlayed < (b.cooldown as number)) continue;

      if (b.restart) {
        // mono mode — a fresh event silences the previous instance
        meta.voices.forEach((v) => this.stopVoice(v));
        meta.voices.clear();
      } else {
        const maxV = Math.max(1, Math.round(b.maxVoices ?? 4));
        if (meta.voices.size >= maxV) {
          if ((b.overflow ?? 'cut') === 'skip') continue;
          let oldest: Voice | null = null;
          meta.voices.forEach((v) => { if (!oldest || v.started < oldest.started) oldest = v; });
          if (oldest) { this.stopVoice(oldest); meta.voices.delete(oldest); }
        }
      }
      meta.lastPlayed = t;

      const rate = Math.max(0.05, b.rate ?? 1);
      const trimStart = Math.min(Math.max(0, b.trimStart ?? 0), Math.max(0, buffer.duration - 0.05));
      const trimEnd = Math.min(Math.max(0, b.trimEnd ?? 0), Math.max(0, buffer.duration - trimStart - 0.05));
      const contentDur = buffer.duration - trimStart - trimEnd;
      if (contentDur <= 0.02) continue;

      const vol = Math.max(0.0001, (b.volume ?? 1) * (opts.volume ?? 1));
      const when = t + Math.max(0, b.delay ?? 0);
      const loop = b.loop ?? opts.loop ?? false;
      const fi = Math.max(0, b.fadeIn ?? 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      if (fi > 0.01) {
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.linearRampToValueAtTime(vol, when + fi);
      } else {
        gain.gain.setValueAtTime(vol, when);
      }

      let chain: AudioNode = source;
      if (b.spatial || opts.spatial) {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = b.minDistance ?? 4;
        panner.maxDistance = b.maxDistance ?? 140;
        panner.rolloffFactor = 0.45;
        if (opts.position) {
          panner.positionX.setValueAtTime(opts.position.x, when);
          panner.positionY.setValueAtTime(opts.position.y, when);
          panner.positionZ.setValueAtTime(opts.position.z, when);
        }
        source.connect(panner);
        chain = panner;
      }
      chain.connect(gain);
      gain.connect(this.master);

      const voice: Voice = { src: source, gain, started: when };
      if (loop) {
        source.loop = true;
        source.loopStart = trimStart;
        source.loopEnd = trimStart + contentDur;
        source.start(when, trimStart);
      } else {
        source.start(when, trimStart, contentDur);
        const dur = contentDur / rate; // wall-clock duration at current rate
        const fo = Math.max(0, b.fadeOut ?? 0);
        if (fo > 0.01 && fo < dur) {
          gain.gain.setValueAtTime(vol, when + dur - fo);
          gain.gain.linearRampToValueAtTime(0.0001, when + dur);
        }
        source.stop(when + dur + 0.06);
      }
      source.onended = () => { meta.voices.delete(voice); };
      meta.voices.add(voice);
      played = true;
    }
    return played;
  }

  setMasterVolume(v: number) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  // Keep the WebAudio listener glued to the camera every frame — without this all
  // positional sounds are panned/attenuated relative to the world origin.
  private lPos = new THREE.Vector3();
  private lFwd = new THREE.Vector3();
  private lUp = new THREE.Vector3();
  updateListener(camera: THREE.Camera) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    camera.getWorldPosition(this.lPos);
    this.lFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.lUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const pos = this.lPos, fwd = this.lFwd, up = this.lUp;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.05);
      l.positionY.setTargetAtTime(pos.y, t, 0.05);
      l.positionZ.setTargetAtTime(pos.z, t, 0.05);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.05);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.05);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
      l.upX.setTargetAtTime(up.x, t, 0.05);
      l.upY.setTargetAtTime(up.y, t, 0.05);
      l.upZ.setTargetAtTime(up.z, t, 0.05);
    } else {
      const legacy = l as unknown as {
        setPosition?: (x: number, y: number, z: number) => void;
        setOrientation?: (x: number, y: number, z: number, ux: number, uy: number, uz: number) => void;
      };
      legacy.setPosition?.(pos.x, pos.y, pos.z);
      legacy.setOrientation?.(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  dispose() {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.buffers.clear();
    this.assets.clear();
    this.bindings.clear();
    this.master = null;
  }
}

export const audio = new AudioManager();
