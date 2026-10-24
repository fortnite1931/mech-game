import { Play, Eye, Crosshair, Gamepad2, Cog, Bot, Keyboard, Volume2, Rocket, Mouse, CircleDot } from 'lucide-react';
import type { MechConfig, ViewMode, VisionMode, WeaponId } from '../three/playTypes.ts';
import { VIEW_ORDER, VIEW_INFO, VISION_ORDER, VISION_INFO, WEAPONS, WEAPON_LIST, CHASSIS } from '../three/playTypes.ts';
import type { SceneObjectState } from '../three/EditorEngine.ts';
import { Section, Slider, Toggle, ColorRow, Btn } from './ui.tsx';
import { cn } from '../utils/cn.ts';

const ROLE_LABEL: Record<string, string> = {
  player: 'Управляемый мех',
  reserve: 'Запасной мех',
  enemy: 'Враг',
  spawn: 'Точка спавна',
  prop: 'Декорация',
};

export function MechPanel({ config, onChange, objects, onPlay, playing, onPlayerObject, selectedId, onRole }: {
  config: MechConfig;
  onChange: (patch: Partial<MechConfig>) => void;
  objects: SceneObjectState[];
  onPlay: () => void;
  playing: boolean;
  /** Выбор пилотируемого меха (id объекта | 'auto' | 'new'). */
  onPlayerObject?: (id: string) => void;
  /** Выделенный объект — панель работает с ним. */
  selectedId?: string | null;
  /** Назначить роль выделенному объекту. */
  onRole?: (objectId: string, role: SceneObjectState['role']) => void;
}) {
  const mechs = objects.filter((o) => o.assetId.startsWith('mech_'));
  const humans = objects.filter((o) => o.assetId === 'pilot' || o.assetId === 'pilot_human' || o.assetId === 'survivor');
  const spawnFlags = objects.filter((o) => o.role === 'spawn');
  const playerByRole = mechs.find((m) => m.role === 'player') ?? null;
  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const selectedMech = selected && selected.assetId.startsWith('mech_') ? selected : null;
  const set = <K extends keyof MechConfig>(k: K, v: MechConfig[K]) => onChange({ [k]: v } as Partial<MechConfig>);
  const setSub = <K extends 'cockpit' | 'third' | 'shoulder' | 'tactical' | 'foot' | 'vitals'>(k: K, patch: Partial<MechConfig[K]>) =>
    onChange({ [k]: { ...config[k], ...patch } } as Partial<MechConfig>);
  const useNew = config.playerObjectId === 'new' || (config.playerObjectId !== 'auto' && !mechs.find((m) => m.id === config.playerObjectId));
  // резервные мехи в авто-выборе не участвуют — как и в движке
  const autoMech = mechs.find((m) => m.role !== 'reserve') ?? null;
  const chassisForInfo = useNew
    ? config.chassis
    : (playerByRole?.assetId ?? (config.playerObjectId === 'auto' ? autoMech?.assetId : mechs.find((m) => m.id === config.playerObjectId)?.assetId) ?? config.chassis);
  const ci = CHASSIS[chassisForInfo] || CHASSIS.mech_scout;

  return (
    <div className="overflow-y-auto">
      <div className="border-b border-white/[0.06] bg-white/[0.015] p-3 text-[10px] leading-relaxed text-stone-500">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-500">
          Это — общие настройки ИГРЫ
        </div>
        Здесь настраивается правило для всех мехов сразу: здоровье, оружие, камера, скорость, точки появления.
        <br /><br />
        <b className="text-stone-300">Скорость анимаций (шаг, бег, прыжок) — не здесь.</b>
        Она у каждого меха своя: выбери меха в сцене и открой вкладку
        <b className="text-stone-300"> «Анимации»</b> — там ползунки «Ходьба / Бег / Прыжок / Ранен / Покой»
        и они применяются только к выбранному меху.
        <br /><br />
        Кто игрок — задаётся ролью объекта («Свойства» → «Роль в превью» → <b className="text-stone-300">Мех игрока</b>)
        или выбором ниже. Резервных мехов может быть сколько угодно, но анимируется (ходит, бежит, прыгает)
        только мех игрока.
      </div>

      {/* ВЫДЕЛЕННЫЙ ОБЪЕКТ — контекст панели */}
      {selectedMech && (
        <div className="border-b border-white/[0.06] bg-amber-500/[0.04] p-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">Выделенный мех</div>
          <div className="text-[12px] font-bold text-stone-100">{selectedMech.name}</div>
          <div className="mt-0.5 text-[9px] text-stone-500">
            {selectedMech.assetId} · роль: <b className="text-stone-300">{ROLE_LABEL[selectedMech.role]}</b>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1">
            <Btn
              onClick={() => onRole?.(selectedMech.id, 'player')}
              title="Этот мех сядет в кабину игрока"
              className={selectedMech.role === 'player' ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200' : ''}
            >
              <Bot size={11} /> Игрок
            </Btn>
            <Btn
              onClick={() => onRole?.(selectedMech.id, 'reserve')}
              title="Резервный мех: в превью не водится, остаётся напарником"
              className={selectedMech.role === 'reserve' ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-200' : ''}
            >
              <CircleDot size={11} /> Резерв
            </Btn>
            <Btn
              onClick={() => onRole?.(selectedMech.id, 'enemy')}
              title="Враг: в превью атакует игрока"
              className={selectedMech.role === 'enemy' ? 'border-red-500/60 bg-red-500/20 text-red-200' : ''}
            >
              <Crosshair size={11} /> Враг
            </Btn>
          </div>
          {selectedMech.role !== 'player' && (
            <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[9px] leading-relaxed text-amber-200">
              Настройки ниже применяются к <b>меху игрока</b>
              {playerByRole ? <> — это <b>{playerByRole.name}</b></> : ' (в сцене его нет)'}.
              Чтобы они применялись к этому меху — нажми «Игрок» выше.
            </div>
          )}
        </div>
      )}
      {/* PLAY */}
      <div className="border-b border-white/[0.06] p-3">
        <Btn variant={playing ? 'danger' : 'success'} className="w-full py-2.5 text-[13px]" onClick={onPlay}>
          <Play size={14} fill="currentColor" /> {playing ? 'Остановить превью' : 'Запустить превью'}
        </Btn>
        <p className="mt-2 text-[10px] leading-relaxed text-stone-500">
          Как Play в игровом движке: сцена замораживается, вы садитесь в кабину меха и тестируете управление, стрельбу и виды обзора.
          После выхода сцена восстанавливается.
        </p>
      </div>

      <Section title="Игрок">
        <div className="mb-1 text-[11px] font-medium text-stone-400">Начинаем игру</div>
        <div className="grid grid-cols-2 gap-1.5">
          {([
            { id: 'mech', label: 'В мехе', hint: 'Сразу за штурвалом' },
            { id: 'foot', label: 'Пешком', hint: 'Персонаж ищет мех' },
          ] as const).map((o) => (
            <button key={o.id} onClick={() => set('playerStart', o.id)}
              className={cn('rounded-md border px-2 py-1.5 text-left transition-all',
                config.playerStart === o.id ? 'border-amber-500/60 bg-amber-500/15' : 'border-white/10 bg-white/[0.03] hover:border-white/25')}>
              <div className="text-[11px] font-bold text-stone-100">{o.label}</div>
              <div className="text-[9px] text-stone-500">{o.hint}</div>
            </button>
          ))}
        </div>

        <div className="mt-2.5 mb-1 text-[11px] font-medium text-stone-400">Кем играем на пешком</div>
        <select
          value={config.pilotObjectId}
          onChange={(e) => set('pilotObjectId', e.target.value)}
          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
        >
          <option value="auto">Авто — первый персонаж в сцене{humans[0] ? ` (${humans[0].name})` : ' (нет → временный)'}</option>
          {humans.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          <option value="new">Без объекта — временный пилот</option>
        </select>
        {humans.length === 0 && (
          <div className="mt-1 text-[10px] leading-relaxed text-stone-500">
            Поставь персонажа: «Библиотека» → категория <b className="text-stone-400">Персонажи</b> → «Пилот» или «Выживший».
          </div>
        )}

        <div className="mt-2.5 mb-1 text-[11px] font-medium text-stone-400">Точка появления</div>
        <select
          value={config.spawnMode}
          onChange={(e) => set('spawnMode', e.target.value as MechConfig['spawnMode'])}
          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
        >
          <option value="spawn_object">Объект с ролью «Спавн»{spawnFlags.length ? ` (${spawnFlags[0].name})` : ' (нет — как у камеры)'}</option>
          <option value="random">Случайная точка мира</option>
          <option value="camera">У текущей камеры редактора</option>
        </select>

        <div className="mt-2.5">
          <Slider label="Шаг пилота, м/с" value={config.foot.walk} min={1} max={9} step={0.1}
            onChange={(v) => setSub('foot', { walk: v })} format={(v) => v.toFixed(1)} />
          <Slider label="Бег пилота (Shift), м/с" value={config.foot.run} min={2} max={22} step={0.5}
            onChange={(v) => setSub('foot', { run: v })} format={(v) => v.toFixed(1)} />
          <Slider label="Дистанция посадки в мех, м" value={config.enterRange ?? 10} min={2} max={40} step={1}
            onChange={(v) => set('enterRange', Math.round(v))} format={(v) => `${Math.round(v)} м`} />
        </div>
        <div className="mt-1 text-[10px] leading-relaxed text-stone-500">
          Пешком: WASD — движение, мышь — обзор, ЛКМ по меху — сесть за руль, F — выйти из кабины.
          Сесть можно только рядом с мехом (дистанция выше). Промахнулся мимо меха — пилот сядет
          в ближайший, если стоит рядом.
        </div>
      </Section>

      <Section title="Здоровье и снаряжение">
        <Slider label="Здоровье игрока" value={config.vitals.health} min={10} max={1000} step={5}
          onChange={(v) => setSub('vitals', { health: Math.round(v) })} format={(v) => `${Math.round(v)} HP`} />
        <Slider label="Выносливость (макс.)" value={config.vitals.stamina} min={10} max={400} step={5}
          onChange={(v) => setSub('vitals', { stamina: Math.round(v) })} format={(v) => `${Math.round(v)}`} />
        <Slider label="Восстановление выносливости, ед/с" value={config.vitals.staminaRegen} min={1} max={60} step={1}
          onChange={(v) => setSub('vitals', { staminaRegen: v })} format={(v) => v.toFixed(0)} />
        <Slider label="Расход выносливости на бег, ед/с" value={config.vitals.runDrain} min={1} max={60} step={1}
          onChange={(v) => setSub('vitals', { runDrain: v })} format={(v) => v.toFixed(0)} />
        <Slider label="Грузоподъёмность рюкзака, кг" value={config.vitals.carryKg} min={10} max={500} step={5}
          onChange={(v) => setSub('vitals', { carryKg: Math.round(v) })} format={(v) => `${Math.round(v)} кг`} />
        <div className="mt-1 text-[10px] text-stone-500">
          Аптечка в рюкзаке лечит 40 HP — клавиша <b className="text-stone-400">H</b> в превью.
        </div>
      </Section>

      <Section title="Добыча и крафт">
        <div className="text-[10px] leading-relaxed text-stone-500">
          Лут, разбор машин, таблицы добычи и рецепты сборки настраиваются в панели
          <b className="text-stone-400"> «Сценарий» → «Добыча и крафт»</b>.
          В превью: <b className="text-stone-400">B</b> — панель сборки, лут с мусора подбирается рядом,
          из убитых машин выпадают детали.
        </div>
      </Section>

      <Section title="Пилотируемый мех">
        <div className="mb-1 text-[11px] font-medium text-stone-400">Какой мех пилотировать</div>
        {playerByRole && (
          <div className="mb-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-emerald-200">
            Роль «Управляемый мех» назначена: <b>{playerByRole.name}</b>. Он и сядет в кабину.
            Снять роль можно в «Свойствах» объекта.
          </div>
        )}
        <select
          value={useNew ? 'new' : (playerByRole ? playerByRole.id : config.playerObjectId)}
          onChange={(e) => (onPlayerObject ? onPlayerObject(e.target.value) : set('playerObjectId', e.target.value))}
          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
        >
          <option value="auto">Авто — первый обычный мех в сцене{autoMech ? ` (${autoMech.name})` : ' (нет → новый)'}</option>
          {mechs.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}{m.role === 'player' ? ' — мех игрока' : m.role === 'reserve' ? ' — резерв' : ''}
            </option>
          ))}
          <option value="new">Новый мех (заспавнить на точке камеры)</option>
        </select>
        {useNew && (
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {Object.entries(CHASSIS).map(([id, c]) => (
              <button key={id} onClick={() => set('chassis', id)}
                className={cn('rounded-md border px-1.5 py-1.5 text-left transition-all', config.chassis === id ? 'border-amber-500/60 bg-amber-500/15' : 'border-white/10 bg-white/[0.03] hover:border-white/25')}>
                <div className="flex items-center gap-1 text-[11px] font-bold text-stone-200"><Bot size={11} />{c.name}</div>
                <div className="text-[9px] text-stone-500">{c.tonnage} т</div>
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
          {[['Масса', `${ci.tonnage} т`], ['Скорость', `${Math.round(config.maxSpeed * ci.speedMul)} км/ч`], ['Манёвр', `${Math.round(config.turnSpeed * ci.turnMul)}°/с`]].map(([k, v]) => (
            <div key={k} className="rounded border border-white/[0.07] bg-black/30 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-stone-500">{k}</div>
              <div className="font-mono text-[12px] font-bold text-amber-300">{v}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Режим обзора по умолчанию">
        <div className="grid grid-cols-2 gap-1.5">
          {VIEW_ORDER.map((v: ViewMode) => (
            <button key={v} onClick={() => set('defaultView', v)}
              className={cn('rounded-md border px-2 py-2 text-left transition-all', config.defaultView === v ? 'border-amber-500/60 bg-amber-500/15' : 'border-white/10 bg-white/[0.03] hover:border-white/25')}>
              <div className={cn('flex items-center gap-1.5 text-[11px] font-bold', config.defaultView === v ? 'text-amber-200' : 'text-stone-300')}><Eye size={11} />{VIEW_INFO[v].label}</div>
              <div className="mt-0.5 text-[9px] leading-tight text-stone-500">{VIEW_INFO[v].desc}</div>
            </button>
          ))}
        </div>
        <div className="mt-2 mb-1 text-[11px] font-medium text-stone-400">Режим зрения (переключение — N)</div>
        <div className="flex gap-1">
          {VISION_ORDER.map((v: VisionMode) => (
            <button key={v} onClick={() => set('defaultVision', v)}
              className={cn('flex-1 rounded border px-1 py-1 text-[10px] font-bold', config.defaultVision === v ? 'border-amber-500/60 bg-amber-500/15 text-amber-200' : 'border-white/10 text-stone-400 hover:text-stone-200')}>
              {VISION_INFO[v].label}
            </button>
          ))}
        </div>
        <ColorRow label="Цвет HUD" value={config.hudColor} onChange={(v) => set('hudColor', v)} />
        <div className="flex gap-1">
          {['#7cf5b0', '#ffb15c', '#5ad8ff', '#ff6a5a', '#e8e0c8', '#c9a0ff'].map((c) => (
            <button key={c} onClick={() => set('hudColor', c)} className={cn('h-5 flex-1 rounded border', config.hudColor === c ? 'border-white' : 'border-white/15')} style={{ background: c }} />
          ))}
        </div>
      </Section>

      <Section title="Кабина — вид из кокпита" defaultOpen={false}>
        <Slider label="Поле зрения (FOV)" value={config.cockpit.fov} min={50} max={110} step={1} onChange={(v) => setSub('cockpit', { fov: v })} format={(v) => `${Math.round(v)}°`} />
        <Slider label="Высота глаз пилота" value={config.cockpit.height} min={-0.5} max={0.8} step={0.01} onChange={(v) => setSub('cockpit', { height: v })} format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} м`} />
        <Slider label="Сдвиг вперёд" value={config.cockpit.forward} min={-0.5} max={1.5} step={0.01} onChange={(v) => setSub('cockpit', { forward: v })} format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} м`} />
        <Slider label="Предел наклона взгляда" value={config.cockpit.pitchLimit} min={10} max={80} step={1} onChange={(v) => setSub('cockpit', { pitchLimit: v })} format={(v) => `±${Math.round(v)}°`} />
        <Slider label="Непрозрачность рамы кабины" value={config.cockpit.frameOpacity} min={0} max={1} onChange={(v) => setSub('cockpit', { frameOpacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Покачивание при ходьбе" value={config.cockpit.sway} min={0} max={1.5} onChange={(v) => setSub('cockpit', { sway: v })} />
        <Toggle label="Сканлайны на бронестекле" value={config.cockpit.scanlines} onChange={(v) => setSub('cockpit', { scanlines: v })} />
      </Section>

      <Section title="Третье лицо" defaultOpen={false}>
        <Slider label="Дистанция камеры" value={config.third.distance} min={4} max={30} step={0.5} onChange={(v) => setSub('third', { distance: v })} format={(v) => `${v.toFixed(1)} м`} />
        <Slider label="Высота точки взгляда" value={config.third.height} min={0} max={8} step={0.1} onChange={(v) => setSub('third', { height: v })} format={(v) => `${v.toFixed(1)} м`} />
        <Slider label="FOV" value={config.third.fov} min={35} max={90} step={1} onChange={(v) => setSub('third', { fov: v })} format={(v) => `${Math.round(v)}°`} />
        <Slider label="Плавность слежения" value={config.third.smoothing} min={2} max={20} step={0.5} onChange={(v) => setSub('third', { smoothing: v })} format={(v) => v.toFixed(1)} />
        <Toggle label="Камера сама заходит за спину при ходьбе" value={config.third.autoFollow} onChange={(v) => setSub('third', { autoFollow: v })} />
      </Section>

      <Section title="Из-за плеча" defaultOpen={false}>
        <Slider label="Дистанция" value={config.shoulder.distance} min={2.5} max={12} step={0.25} onChange={(v) => setSub('shoulder', { distance: v })} format={(v) => `${v.toFixed(2)} м`} />
        <Slider label="Высота" value={config.shoulder.height} min={1} max={7} step={0.1} onChange={(v) => setSub('shoulder', { height: v })} format={(v) => `${v.toFixed(1)} м`} />
        <Slider label="Смещение к плечу" value={config.shoulder.side} min={-4} max={4} step={0.1} onChange={(v) => setSub('shoulder', { side: v })} format={(v) => `${v.toFixed(1)} м`} />
        <Slider label="FOV" value={config.shoulder.fov} min={35} max={90} step={1} onChange={(v) => setSub('shoulder', { fov: v })} format={(v) => `${Math.round(v)}°`} />
      </Section>

      <Section title="Тактический (изометрия)" defaultOpen={false}>
        <Slider label="Дистанция" value={config.tactical.distance} min={10} max={50} step={1} onChange={(v) => setSub('tactical', { distance: v })} format={(v) => `${Math.round(v)} м`} />
        <Slider label="Угол камеры" value={config.tactical.pitch} min={25} max={85} step={1} onChange={(v) => setSub('tactical', { pitch: v })} format={(v) => `${Math.round(v)}°`} />
        <Slider label="FOV" value={config.tactical.fov} min={25} max={70} step={1} onChange={(v) => setSub('tactical', { fov: v })} format={(v) => `${Math.round(v)}°`} />
        <Toggle label="Поворачивать карту за мехом" value={config.tactical.autoFollow} onChange={(v) => setSub('tactical', { autoFollow: v })} />
      </Section>

      <Section title="Управление">
        <Toggle label="Камера только при зажатом колёсике (СКМ)" icon={<Mouse size={13} />} value={config.cameraNeedsMMB} onChange={(v) => set('cameraNeedsMMB', v)} />
        <Slider label="Чувствительность мыши" value={config.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => set('sensitivity', v)} format={(v) => `${v.toFixed(2)}×`} />
        <Toggle label="Инверсия оси Y" value={config.invertY} onChange={(v) => set('invertY', v)} />
        <Toggle label="Прыжковые двигатели (Space)" icon={<Rocket size={13} />} value={config.jumpJets} onChange={(v) => set('jumpJets', v)} />
        <Toggle label="Звуковые эффекты" icon={<Volume2 size={13} />} value={config.sfx} onChange={(v) => set('sfx', v)} />
      </Section>

      <Section title="Вооружение — 4 слота">
        {config.weapons.map((wid, i) => {
          const w = WEAPONS[wid] || WEAPONS.none;
          return (
            <div key={i} className="mb-1.5 rounded-md border border-white/[0.07] bg-white/[0.02] p-1.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-amber-500/15 font-mono text-[11px] font-black text-amber-300">{i + 1}</span>
                <select value={wid} onChange={(e) => { const ws = [...config.weapons]; ws[i] = e.target.value as WeaponId; set('weapons', ws); }}
                  className="flex-1 rounded border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none">
                  {WEAPON_LIST.map((id) => <option key={id} value={id}>{WEAPONS[id].name}</option>)}
                </select>
              </div>
              {w.kind !== 'none' && (
                <div className="mt-1 flex gap-2 pl-8 font-mono text-[9px] text-stone-500">
                  <span>урон <b className="text-stone-300">{w.damage}</b></span>
                  <span>темп <b className="text-stone-300">{w.rof}/с</b></span>
                  <span>нагрев <b className="text-stone-300">{w.heat}</b></span>
                  <span>б/к <b className="text-stone-300">{w.ammo ?? '∞'}</b></span>
                  {w.salvo > 1 && <span>залп <b className="text-stone-300">×{w.salvo}</b></span>}
                </div>
              )}
            </div>
          );
        })}
        <div className="mt-1 flex items-center gap-1.5 rounded border border-white/[0.07] bg-black/30 p-2 text-[10px] text-stone-500">
          <Crosshair size={11} className="shrink-0 text-amber-500" /> ЛКМ — выбранное оружие, ПКМ — альфа-страйк всеми. Перегрев &gt;100 отключает реактор на 3.5 с.
        </div>
      </Section>

      <Section title="Ходовая часть" defaultOpen={false}>
        <Slider label="Макс. скорость (базовая)" value={config.maxSpeed} min={10} max={90} step={1} onChange={(v) => set('maxSpeed', v)} format={(v) => `${Math.round(v)} км/ч`} />
        <Slider label="Скорость поворота" value={config.turnSpeed} min={20} max={180} step={1} onChange={(v) => set('turnSpeed', v)} format={(v) => `${Math.round(v)}°/с`} />
        <Slider label="Разворот торса" value={config.torsoTwist} min={30} max={180} step={5} onChange={(v) => set('torsoTwist', v)} format={(v) => `±${Math.round(v)}°`} />
        <Slider label="Разгон" value={config.accel} min={0.1} max={1} onChange={(v) => set('accel', v)} />
        <div className="mt-1 text-[10px] text-stone-500"><Cog size={10} className="mr-1 inline" />Итог зависит от шасси: лёгкие мехи быстрее и манёвреннее тяжёлых.</div>
      </Section>

      <div className="p-3">
        <div className="rounded-md border border-white/[0.07] bg-black/30 p-2.5 text-[10px] leading-relaxed text-stone-500">
          <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wider text-stone-400"><Keyboard size={11} className="text-amber-500" /> Управление в превью</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {[['W / S', 'ход'], ['A / D', 'поворот'], ['Shift', 'форсаж'], ['Space', 'джет-двигатели'], ['СКМ зажать', 'обзор камеры'], ['Колесо', 'зум / FOV'], ['ЛКМ / ПКМ', 'огонь / залп'], ['1-4, Tab', 'оружие'], ['V / N', 'вид / зрение'], ['C', 'центр торса'], ['H', 'подсказка'], ['Esc', 'выход']].map(([k, v]) => (
              <div key={k}><b className="font-mono text-stone-300">{k}</b> — {v}</div>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1 text-stone-600"><Gamepad2 size={10} /> Конфигурация сохраняется в JSON сцены (ключ «player»).</div>
        </div>
      </div>
    </div>
  );
}
