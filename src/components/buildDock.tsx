import { cn } from '../utils/cn.ts';

/** Иконки-заглушки для ресурсов (временные, заменятся текстурами). */
const ITEM_GLYPH: Record<string, string> = {
  scrap: '🧱',
  plate: '🪙',
  gear: '🔩',
  hydraulic: '⚙️',
  reactor: '☢️',
  cockpit_core: '🪑',
  fuel_cell: '🛢️',
  medkit: '💉',
  ammo_shells: '🔫',
  raremetal: '💎',
};

export type BuildTab = 'build' | 'craft' | 'inv';

export function BuildDock({ bag, buildOptions, craftOptions, activeTab, onTab, onBuild, onCraft, activeKind }: {
  bag?: { item: string; short: string; name: string; n: number }[];
  buildOptions?: { kind: string; name: string; cost: string; ok: boolean; reason?: string | null; dims?: string }[];
  craftOptions?: { id: string; name: string; desc: string; ok: boolean; missing: string }[];
  activeTab: BuildTab;
  onTab: (t: BuildTab) => void;
  onBuild?: (kind: string) => void;
  onCraft?: (recipeId: string) => void;
  /** Идёт размещение этой постройки (подсветка). */
  activeKind?: string | null;
}) {
  const bagMap = new Map((bag ?? []).map((b) => [b.item, b]));
  const resOrder = ['scrap', 'plate', 'gear', 'hydraulic', 'fuel_cell', 'reactor', 'cockpit_core', 'medkit', 'ammo_shells', 'raremetal'];
  const resources = resOrder
    .filter((id) => bagMap.has(id))
    .map((id) => bagMap.get(id)!);

  const defs = buildOptions ?? [];
  const foundations = defs.filter((d) => d.kind === 'foundation');
  const buildings = defs.filter((d) => ['factory', 'power_plant', 'oil_tower', 'extractor'].includes(d.kind));
  const defense = defs.filter((d) => !['foundation', 'factory', 'power_plant', 'oil_tower', 'extractor'].includes(d.kind));
  const recipes = craftOptions ?? [];

  const TabBtn = ({ t, label }: { t: BuildTab; label: string }) => (
    <button
      onClick={() => onTab(t)}
      className={cn(
        'rounded-t border border-b-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
        activeTab === t ? 'border-amber-500/40 bg-black/80 text-amber-300' : 'border-white/10 bg-black/40 text-stone-500 hover:text-stone-300',
      )}
    >
      {label}
    </button>
  );

  const BuildBtn = ({ b }: { b: NonNullable<typeof buildOptions>[number] }) => (
    <button
      onClick={() => onBuild?.(b.kind)}
      title={b.reason ?? b.cost}
      className={cn(
        'relative flex min-w-[132px] flex-col gap-0.5 rounded border px-2 py-1.5 text-left transition-all',
        b.ok
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20'
          : 'border-white/10 bg-white/[0.02] text-stone-500',
        activeKind === b.kind && 'ring-2 ring-amber-300/80',
      )}
    >
      <span className="text-[11px] font-bold">{b.name}</span>
      <span className="font-mono text-[9px] text-amber-300/80">{b.cost}</span>
      {b.dims && <span className="text-[8px] text-stone-500">{b.dims}</span>}
      {!b.ok && b.reason && <span className="text-[8px] leading-tight text-red-400/90">{b.reason}</span>}
      {activeKind === b.kind && <span className="text-[8px] font-bold text-amber-200">▶ размещение… ЛКМ</span>}
    </button>
  );

  const Resource = ({ r }: { r: { item: string; short: string; name: string; n: number } }) => (
    <div key={r.item} title={r.name} className="flex items-center gap-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5">
      <span className="text-[12px]">{ITEM_GLYPH[r.item] ?? '▫'}</span>
      <span className="font-mono text-[10px] font-bold text-amber-300">×{r.n}</span>
    </div>
  );

  return (
    <div className="pointer-events-auto absolute bottom-0 left-0 right-0 z-20">
      {/* ресурсы */}
      <div className="flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/95 to-black/70 px-2 pb-1 pt-1.5 backdrop-blur">
        {resources.length === 0
          ? <span className="text-[10px] text-stone-500">Рюкзак пуст — разнеси ящики/бочки, чтобы добыть ресурсы</span>
          : resources.map((r) => <Resource key={r.item} r={r} />)}
        <span className="ml-2 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-stone-500">
          💼 {bag?.reduce((s, b) => s + b.n, 0) ?? 0} шт.
        </span>
      </div>

      {/* вкладки */}
      <div className="flex justify-center gap-1 px-2">
        <TabBtn t="build" label="Стройка" />
        <TabBtn t="craft" label="Техника" />
        <TabBtn t="inv" label="Инвентарь" />
      </div>

      {/* контент вкладки */}
      <div className="mx-auto max-w-[980px] overflow-x-auto rounded-t-lg border border-b-0 border-white/10 bg-black/85 px-2 pb-2 pt-1 backdrop-blur">
        {activeTab === 'build' && (
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">Бетон</div>
              <div className="flex gap-1.5">{foundations.map((b) => <BuildBtn key={b.kind} b={b} />)}</div>
            </div>
            <div className="shrink-0">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">Здания</div>
              <div className="flex gap-1.5">{buildings.map((b) => <BuildBtn key={b.kind} b={b} />)}</div>
            </div>
            <div className="shrink-0">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">Защита</div>
              <div className="flex gap-1.5">{defense.map((b) => <BuildBtn key={b.kind} b={b} />)}</div>
            </div>
          </div>
        )}

        {activeTab === 'craft' && (
          <div className="flex gap-1.5">
            {recipes.length === 0 && <div className="text-[10px] text-stone-500">Нет доступных рецептов (построй завод).</div>}
            {recipes.map((r) => (
              <button
                key={r.id}
                onClick={() => onCraft?.(r.id)}
                disabled={!r.ok}
                className={cn(
                  'flex min-w-[150px] flex-col gap-0.5 rounded border px-2 py-1.5 text-left transition-all',
                  r.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20' : 'border-white/10 bg-white/[0.02] text-stone-500',
                )}
              >
                <span className="text-[11px] font-bold">{r.name}</span>
                <span className="text-[9px] text-stone-500">{r.desc}</span>
                {!r.ok && r.missing && <span className="text-[8px] text-red-400/90">{r.missing}</span>}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'inv' && (
          <div className="flex flex-wrap gap-1.5">
            {(bag ?? []).length === 0 ? (
              <div className="text-[10px] text-stone-500">Пусто. Ресурсы выпадают из разрушенных ящиков, бочек и врагов — подойди к трофею.</div>
            ) : (
              (bag ?? []).map((r) => (
                <div key={r.item} className="flex items-center gap-1.5 rounded border border-white/10 bg-white/[0.02] px-2 py-1">
                  <span className="text-[14px]">{ITEM_GLYPH[r.item] ?? '▫'}</span>
                  <div>
                    <div className="text-[11px] font-bold text-stone-200">{r.short}</div>
                    <div className="font-mono text-[10px] text-amber-300">×{r.n}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
