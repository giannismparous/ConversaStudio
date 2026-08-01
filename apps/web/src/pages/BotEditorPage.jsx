import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { buildSourcePreview } from '../lib/sourcePreview.js';
import { ensureHttpsUrl } from '../lib/url.js';
import { useAuth } from '../lib/auth.jsx';
import { useConfirm } from '../lib/useConfirm.jsx';
import { useI18n } from '../lib/i18n.jsx';
import OrderedListEditor from '../components/OrderedListEditor.jsx';
import KeyFactsEditor from '../components/KeyFactsEditor.jsx';
import FieldLabelHelp from '../components/FieldLabelHelp.jsx';
import FileTypeIcon, { fileSourceDisplayName } from '../components/FileTypeIcon.jsx';
import SourcePreviewModal from '../components/SourcePreviewModal.jsx';
import EyeIcon from '../components/EyeIcon.jsx';
import GenderPicker from '../components/GenderPicker.jsx';
import ThemeColors from '../components/ThemeColors.jsx';
import BotIconField from '../components/BotIconField.jsx';
import ThemePreview from '../components/ThemePreview.jsx';
import ThemeAccessibility from '../components/ThemeAccessibility.jsx';
import UnsavedChangesDialog from '../components/UnsavedChangesDialog.jsx';
import BuildImmersiveOverlay from '../components/BuildImmersiveOverlay.jsx';
import CheckIcon from '../components/CheckIcon.jsx';
import { getEmbedSnippet } from '../lib/embedSnippet.js';
import { localizeStarterCopyIfDefault } from '../lib/dialogosDefaults.js';

const DEFAULT_THEME = {
  panelBg: '#faf9f5',
  accent: '#d97757',
  launcherBg: '#ffffff',
  textColor: '#141413',
};

const DEFAULT_SOURCE_CITATIONS = {
  showSources: true,
  hideTypes: ['key_facts'],
};

const SAVE_SAVING_MIN_MS = 1000;
const SAVE_SAVED_VISIBLE_MS = 2200;
const SAVE_FADE_MS = 380;

let editorDraftLinkSeq = 0;
function createEditorDraftLink(onlyPage = false) {
  editorDraftLinkSeq += 1;
  return {
    localId: `ed-link-${editorDraftLinkSeq}`,
    url: '',
    onlyPage: Boolean(onlyPage),
  };
}

function normalizeTheme(theme = {}) {
  return { ...DEFAULT_THEME, ...theme };
}

function normalizeSourceCitations(sourceCitations = {}) {
  const hideTypes = Array.isArray(sourceCitations.hideTypes)
    ? [...sourceCitations.hideTypes].sort()
    : [...DEFAULT_SOURCE_CITATIONS.hideTypes];
  return {
    showSources: sourceCitations.showSources !== false,
    hideTypes,
  };
}

function buildEditorPayload({
  name,
  systemPrompt,
  welcomeMessage,
  personaGender,
  rules,
  suggestions,
  keyFacts,
  theme,
  sourceCitations,
}) {
  return {
    name: String(name || '').trim(),
    systemPrompt: String(systemPrompt || ''),
    welcomeMessage: String(welcomeMessage || ''),
    personaGender: personaGender || 'neutral',
    rules: (rules || []).map((r) => String(r || '').trim()).filter(Boolean),
    suggestedQuestions: (suggestions || []).map((s) => String(s || '').trim()).filter(Boolean),
    keyFacts: (keyFacts || [])
      .map((f) => ({
        title: String(f?.title || '').trim(),
        body: String(f?.body || '').trim(),
      }))
      .filter((f) => f.title && f.body),
    theme: normalizeTheme(theme),
    sourceCitations: normalizeSourceCitations(sourceCitations),
  };
}

/** Like save payload, but keeps partial trusted-answer drafts so leave/save prompts fire. */
function formDirtySignature({
  name,
  systemPrompt,
  welcomeMessage,
  personaGender,
  rules,
  suggestions,
  keyFacts,
  theme,
  sourceCitations,
}) {
  return JSON.stringify({
    ...buildEditorPayload({
      name,
      systemPrompt,
      welcomeMessage,
      personaGender,
      rules,
      suggestions,
      keyFacts,
      theme,
      sourceCitations,
    }),
    keyFactsDraft: (keyFacts || [])
      .map((f) => ({
        title: String(f?.title || '').trim(),
        body: String(f?.body || '').trim(),
      }))
      .filter((f) => f.title || f.body),
  });
}

function payloadSignature(parts) {
  return JSON.stringify(buildEditorPayload(parts));
}

/** If an old bot still has RULES inside system_prompt, split them for the new UI. */
function splitLegacyPrompt(systemPrompt, rules) {
  if (Array.isArray(rules) && rules.length) {
    return { systemPrompt: systemPrompt || '', rules };
  }
  const text = String(systemPrompt || '');
  const idx = text.search(/\n\s*RULES:\s*\n/i);
  if (idx === -1) {
    return {
      systemPrompt: text,
      rules: [],
    };
  }
  const head = text.slice(0, idx).trim();
  const body = text.slice(idx).replace(/^\s*RULES:\s*/i, '');
  const parsed = body
    .split(/\n+/)
    .map((line) => line.replace(/^\s*\d+[).b]?\s*/i, '').trim())
    .filter(Boolean);
  return {
    systemPrompt: head,
    rules: parsed,
  };
}

function chunkExcerpt(text, max = 200, t) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return t('editor.noTextChunk');
  if (!max || clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}

function chunkPageLabel(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.pathname === '/' || !u.pathname) return null;
    return u.pathname;
  } catch {
    return null;
  }
}

function urlDisplayLabel(url) {
  try {
    let raw = String(url || '')
      .trim()
      .replace(/^Site:\s*/i, '');
    if (!raw) return '';
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) raw = `https://${raw}`;
    const u = new URL(raw);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return String(url || '')
      .replace(/^Site:\s*/i, '')
      .replace(/^https?:\/\//i, '')
      .split('/')[0];
  }
}

function fileDisplayLabel(name, t) {
  const s = String(name || '').trim();
  if (!s) return t('editor.fileLabel');
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

function sourceDisplayLabel(source, t) {
  if (!source) return '';
  if (source.type === 'url') return urlDisplayLabel(source.uri || source.label);
  if (source.type === 'pdf' || source.type === 'txt') {
    const base = fileDisplayLabel(source.label, t);
    return fileSourceDisplayName({ ...source, label: base }) || base;
  }
  return source.label || t('editor.pasteShort');
}

function chunkMetaLine(chunk, t) {
  if (chunk.sourceType !== 'url') {
    return sourceDisplayLabel(
      {
        type: chunk.sourceType,
        label: chunk.sourceLabel,
        uri: chunk.sourceUri,
      },
      t
    );
  }
  const host = urlDisplayLabel(chunk.sourceUri || chunk.sourceLabel);
  const page = chunkPageLabel(chunk.pageUrl);
  if (page) return `${host} · ${page}`;
  return host;
}

function chunkTitle(text, page, ordinal, t) {
  const line = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (line.length >= 12) return chunkExcerpt(line, 72, t);
  if (page) return page;
  return t('editor.chunkN', { n: ordinal + 1 });
}

function chunkSizeLabel(chunk, t) {
  if (chunk.tokenEstimate) return t('editor.tokens', { count: chunk.tokenEstimate });
  const len = String(chunk.content || '').length;
  if (len >= 1000) return t('editor.charsK', { count: (len / 1000).toFixed(1) });
  return t('editor.chars', { count: len });
}

function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status, t) {
  switch (status) {
    case 'ready':
      return t('status.indexed');
    case 'indexing':
      return t('status.indexing');
    case 'error':
      return t('status.error');
    case 'skipped':
      return t('status.skipped');
    case 'pending':
    default:
      return t('status.notIndexed');
  }
}

function UrlValidityMark({ status, t, pageCount, scrapeMode }) {
  const invalid = status === 'skipped' || status === 'error';
  const showPages =
    !invalid &&
    scrapeMode === 'site' &&
    Number(pageCount) > 0;
  const pagesLabel = showPages
    ? t(Number(pageCount) === 1 ? 'editor.pagesFoundOne' : 'editor.pagesFound', {
        count: pageCount,
      })
    : null;
  return (
    <span className="source-validity-group">
      <span
        className={`source-validity${invalid ? ' is-invalid' : ' is-valid'}`}
        title={invalid ? t('editor.urlInvalid') : t('editor.urlValid')}
        aria-label={
          invalid
            ? t('editor.urlInvalid')
            : pagesLabel
              ? `${t('editor.urlValid')} · ${pagesLabel}`
              : t('editor.urlValid')
        }
      >
        {invalid ? '✕' : '✓'}
      </span>
      {showPages ? <span className="source-page-count">{pagesLabel}</span> : null}
    </span>
  );
}

function StatusBadge({ status }) {
  const { t } = useI18n();
  const busy = status === 'indexing';
  return (
    <span className={`source-status source-status-${status || 'pending'}`}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {statusLabel(status, t)}
    </span>
  );
}

export default function BotEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const { username } = useAuth();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const { t, dateLocale, locale } = useI18n();

  const [bot, setBot] = useState(null);
  const [sources, setSources] = useState([]);
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [rules, setRules] = useState(['']);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [suggestions, setSuggestions] = useState(['']);
  const [keyFacts, setKeyFacts] = useState([{ title: '', body: '' }]);
  const [personaGender, setPersonaGender] = useState('neutral');
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [sourceCitations, setSourceCitations] = useState(DEFAULT_SOURCE_CITATIONS);
  const [draftLinks, setDraftLinks] = useState([]);
  const [enteringDraftIds, setEnteringDraftIds] = useState(() => new Set());
  const [committingDraftId, setCommittingDraftId] = useState(null);
  const draftLinkInputRefs = useRef({});
  const draftLinksRef = useRef(draftLinks);
  draftLinksRef.current = draftLinks;
  const committingDraftIdRef = useRef(null);
  committingDraftIdRef.current = committingDraftId;
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [saveFeedback, setSaveFeedback] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [isHydrated, setIsHydrated] = useState(isNew);
  const saveTimerRef = useRef(null);
  const saveAbortRef = useRef(null);
  const saveUiTimerRef = useRef(null);
  const saveStartedAtRef = useRef(0);
  const skipAutoSaveRef = useRef(true);
  const persistInFlightRef = useRef(false);
  const lastSavedPayloadRef = useRef(null);
  const lastSavedDirtyRef = useRef(null);
  const formDraftRef = useRef(null);
  const formFieldsRef = useRef(null);
  const isDirtyRef = useRef(false);
  const persistBotRef = useRef(null);
  const [saveGeneration, setSaveGeneration] = useState(0);
  const botIdRef = useRef(null);
  const botRef = useRef(null);
  const allowNavigationRef = useRef(false);
  botIdRef.current = bot?.id;
  botRef.current = bot;
  formFieldsRef.current = {
    name,
    systemPrompt,
    welcomeMessage,
    personaGender,
    rules,
    suggestions,
    keyFacts,
    theme,
    sourceCitations,
  };
  const [job, setJob] = useState(null);
  const [building, setBuilding] = useState(false);
  const [buildVariant, setBuildVariant] = useState('full');
  const [buildSuccessKind, setBuildSuccessKind] = useState(null); // 'rebuild' | 'build' | null
  const buildSuccessKindRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconPreview, setIconPreview] = useState(null);
  const [chunksOpen, setChunksOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [a11yOpen, setA11yOpen] = useState(false);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunkData, setChunkData] = useState(null);
  const [chunkSourceFilter, setChunkSourceFilter] = useState('');
  const [expandedChunk, setExpandedChunk] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [chunkSaving, setChunkSaving] = useState(false);
  const [embedSnippetCopied, setEmbedSnippetCopied] = useState(false);

  const embedSnippet = useMemo(() => getEmbedSnippet(bot?.id), [bot?.id]);
  const embedSteps = useMemo(
    () => [t('editor.embedStep1'), t('editor.embedStep2'), t('editor.embedStep3')],
    [t]
  );

  const fileSources = useMemo(
    () => sources.filter((s) => s.type === 'pdf' || s.type === 'txt' || s.type === 'text'),
    [sources]
  );
  const urlSources = useMemo(() => sources.filter((s) => s.type === 'url'), [sources]);

  const hasPriorBuild = useMemo(
    () =>
      Boolean(bot?.lastBuiltAt) ||
      (bot?.chunkCount || 0) > 0 ||
      sources.some((s) => (s.chunkCount || 0) > 0),
    [bot?.lastBuiltAt, bot?.chunkCount, sources]
  );

  const knowledgeNeedsRebuild = useMemo(() => {
    if (!sources.length) return false;
    if (!bot?.lastBuiltAt) return true;
    if (bot.needsRebuild) return true;
    return false;
  }, [sources.length, bot?.lastBuiltAt, bot?.needsRebuild]);

  const needsRebuild = building || knowledgeNeedsRebuild;

  useEffect(() => {
    if (knowledgeNeedsRebuild) setBuildSuccessKind(null);
  }, [knowledgeNeedsRebuild]);

  const copyEmbedSnippet = async () => {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setEmbedSnippetCopied(true);
      window.setTimeout(() => setEmbedSnippetCopied(false), 2200);
    } catch {
      setEmbedSnippetCopied(false);
    }
  };

  const renderSourceRow = (s) => (
    <div className={`source-row${s.status === 'indexing' ? ' is-busy' : ''}`} key={s.id}>
      <div className="source-row-main">
        <div className="source-row-title">
          {(s.type === 'pdf' || s.type === 'txt') && <FileTypeIcon source={s} />}
          {s.type === 'url' && (
            <UrlValidityMark
              status={s.status}
              t={t}
              pageCount={s.pageCount}
              scrapeMode={s.scrapeMode}
            />
          )}
          <strong>{sourceDisplayLabel(s, t)}</strong>
          <StatusBadge status={s.status} />
        </div>
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          {s.type}
          {s.byteSize > 0 ? ` · ${formatBytes(s.byteSize)}` : ''}
          {s.chunkCount > 0
            ? ` · ${s.chunkCount} ${s.chunkCount === 1 ? t('bots.chunk') : t('bots.chunks')}`
            : ''}
          {s.errorMessage && s.status !== 'ready' ? ` · ${s.errorMessage}` : ''}
        </div>
        {s.type === 'url' && (
          <span
            className={`wizard-link-mode-badge source-row-site-check${
              s.scrapeMode !== 'site' ? ' is-page' : ' is-site'
            }`}
          >
            {s.scrapeMode !== 'site' ? t('editor.onlyThisPage') : t('editor.fullSite')}
          </span>
        )}
      </div>
      <div className="source-row-actions">
        <button
          type="button"
          className="icon-btn"
          title={t('common.view')}
          aria-label={t('common.view')}
          disabled={s.status === 'indexing'}
          onClick={() => openPreview(s)}
        >
          <EyeIcon />
        </button>
        <button
          type="button"
          className="icon-btn danger"
          title={t('editor.removeSource')}
          aria-label={t('editor.removeSource')}
          disabled={building || s.status === 'indexing'}
          onClick={() => removeSource(s.id)}
        >
          ×
        </button>
      </div>
    </div>
  );

  const load = useCallback(async () => {
    if (isNew) return;
    const keepDraft = isDirtyRef.current ? formDraftRef.current : null;
    skipAutoSaveRef.current = true;
    setIsHydrated(false);
    const data = await api(`/bots/${id}`, { username });
    const split = splitLegacyPrompt(data.bot.systemPrompt, data.bot.rules);
    const qs = data.bot.suggestedQuestions || [];
    const facts = Array.isArray(data.bot.keyFacts) ? data.bot.keyFacts : [];
    const mergedTheme = normalizeTheme(data.bot.theme);
    const mergedCitations = normalizeSourceCitations(data.bot.sourceCitations);
    const rulesForUi = split.rules.length ? split.rules : [''];
    const suggestionsForUi = qs.length ? qs : [''];
    const keyFactsForUi = Array.isArray(facts) ? facts : [];

    lastSavedPayloadRef.current = payloadSignature({
      name: data.bot.name,
      systemPrompt: split.systemPrompt,
      welcomeMessage: data.bot.welcomeMessage || '',
      personaGender: data.bot.personaGender || 'neutral',
      rules: rulesForUi,
      suggestions: suggestionsForUi,
      keyFacts: keyFactsForUi,
      theme: mergedTheme,
      sourceCitations: mergedCitations,
    });
    lastSavedDirtyRef.current = formDirtySignature({
      name: data.bot.name,
      systemPrompt: split.systemPrompt,
      welcomeMessage: data.bot.welcomeMessage || '',
      personaGender: data.bot.personaGender || 'neutral',
      rules: rulesForUi,
      suggestions: suggestionsForUi,
      keyFacts: keyFactsForUi,
      theme: mergedTheme,
      sourceCitations: mergedCitations,
    });

    setBot(data.bot);
    setSources(data.sources || []);

    if (keepDraft) {
      setName(keepDraft.name);
      setSystemPrompt(keepDraft.systemPrompt);
      setRules(keepDraft.rules);
      setWelcomeMessage(keepDraft.welcomeMessage);
      setSuggestions(keepDraft.suggestions);
      setPersonaGender(keepDraft.personaGender);
      setKeyFacts(keepDraft.keyFacts);
      setTheme(keepDraft.theme);
      setSourceCitations(keepDraft.sourceCitations);
      setSaveStatus('unsaved');
    } else {
      setName(data.bot.name);
      const localized = localizeStarterCopyIfDefault(
        {
          welcomeMessage: data.bot.welcomeMessage || '',
          suggestedQuestions: suggestionsForUi,
          systemPrompt: split.systemPrompt,
          rules: rulesForUi,
          botName: data.bot.name,
        },
        locale
      );
      const nextPrompt = localized?.systemPrompt ?? split.systemPrompt;
      const nextWelcome = localized?.welcomeMessage ?? (data.bot.welcomeMessage || '');
      const nextRules = localized?.rules ?? rulesForUi;
      const nextSuggestions = localized?.suggestedQuestions ?? suggestionsForUi;
      setSystemPrompt(nextPrompt);
      setRules(nextRules);
      setWelcomeMessage(nextWelcome);
      setSuggestions(nextSuggestions);
      setPersonaGender(data.bot.personaGender || 'neutral');
      setKeyFacts(keyFactsForUi);
      setTheme(mergedTheme);
      setSourceCitations(mergedCitations);
      if (localized) {
        lastSavedPayloadRef.current = payloadSignature({
          name: data.bot.name,
          systemPrompt: nextPrompt,
          welcomeMessage: nextWelcome,
          personaGender: data.bot.personaGender || 'neutral',
          rules: nextRules,
          suggestions: nextSuggestions,
          keyFacts: keyFactsForUi,
          theme: mergedTheme,
          sourceCitations: mergedCitations,
        });
        lastSavedDirtyRef.current = formDirtySignature({
          name: data.bot.name,
          systemPrompt: nextPrompt,
          welcomeMessage: nextWelcome,
          personaGender: data.bot.personaGender || 'neutral',
          rules: nextRules,
          suggestions: nextSuggestions,
          keyFacts: keyFactsForUi,
          theme: mergedTheme,
          sourceCitations: mergedCitations,
        });
      }
      setSaveStatus('saved');
    }
    if (data.jobs?.[0] && ['queued', 'running'].includes(data.jobs[0].status)) {
      setJob(data.jobs[0]);
      setBuildVariant(data.jobs[0].mode === 'adaptive' ? 'adaptive' : 'full');
      setBuilding(true);
    } else {
      setJob(null);
      setBuilding(false);
    }
    skipAutoSaveRef.current = false;
    setIsHydrated(true);
  }, [id, isNew, username, locale]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  // Swap Dialogos starter prompts/welcome/suggestions when platform language changes.
  useEffect(() => {
    if (!isHydrated) return;
    const localized = localizeStarterCopyIfDefault(
      {
        welcomeMessage,
        suggestedQuestions: suggestions,
        systemPrompt,
        rules,
        botName: name,
      },
      locale
    );
    if (!localized) return;
    skipAutoSaveRef.current = true;
    setWelcomeMessage(localized.welcomeMessage);
    setSuggestions(localized.suggestedQuestions);
    setSystemPrompt(localized.systemPrompt);
    setRules(localized.rules);
    lastSavedPayloadRef.current = payloadSignature({
      name,
      systemPrompt: localized.systemPrompt,
      welcomeMessage: localized.welcomeMessage,
      personaGender,
      rules: localized.rules,
      suggestions: localized.suggestedQuestions,
      keyFacts,
      theme,
      sourceCitations,
    });
    lastSavedDirtyRef.current = formDirtySignature({
      name,
      systemPrompt: localized.systemPrompt,
      welcomeMessage: localized.welcomeMessage,
      personaGender,
      rules: localized.rules,
      suggestions: localized.suggestedQuestions,
      keyFacts,
      theme,
      sourceCitations,
    });
    skipAutoSaveRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when UI language changes
  }, [locale]);

  useEffect(() => {
    if (!building || !job?.id || !bot?.id) return undefined;
    const timer = setInterval(async () => {
      try {
        const data = await api(`/bots/${bot.id}/build/${job.id}`, { username });
        setJob(data.job);
        setBot(data.bot);
        if (data.sources) setSources(data.sources);
        // Keep building true until BuildImmersiveOverlay finishes its exit.
      } catch (err) {
        setError(err.message);
        setBuilding(false);
        setJob(null);
      }
    }, 450);
    return () => clearInterval(timer);
  }, [building, job?.id, bot?.id, username]);

  useEffect(() => {
    allowNavigationRef.current = false;
    if (isNew) {
      skipAutoSaveRef.current = false;
      setIsHydrated(true);
    }
  }, [id, isNew]);

  const getDirtySignature = useCallback(
    () =>
      formDirtySignature({
        name,
        systemPrompt,
        welcomeMessage,
        personaGender,
        rules,
        suggestions,
        keyFacts,
        theme,
        sourceCitations,
      }),
    [
      name,
      systemPrompt,
      welcomeMessage,
      personaGender,
      rules,
      suggestions,
      keyFacts,
      theme,
      sourceCitations,
    ]
  );

  const hasUncommittedDraftLinks = useMemo(
    () => draftLinks.some((row) => String(row.url || '').trim()),
    [draftLinks]
  );

  const formIsDirty = useMemo(() => {
    if (!isHydrated || !name.trim()) return false;
    return getDirtySignature() !== lastSavedDirtyRef.current;
  }, [isHydrated, name, getDirtySignature, saveGeneration]);

  // Unsaved form/drafts take priority over rebuild when leaving.
  const isDirty = formIsDirty || hasUncommittedDraftLinks;

  isDirtyRef.current = isDirty;

  const shouldBlockNavigation = useCallback(() => {
    if (allowNavigationRef.current) return false;
    if (!isHydrated || !name.trim()) return false;
    // 1) Unsaved form or typed draft links not committed yet.
    if (getDirtySignature() !== lastSavedDirtyRef.current) return true;
    if (draftLinksRef.current.some((row) => String(row.url || '').trim())) return true;
    // 2) Already saved, but a new source still needs rebuild.
    if (knowledgeNeedsRebuild && !building) return true;
    return false;
  }, [isHydrated, name, getDirtySignature, knowledgeNeedsRebuild, building]);
  const blocker = useBlocker(shouldBlockNavigation);

  // Priority: unsaved first; only if clean, ask about rebuild.
  const leavePromptKind =
    blocker.state !== 'blocked'
      ? null
      : isDirty
        ? 'unsaved'
        : knowledgeNeedsRebuild && !building
          ? 'rebuild'
          : null;

  const bodyPayload = useCallback(
    () =>
      buildEditorPayload({
        name,
        systemPrompt,
        welcomeMessage,
        personaGender,
        rules,
        suggestions,
        keyFacts,
        theme,
        sourceCitations,
      }),
    [
      name,
      systemPrompt,
      welcomeMessage,
      personaGender,
      rules,
      suggestions,
      keyFacts,
      theme,
      sourceCitations,
    ]
  );

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (saveUiTimerRef.current) {
      clearTimeout(saveUiTimerRef.current);
      saveUiTimerRef.current = null;
    }
    setSaveFeedback(null);
    saveAbortRef.current?.abort();
    saveAbortRef.current = null;
  }, []);

  const clearSaveFeedbackTimers = useCallback(() => {
    if (saveUiTimerRef.current) {
      clearTimeout(saveUiTimerRef.current);
      saveUiTimerRef.current = null;
    }
  }, []);

  const completeSaveFeedback = useCallback(
    (result, { immediate = false } = {}) => {
      clearSaveFeedbackTimers();

      const showSaved = () => {
        setSaveFeedback('saved');
        setSaveStatus('saved');
        saveUiTimerRef.current = setTimeout(() => {
          setSaveFeedback('saved-fade');
          saveUiTimerRef.current = setTimeout(() => {
            setSaveFeedback(null);
            saveUiTimerRef.current = null;
          }, SAVE_FADE_MS);
        }, SAVE_SAVED_VISIBLE_MS);
      };

      const apply = () => {
        if (result === 'saved') showSaved();
        else if (result === 'error') {
          setSaveFeedback(null);
          setSaveStatus('error');
        } else {
          setSaveFeedback(null);
          setSaveStatus('unsaved');
        }
      };

      if (immediate) {
        apply();
        return;
      }

      const elapsed = Date.now() - (saveStartedAtRef.current || Date.now());
      const waitSaving = Math.max(0, SAVE_SAVING_MIN_MS - elapsed);
      saveUiTimerRef.current = setTimeout(apply, waitSaving);
    },
    [clearSaveFeedbackTimers]
  );

  const startSaveFeedback = useCallback(() => {
    clearSaveFeedbackTimers();
    saveStartedAtRef.current = Date.now();
    setSaveFeedback('saving');
    setSaveStatus('saving');
  }, [clearSaveFeedbackTimers]);

  const persistBot = useCallback(
    async ({ navigateAfter = false } = {}) => {
      if (!name.trim()) return null;
      if (persistInFlightRef.current) return botRef.current;
      const payloadAtSave = bodyPayload();
      persistInFlightRef.current = true;
      saveAbortRef.current?.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;
      startSaveFeedback();
      setError('');
      try {
        let data;
        const botId = botIdRef.current;
        if (botId) {
          data = await api(`/bots/${botId}`, {
            method: 'PATCH',
            username,
            body: payloadAtSave,
            signal: controller.signal,
          });
          setBot(data.bot);
        } else {
          data = await api('/bots', {
            method: 'POST',
            username,
            body: payloadAtSave,
            signal: controller.signal,
          });
          setBot(data.bot);
          allowNavigationRef.current = true;
          navigate(`/bots/${data.bot.id}`, { replace: true });
        }
        lastSavedPayloadRef.current = JSON.stringify(payloadAtSave);
        // Mark clean from the live form after the request finishes (avoids stale
        // baseline if something updated during the await).
        lastSavedDirtyRef.current = formDirtySignature(formFieldsRef.current);
        setSaveGeneration((n) => n + 1);
        setSaveStatus('saved');
        completeSaveFeedback('saved');
        if (navigateAfter) {
          allowNavigationRef.current = true;
          navigate('/bots');
        }
        return data.bot;
      } catch (err) {
        if (err.name === 'AbortError') {
          completeSaveFeedback('cancelled', { immediate: true });
          return null;
        }
        setError(err.message);
        completeSaveFeedback('error');
        return null;
      } finally {
        if (saveAbortRef.current === controller) {
          saveAbortRef.current = null;
        }
        persistInFlightRef.current = false;
      }
    },
    [bodyPayload, completeSaveFeedback, name, navigate, startSaveFeedback, username]
  );

  persistBotRef.current = persistBot;

  useEffect(() => {
    if (skipAutoSaveRef.current || !name.trim() || !isHydrated || saveFeedback) return undefined;

    const signature = getDirtySignature();
    if (signature === lastSavedDirtyRef.current && !hasUncommittedDraftLinks) {
      setSaveStatus('saved');
    } else {
      setSaveStatus('unsaved');
    }
  }, [
    isHydrated,
    saveFeedback,
    getDirtySignature,
    hasUncommittedDraftLinks,
    name,
  ]);

  useEffect(() => () => cancelPendingSave(), [cancelPendingSave]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (isDirty || (knowledgeNeedsRebuild && !building)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty, knowledgeNeedsRebuild, building]);

  const handleStayOnPage = () => {
    if (blocker.state === 'blocked') blocker.reset();
  };

  const handleGoToRebuild = () => {
    if (blocker.state === 'blocked') blocker.reset();
    window.requestAnimationFrame(() => {
      const el = document.getElementById('editor-build-section');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleLeaveWithoutSaving = () => {
    cancelPendingSave();
    allowNavigationRef.current = true;
    if (blocker.state === 'blocked') blocker.proceed();
  };

  const syncSaveStatusFromForm = () => {
    if (!isHydrated || !name.trim()) return;
    if (getDirtySignature() === lastSavedDirtyRef.current && !hasUncommittedDraftLinks) {
      setSaveStatus('saved');
    } else {
      setSaveStatus('unsaved');
    }
  };

  const snapshotFormDraft = () => {
    formDraftRef.current = {
      name,
      systemPrompt,
      welcomeMessage,
      personaGender,
      rules,
      suggestions,
      keyFacts,
      theme,
      sourceCitations,
    };
  };

  const restoreFormDraft = () => {
    const d = formDraftRef.current;
    if (!d) return;
    setName(d.name);
    setSystemPrompt(d.systemPrompt);
    setWelcomeMessage(d.welcomeMessage);
    setPersonaGender(d.personaGender);
    setRules(d.rules);
    setSuggestions(d.suggestions);
    setKeyFacts(d.keyFacts);
    setTheme(d.theme);
    setSourceCitations(d.sourceCitations);
    const dirty = formDirtySignature(d) !== lastSavedDirtyRef.current;
    setSaveStatus(dirty ? 'unsaved' : 'saved');
  };

  // Keep draft snapshot fresh while editing so rebuild/reload can't wipe it.
  useEffect(() => {
    if (!isHydrated) return;
    formDraftRef.current = {
      name,
      systemPrompt,
      welcomeMessage,
      personaGender,
      rules,
      suggestions,
      keyFacts,
      theme,
      sourceCitations,
    };
  }, [
    isHydrated,
    name,
    systemPrompt,
    welcomeMessage,
    personaGender,
    rules,
    suggestions,
    keyFacts,
    theme,
    sourceCitations,
  ]);

  const handleBuildOverlayComplete = async () => {
    setBuilding(false);
    setJob(null);
    const kind = buildSuccessKindRef.current || 'rebuild';
    if (!botIdRef.current) {
      setBuildSuccessKind(kind);
      restoreFormDraft();
      return;
    }
    try {
      const refreshed = await api(`/bots/${botIdRef.current}`, { username });
      // Refresh index metadata only — keep unsaved form fields as-is.
      setSources(refreshed.sources || []);
      setBot(refreshed.bot);
      restoreFormDraft();
      // Session-only notice — gone if the user leaves and comes back.
      setBuildSuccessKind(kind);
    } catch (err) {
      setError(err.message);
      restoreFormDraft();
    }
  };

  const handleBuildOverlayError = async () => {
    setBuilding(false);
    setBuildSuccessKind(null);
    const failedMessage = job?.message;
    setJob(null);
    if (failedMessage) setError(failedMessage);
    if (!botIdRef.current) {
      restoreFormDraft();
      return;
    }
    try {
      const refreshed = await api(`/bots/${botIdRef.current}`, { username });
      setSources(refreshed.sources || []);
      setBot(refreshed.bot);
    } catch {
      /* ignore */
    }
    restoreFormDraft();
  };

  /** Create the bot on first knowledge action if still unsaved. */
  const ensureBot = async () => {
    if (bot?.id) return bot;
    return persistBot();
  };

  const refreshSources = async (botId) => {
    const data = await api(`/bots/${botId}`, { username });
    setBot(data.bot);
    setSources(data.sources || []);
    // Sources persist on their own — don't leave Save looking dirty for form fields.
    syncSaveStatusFromForm();
  };

  const createBot = async () => {
    await persistBot({ navigateAfter: true });
  };

  const saveBot = async () => {
    await flushDraftLinks();
    await persistBot({ navigateAfter: false });
  };

  const uploadFiles = async (fileList) => {
    if (!fileList?.length) return;
    setError('');
    setUploading(true);
    try {
      const b = await ensureBot();
      for (const file of fileList) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/bots/${b.id}/sources/upload`, {
          method: 'POST',
          username,
          formData: fd,
        });
      }
      await refreshSources(b.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const focusDraftLink = (localId) => {
    requestAnimationFrame(() => {
      const el = draftLinkInputRefs.current[localId];
      if (el) {
        el.focus();
        el.select?.();
      }
    });
  };

  const clearDraftEntering = (localId) => {
    setEnteringDraftIds((prev) => {
      if (!prev.has(localId)) return prev;
      const next = new Set(prev);
      next.delete(localId);
      return next;
    });
  };

  const addDraftLink = (onlyPage) => {
    setDraftLinks((prev) => {
      const emptySame = [...prev]
        .reverse()
        .find((row) => !String(row.url || '').trim() && Boolean(row.onlyPage) === Boolean(onlyPage));
      if (emptySame) {
        focusDraftLink(emptySame.localId);
        return prev;
      }
      const row = createEditorDraftLink(onlyPage);
      setEnteringDraftIds((ids) => new Set(ids).add(row.localId));
      focusDraftLink(row.localId);
      const next = [...prev, row];
      draftLinksRef.current = next;
      return next;
    });
  };

  const setDraftLinkUrl = (localId, nextUrl) => {
    setDraftLinks((prev) => {
      const next = prev.map((row) => (row.localId === localId ? { ...row, url: nextUrl } : row));
      draftLinksRef.current = next;
      return next;
    });
  };

  const removeDraftLink = (localId) => {
    setDraftLinks((prev) => {
      const next = prev.filter((row) => row.localId !== localId);
      draftLinksRef.current = next;
      return next;
    });
    clearDraftEntering(localId);
  };

  const commitDraftLink = async (localId) => {
    if (committingDraftIdRef.current) return;
    const row = draftLinksRef.current.find((r) => r.localId === localId);
    if (!row) return;
    const normalized = ensureHttpsUrl(row.url);
    if (!normalized) {
      if (!String(row.url || '').trim()) removeDraftLink(localId);
      return;
    }
    setError('');
    setCommittingDraftId(localId);
    committingDraftIdRef.current = localId;
    try {
      const b = await ensureBot();
      await api(`/bots/${b.id}/sources/url`, {
        method: 'POST',
        username,
        body: { url: normalized, scrapeMode: row.onlyPage ? 'page' : 'site' },
      });
      removeDraftLink(localId);
      await refreshSources(b.id);
    } catch (err) {
      if (err?.status === 409) {
        removeDraftLink(localId);
        if (botIdRef.current) await refreshSources(botIdRef.current);
      } else {
        setError(err.message);
        setDraftLinkUrl(localId, normalized);
      }
    } finally {
      setCommittingDraftId(null);
      committingDraftIdRef.current = null;
    }
  };

  /** Commit typed draft links and drop empty rows so Save clears “unsaved”. */
  const flushDraftLinks = async () => {
    const rows = [...draftLinksRef.current];
    for (const row of rows) {
      if (!String(row.url || '').trim()) {
        removeDraftLink(row.localId);
        continue;
      }
      await commitDraftLink(row.localId);
    }
  };

  const openPreview = async (source) => {
    setError('');
    setPreview({ source, kind: 'loading' });
    try {
      const next = await buildSourcePreview(source, { botId: bot.id, username });
      setPreview(next);
    } catch (err) {
      setPreview(null);
      setError(err.message);
    }
  };

  const loadChunks = async (sourceId = '') => {
    if (!bot?.id) return;
    setChunksLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (sourceId) params.set('sourceId', sourceId);
      const data = await api(`/bots/${bot.id}/chunks?${params}`, { username });
      setChunkData(data);
      setChunksOpen(true);
      setChunkSourceFilter(sourceId);
      setExpandedChunk(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setChunksLoading(false);
    }
  };

  const openChunk = (chunk) => {
    if (expandedChunk === chunk.id) {
      setExpandedChunk(null);
      setEditDraft('');
      return;
    }
    setExpandedChunk(chunk.id);
    setEditDraft(chunk.content || '');
  };

  const deleteChunk = async (chunkId) => {
    if (!bot?.id) return;
    const ok = await confirm({
      title: t('editor.chunkDeleteTitle'),
      message: t('editor.chunkDeleteMessage'),
      confirmLabel: t('common.yes'),
      cancelLabel: t('common.no'),
      danger: true,
    });
    if (!ok) return;
    setChunkSaving(true);
    setError('');
    try {
      await api(`/bots/${bot.id}/chunks/${chunkId}`, { method: 'DELETE', username });
      if (expandedChunk === chunkId) {
        setExpandedChunk(null);
        setEditDraft('');
      }
      await load();
      await loadChunks(chunkSourceFilter);
    } catch (err) {
      setError(err.message);
    } finally {
      setChunkSaving(false);
    }
  };

  const saveChunk = async (chunkId) => {
    if (!bot?.id) return;
    const content = editDraft.trim();
    if (content.length < 20) {
      setError(t('editor.chunkMinLength'));
      return;
    }
    setChunkSaving(true);
    setError('');
    try {
      await api(`/bots/${bot.id}/chunks/${chunkId}`, {
        method: 'PATCH',
        username,
        body: { content },
      });
      await load();
      await loadChunks(chunkSourceFilter);
    } catch (err) {
      setError(err.message);
    } finally {
      setChunkSaving(false);
    }
  };

  const clearSourceChunks = async (sourceId) => {
    if (!bot?.id || !sourceId) return;
    const source = sources.find((s) => s.id === sourceId);
    const ok = await confirm({
      title: t('editor.clearChunksTitle'),
      message: source
        ? t('editor.clearChunksMessage', {
            label: source.label || source.url || t('editor.thisSource'),
          })
        : t('editor.clearChunksMessageGeneric'),
      confirmLabel: t('common.yes'),
      cancelLabel: t('common.no'),
      danger: true,
    });
    if (!ok) return;
    setChunkSaving(true);
    setError('');
    try {
      await api(`/bots/${bot.id}/sources/${sourceId}/chunks`, { method: 'DELETE', username });
      setExpandedChunk(null);
      setEditDraft('');
      await load();
      await loadChunks('');
    } catch (err) {
      setError(err.message);
    } finally {
      setChunkSaving(false);
    }
  };

  const removeSource = async (sourceId) => {
    const source = sources.find((s) => s.id === sourceId);
    const label = source ? sourceDisplayLabel(source, t) : t('editor.thisSource');
    const chunkN = source?.chunkCount || 0;
    const ok = await confirm({
      title: t('editor.removeSourceTitle'),
      message:
        chunkN > 0
          ? t('editor.removeSourceMessageChunks', { label, count: chunkN })
          : t('editor.removeSourceMessage', { label }),
      confirmLabel: t('editor.removeSourceConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/bots/${bot.id}/sources/${sourceId}`, { method: 'DELETE', username });
      await load();
      if (chunksOpen) {
        setExpandedChunk(null);
        setEditDraft('');
        const nextFilter = chunkSourceFilter === sourceId ? '' : chunkSourceFilter;
        if (chunkSourceFilter === sourceId) setChunkSourceFilter('');
        await loadChunks(nextFilter);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const uploadIcon = async (file) => {
    if (!file) return;
    setError('');
    setUploadingIcon(true);
    try {
      const b = await ensureBot();
      const fd = new FormData();
      fd.append('file', file, file.name || 'icon.png');
      const data = await api(`/bots/${b.id}/icon`, {
        method: 'POST',
        username,
        formData: fd,
      });
      setBot(data.bot);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  };

  const removeIcon = async () => {
    if (!bot?.id) return;
    setError('');
    setIconPreview(null);
    setUploadingIcon(true);
    try {
      const data = await api(`/bots/${bot.id}/icon`, {
        method: 'DELETE',
        username,
      });
      setBot(data.bot);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  };

  const startBuild = async (mode) => {
    setError('');
    snapshotFormDraft();
    const kind = hasPriorBuild ? 'rebuild' : 'build';
    buildSuccessKindRef.current = kind;
    setBuildSuccessKind(null);
    setBuildVariant(mode === 'adaptive' && hasPriorBuild ? 'adaptive' : 'full');
    setBuilding(true);
    try {
      const data = await api(`/bots/${bot.id}/build`, {
        method: 'POST',
        username,
        body: { mode },
      });
      setJob(data.job);
    } catch (err) {
      setError(err.message);
      setBuilding(false);
      setJob(null);
      restoreFormDraft();
    }
  };

  return (
    <div>
      <BuildImmersiveOverlay
        active={building}
        variant={buildVariant}
        botName={name || bot?.name}
        personaGender={personaGender}
        job={job}
        onComplete={handleBuildOverlayComplete}
        onError={handleBuildOverlayError}
      />
      <div className="topbar" style={{ marginBottom: '1rem' }}>
        <div>
          <h2 className="section-title">{isNew ? t('editor.newTitle') : t('editor.editTitle')}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {t('editor.subtitle')}
          </p>
        </div>
        <div className="topbar-actions">
          <div className="editor-primary-actions">
            <button
              className={[
                'btn btn-accent editor-save-btn',
                saveFeedback === 'saving' && 'is-saving',
                (saveFeedback === 'saved' || saveFeedback === 'saved-fade') && 'is-saved',
                saveFeedback === 'saved-fade' && 'is-fade-out',
                saveStatus === 'unsaved' && !saveFeedback && 'is-unsaved',
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              onClick={saveBot}
              disabled={saveFeedback === 'saving' || !name.trim()}
              aria-live="polite"
            >
              <span className="editor-save-btn-label" data-state="idle">
                {t('common.save')}
              </span>
              <span className="editor-save-btn-label" data-state="saving" aria-hidden={saveFeedback !== 'saving'}>
                {t('common.saving')}
              </span>
              <span
                className="editor-save-btn-label"
                data-state="saved"
                aria-hidden={saveFeedback !== 'saved' && saveFeedback !== 'saved-fade'}
              >
                <CheckIcon />
                {t('common.saved')}
              </span>
            </button>
          </div>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="stack-sections">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('editor.identity')}</h3>
          <div className="field" style={{ marginTop: '1rem' }}>
            <label>{t('editor.botName')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="DialogosAI"
            />
          </div>
          <div className="field">
            <label>{t('editor.gender')}</label>
            <GenderPicker
              value={personaGender}
              onChange={setPersonaGender}
              labels={{
                group: t('editor.gender'),
                he: t('wizard.genderHe'),
                she: t('wizard.genderShe'),
                it: t('wizard.genderIt'),
                detecting: t('wizard.genderDetecting'),
              }}
            />
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('editor.theme')}</h3>
          <div className="wizard-look editor-theme-look">
            <BotIconField
              iconUrl={bot?.iconUrl}
              accent={theme.accent}
              uploading={uploadingIcon}
              onUpload={uploadIcon}
              onRemove={removeIcon}
              onPreviewChange={setIconPreview}
            />
            <ThemeColors theme={theme} onChange={setTheme} />
            <ThemePreview
              theme={theme}
              botName={name}
              iconUrl={iconPreview || bot?.iconUrl}
              welcomeMessage={welcomeMessage}
              suggestedQuestions={suggestions}
              personaGender={personaGender}
            />
          </div>
          <div className="theme-a11y-fold">
            <button
              type="button"
              className="build-advanced-toggle"
              aria-expanded={a11yOpen}
              onClick={() => setA11yOpen((open) => !open)}
            >
              <span className="build-advanced-toggle-text">
                <strong>{t('editor.a11yTitle')}</strong>
              </span>
              <span className={`chunks-chevron${a11yOpen ? ' is-open' : ''}`} aria-hidden="true">
                <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
                  <path
                    d="M4 6l4 4 4-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
            {a11yOpen && (
              <div className="theme-a11y-fold-body">
                <ThemeAccessibility theme={theme} onApply={setTheme} />
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('editor.prompts')}</h3>
          <div className="field">
            <label>{t('editor.systemPrompt')}</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              placeholder={t('editor.systemPromptPlaceholder')}
            />
          </div>
          <div className="field">
            <label>{t('editor.welcome')}</label>
            <input
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{t('editor.suggestions')}</label>
            <OrderedListEditor
              items={suggestions}
              onChange={setSuggestions}
              addLabel={t('editor.addQuestion')}
              placeholder={t('editor.newQuestion')}
            />
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('editor.knowledge')}</h3>
          {!bot?.id && <p className="muted">{t('editor.sourcesTip')}</p>}
          <div
            className={`files-block${uploading ? ' is-busy' : ''}${
              fileSources.length === 0 ? ' files-block--solo' : ''
            }`}
          >
            <div
              className={`dropzone${dragOver ? ' active' : ''}${uploading ? ' is-busy' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!uploading) uploadFiles([...e.dataTransfer.files]);
              }}
            >
              {uploading ? (
                <p style={{ margin: 0 }} className="busy-line">
                  <span className="spinner" aria-hidden="true" />
                  {t('editor.uploading')}
                </p>
              ) : (
                <p style={{ margin: 0 }}>
                  {t('editor.dropFiles')}{' '}
                  <label style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
                    {t('editor.browse')}
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                      multiple
                      hidden
                      onChange={(e) => uploadFiles([...(e.target.files || [])])}
                    />
                  </label>
                </p>
              )}
            </div>
            {fileSources.length > 0 && (
              <div className="source-panel">{fileSources.map(renderSourceRow)}</div>
            )}
          </div>

          <div className="url-add-block" style={{ marginTop: '1.25rem' }}>
            {urlSources.length > 0 && (
              <div className="source-panel">{urlSources.map(renderSourceRow)}</div>
            )}
            <div
              className="wizard-link-list"
              style={urlSources.length > 0 ? { marginTop: '0.75rem' } : undefined}
            >
              {draftLinks.map((row) => {
                const entering = enteringDraftIds.has(row.localId);
                const busy = committingDraftId === row.localId;
                return (
                  <div
                    key={row.localId}
                    className={`wizard-link-row is-editing${entering ? ' is-entering' : ''}`}
                    onAnimationEnd={(e) => {
                      if (e.target !== e.currentTarget) return;
                      clearDraftEntering(row.localId);
                    }}
                  >
                    <input
                      ref={(el) => {
                        if (el) draftLinkInputRefs.current[row.localId] = el;
                        else delete draftLinkInputRefs.current[row.localId];
                      }}
                      className="wizard-link-input"
                      value={row.url}
                      disabled={busy}
                      onChange={(e) => setDraftLinkUrl(row.localId, e.target.value)}
                      placeholder={
                        row.onlyPage
                          ? t('wizard.urlPlaceholderPage')
                          : t('wizard.urlPlaceholderSite')
                      }
                      onBlur={() => {
                        void commitDraftLink(row.localId);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void commitDraftLink(row.localId);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          removeDraftLink(row.localId);
                        }
                      }}
                    />
                    <span
                      className={`wizard-link-mode-badge${
                        row.onlyPage ? ' is-page' : ' is-site'
                      }`}
                    >
                      {row.onlyPage ? t('wizard.linkModePage') : t('wizard.linkModeSite')}
                    </span>
                    <button
                      type="button"
                      className="icon-btn danger"
                      title={t('list.remove')}
                      disabled={busy}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => removeDraftLink(row.localId)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <div className="wizard-link-add-row">
                <button
                  className="btn btn-secondary ordered-list-add wizard-link-add-site"
                  type="button"
                  disabled={Boolean(committingDraftId)}
                  onClick={() => addDraftLink(false)}
                >
                  + {t('editor.addWebsite')}
                </button>
                <button
                  className="btn btn-secondary ordered-list-add wizard-link-add-page"
                  type="button"
                  disabled={Boolean(committingDraftId)}
                  onClick={() => addDraftLink(true)}
                >
                  + {t('editor.addPage')}
                </button>
                <FieldLabelHelp help={t('editor.linksModeHelp')} />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('editor.trustedAnswers')}</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            {t('editor.keyFactsHelp')}
          </p>
          <KeyFactsEditor items={keyFacts} onChange={setKeyFacts} />
        </div>

        <div
          id="editor-build-section"
          className={`card build-index-card${knowledgeNeedsRebuild ? ' build-index-card--needs-rebuild' : ''}`}
        >
          <h3 style={{ marginTop: 0 }}>{t('editor.build')}</h3>
          {knowledgeNeedsRebuild ? (
            <div className="build-alert build-alert--rebuild" role="status">
              {hasPriorBuild ? t('editor.rebuildRequired') : t('editor.buildRequired')}
            </div>
          ) : buildSuccessKind && !building ? (
            <div className="build-alert build-alert--ok" role="status">
              {buildSuccessKind === 'rebuild' ? t('editor.rebuildDone') : t('editor.buildDone')}
            </div>
          ) : null}
          {!sources.length ? (
            <p className="muted build-index-help">{t('editor.buildFirst')}</p>
          ) : knowledgeNeedsRebuild ? (
            <p className="muted build-index-help">
              {hasPriorBuild ? t('editor.buildAdaptiveHelp') : t('editor.buildFirst')}
            </p>
          ) : buildSuccessKind ? null : (
            <p className="muted build-index-help">{t('editor.buildUpToDate')}</p>
          )}

          <div className="build-index-actions">
            {hasPriorBuild ? (
              <button
                className="btn btn-accent"
                type="button"
                disabled={!bot?.id || building || !sources.length || !knowledgeNeedsRebuild}
                onClick={() => startBuild('adaptive')}
              >
                {building && job?.mode !== 'full' ? (
                  <>
                    <span className="spinner spinner-inline" aria-hidden="true" />
                    {t('editor.building')}
                  </>
                ) : (
                  t('editor.adaptiveRebuild')
                )}
              </button>
            ) : null}
            <button
              className={`btn ${hasPriorBuild ? 'btn-secondary' : 'btn-accent'}`}
              type="button"
              disabled={
                !bot?.id ||
                building ||
                !sources.length ||
                (hasPriorBuild ? !knowledgeNeedsRebuild : false)
              }
              onClick={() => startBuild(hasPriorBuild ? 'full' : 'adaptive')}
            >
              {building && (!hasPriorBuild || job?.mode === 'full') ? (
                <>
                  <span className="spinner spinner-inline" aria-hidden="true" />
                  {t('editor.building')}
                </>
              ) : hasPriorBuild ? (
                t('editor.fullRebuild')
              ) : (
                t('editor.buildAction')
              )}
            </button>
            {hasPriorBuild ? <FieldLabelHelp help={t('editor.rebuildModesHelp')} /> : null}
          </div>

        {bot && (hasPriorBuild || bot.status !== 'draft') && (
          <div className="build-index-status">
            <span className={`badge badge-${bot.status}`}>{t(`status.${bot.status || 'draft'}`)}</span>
            {bot.chunkCount > 0 && (
              <span className="badge badge-muted">
                {bot.chunkCount}{' '}
                {bot.chunkCount === 1 ? t('bots.chunk') : t('bots.chunks')}
              </span>
            )}
            {bot.lastBuiltAt && (
              <span className="build-index-built muted">
                {t('editor.lastBuilt', {
                  date: new Date(bot.lastBuiltAt).toLocaleString(dateLocale),
                })}
              </span>
            )}
          </div>
        )}

        {building && (
          <div className="build-progress build-progress--placeholder" aria-hidden="true">
            <p className="muted busy-line build-progress-msg">
              <span className="spinner" aria-hidden="true" />
              {t('editor.building')}
            </p>
          </div>
        )}

        {!building && bot?.buildError && (
          <div className="build-alert build-alert--warn" role="status">
            {bot.buildError}
          </div>
        )}

        {bot?.id && (bot.chunkCount > 0 || sources.some((s) => s.chunkCount > 0)) && (
          <div className="build-advanced">
            <button
              type="button"
              className="build-advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => {
                if (advancedOpen) {
                  setAdvancedOpen(false);
                  setChunksOpen(false);
                  setExpandedChunk(null);
                  setEditDraft('');
                } else {
                  setAdvancedOpen(true);
                }
              }}
            >
              <span className="build-advanced-toggle-text">
                <strong>{t('editor.advanced')}</strong>
              </span>
              <span className={`chunks-chevron${advancedOpen ? ' is-open' : ''}`} aria-hidden="true">
                <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
                  <path
                    d="M4 6l4 4 4-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>

            {advancedOpen && (
              <div className="build-advanced-body">
                <div className="chunks-browser">
                  <button
                    type="button"
                    className="chunks-browser-toggle"
                    aria-expanded={chunksOpen}
                    disabled={chunksLoading}
                    onClick={() => {
                      if (chunksOpen) {
                        setChunksOpen(false);
                        setExpandedChunk(null);
                        setEditDraft('');
                      } else {
                        loadChunks(chunkSourceFilter || '');
                      }
                    }}
                  >
                    <span className="chunks-browser-toggle-text">
                      <strong>{t('editor.indexedChunks')}</strong>
                      <span className="muted">
                        {chunksLoading
                          ? t('common.loading')
                          : t('editor.chunksPreview', {
                              count: bot.chunkCount || chunkData?.total || 0,
                            })}
                      </span>
                    </span>
                    <span className={`chunks-chevron${chunksOpen ? ' is-open' : ''}`} aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
                        <path
                          d="M4 6l4 4 4-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </button>

                  {chunksOpen && chunkData && (
                    <div className="chunks-browser-panel">
                      <div className="chunk-source-summary">
                        <button
                          type="button"
                          className={`chunk-source-chip${!chunkSourceFilter ? ' active' : ''}`}
                          onClick={() => loadChunks('')}
                        >
                          <span>{t('editor.all')}</span>
                          <strong>{chunkData.total || 0}</strong>
                        </button>
                        {(chunkData.bySource || [])
                          .filter((s) => s.storedChunks > 0)
                          .map((s) => (
                            <button
                              type="button"
                              key={s.sourceId}
                              className={`chunk-source-chip${chunkSourceFilter === s.sourceId ? ' active' : ''}`}
                              onClick={() =>
                                loadChunks(chunkSourceFilter === s.sourceId ? '' : s.sourceId)
                              }
                            >
                              <span>{sourceDisplayLabel(s, t)}</span>
                              <strong>{s.storedChunks}</strong>
                            </button>
                          ))}
                      </div>

                      {chunkSourceFilter ? (
                        <p className="chunk-list-meta muted">
                          {t('editor.chunksCount', { count: chunkData.total || 0 })}
                          <button
                            type="button"
                            className="text-link danger-link"
                            disabled={chunkSaving}
                            onClick={() => clearSourceChunks(chunkSourceFilter)}
                          >
                            {t('editor.clearSourceChunks')}
                          </button>
                        </p>
                      ) : (
                        <p className="chunk-list-meta muted">
                          {t('editor.chunksCount', { count: chunkData.total || 0 })}
                        </p>
                      )}

                      <div className="chunk-list">
                        {(chunkData.chunks || []).length === 0 && (
                          <p className="muted chunk-list-empty">{t('editor.noChunksFilter')}</p>
                        )}
                        {(chunkData.chunks || []).map((c) => {
                          const open = expandedChunk === c.id;
                          const page = chunkPageLabel(c.pageUrl);
                          const title = chunkTitle(c.content, page, c.ordinal, t);
                          const meta = chunkMetaLine(c, t);
                          const head = (
                            <div className="chunk-item-head">
                              <span className="chunk-badge-num">#{c.ordinal + 1}</span>
                              <div className="chunk-item-copy">
                                <p className="chunk-item-title">{title}</p>
                                {meta ? <p className="chunk-item-sub muted">{meta}</p> : null}
                              </div>
                              <span className="chunk-badge-size muted">{chunkSizeLabel(c, t)}</span>
                            </div>
                          );
                          return (
                            <article
                              className={`chunk-item${open ? ' is-open' : ''}`}
                              key={c.id}
                            >
                              {!open ? (
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className="chunk-item-trigger"
                                  onClick={() => openChunk(c)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      openChunk(c);
                                    }
                                  }}
                                >
                                  {head}
                                  <p className="chunk-item-excerpt">{chunkExcerpt(c.content, 200, t)}</p>
                                </div>
                              ) : (
                                <div className="chunk-item-panel">
                                  {head}
                                  <textarea
                                    className="chunk-edit-area"
                                    value={editDraft}
                                    onChange={(e) => setEditDraft(e.target.value)}
                                    rows={6}
                                    disabled={chunkSaving}
                                    aria-label={t('editor.chunkTextLabel')}
                                  />
                                  <div className="chunk-item-actions">
                                    <button
                                      type="button"
                                      className="text-link"
                                      disabled={chunkSaving}
                                      onClick={() => saveChunk(c.id)}
                                    >
                                      {chunkSaving ? t('editor.chunkSaving') : t('editor.saveChanges')}
                                    </button>
                                    <button
                                      type="button"
                                      className="text-link danger-link"
                                      disabled={chunkSaving}
                                      onClick={() => deleteChunk(c.id)}
                                    >
                                      {t('common.delete')}
                                    </button>
                                    <button
                                      type="button"
                                      className="text-link"
                                      disabled={chunkSaving}
                                      onClick={() => openChunk(c)}
                                    >
                                      {t('editor.closePreview')}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

        {bot?.id && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t('editor.embedSection')}</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {t('editor.embedDesc', { name: name || bot.name })}
            </p>
            <ol className="embed-steps">
              {embedSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <pre className="code-block">{embedSnippet}</pre>
            <div className="embed-snippet-footer">
              <button
                type="button"
                className={`btn btn-with-icon${embedSnippetCopied ? ' btn-secondary embed-copy-done' : ' btn-accent'}`}
                onClick={copyEmbedSnippet}
                aria-live="polite"
              >
                {embedSnippetCopied ? (
                  <>
                    <CheckIcon />
                    {t('common.copied')}
                  </>
                ) : (
                  t('common.copyCode')
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {preview ? (
        <SourcePreviewModal
          preview={preview}
          onClose={() => {
            if (preview?.objectUrl && preview?.url) {
              try {
                URL.revokeObjectURL(preview.url);
              } catch {
                /* ignore */
              }
            }
            setPreview(null);
          }}
        />
      ) : null}

      {dialog}
      {blocker.state === 'blocked' && leavePromptKind === 'unsaved' && (
        <UnsavedChangesDialog
          title={t('editor.unsavedNav.title')}
          message={t('editor.unsavedNav.message')}
          stayLabel={t('editor.unsavedNav.stay')}
          leaveLabel={t('editor.unsavedNav.leave')}
          showSave={false}
          onStay={handleStayOnPage}
          onLeave={handleLeaveWithoutSaving}
        />
      )}
      {blocker.state === 'blocked' && leavePromptKind === 'rebuild' && (
        <UnsavedChangesDialog
          title={t('editor.rebuildNav.title')}
          message={t('editor.rebuildNav.message')}
          stayLabel={t('editor.rebuildNav.goToRebuild')}
          leaveLabel={t('editor.rebuildNav.leave')}
          showSave={false}
          emphasizeStay
          onStay={handleGoToRebuild}
          onLeave={handleLeaveWithoutSaving}
        />
      )}
    </div>
  );
}
