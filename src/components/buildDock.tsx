import { cn } from '../utils/cn.ts';

/** Иконки-заглушки для ресурсов (временные). */
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
  activeKind?: string | null;
}) {
  const bagMap = new Map((bag ?? []).map((b) => [b.item, b]));
  const resOrder = ['scrap', 'plate', 'gear', 'hydraulic', 'fuel_cell', 'reactor', 'cockpit_core', 'medkit', 'ammo_shells', 'raremetal'];
  const resources = resOrder.filter((id) => bagMap.has(id)).map((id) => bagMap.get(id)!);

  const defs = buildOptions ?? [];
  const foundations = defs.filter((d) => d.kind === 'foundation');
  const buildings = defs.filter((d) => ['factory', 'power_plant', 'oil_tower', 'extractor'].includes(d.kind));
  const defense = defs.filter((d) => !['foundation', 'factory', 'power_plant', 'oil_tower', 'extractor'].includes(d.kind));
  const recipes = craftOptions ?? [];

  const TabBtn = ({ t, label }: { t: BuildTab; label: string }) => (
    <button
      onClick={() => onTab(t)}
      className={cn(
        'rounded-t border border-b-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors',
        activeTab === t ? 'border-amber-500/40 bg-black/80 text-amber-300' : 'border-white/10 bg-black/40 text-stone-500 hover:text-stone-300',
      )}
    >
      {label}
    </button>
  );

  const Card = ({ name, cost, dims, ok, reason, active, onClick, hint }: {
    name: string; cost: string; dims?: string; ok: boolean; reason?: string | null;
    active?: boolean; onClick: () => void; hint?: string;
  }) => (
    <button
      onClick={onClick}
      title={hint ?? reason ?? cost}
      className={cn(
        'flex w-[128px] shrink-0 flex-col gap-0.5 rounded border px-2 py-1.5 text-left transition-all',
        ok ? 'border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20' : 'border-white/10 bg-white/[0.02] text-stone-500',
        active && 'ring-2 ring-amber-300/80',
      )}
    >
      <span className="truncate text-[11px] font-bold">{name}</span>
      <span className="font-mono text-[9px] text-amber-300/80">{cost}</span>
      {dims && <span className="text-[8px] text-stone-500">{dims}</span>}
      {!ok && reason && <span className="text-[8px] leading-tight text-red-400/90">{reason}</span>}
      {active && <span className="text-[8px] font-bold text-amber-200">▶ ЛКМ по земле</span>}
    </button>
  );

  return (
    <div className="pointer-events-auto absolute bottom-0 left-0 right-0 z-20 select-none">
      {/* ресурсы */}
      <div className="flex items-center justify-center gap-1 bg-gradient-to-t from-black/95 to-black/70 px-2 pb-1 pt-1.5 backdrop-blur">
        {resources.length === 0 ? (
          <span className="text-[10px] text-stone-500">Рюкзак пуст — разнеси ящики/бочки, чтобы добыть ресурсы</span>
        ) : (
          resources.map((r) => (
            <div key={r.item} title={r.name} className="flex items-center gap-0.5 rounded border border-white/10 bg-black/40 px-1.5 py-0.5">
              <span className="text-[12px]">{ITEM_GLYPH[r.item] ?? '▫'}</span>
              <span className="font-mono text-[10px] font-bold text-amber-300">×{r.n}</span>
            </div>
          ))
        )}
        <span className="ml-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-stone-500">
          💼 {bag?.reduce((s, b) => s + b.n, 0) ?? 0} шт.
        </span>
      </div>

      {/* вкладки */}
      <div className="flex justify-center gap-1 px-2">
        <TabBtn t="build" label="Стройка" />
        <TabBtn t="craft" label="Техника" />
        <TabBtn t="inv" label="Инвентарь" />
      </div>

      {/* контент: горизонтальная лента с прокруткой */}
      <div className="mx-auto max-w-[1000px] overflow-x-auto rounded-t-lg border border-b-0 border-white/10 bg-black/85 px-2 pb-2 pt-1 backdrop-blur">
        {activeTab === 'build' && (
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">Бетон</div>
              <div className="flex gap-1.5">
                {foundations.map((b) => (
                  <Card key={b.kind} name={b.name} cost={b.cost} dims={b.dims} ok={b.ok} reason={b.reason}
                    active={activeKind === b.kind} onClick={() => onBuild?.(b.kind)} />
                ))}
              </div>
            </div>
            <div className="shrink-0">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">Здания</div>
              <div className="flex gap-1.5">
                {buildings.map((b) => (
                  <Card key={b.kind} name={b.name} cost={b.cost} dims={b.dims} ok={b.ok} reason={b.reason}
                    active={activeKind === b.kind} onClick={() => onBuild?.(b.kind)} />
                ))}
              </div>
            </div>
            <div className="shrink-0">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">Защита</div>
              <div className="flex gap-1.5">
                {defense.map((b) => (
                  <Card key={b.kind} name={b.name} cost={b.cost} dims={b.dims} ok={b.ok} reason={b.reason}
                    active={activeKind === b.kind} onClick={() => onBuild?.(b.kind)} />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'craft' && (
          <div className="flex gap-1.5">
            {recipes.length === 0 && <div className="text-[10px] text-stone-500">Нет доступных рецептов (построй завод).</div>}
            {recipes.map((r) => (
              <Card key={r.id} name={r.name} cost={r.missing || ''} ok={r.ok} reason={!r.ok ? (r.missing || 'не хватает') : null}
                onClick={() => onCraft?.(r.id)} hint={r.desc} />
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
