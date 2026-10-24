import React from 'react';
import { Bot, Settings, Plus, Check, X, Loader, Square } from 'lucide-react';
import { Section, Btn } from './ui.tsx';
import { cn } from '../utils/cn.ts';

// ============ ТИПЫ ============
export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> | string;
  timestamp: number;
}

interface BridgeStatus {
  connected: boolean;
  token: string;
}

interface DiffView {
  file: string;
  oldContent: string;
  newContent: string;
  applied: boolean;
}

// ============ СЕССИИ ЧАТА ============
interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  diffs: DiffView[];
}

const STORAGE_KEY_SESSIONS = 'wf_ai_sessions';
const STORAGE_KEY_ACTIVE_SESSION = 'wf_ai_active_session';
const STORAGE_KEY_SELECTED = 'wf_ai_selected';

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatSession[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

function saveSessions(sessions: ChatSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions.slice(0, 50)));
  } catch { /* ignore */ }
}

function loadModePrefs(): { planMode: boolean; maxEffort: boolean } {
  try {
    return {
      planMode: localStorage.getItem('wf_ai_mode') === 'plan',
      maxEffort: localStorage.getItem('wf_ai_effort') === 'max',
    };
  } catch {
    return { planMode: false, maxEffort: false };
  }
}

// ============ УТИЛИТЫ ============
const STORAGE_KEY_PROVIDERS = 'wf_ai_providers';
const STORAGE_KEY_BRIDGE = 'wf_bridge_token';
const BRIDGE_URL = 'http://127.0.0.1:8787';
const MAX_MSG_CHARS = 4000;
const MAX_TOOL_RESULT_CHARS = 6000;
const MAX_LOOP_STEPS = 8;

// Дефолт: бесплатные модели OpenCode Zen (OpenAI-совместимый endpoint).
// Ключ пользователь получает на opencode.ai/zen. Tokenator НЕ добавляем — вручную.
const OPENCODE_PRESET: AIProvider = {
  id: 'opencode-zen',
  name: 'OpenCode Zen (бесплатные)',
  baseUrl: 'https://opencode.ai/zen/v1',
  apiKey: '',
  models: [
    'nemotron-3-ultra-free',
    'nemotron-3.5-lightning-free',
    'big-pickle',
    'exo-free',
    'ling-3.1-flash-free',
    'longcat-2.5-preview-free',
    'step-5-preview-free',
    'mimo-v2.6-flash-free',
  ],
};

function loadProviders(): AIProvider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROVIDERS);
    if (raw) {
      const parsed = JSON.parse(raw) as AIProvider[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch { /* ignore */ }
  return [{ ...OPENCODE_PRESET }];
}

function saveProviders(providers: AIProvider[]) {
  try {
    localStorage.setItem(STORAGE_KEY_PROVIDERS, JSON.stringify(providers));
  } catch { /* ignore */ }
}

function loadBridgeToken(): string {
  return localStorage.getItem(STORAGE_KEY_BRIDGE) || '';
}

function saveBridgeToken(token: string) {
  localStorage.setItem(STORAGE_KEY_BRIDGE, token);
}

/** Режем длинные тексты: бесплатные провайдеры игнорируют промпты >4к символов */
function capText(s: string, max = MAX_MSG_CHARS): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…(обрезано, всего ${s.length} символов)`;
}

/** Достать JSON-агента из ответа (с ```-фенсом или без) */
function parseAgentReply(text: string): { text?: string; tool?: string; args?: Record<string, unknown>; edit?: { file: string; content: string } } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const candidate of [fenced?.[1], text]) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      const obj = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
      const edit = obj.edit && typeof obj.edit === 'object'
        ? obj.edit as { file?: unknown; content?: unknown }
        : undefined;
      return {
        text: typeof obj.text === 'string' ? obj.text : undefined,
        tool: typeof obj.tool === 'string' ? obj.tool : undefined,
        args: obj.args && typeof obj.args === 'object' ? (obj.args as Record<string, unknown>) : undefined,
        edit: edit && typeof edit.file === 'string' && typeof edit.content === 'string'
          ? { file: edit.file, content: edit.content }
          : undefined,
      };
    } catch { /* пробуем следующий вариант */ }
  }
  return { text };
}

// ============ КОМПОНЕНТ ПАНЕЛИ ============
export interface AssistantPanelProps {
  /** Снимок проекта, прикреплённый извне (необязательный). */
  attachedSnapshot?: string | null;
  onClearSnapshot?: () => void;
}

export function AssistantPanel(props: AssistantPanelProps = {}) {
  const { attachedSnapshot, onClearSnapshot } = props;
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [isThinking, setIsThinking] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [providers, setProviders] = React.useState<AIProvider[]>(loadProviders);
  const [selectedProviderId, setSelectedProviderId] = React.useState<string>('');
  const [selectedModel, setSelectedModel] = React.useState<string>('');
  const [bridgeStatus, setBridgeStatus] = React.useState<BridgeStatus>({ connected: false, token: loadBridgeToken() });
  const [attachedImage, setAttachedImage] = React.useState<string | null>(attachedSnapshot ?? null);
  const [diffViews, setDiffViews] = React.useState<DiffView[]>([]);
  const [providerError, setProviderError] = React.useState<Record<string, string>>({});
  const [visionWarn, setVisionWarn] = React.useState<string | null>(null);
  const [stepLabel, setStepLabel] = React.useState('');
  const [sessions, setSessions] = React.useState<ChatSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = React.useState<string>('');
  const [planMode, setPlanMode] = React.useState<boolean>(() => loadModePrefs().planMode);
  const [maxEffort, setMaxEffort] = React.useState<boolean>(() => loadModePrefs().maxEffort);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const loopStopRef = React.useRef(false);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  React.useEffect(() => {
    saveProviders(providers);
  }, [providers]);

  React.useEffect(() => {
    saveBridgeToken(bridgeStatus.token);
  }, [bridgeStatus.token]);

  React.useEffect(() => {
    setAttachedImage(attachedSnapshot ?? null);
  }, [attachedSnapshot]);

  // Персист выбора провайдера/модели — чтобы не сбрасывался при переключении вкладок
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SELECTED);
      if (raw) {
        const s = JSON.parse(raw) as { provider?: string; model?: string };
        if (s.provider && providers.some((p) => p.id === s.provider)) setSelectedProviderId(s.provider);
        if (s.model) setSelectedModel(s.model);
        else if (s.provider && providers.length) {
          const p = providers.find((x) => x.id === s.provider);
          if (p?.models.length) setSelectedModel(p.models[0]);
        }
        return;
      }
    } catch { /* ignore */ }
    setSelectedProviderId(providers[0]?.id || '');
    setSelectedModel(providers[0]?.models[0] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SELECTED, JSON.stringify({ provider: selectedProviderId, model: selectedModel }));
    } catch { /* ignore */ }
  }, [selectedProviderId, selectedModel]);

  React.useEffect(() => {
    try {
      localStorage.setItem('wf_ai_mode', planMode ? 'plan' : 'build');
      localStorage.setItem('wf_ai_effort', maxEffort ? 'max' : 'normal');
    } catch { /* ignore */ }
  }, [planMode, maxEffort]);

  // Восстановление активной сессии (или создание первой)
  React.useEffect(() => {
    const savedId = localStorage.getItem(STORAGE_KEY_ACTIVE_SESSION) || '';
    if (sessions.length) {
      const found = sessions.find((s) => s.id === savedId) ?? sessions[0];
      setActiveSessionId(found.id);
      setMessages(found.messages);
      setDiffViews(found.diffs);
    } else {
      const first: ChatSession = {
        id: crypto.randomUUID(),
        title: 'Новый чат',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        diffs: [],
      };
      try { localStorage.setItem(STORAGE_KEY_ACTIVE_SESSION, first.id); } catch { /* ignore */ }
      setSessions([first]);
      setActiveSessionId(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Автосохранение активной сессии при изменении сообщений/диффов
  const saveActiveTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (!activeSessionId) return;
    window.clearTimeout(saveActiveTimer.current);
    saveActiveTimer.current = window.setTimeout(() => {
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === activeSessionId);
        if (!exists) return prev;
        const firstUser = messages.find((m) => m.role === 'user');
        let title = 'Без названия';
        if (firstUser) {
          if (typeof firstUser.content === 'string') title = firstUser.content.slice(0, 42);
          else {
            const t = firstUser.content.find((c) => c.type === 'text');
            if (t && t.type === 'text') title = t.text.slice(0, 42);
          }
        }
        const next = prev.map((s) => (s.id === activeSessionId
          ? { ...s, title, messages, diffs: diffViews, updatedAt: Date.now() }
          : s));
        saveSessions(next);
        return next;
      });
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, diffViews, activeSessionId]);

  React.useEffect(() => {
    if (activeSessionId) {
      try { localStorage.setItem(STORAGE_KEY_ACTIVE_SESSION, activeSessionId); } catch { /* ignore */ }
    }
  }, [activeSessionId]);

  // Проверка моста
  const testBridge = async (token: string) => {
    try {
      const res = await fetch('http://127.0.0.1:8787', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token },
        body: JSON.stringify({ tool: 'ping', args: {} }),
      });
      const data = await res.json();
      return data.pong === true;
    } catch {
      return false;
    }
  };

  const connectBridge = async () => {
    const ok = await testBridge(bridgeStatus.token);
    setBridgeStatus((s) => ({ ...s, connected: ok }));
    return ok;
  };

  // Автопроверка моста при открытии вкладки, если токен уже сохранён
  React.useEffect(() => {
    if (bridgeStatus.token) void connectBridge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Проверка провайдера (baseUrl уже содержит версию, напр. https://opencode.ai/zen/v1)
  const testProvider = async (provider: AIProvider) => {
    try {
      const base = provider.baseUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/models`, {
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      });
      if (!res.ok) return { ok: false as const, models: [] as string[] };
      const data = await res.json();
      const models: string[] = (data.data || data.models || []).map((m: { id?: string }) => m.id).filter(Boolean);
      return { ok: models.length > 0, models };
    } catch {
      return { ok: false as const, models: [] };
    }
  };

  const handleTestProvider = async (providerId: string) => {
    const p = providers.find((p) => p.id === providerId);
    if (!p) return;
    setProviderError((e) => ({ ...e, [providerId]: '' }));
    const { ok, models } = await testProvider(p);
    if (ok && models.length) {
      setProviders((ps) =>
        ps.map((p) => (p.id === providerId ? { ...p, models } : p))
      );
    } else {
      setProviderError((e) => ({ ...e, [providerId]: 'Недоступен: проверь ключ и baseUrl (должен включать /v1)' }));
    }
  };

  // При открытии настроек — подтягиваем список моделей динамически (новые фришки появляются сами)
  React.useEffect(() => {
    if (!showSettings) return;
    for (const p of providers) {
      if (p.apiKey && p.models.length === 0) void handleTestProvider(p.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  const addProvider = () => {
    const newProvider: AIProvider = {
      id: crypto.randomUUID(),
      name: 'Новый провайдер',
      baseUrl: 'https://',
      apiKey: '',
      models: [],
    };
    setProviders([...providers, newProvider]);
  };

  const deleteProvider = (id: string) => {
    if (!confirm('Удалить провайдера?')) return;
    setProviders((ps) => ps.filter((p) => p.id !== id));
  };

  const updateProvider = (id: string, patch: Partial<AIProvider>) =>
    setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  // Отправка сообщения
const executeBridgeTool = async (tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    try {
      const res = await fetch(BRIDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': bridgeStatus.token },
        body: JSON.stringify({ tool, args }),
      });
      if (res.status === 401) return { error: 'Неверный токен моста' };
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return { error: 'Мост недоступен — запусти node agent-bridge.mjs' };
    }
  };

  const buildSystemPrompt = (): string => {
    const base = `Ты ИИ-инженер проекта Wasteland Forge (редактор 3D-сцен: React 19 + three.js 0.186 + TS strict + Vite 7, UI на русском). Работаешь инструментами локального моста.
Инструменты (по одному за ход): list_files {dir}, read_file {path}, run_command {cmd: "npx tsc --noEmit" | "npm run build"}.
${planMode
  ? 'РЕЖИМ «ПЛАН»: правки запрещены (edit не используй). Исследуй код (list_files/read_file) и выдай план: какие файлы менять, что именно. Проект не изменяй.'
  : 'Правку файла не пиши сам — верни {"edit":{"file":"путь","content":"ПОЛНЫЙ новый текст"}}. Пользователь увидит diff и нажмёт «Применить»; после применения я сам прогоню tsc и build и покажу вывод.'}
Правила: сначала read_file, потом edit; не выдумывай содержимое файлов; отвечай по-русски кратко.
ФОРМАТ ОТВЕТА — только один JSON-объект, без markdown: {"text":"...","tool":"имя","args":{...}} | {"text":"...","edit":{"file":"...","content":"..."}} | {"text":"ответ"}.`;
    return capText(base, 3500);
  };

  /** Сжатие истории под бюджет контекста (фришки игнорируют длинные промпты) */
  const buildContext = (history: ChatMessage[]): Array<{ role: string; content: ChatMessage['content'] }> => {
    const out: Array<{ role: string; content: ChatMessage['content'] }> = [];
    let budget = maxEffort ? 22000 : 12000;
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      const content: ChatMessage['content'] = typeof m.content === 'string'
        ? capText(m.content)
        : m.content.map((c) => (c.type === 'text' ? { type: 'text' as const, text: capText(c.text) } : c));
      const size = typeof content === 'string'
        ? content.length
        : content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 2500), 0);
      if (budget - size < 0) break;
      budget -= size;
      out.unshift({ role: m.role, content });
    }
    return out;
  };

  const callModel = async (convo: Array<{ role: string; content: ChatMessage['content'] }>): Promise<string> => {
    const p = providers.find((x) => x.id === selectedProviderId);
    if (!p) throw new Error('Провайдер не выбран');
    const base = p.baseUrl.replace(/\/+$/, '');
    abortControllerRef.current = new AbortController();
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: 'system', content: buildSystemPrompt() }, ...convo],
        max_tokens: maxEffort ? 8192 : 4096,
        temperature: 0.3,
      }),
      signal: abortControllerRef.current.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (/image|vision|multimodal|modalit/i.test(body)) {
        setVisionWarn('Эта модель не видит картинки — выбери vision-модель или опиши картинку текстом.');
      }
      throw new Error(`API ${res.status}: ${capText(body, 400)}`);
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw.map((x: { text?: string }) => x.text ?? '').join('');
    return '(пустой ответ)';
  };

  const summarizeTool = (tool: string, r: Record<string, unknown>): string => {
    if (r.error) return `ОШИБКА: ${String(r.error)}`;
    if (tool === 'list_files') {
      const entries = (r.entries as Array<{ name: string; type: string }> | undefined) ?? [];
      return entries.map((e) => (e.type === 'dir' ? e.name + '/' : e.name)).join(', ') || '(пусто)';
    }
    if (tool === 'read_file') {
      return capText(String(r.content ?? ''), MAX_TOOL_RESULT_CHARS);
    }
    if (tool === 'run_command') {
      return `exit=${String(r.code)}\n--- stdout ---\n${capText(String(r.stdout ?? ''), 2500)}\n--- stderr ---\n${capText(String(r.stderr ?? ''), 2500)}`;
    }
    return capText(JSON.stringify(r), MAX_TOOL_RESULT_CHARS);
  };

  const pushMsg = (content: ChatMessage['content'], role: ChatMessage['role'] = 'assistant') => {
    setMessages((m) => [...m, { role, content, timestamp: Date.now() }]);
  };

  /** Агентский цикл: модель → инструмент → результат → снова модель */
  const runAgentLoop = async (history: ChatMessage[]) => {
    loopStopRef.current = false;
    setIsThinking(true);
    const convo: Array<{ role: string; content: ChatMessage['content'] }> = buildContext(history);
    let steps = 0;
    const maxSteps = maxEffort ? 20 : MAX_LOOP_STEPS;
    try {
      while (steps < maxSteps && !loopStopRef.current) {
        steps++;
        setStepLabel(String(steps));
        const raw = await callModel(convo);
        const parsed = parseAgentReply(raw);
        const shown = parsed.text?.trim() || (parsed.tool ? `Вызываю инструмент: ${parsed.tool}` : capText(raw, 1500));
        pushMsg(shown);

        // Правка файла — показываем diff и ждём кнопку «Применить»
        if (parsed.edit) {
          const oldRes = await executeBridgeTool('read_file', { path: parsed.edit.file });
          const oldContent = typeof oldRes.content === 'string'
            ? oldRes.content
            : `// ${String(oldRes.error ?? 'файл отсутствует или мост не подключён')}`;
          setDiffViews((d) => [...d, { file: parsed.edit!.file, oldContent, newContent: parsed.edit!.content, applied: false }]);
          pushMsg(`Правка файла ${parsed.edit.file} готова — проверь diff и нажми «Применить».`);
          break;
        }

        // Инструмент — выполняем через мост и продолжаем цикл
        if (parsed.tool) {
          if (!bridgeStatus.connected) {
            pushMsg('Мост не подключён. Подключи его в настройках (шестерёнка) — без него инструменты не работают.');
            break;
          }
          const result = await executeBridgeTool(parsed.tool, parsed.args ?? {});
          const summary = summarizeTool(parsed.tool, result);
          pushMsg(`⚙ ${parsed.tool} → ${capText(summary, 900)}`);
          convo.push({ role: 'assistant', content: shown });
          convo.push({
            role: 'user',
            content: `TOOL_RESULT ${parsed.tool}: ${capText(summary, MAX_TOOL_RESULT_CHARS)}\nПродолжай: следующий шаг — {"text","tool","args"} либо {"edit":{...}}, либо финальный {"text":"готово"}.`,
          });
          continue;
        }

        break;
      }
      if (loopStopRef.current) pushMsg('⏹ Остановлено.');
      else if (steps >= maxSteps) pushMsg('⚠️ Лимит шагов агента исчерпан — напиши продолжение.');
    } catch (err) {
      const e = err as { name?: string; message?: string };
      pushMsg(e.name === 'AbortError' ? '⏹ Запрос прерван.' : `Ошибка: ${e.message ?? String(err)}`);
    } finally {
      setIsThinking(false);
      setStepLabel('');
      abortControllerRef.current = null;
    }
  };

  const sendMessage = async () => {
    if (!input.trim() && !attachedImage) return;
    if (!selectedProviderId || !selectedModel) {
      setVisionWarn(null);
      pushMsg('Сначала выбери провайдера и модель (или добавь провайдера в настройках).');
      return;
    }
    if (attachedImage && /nemotron|big-pickle|exo-free|ling-3|mimo-v2|longcat|step-5/i.test(selectedModel)) {
      setVisionWarn('Эта модель не видит картинки — выбери vision-модель или опиши картинку текстом.');
    }

    const content: ChatMessage['content'] = [];
    if (input.trim()) content.push({ type: 'text', text: input.trim() });
    if (attachedImage) {
      content.push({ type: 'text', text: 'На скриншоте: жёлтая рамка — область просмотра; красные рамки с номерами — важные моменты.' });
      content.push({ type: 'image_url', image_url: { url: attachedImage } });
    }

    const userMsg: ChatMessage = { role: 'user', content, timestamp: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setAttachedImage(null);
    onClearSnapshot?.();
    await runAgentLoop(next);
  };

  const stopGeneration = () => {
    loopStopRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  };

  const applyDiff = async (index: number) => {
    const diff = diffViews[index];
    if (!diff) return;
    if (planMode) { pushMsg('⚠️ Режим «План» — переключись в «Строить», чтобы применить правку.'); return; }
    if (!bridgeStatus.connected) { setBridgeStatus((s) => ({ ...s, connected: false })); pushMsg('Мост не подключён — подключи его, чтобы применить правку.'); return; }
    const result = await executeBridgeTool('write_file', { path: diff.file, content: diff.newContent });
    if (result.ok) {
      setDiffViews((d) => d.map((v, i) => (i === index ? { ...v, applied: true } : v)));
      pushMsg(`✅ ${diff.file} обновлён (бэкап в ./backups/). Прогоняю проверки…`);
      const tsc = await executeBridgeTool('run_command', { cmd: 'npx tsc --noEmit' });
      const tscOk = tsc.code === 0;
      pushMsg(tscOk
        ? '✅ npx tsc --noEmit — 0 ошибок.'
        : `❌ npx tsc --noEmit (код ${String(tsc.code)}):\n${capText(String(tsc.stderr || tsc.stdout || ''), 1800)}`);
      if (tscOk) {
        const build = await executeBridgeTool('run_command', { cmd: 'npm run build' });
        pushMsg(build.code === 0
          ? `✅ npm run build — сборка зелёная.\n${capText(String(build.stdout ?? ''), 600)}`
          : `❌ npm run build (код ${String(build.code)}):\n${capText(String(build.stderr || build.stdout || ''), 1800)}`);
      }
    } else {
      pushMsg(`Ошибка записи: ${String(result.error ?? 'неизвестно')}`);
    }
  };

  const newSession = () => {
    const s: ChatSession = {
      id: crypto.randomUUID(),
      title: 'Новый чат',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      diffs: [],
    };
    setSessions((prev) => {
      const next = [s, ...prev];
      saveSessions(next);
      return next;
    });
    setActiveSessionId(s.id);
    setMessages([]);
    setDiffViews([]);
  };

  const switchSession = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    setActiveSessionId(s.id);
    setMessages(s.messages);
    setDiffViews(s.diffs);
  };

  const deleteSession = () => {
    if (sessions.length <= 1) {
      setMessages([]);
      setDiffViews([]);
      return;
    }
    const rest = sessions.filter((s) => s.id !== activeSessionId);
    saveSessions(rest);
    setSessions(rest);
    setActiveSessionId(rest[0].id);
    setMessages(rest[0].messages);
    setDiffViews(rest[0].diffs);
  };

  // ============ RENDER ============
  if (showSettings) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <span className="text-[12px] font-bold uppercase tracking-wider text-amber-400">Настройки помощника</span>
          <button onClick={() => setShowSettings(false)} className="text-stone-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {/* Мост */}
          <Section title="Мост (agent-bridge)">
            <div className="mb-2 text-[10px] text-stone-500">Локальный мост для работы с файлами. Запусти agent-bridge.mjs и вставь токен из консоли.</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={bridgeStatus.token}
                onChange={(e) => setBridgeStatus((s) => ({ ...s, token: e.target.value }))}
                placeholder="Токен из консоли моста"
                className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
              />
              <Btn onClick={connectBridge}>{bridgeStatus.connected ? <Check size={13} /> : 'Проверить'}</Btn>
            </div>
            <div className={cn('mt-1 text-[10px]', bridgeStatus.connected ? 'text-emerald-400' : 'text-stone-600')}>
              {bridgeStatus.connected ? '🟢 Мост подключён' : '🔴 Мост не подключён'}
            </div>
          </Section>

          {/* Провайдеры */}
          <Section title={`Провайдеры (${providers.length})`}>
            {providers.map((p) => (
              <div key={p.id} className="mb-2 rounded border border-white/10 bg-white/[0.02] p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-stone-200">{p.name}</span>
                  <div className="flex gap-1">
                    <button onClick={() => handleTestProvider(p.id)} className="text-[10px] text-emerald-400 hover:underline">Проверить</button>
                    <button onClick={() => deleteProvider(p.id)} className="text-[10px] text-red-400 hover:underline">Удалить</button>
                  </div>
                </div>
                <div className="mb-1 flex gap-1.5">
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                    placeholder="Имя"
                    className="flex-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={p.baseUrl}
                    onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })}
                    placeholder="Base URL"
                    className="flex-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                  />
                </div>
                <div className="mb-1 flex gap-1.5">
                  <input
                    type="password"
                    value={p.apiKey}
                    onChange={(e) => updateProvider(p.id, { apiKey: e.target.value })}
                    placeholder="API Key"
                    className="flex-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                  />
                  <select
                    value={p.models[0] || ''}
                    onChange={(e) => updateProvider(p.id, { models: [e.target.value] })}
                    disabled={p.models.length === 0}
                    className="flex-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                  >
                    {p.models.length ? p.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    )) : <option value="">нет моделей</option>}
                  </select>
                </div>
                {providerError[p.id] && (
                  <div className="mt-1 text-[10px] text-red-400">{providerError[p.id]}</div>
                )}
              </div>
            ))}
            <Btn onClick={addProvider} className="w-full">
              <Plus size={13} /> Добавить провайдера
            </Btn>
          </Section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Шапка: статус моста, сессии, настройки */}
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-1.5">
        <Bot size={15} className="shrink-0 text-amber-400" />
        <span
          title={bridgeStatus.connected ? 'Мост подключён' : 'Мост не подключён (настройки → токен)'}
          className={cn('h-2 w-2 shrink-0 rounded-full', bridgeStatus.connected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]' : 'bg-red-500/80')}
        />
        <select
          value={activeSessionId}
          onChange={(e) => switchSession(e.target.value)}
          title="История чатов (сессии сохраняются в браузере)"
          className="min-w-0 flex-1 truncate rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} ({s.messages.length})
            </option>
          ))}
        </select>
        <button onClick={newSession} title="Новый чат" className="rounded border border-white/10 bg-white/[0.04] p-1 text-stone-300 hover:border-amber-500/50 hover:text-amber-300">
          <Plus size={13} />
        </button>
        {sessions.length > 1 && (
          <button onClick={deleteSession} title="Удалить эту сессию" className="rounded p-1 text-stone-500 hover:text-red-400">
            <X size={13} />
          </button>
        )}
        <button onClick={() => setShowSettings(true)} title="Настройки провайдеров и моста" className="rounded p-1 text-stone-400 hover:text-white">
          <Settings size={14} />
        </button>
      </div>

      {/* Режимы: План / Строить + Нормал / Макс */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] bg-white/[0.015] px-3 py-1 text-[10px]">
        <div className="flex items-center gap-1" title="План — только чтение и план правок; Строить — полный агент с diff и сборкой">
          <span className="mr-1 uppercase tracking-wider text-stone-500">Режим:</span>
          <button
            onClick={() => setPlanMode(true)}
            className={cn(
              'rounded px-2 py-0.5 font-bold uppercase tracking-wider transition-all',
              planMode ? 'border border-sky-500/60 bg-sky-500/20 text-sky-200' : 'text-stone-500 hover:text-stone-300'
            )}
          >
            План
          </button>
          <button
            onClick={() => setPlanMode(false)}
            className={cn(
              'rounded px-2 py-0.5 font-bold uppercase tracking-wider transition-all',
              !planMode ? 'border border-amber-500/60 bg-amber-500/20 text-amber-200' : 'text-stone-500 hover:text-stone-300'
            )}
          >
            Билд
          </button>
        </div>
        <div className="flex items-center gap-1" title="Нормал — до 8 шагов; Макс — до 20 шагов и расширенный контекст">
          <span className="mr-1 uppercase tracking-wider text-stone-500">Глубина:</span>
          <button
            onClick={() => setMaxEffort(false)}
            className={cn(
              'rounded px-1.5 py-0.5 font-bold uppercase transition-all',
              !maxEffort ? 'border border-white/25 bg-white/10 text-stone-200' : 'text-stone-500 hover:text-stone-300'
            )}
          >
            Норм.
          </button>
          <button
            onClick={() => setMaxEffort(true)}
            className={cn(
              'rounded px-1.5 py-0.5 font-bold uppercase transition-all',
              maxEffort ? 'border border-emerald-500/60 bg-emerald-500/20 text-emerald-200' : 'text-stone-500 hover:text-stone-300'
            )}
          >
            Макс.
          </button>
        </div>
      </div>

      {/* Выбор модели */}
      {providers.length > 0 && (
        <div className="border-b border-white/10 px-3 py-2">
          <div className="flex gap-2">
            <select
              value={selectedProviderId}
              onChange={(e) => {
                setSelectedProviderId(e.target.value);
                const p = providers.find((x) => x.id === e.target.value);
                if (p && p.models.length) setSelectedModel(p.models[0]);
              }}
              className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
            >
              {(providers.find((p) => p.id === selectedProviderId)?.models || []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Сообщения */}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="rounded border border-white/10 bg-white/[0.02] p-3 text-[11px] text-stone-500">
            Помощник готов к работе. Добавь провайдера в настройках (шестерёнка) и подключи мост (agent-bridge.mjs).
          </div>
        )}
        {visionWarn && (
          <div className="mb-2 rounded border border-red-500/50 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
            ⚠️ {visionWarn}
          </div>
        )}
        {stepLabel && (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-stone-500">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Шаг {stepLabel}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn('mb-2 flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-[11px]',
                msg.role === 'user' ? 'bg-amber-500/20 text-amber-100' : 'bg-white/[0.05] text-stone-300'
              )}
            >
              {typeof msg.content === 'string' ? (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              ) : (
                msg.content.map((c, j) => (
                  <div key={j}>
                    {c.type === 'text' && <div className="whitespace-pre-wrap">{c.text}</div>}
                    {c.type === 'image_url' && <img src={c.image_url.url} alt="snapshot" className="mt-2 max-w-full rounded border border-white/20" />}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}

        {/* Diff-карточки */}
        {diffViews.map((diff, i) => (
          <div key={i} className="mb-2 rounded border border-amber-500/40 bg-amber-950/30 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[10px] font-bold text-amber-300">{diff.file}</span>
              {!diff.applied && (
                <Btn onClick={() => applyDiff(i)} variant="success">
                  Применить
                </Btn>
              )}
              {diff.applied && <span className="text-[10px] text-emerald-400">✅ Применено</span>}
            </div>
            <details className="text-[10px] text-stone-400">
              <summary className="cursor-pointer hover:text-stone-200">Показать diff</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/60 p-2 font-mono text-[9px]">
                <div className="text-red-400">- {diff.oldContent}</div>
                <div className="text-emerald-400">+ {diff.newContent}</div>
              </pre>
            </details>
          </div>
        ))}

        {isThinking && (
          <div className="flex items-center gap-2 text-[11px] text-stone-500">
            <Loader size={14} className="animate-spin" />
            Помощник думает...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Поле ввода */}
      <div className="border-t border-white/10 p-3">
        {attachedImage && (
          <div className="mb-2 flex items-center gap-2 rounded border border-white/10 bg-white/[0.02] p-2">
            <img src={attachedImage} alt="attached" className="h-12 rounded border border-white/20" />
            <button onClick={() => { setAttachedImage(null); onClearSnapshot?.(); }} className="ml-auto text-stone-400 hover:text-red-300">
              <X size={14} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Напиши запрос помощнику..."
            disabled={isThinking}
            className="flex-1 rounded border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-stone-200 placeholder-stone-600 focus:border-amber-500/50 focus:outline-none disabled:opacity-50"
          />
          {isThinking ? (
            <Btn onClick={stopGeneration} variant="danger">
              <Square size={13} /> Стоп
            </Btn>
          ) : (
            <Btn onClick={sendMessage} variant="primary" disabled={!input.trim() && !attachedImage}>
              Отправить
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}
