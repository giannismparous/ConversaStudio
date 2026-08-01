import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { buildSourcePreview } from '../lib/sourcePreview.js';
import { ensureHttpsUrl } from '../lib/url.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useConfirm } from '../lib/useConfirm.jsx';
import OrderedListEditor from '../components/OrderedListEditor.jsx';
import KeyFactsEditor from '../components/KeyFactsEditor.jsx';
import FieldLabelHelp from '../components/FieldLabelHelp.jsx';
import FileTypeIcon, { fileSourceDisplayName } from '../components/FileTypeIcon.jsx';
import SourcePreviewModal from '../components/SourcePreviewModal.jsx';
import EyeIcon from '../components/EyeIcon.jsx';
import ThemeColors from '../components/ThemeColors.jsx';
import BotIconField from '../components/BotIconField.jsx';
import ThemePreview from '../components/ThemePreview.jsx';
import GenderPicker from '../components/GenderPicker.jsx';
import TypewriterField from '../components/TypewriterField.jsx';
import { applyGreekPersonaGrammar, personalizeUiCopy, greekBuildNameVars } from '../lib/testUiLocalize.js';
import {
  DEFAULT_BOT_NAME,
  DIALOGOS_DEFAULTS_EN,
  defaultsForLocale,
  localizeStarterCopyIfDefault,
  withBotName,
} from '../lib/dialogosDefaults.js';
import { makeFloaterMotion, scatterFloaterPosition, pickLatestFloaterLine, MAX_BUILD_FLOATERS } from '../lib/buildImmersive.js';
import {
  clearWizardSession,
  clearWizardCreateInflight,
  completeSetupBot,
  getSetupBotId,
  getWizardCreateInflight,
  isGenderLocked,
  markSetupBot,
  abandonWizardBot,
  pauseSetupWizard,
  readInferredGenderName,
  readWizardBotId,
  readWizardStep,
  setGenderLocked,
  setWizardCreateInflight,
  writeInferredGenderName,
  writeWizardBotId,
  writeWizardStep,
} from '../lib/wizardSession.js';

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

const DIALOGOS_DEFAULTS = {
  ...DIALOGOS_DEFAULTS_EN,
  personaGender: 'neutral',
};

const LEGACY_SUGGESTED_QUESTIONS = [
  'What can DialogosAI do for me?',
  'What are the main points in the knowledge base?',
  'How can I get started?',
  'Who do you serve?',
  'How can I contact you?',
];

const LEGACY_SUGGESTED_QUESTIONS_V2 = [
  'What are the main points in the knowledge base?',
  'How can I contact you?',
];

function defaultsForName(botName, locale = 'en') {
  return defaultsForLocale(locale, botName);
}

/** Swap an old bot name (or DialogosAI) for the current one in copy fields. */
function retargetBotName(text, fromNames, toName) {
  const target = String(toName || '').trim() || DEFAULT_BOT_NAME;
  let result = String(text || '');
  const names = [
    ...new Set(
      [DEFAULT_BOT_NAME, ...(fromNames || []).map((n) => String(n || '').trim())].filter(Boolean)
    ),
  ]
    .filter((n) => n !== target)
    .sort((a, b) => b.length - a.length);
  for (const from of names) {
    if (result.includes(from)) result = result.split(from).join(target);
  }
  return result;
}

function isDefaultBotName(value) {
  return /^dialogosai$/i.test(String(value || '').trim());
}

function matchesQuestionSet(current, templates, botName) {
  if (current.length !== templates.length) return false;
  const personalized = templates.map((q) => withBotName(q, botName));
  return current.every((q, i) => q === personalized[i] || q === templates[i]);
}

/** Old prefill sets → current 2-question set (name-aware). */
function migrateSuggestedQuestions(list, botName) {
  const current = (Array.isArray(list) ? list : []).map((q) => String(q || '').trim()).filter(Boolean);
  const name = botName || DEFAULT_BOT_NAME;
  if (
    matchesQuestionSet(current, LEGACY_SUGGESTED_QUESTIONS, name) ||
    matchesQuestionSet(current, LEGACY_SUGGESTED_QUESTIONS_V2, name)
  ) {
    return defaultsForName(name, 'en').suggestedQuestions;
  }
  return current;
}

const STEPS = [
  'name',
  'look',
  'voice',
  'suggestions',
  'knowledge',
  'keyFacts',
  'citations',
  'build',
  'done',
];

/** Preview-only: animate build UI without crawling / embedding / spending tokens. */
const WIZARD_FAKE_BUILD = false;

/** Keep the loading scene up even when the server finishes in milliseconds. */
const BUILD_MIN_VISIBLE_MS = 4200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
const randBetween = (min, max) => min + Math.random() * (max - min);

function setWizardBuildImmersive(on) {
  const root = document.documentElement;
  if (on) {
    root.classList.add('wizard-build-immersive');
    root.classList.remove('wizard-build-immersive-exit');
    return;
  }
  root.classList.remove('wizard-build-immersive');
  root.classList.remove('wizard-build-immersive-exit');
}

function setWizardBuildImmersiveExit(on) {
  document.documentElement.classList.toggle('wizard-build-immersive-exit', Boolean(on));
}

const IMMERSIVE_EXIT_MS = 2800;

let linkRowSeq = 0;
function createLinkRow(partial = {}) {
  linkRowSeq += 1;
  return {
    localId: `lr-${linkRowSeq}`,
    sourceId: null,
    url: '',
    onlyPage: false,
    status: null,
    pageCount: 0,
    ...partial,
  };
}

function linkRowsFromSources(urlSources) {
  return (Array.isArray(urlSources) ? urlSources : []).map((s) =>
    createLinkRow({
      localId: `src-${s.id}`,
      sourceId: s.id,
      url: String(s.uri || s.label || ''),
      onlyPage: s.scrapeMode !== 'site',
      status: s.status || null,
      pageCount: Number(s.pageCount) || 0,
    })
  );
}

function isKnowledgeFileSource(source) {
  return source?.type === 'pdf' || source?.type === 'txt' || source?.type === 'text';
}

function countKnowledgeSources(sources) {
  return (Array.isArray(sources) ? sources : []).filter(
    (s) => isKnowledgeFileSource(s) || s.type === 'url'
  ).length;
}

/** True if the knowledge step currently has a file and/or a non-empty link draft. */
function hasKnowledgeContent(sources, rows) {
  if (countKnowledgeSources(sources) > 0) return true;
  return (Array.isArray(rows) ? rows : []).some((row) => String(row?.url || '').trim());
}

function shortenBuildLabel(label) {
  const s = String(label || '').trim();
  if (!s) return '';
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    const clipped = path.length > 28 ? `${path.slice(0, 28)}…` : path;
    return `${host}${clipped}`;
  } catch {
    return s.length > 42 ? `${s.slice(0, 40)}…` : s;
  }
}

function formatWizardBuildMessage(message, botName, t, personaGender = 'neutral') {
  const msg = String(message || '').trim();
  const nameVars = greekBuildNameVars(botName, personaGender);
  if (!msg || /^Starting/i.test(msg)) return t('wizard.buildLogStarting', nameVars);
  let m;
  if ((m = msg.match(/^Indexing:\s*(.+)$/i))) {
    return t('wizard.buildLogIndexing', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Reading PDF:\s*(.+)$/i))) {
    return t('wizard.buildLogReadingPdf', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Reading:\s*(.+)$/i))) {
    return t('wizard.buildLogReadingFile', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Parsing\s+(.+)$/i))) {
    return t('wizard.buildLogParsing', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Embedding\s+(.+?)\s*\((\d+)\/(\d+)\)/i))) {
    return t('wizard.buildLogEmbedding', {
      label: shortenBuildLabel(m[1]),
      current: m[2],
      total: m[3],
    });
  }
  if ((m = msg.match(/^Embedded\s+(.+?)\s*\((\d+)\/(\d+)\)/i))) {
    return t('wizard.buildLogEmbedded', {
      label: shortenBuildLabel(m[1]),
      current: m[2],
      total: m[3],
    });
  }
  if ((m = msg.match(/^Crawling\s*\((\d+)\/(\d+)\):\s*(.+)$/i))) {
    return t('wizard.buildLogCrawling', {
      current: m[1],
      total: m[2],
      label: shortenBuildLabel(m[3]),
    });
  }
  if ((m = msg.match(/^Skipped unchanged:\s*(.+)$/i))) {
    return t('wizard.buildLogSkipped', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Skipped duplicate:\s*(.+)$/i))) {
    return t('wizard.buildLogDuplicateSource', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Skipped page:\s*(.+)$/i))) {
    return t('wizard.buildLogSkippedPage', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Skipped duplicate page:\s*(.+)$/i))) {
    return t('wizard.buildLogDuplicate', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Skipped duplicate page\s+(.+)$/i))) {
    return t('wizard.buildLogDuplicate', { label: shortenBuildLabel(m[1]) });
  }
  if (/^Failed:/i.test(msg)) {
    return t('wizard.buildLogFailed', { detail: msg.replace(/^Failed:\s*/i, '') });
  }
  if (/Removed .+ chunk/i.test(msg)) return t('wizard.buildLogCleanup');
  if (/^Ready|^Done/i.test(msg)) return t('wizard.buildLogReady', nameVars);
  return msg;
}

const MAX_BUILD_LOG = 5;

function pushBuildLogEntry(prev, entry) {
  const sealed = prev.map((item) =>
    item.status === 'active' ? { ...item, status: 'done' } : item
  );
  return [...sealed, entry].slice(-MAX_BUILD_LOG);
}

function snippetFromBuildText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/^(Reading|Crawling|Learned|Embedded|Indexing|Indexed|Getting|Already knew)\s+/i, '')
    .replace(/\s*\(\d+\/\d+\)\s*$/, '')
    .replace(/^https?:\/\//i, '')
    .trim();
  if (!cleaned) return raw.slice(0, 28);
  if (cleaned.length <= 32) return cleaned;
  return `${cleaned.slice(0, 30)}…`;
}

function splitIntoChunkLines(text, maxLen = 96) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return [];
  const parts = raw
    .split(/(?<=[.!?…;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  const out = [];
  for (const part of parts) {
    if (part.length <= maxLen) {
      out.push(part);
      continue;
    }
    let rest = part;
    while (rest.length > maxLen) {
      let cut = rest.lastIndexOf(' ', maxLen);
      if (cut < 32) cut = maxLen;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest.length >= 12) out.push(rest);
  }
  return out.slice(0, 40);
}

function wizardContentChunks(keyFacts, welcomeMessage, systemPrompt) {
  const lines = [];
  for (const fact of Array.isArray(keyFacts) ? keyFacts : []) {
    const title = String(fact?.title || '').trim();
    const body = String(fact?.body || '').trim();
    if (title) lines.push(title);
    lines.push(...splitIntoChunkLines(body));
  }
  lines.push(...splitIntoChunkLines(welcomeMessage));
  lines.push(...splitIntoChunkLines(String(systemPrompt || '').slice(0, 600)));
  return [...new Set(lines.filter(Boolean))];
}

function fakeSitePageLabel(baseLabel, pageIndex) {
  const paths = ['/', '/about', '/pricing', '/docs', '/blog', '/contact', '/faq', '/features', '/help', '/team'];
  const path = paths[pageIndex % paths.length];
  try {
    const withProto = /^https?:\/\//i.test(baseLabel) ? baseLabel : `https://${baseLabel}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./, '');
    return path === '/' ? host : `${host}${path}`;
  } catch {
    return `${shortenBuildLabel(baseLabel)}${path === '/' ? '' : path}`;
  }
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

function buildPayload(state) {
  return {
    name: String(state.name || '').trim(),
    systemPrompt: String(state.systemPrompt || ''),
    welcomeMessage: String(state.welcomeMessage || ''),
    personaGender: state.personaGender || 'neutral',
    rules: (state.rules || []).map((r) => String(r || '').trim()).filter(Boolean),
    suggestedQuestions: (state.suggestions || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean),
    keyFacts: (state.keyFacts || [])
      .map((f) => ({
        title: String(f?.title || '').trim(),
        body: String(f?.body || '').trim(),
      }))
      .filter((f) => f.title && f.body),
    theme: normalizeTheme(state.theme),
    sourceCitations: normalizeSourceCitations(state.sourceCitations),
  };
}

function pruneEmptySuggestions(list) {
  return (Array.isArray(list) ? list : []).map((s) => String(s || '').trim()).filter(Boolean);
}

function defaultContactKeyFacts(email, t) {
  const address = String(email || '').trim() || t('keyFacts.emailPlaceholder');
  return [
    {
      title: t('keyFacts.defaultContactTitle'),
      body: t('keyFacts.defaultContactBody', { email: address }),
    },
  ];
}

function isDefaultContactTitle(title, t) {
  const value = String(title || '').trim();
  return (
    value === t('keyFacts.defaultContactTitle') ||
    value === 'How to contact you' ||
    value === 'Πώς να επικοινωνήσετε μαζί μας'
  );
}

function withRegistrationEmail(facts, email, t) {
  const address = String(email || '').trim();
  const list = Array.isArray(facts) ? facts : [];
  // Respect an intentionally empty list (user removed every trusted answer).
  if (!list.length) return list;

  const placeholder = t('keyFacts.emailPlaceholder');
  const fresh = defaultContactKeyFacts(address, t)[0];
  let changed = false;
  const next = list.map((fact, index) => {
    if (index !== 0) return fact;
    const title = String(fact?.title || '').trim();
    const body = String(fact?.body || '');
    if (!isDefaultContactTitle(title, t)) return fact;

    const needsEmail =
      Boolean(address) &&
      !body.includes(address) &&
      (body.includes(placeholder) ||
        body.includes('[your email here]') ||
        body.includes('[το email σας εδώ]') ||
        !body.includes('@'));
    const needsCopyRefresh =
      body.includes('We usually reply as soon as we can') ||
      body.includes('Απαντάμε συνήθως το συντομότερο δυνατό');

    if (!needsEmail && !needsCopyRefresh) return fact;
    changed = true;
    return fresh;
  });
  return changed ? next : list;
}

function typesHidden(hideTypes, types) {
  return types.every((type) => (hideTypes || []).includes(type));
}

function toggleHiddenTypes(hideTypes, types, hidden) {
  const set = new Set(hideTypes || []);
  for (const type of types) {
    if (hidden) set.add(type);
    else set.delete(type);
  }
  return [...set];
}

export default function BotCreateWizardPage() {
  const { username, user, email: authEmail, ready: authReady } = useAuth();
  const { t, locale } = useI18n();
  const { confirm, dialog } = useConfirm();
  const navigate = useNavigate();
  // Create-wizard bots stay off the dashboard (listed=false) until build.
  // Always treat this session as guided setup so leaving resumes the same bot.
  const trackAsSetupRef = useRef(true);
  // Supabase registration email (from /auth/me + session fallback).
  const userEmail = String(authEmail || user?.email || '').trim();
  const userEmailRef = useRef(userEmail);
  const tRef = useRef(t);
  userEmailRef.current = userEmail;
  tRef.current = t;

  const [stepIndex, setStepIndex] = useState(() => {
    const saved = readWizardStep();
    const doneIdx = STEPS.indexOf('done');
    // Never mount on the done step — without doneReveal the title stays opacity 0 (blank page).
    if (saved == null || saved < 0 || saved >= STEPS.length || saved === doneIdx) return 0;
    return saved;
  });
  const [animKey, setAnimKey] = useState(0);
  const [stepDir, setStepDir] = useState(1);
  const [bot, setBot] = useState(null);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [genderDetecting, setGenderDetecting] = useState(false);
  const [copyAnimKey, setCopyAnimKey] = useState(0);
  const [voiceFieldsLocked, setVoiceFieldsLocked] = useState(false);
  const [voiceSetupPending, setVoiceSetupPending] = useState(false);
  const voiceAnimPendingRef = useRef(new Set());
  const voiceAnimatedForNameRef = useRef(null);
  const [suggestionsAnimKey, setSuggestionsAnimKey] = useState(0);
  const [suggestionsLocked, setSuggestionsLocked] = useState(false);
  const suggestionsAnimatedForNameRef = useRef(null);
  const [keyFactsAnimKey, setKeyFactsAnimKey] = useState(0);
  const [keyFactsLocked, setKeyFactsLocked] = useState(false);
  const keyFactsAnimatedForNameRef = useRef(null);
  const [job, setJob] = useState(null);
  const [buildLog, setBuildLog] = useState([]);
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildFailed, setBuildFailed] = useState(false);
  const [immersiveUi, setImmersiveUi] = useState(false);
  const [immersiveExit, setImmersiveExit] = useState(false);
  const [doneReveal, setDoneReveal] = useState(false);
  const [driftTexts, setDriftTexts] = useState([]);
  const lastBuildMsgRef = useRef('');
  const lastDriftSnippetRef = useRef('');
  const buildLogSeqRef = useRef(0);
  const buildTargetRef = useRef(0);
  const buildRunRef = useRef(0);
  const buildStartedAtRef = useRef(0);
  const buildHandoffRef = useRef({
    finishBuildSuccess: async () => {},
    clearBuildImmersive: () => {},
  });
  const immersiveTimerRef = useRef(0);
  const driftSeqRef = useRef(0);
  const lastDriftSrcRef = useRef('');
  const driftPoolRef = useRef([]);
  const driftBandRef = useRef(0);
  const spawnDriftTextRef = useRef(() => {});
  const driftPositionsRef = useRef([]);
  const MAX_DRIFT_ON_SCREEN = MAX_BUILD_FLOATERS;
  const [iconPreview, setIconPreview] = useState(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkRows, setLinkRows] = useState([]);
  const [enteringLinkIds, setEnteringLinkIds] = useState(() => new Set());
  const [leavingLinkIds, setLeavingLinkIds] = useState(() => new Set());
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoadingId, setPreviewLoadingId] = useState(null);
  const [focusedLinkId, setFocusedLinkId] = useState(null);
  const [committingLinkIds, setCommittingLinkIds] = useState(() => new Set());
  const committingLinkIdsRef = useRef(new Set());
  const linkInputRefs = useRef({});
  const linksHydratedRef = useRef(false);
  const linkRowsRef = useRef(linkRows);
  linkRowsRef.current = linkRows;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const leavingLinkIdsRef = useRef(leavingLinkIds);
  leavingLinkIdsRef.current = leavingLinkIds;

  const fileSources = useMemo(
    () => sources.filter((s) => s.type === 'pdf' || s.type === 'txt'),
    [sources]
  );
  const urlSources = useMemo(() => sources.filter((s) => s.type === 'url'), [sources]);
  const knowledgeReady = useMemo(
    () => hasKnowledgeContent(sources, linkRows),
    [sources, linkRows]
  );
  /** True while a link is mid-edit / checking — Next waits for ✓ or ✕. */
  const linksPendingSettle = useMemo(() => {
    if (focusedLinkId) {
      const focused = linkRows.find((r) => r.localId === focusedLinkId);
      if (focused && String(focused.url || '').trim()) return true;
    }
    if (committingLinkIds.size > 0) return true;
    return linkRows.some((row) => {
      const url = String(row?.url || '').trim();
      if (!url) return false;
      if (committingLinkIds.has(row.localId)) return true;
      const linked = row.sourceId ? sources.find((s) => s.id === row.sourceId) : null;
      const status = linked?.status || row.status;
      return !status;
    });
  }, [linkRows, focusedLinkId, committingLinkIds, sources]);

  useEffect(() => {
    if (linksHydratedRef.current) return;
    if (!urlSources.length) return;
    // Don't replace rows the user is already editing — that wiped ✓/✕ on blur.
    if (linkRowsRef.current.some((r) => String(r.url || '').trim())) return;
    setLinkRows(linkRowsFromSources(urlSources));
    linksHydratedRef.current = true;
  }, [urlSources]);

  const [name, setName] = useState(DEFAULT_BOT_NAME);
  const [nameTaken, setNameTaken] = useState(false);
  const [nameChecking, setNameChecking] = useState(false);
  const [nameHintVisible, setNameHintVisible] = useState(false);
  const [nameHintText, setNameHintText] = useState('');
  const nameCheckSeqRef = useRef(0);
  const nameCheckTimerRef = useRef(0);
  const nameHintHideTimerRef = useRef(0);
  const [personaGender, setPersonaGender] = useState(DIALOGOS_DEFAULTS.personaGender);
  const [systemPrompt, setSystemPrompt] = useState(
    () => defaultsForName(DEFAULT_BOT_NAME, locale).systemPrompt
  );
  const [welcomeMessage, setWelcomeMessage] = useState(
    () => defaultsForName(DEFAULT_BOT_NAME, locale).welcomeMessage
  );
  const [rules, setRules] = useState(() => [...defaultsForName(DEFAULT_BOT_NAME, locale).rules]);
  const [suggestions, setSuggestions] = useState(
    () => defaultsForName(DEFAULT_BOT_NAME, locale).suggestedQuestions
  );
  const [keyFacts, setKeyFacts] = useState(() => defaultContactKeyFacts('', t));
  const [theme, setTheme] = useState({ ...DEFAULT_THEME });
  const [sourceCitations, setSourceCitations] = useState({ ...DEFAULT_SOURCE_CITATIONS });

  const botIdRef = useRef(null);
  const formStateRef = useRef(null);
  const stepIndexRef = useRef(stepIndex);
  stepIndexRef.current = stepIndex;
  const appliedNameRef = useRef(DEFAULT_BOT_NAME);
  const genderLockedRef = useRef(isGenderLocked());
  const inferredForNameRef = useRef(readInferredGenderName());
  const genderInferInflightRef = useRef(null);
  const goNextLockRef = useRef(false);
  const usernameRef = useRef(username);
  usernameRef.current = username;
  const pendingVoiceSetupRef = useRef(false);

  const step = STEPS[stepIndex];
  const totalSteps = STEPS.length - 1; // exclude done from count display
  const displayStep = Math.min(stepIndex + 1, totalSteps);

  useEffect(() => {
    if (step === 'knowledge' && knowledgeReady) {
      setError((prev) => (prev === t('wizard.knowledgeRequired') ? '' : prev));
    }
  }, [step, knowledgeReady, t]);

  useEffect(() => {
    window.clearTimeout(nameHintHideTimerRef.current);
    if (nameTaken) {
      setNameHintText(t('wizard.nameTaken'));
      // Allow paint with opacity 0, then fade in.
      const id = window.requestAnimationFrame(() => {
        setNameHintVisible(true);
      });
      return () => window.cancelAnimationFrame(id);
    }
    setNameHintVisible(false);
    nameHintHideTimerRef.current = window.setTimeout(() => {
      setNameHintText('');
    }, 340);
    return () => window.clearTimeout(nameHintHideTimerRef.current);
  }, [nameTaken, t]);

  useEffect(() => {
    if (step !== 'name' || !username) return undefined;
    const trimmed = String(name || '').trim();
    window.clearTimeout(nameCheckTimerRef.current);
    if (!trimmed) {
      setNameTaken(false);
      setNameChecking(false);
      return undefined;
    }
    setNameChecking(true);
    const seq = ++nameCheckSeqRef.current;
    nameCheckTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const excludeId = botIdRef.current || bot?.id || '';
          const params = new URLSearchParams({ name: trimmed });
          if (excludeId) params.set('excludeId', excludeId);
          const data = await api(`/bots/check-name?${params}`, { username });
          if (nameCheckSeqRef.current !== seq) return;
          const taken = data?.available === false;
          setNameTaken(taken);
          if (taken) setError('');
        } catch {
          if (nameCheckSeqRef.current !== seq) return;
          setNameTaken(false);
        } finally {
          if (nameCheckSeqRef.current === seq) setNameChecking(false);
        }
      })();
    }, 280);
    return () => window.clearTimeout(nameCheckTimerRef.current);
  }, [name, step, username, bot?.id]);

  // Keep Dialogos starter fields in sync with platform language (custom text is left alone).
  useEffect(() => {
    const localized = localizeStarterCopyIfDefault(
      {
        welcomeMessage,
        suggestedQuestions: suggestions,
        systemPrompt,
        rules,
        botName: name || DEFAULT_BOT_NAME,
      },
      locale
    );
    if (localized) {
      setWelcomeMessage(localized.welcomeMessage);
      setSuggestions(localized.suggestedQuestions);
      setSystemPrompt(localized.systemPrompt);
      setRules(localized.rules);
    }
    setKeyFacts((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (!list.length) return list;
      const first = list[0];
      if (!isDefaultContactTitle(first?.title, t)) return prev;
      const emailMatch = String(first?.body || '').match(/[\w.+-]+@[\w.-]+\.\w+/);
      const address = emailMatch?.[0] || userEmailRef.current || '';
      const next = defaultContactKeyFacts(address, t);
      return [next[0], ...list.slice(1)];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when UI language changes
  }, [locale, t]);

  const formState = useMemo(
    () => ({
      name,
      personaGender,
      systemPrompt,
      welcomeMessage,
      rules,
      suggestions,
      keyFacts,
      theme,
      sourceCitations,
    }),
    [
      name,
      personaGender,
      systemPrompt,
      welcomeMessage,
      rules,
      suggestions,
      keyFacts,
      theme,
      sourceCitations,
    ]
  );
  formStateRef.current = formState;

  const refreshSources = useCallback(
    async (botId) => {
      const id = botId || bot?.id;
      if (!id) return;
      const data = await api(`/bots/${id}`, { username });
      setBot(data.bot);
      botIdRef.current = data.bot?.id || null;
      setSources(data.sources || []);
    },
    [bot?.id, username]
  );

  const persistBot = useCallback(async () => {
    const payload = buildPayload(formStateRef.current || formState);
    if (!payload.name) {
      throw new Error(t('wizard.nameRequired'));
    }
    const existingId = botIdRef.current || bot?.id || readWizardBotId();
    if (existingId) {
      const data = await api(`/bots/${existingId}`, {
        method: 'PATCH',
        username,
        body: payload,
      });
      setBot(data.bot);
      botIdRef.current = data.bot.id;
      writeWizardBotId(data.bot.id);
      if (trackAsSetupRef.current || getSetupBotId() === data.bot.id) {
        markSetupBot(data.bot.id);
        trackAsSetupRef.current = true;
      }
      return data.bot;
    }
    // Create once per wizard session. Name changes after this always PATCH above.
    if (!getWizardCreateInflight()) {
      setWizardCreateInflight(
        api('/bots', {
          method: 'POST',
          username,
          body: payload,
        })
          .then((data) => data.bot)
          .catch((err) => {
            clearWizardCreateInflight();
            throw err;
          })
      );
    }
    let created;
    try {
      created = await getWizardCreateInflight();
    } catch (err) {
      clearWizardCreateInflight();
      throw err;
    }
    botIdRef.current = created.id;
    writeWizardBotId(created.id);
    clearWizardCreateInflight();
    if (trackAsSetupRef.current) {
      markSetupBot(created.id);
    }
    // Apply latest form (e.g. name typed while POST was in flight) without a second create.
    const data = await api(`/bots/${created.id}`, {
      method: 'PATCH',
      username,
      body: buildPayload(formStateRef.current || formState),
    });
    setBot(data.bot);
    botIdRef.current = data.bot.id;
    return data.bot;
  }, [bot?.id, formState, t, username]);

  const ensureBot = useCallback(async () => {
    return persistBot();
  }, [persistBot]);

  const hydrateFromBot = useCallback((saved) => {
    if (!saved) return;
    setBot(saved);
    botIdRef.current = saved.id;
    writeWizardBotId(saved.id);
    if (getSetupBotId() === saved.id || trackAsSetupRef.current) {
      markSetupBot(saved.id);
      trackAsSetupRef.current = true;
    }
    if (saved.name) {
      setName(saved.name);
      appliedNameRef.current = saved.name;
    }
    if (saved.personaGender) setPersonaGender(saved.personaGender);
    genderLockedRef.current = isGenderLocked();
    inferredForNameRef.current = readInferredGenderName() || saved.name || '';
    if (saved.systemPrompt != null) setSystemPrompt(saved.systemPrompt);
    if (saved.welcomeMessage != null) setWelcomeMessage(saved.welcomeMessage);
    if (Array.isArray(saved.rules)) setRules([...saved.rules]);
    if (Array.isArray(saved.suggestedQuestions)) {
      setSuggestions(migrateSuggestedQuestions(saved.suggestedQuestions, saved.name));
    }
    // After hydrate, swap Dialogos starter copy into the active UI language.
    const localized = localizeStarterCopyIfDefault(
      {
        welcomeMessage: saved.welcomeMessage,
        suggestedQuestions: saved.suggestedQuestions,
        systemPrompt: saved.systemPrompt,
        rules: saved.rules,
        botName: saved.name || DEFAULT_BOT_NAME,
      },
      locale
    );
    if (localized) {
      setWelcomeMessage(localized.welcomeMessage);
      setSuggestions(localized.suggestedQuestions);
      setSystemPrompt(localized.systemPrompt);
      setRules(localized.rules);
    }
    if (Array.isArray(saved.keyFacts)) {
      const facts = saved.keyFacts
        .map((f) => ({
          title: String(f?.title || '').trim(),
          body: String(f?.body || '').trim(),
        }))
        .filter((f) => f.title || f.body);
      setKeyFacts(withRegistrationEmail(facts, userEmailRef.current, tRef.current));
    } else {
      setKeyFacts(defaultContactKeyFacts(userEmailRef.current, tRef.current));
    }
    if (saved.theme) setTheme(normalizeTheme(saved.theme));
    if (saved.sourceCitations) setSourceCitations(normalizeSourceCitations(saved.sourceCitations));
    if (saved.iconUrl) setIconPreview(saved.iconUrl);
    const savedStep = readWizardStep();
    const doneIdx = STEPS.indexOf('done');
    if (savedStep != null && savedStep >= 0 && savedStep < STEPS.length && savedStep !== doneIdx) {
      setStepIndex(savedStep);
      // Resume past an animated section → treat copy as already shown for this name.
      const resumedName = String(saved.name || appliedNameRef.current || '').trim();
      if (resumedName) {
        if (savedStep > STEPS.indexOf('look')) voiceAnimatedForNameRef.current = resumedName;
        if (savedStep > STEPS.indexOf('voice')) suggestionsAnimatedForNameRef.current = resumedName;
        if (savedStep > STEPS.indexOf('knowledge')) keyFactsAnimatedForNameRef.current = resumedName;
      }
    }
  }, [locale]);

  const isInProgressWizardBot = (b) => Boolean(b) && b.listed === false && !b.lastBuiltAt;

  // Resume the in-progress create-wizard bot (same fields if you leave and click New bot again).
  // Do NOT create until leaving the name step — and never list that bot on the dashboard.
  useEffect(() => {
    if (!username) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const existingId = readWizardBotId() || getSetupBotId();
        if (existingId) {
          try {
            const data = await api(`/bots/${existingId}`, { username });
            if (cancelled) return;
            // Finished / done-step leftovers → start a real new chatbot (not a blank done screen).
            if (!isInProgressWizardBot(data.bot) || readWizardStep() === STEPS.indexOf('done')) {
              abandonWizardBot();
              botIdRef.current = null;
            } else {
              trackAsSetupRef.current = true;
              hydrateFromBot(data.bot);
              setSources(data.sources || []);
              return;
            }
          } catch {
            // Stale id from another account / deleted bot — do not PATCH it.
            abandonWizardBot();
            botIdRef.current = null;
          }
        }

        // Resume newest unlisted (wizard) draft; drop older wizard orphans.
        try {
          const list = await api('/bots', { username });
          const unfinished = (list.bots || [])
            .filter((b) => isInProgressWizardBot(b))
            .sort((a, b) => {
              const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
              const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
              return tb - ta;
            });
          if (unfinished.length >= 1) {
            const keep = unfinished[0];
            for (const orphan of unfinished.slice(1)) {
              void api(`/bots/${orphan.id}`, { method: 'DELETE', username }).catch(() => {});
            }
            const data = await api(`/bots/${keep.id}`, { username });
            if (cancelled) return;
            trackAsSetupRef.current = true;
            hydrateFromBot(data.bot);
            setSources(data.sources || []);
            return;
          }
        } catch {
          /* stay on empty name step — create later via ensureBot */
        }
        // No draft: wait for ensureBot when leaving the name step.
      } catch (err) {
        if (!cancelled) {
          abandonWizardBot();
          botIdRef.current = null;
          if (err?.status === 409 || err?.data?.error === 'duplicate_name') {
            setNameTaken(true);
            setError('');
          } else {
            setError(err.message);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // Fill/replace the default contact trusted answer with the Supabase registration email.
  useEffect(() => {
    if (!authReady || !userEmail) return;
    setKeyFacts((prev) => withRegistrationEmail(prev, userEmail, t));
  }, [authReady, userEmail, t]);

  // Persist latest edits when leaving the wizard (nav bar, etc.).
  useEffect(() => {
    return () => {
      const payload = buildPayload(formStateRef.current || {});
      const user = usernameRef.current;
      const id = botIdRef.current || readWizardBotId();
      const onDone = stepIndexRef.current === STEPS.indexOf('done');
      // Leaving the ready screen: clear wizard session so "New chatbot" isn't a blank done page.
      if (onDone) {
        completeSetupBot();
        trackAsSetupRef.current = false;
        return;
      }
      if (!user || !payload.name || !id) return;
      void api(`/bots/${id}`, { method: 'PATCH', username: user, body: payload }).catch(() => {});
      if (trackAsSetupRef.current) {
        pauseSetupWizard(id, stepIndexRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop any leftover immersive classes from a prior build (covers HMR / interrupted exits).
  useEffect(() => {
    setWizardBuildImmersive(false);
    setWizardBuildImmersiveExit(false);
  }, []);

  // Debounced autosave so theme/colors/copy survive refresh, back/forward, and logout.
  useEffect(() => {
    if (!botIdRef.current && !bot?.id && !readWizardBotId()) return undefined;
    if (!name.trim()) return undefined;
    const timer = window.setTimeout(() => {
      void persistBot().catch(() => {});
    }, 700);
    return () => window.clearTimeout(timer);
  }, [formState, bot?.id, name, persistBot]);

  useEffect(() => {
    writeWizardStep(stepIndex);
  }, [stepIndex]);

  useEffect(() => {
    if (!building || WIZARD_FAKE_BUILD || !job?.id || !bot?.id) return undefined;
    let cancelled = false;
    const runId = buildRunRef.current;
    const tick = async () => {
      try {
        const data = await api(`/bots/${bot.id}/build/${job.id}`, { username });
        if (cancelled || buildRunRef.current !== runId) return;
        setJob(data.job);
        const progress = Number(data.job.progress);
        if (Number.isFinite(progress)) {
          // Hold the bar under 100 until the Ready handoff so a fast job doesn’t look finished.
          const capped = Math.min(96, progress);
          const next = Math.max(buildTargetRef.current, Math.min(96, capped));
          buildTargetRef.current = next;
          setBuildProgress(next);
        }
        if (data.job.status === 'queued' || data.job.status === 'running') {
          setTimeout(tick, 450);
          return;
        }

        // Keep `building` true until we hand off — flipping it false here used to
        // cancel this effect and skip revealDoneStep (stuck on Build + dark bg).
        try {
          await refreshSources(bot.id);
        } catch {
          /* non-fatal — still finish the wizard if the job succeeded */
        }
        if (cancelled || buildRunRef.current !== runId) return;

        if (data.job.status === 'done' || data.job.status === 'completed') {
          await buildHandoffRef.current.finishBuildSuccess(runId);
        } else {
          setBuildLog((prev) =>
            prev.map((item) => (item.status === 'active' ? { ...item, status: 'error' } : item))
          );
          setError(data.job.message || t('wizard.buildFailed'));
          setBuildFailed(true);
          buildRunRef.current = 0;
          setBuilding(false);
          buildHandoffRef.current.clearBuildImmersive(800);
        }
      } catch (err) {
        if (cancelled || buildRunRef.current !== runId) return;
        setBuilding(false);
        setBuildFailed(true);
        buildRunRef.current = 0;
        buildHandoffRef.current.clearBuildImmersive(800);
        setError(err.message);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [building, job?.id, bot?.id, username, refreshSources, t]);

  useEffect(() => {
    if (WIZARD_FAKE_BUILD || !job) return;
    const raw = String(job.message || '').trim();
    const progress = Number(job.progress);
    if (Number.isFinite(progress)) {
      // Never let the bar jump backwards; ease toward the latest target.
      // Cap under 100 while building so a finished job doesn’t flash “complete”.
      const ceiling = building ? 96 : 100;
      const next = Math.max(buildTargetRef.current, Math.min(ceiling, progress));
      buildTargetRef.current = next;
      setBuildProgress(next);
    }

    const snippet = String(job.snippet || '').trim();
    const snippetChanged = Boolean(snippet) && snippet !== lastDriftSnippetRef.current;
    if (snippetChanged) {
      lastDriftSnippetRef.current = snippet;
      const lines = splitIntoChunkLines(snippet, 88);
      const extras = lines.length ? lines : [snippet.slice(0, 96)];
      const prev = driftPoolRef.current || [];
      const seen = new Set(prev);
      driftPoolRef.current = [
        ...extras.filter((l) => l && !seen.has(l)),
        ...prev,
      ].slice(0, 80);
    }

    if (!raw || raw === lastBuildMsgRef.current) {
      if (snippetChanged && building) spawnDriftTextRef.current?.(snippet.slice(0, 96));
      return;
    }
    lastBuildMsgRef.current = raw;
    const text = formatWizardBuildMessage(
      raw,
      String(name.trim() || appliedNameRef.current || 'DialogosAI'),
      t,
      personaGender
    );
    setBuildLog((prev) => {
      buildLogSeqRef.current += 1;
      return pushBuildLogEntry(prev, {
        id: buildLogSeqRef.current,
        text,
        status: 'active',
      });
    });
    if (building) {
      const isSkip = /^Skipped /i.test(raw);
      spawnDriftTextRef.current?.(
        snippetChanged ? snippet.slice(0, 96) : isSkip ? text : undefined
      );
    }
  }, [job, name, t, building, personaGender]);

  // Keep floaters alive between progress ticks (real + fake builds) with jittered timing.
  useEffect(() => {
    if (!building) return undefined;
    let cancelled = false;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (Math.random() < 0.7 + Math.random() * 0.2) spawnDriftTextRef.current?.();
        tick();
      }, 420 + Math.floor(Math.random() * 520));
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [building]);

  useEffect(() => {
    if (step === 'build') {
      setBusy(false);
    }
  }, [step]);

  useEffect(
    () => () => {
      window.clearTimeout(immersiveTimerRef.current);
      setWizardBuildImmersive(false);
    },
    []
  );

  const wizardName = () => String(name.trim() || appliedNameRef.current || '').trim();

  /** Prefill only — no typewriter / preparing shimmer — once a step has played for this name. */
  const settleStepAnimations = (stepId) => {
    const currentName = wizardName();
    if (!currentName) return;
    if (stepId === 'voice' && voiceAnimatedForNameRef.current === currentName) {
      setCopyAnimKey(0);
      voiceAnimPendingRef.current = new Set();
      setVoiceFieldsLocked(false);
    }
    if (stepId === 'suggestions' && suggestionsAnimatedForNameRef.current === currentName) {
      setSuggestionsAnimKey(0);
      setSuggestionsLocked(false);
    }
    if (stepId === 'keyFacts' && keyFactsAnimatedForNameRef.current === currentName) {
      setKeyFactsAnimKey(0);
      setKeyFactsLocked(false);
    }
  };

  const goTo = (nextIndex) => {
    setError('');
    setStepDir(nextIndex >= stepIndex ? 1 : -1);
    const nextStep = STEPS[nextIndex];
    if (nextStep) settleStepAnimations(nextStep);
    setStepIndex(nextIndex);
    setAnimKey((k) => k + 1);
  };

  /** Replay typewriters only when the committed bot name changed since last full play. */
  const armVoiceAnimation = () => {
    const currentName = wizardName();
    if (voiceAnimatedForNameRef.current === currentName && currentName) {
      setCopyAnimKey(0);
      voiceAnimPendingRef.current = new Set();
      setVoiceFieldsLocked(false);
      return;
    }
    setCopyAnimKey(Date.now());
    voiceAnimPendingRef.current = new Set(['welcome']);
    setVoiceFieldsLocked(true);
    // Hard unlock so a cancelled typewriter can never trap the wizard.
    window.setTimeout(() => {
      setVoiceFieldsLocked(false);
      voiceAnimPendingRef.current = new Set();
    }, 12000);
  };

  const runGenderInferIfNeeded = async (inferName) => {
    const nextName = String(inferName || '').trim();
    if (!nextName || isDefaultBotName(nextName) || genderLockedRef.current) return null;
    if (inferredForNameRef.current === nextName && !genderInferInflightRef.current) {
      // Already inferred for this name earlier in the session.
      return null;
    }
    if (genderInferInflightRef.current === nextName) return null;

    genderInferInflightRef.current = nextName;
    inferredForNameRef.current = nextName;
    writeInferredGenderName(nextName);
    setGenderDetecting(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const data = await api('/persona-gender', {
        method: 'POST',
        username,
        body: { name: nextName },
        signal: controller.signal,
      });
      if (genderLockedRef.current || genderInferInflightRef.current !== nextName) return null;
      const guessed = data.personaGender || 'neutral';
      setPersonaGender(guessed);
      setWelcomeMessage((prev) => applyGreekPersonaGrammar(prev, nextName, guessed));
      setSuggestions((prev) =>
        (Array.isArray(prev) ? prev : []).map((q) =>
          applyGreekPersonaGrammar(q, nextName, guessed)
        )
      );
      formStateRef.current = {
        ...(formStateRef.current || formState),
        personaGender: guessed,
        welcomeMessage: applyGreekPersonaGrammar(
          formStateRef.current?.welcomeMessage || welcomeMessage,
          nextName,
          guessed
        ),
        suggestions: (formStateRef.current?.suggestions || suggestions).map((q) =>
          applyGreekPersonaGrammar(q, nextName, guessed)
        ),
      };
      return guessed;
    } catch {
      if (inferredForNameRef.current === nextName) {
        inferredForNameRef.current = '';
        writeInferredGenderName('');
      }
      return null;
    } finally {
      window.clearTimeout(timeout);
      if (genderInferInflightRef.current === nextName) {
        genderInferInflightRef.current = null;
      }
      setGenderDetecting(false);
    }
  };

  // After Look → Voice: gender detect + welcome typewriter run together.
  useEffect(() => {
    if (step !== 'voice' || !pendingVoiceSetupRef.current) return undefined;
    pendingVoiceSetupRef.current = false;
    let cancelled = false;
    void (async () => {
      const voiceName = wizardName();
      setVoiceSetupPending(false);
      voiceAnimatedForNameRef.current = null;

      const needsGender =
        !genderLockedRef.current &&
        voiceName &&
        !isDefaultBotName(voiceName) &&
        inferredForNameRef.current !== voiceName;

      // Kick off both at once — typewriter follows gender text updates via fullRef.
      const genderPromise = needsGender
        ? runGenderInferIfNeeded(voiceName)
        : Promise.resolve(null);
      armVoiceAnimation();
      await genderPromise;
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arm once when entering voice after Look
  }, [step]);

  const armSuggestionsAnimation = () => {
    const currentName = wizardName();
    if (suggestionsAnimatedForNameRef.current === currentName && currentName) {
      setSuggestionsAnimKey(0);
      setSuggestionsLocked(false);
      return;
    }
    setSuggestionsAnimKey(Date.now());
    setSuggestionsLocked(true);
    window.setTimeout(() => setSuggestionsLocked(false), 20000);
  };

  const armKeyFactsAnimation = () => {
    const currentName = wizardName();
    if (keyFactsAnimatedForNameRef.current === currentName && currentName) {
      setKeyFactsAnimKey(0);
      setKeyFactsLocked(false);
      return;
    }
    setKeyFactsAnimKey(Date.now());
    setKeyFactsLocked(true);
    window.setTimeout(() => setKeyFactsLocked(false), 20000);
  };

  const goNext = async () => {
    if (
      busy ||
      building ||
      voiceFieldsLocked ||
      suggestionsLocked ||
      keyFactsLocked ||
      goNextLockRef.current ||
      (step === 'name' && (nameTaken || nameChecking || !name.trim())) ||
      (step === 'knowledge' &&
        (!hasKnowledgeContent(sources, linkRowsRef.current) || linksPendingSettle))
    ) {
      if (step === 'knowledge' && !hasKnowledgeContent(sources, linkRowsRef.current)) {
        setError(t('wizard.knowledgeRequired'));
      }
      if (step === 'name' && nameTaken) {
        setError('');
      }
      return;
    }
    goNextLockRef.current = true;
    setError('');
    try {
      if (step === 'name' && !name.trim()) {
        setError(t('wizard.nameRequired'));
        return;
      }
      if (step === 'name' && nameTaken) {
        return;
      }

      if (step === 'name') {
        const previousName = appliedNameRef.current;
        const nextName = name.trim();
        const nameChanged = previousName !== nextName;
        const fromNames = [previousName, bot?.name, DEFAULT_BOT_NAME];
        let nextGender = personaGender;

        if (!genderLockedRef.current) {
          if (isDefaultBotName(nextName)) {
            nextGender = 'neutral';
            inferredForNameRef.current = nextName;
            writeInferredGenderName(nextName);
          } else if (nameChanged || inferredForNameRef.current !== nextName) {
            // Clear so Look → Voice will run gender detect + typewriter for this name.
            inferredForNameRef.current = '';
            writeInferredGenderName('');
          }
        }

        const retargeted = personalizeUiCopy(
          {
            welcomeMessage: retargetBotName(welcomeMessage, fromNames, nextName),
            suggestedQuestions: suggestions.map((q) =>
              retargetBotName(q, fromNames, nextName)
            ),
          },
          nextName,
          nextGender
        );
        const nextWelcome = retargeted.welcomeMessage;
        const nextSuggestions = retargeted.suggestedQuestions;
        const nextPrompt = retargetBotName(systemPrompt, fromNames, nextName);

        // Name change invalidates prior typewriter plays so later steps animate once more.
        if (nameChanged) {
          voiceAnimatedForNameRef.current = null;
          suggestionsAnimatedForNameRef.current = null;
          keyFactsAnimatedForNameRef.current = null;
        }

        setWelcomeMessage(nextWelcome);
        setSystemPrompt(nextPrompt);
        setSuggestions(nextSuggestions);
        setPersonaGender(nextGender);
        appliedNameRef.current = nextName;
        formStateRef.current = {
          ...(formStateRef.current || formState),
          name: nextName,
          welcomeMessage: nextWelcome,
          systemPrompt: nextPrompt,
          suggestions: nextSuggestions,
          personaGender: nextGender,
        };
      }

      // Prepare Voice on entry: gender + typewriter together (see pendingVoiceSetup effect).
      if (step === 'look') {
        pendingVoiceSetupRef.current = true;
        voiceAnimatedForNameRef.current = null;
        setVoiceSetupPending(false);
        setCopyAnimKey(0);
        voiceAnimPendingRef.current = new Set(['welcome']);
        setVoiceFieldsLocked(true);
      }

      if (step === 'voice') {
        armSuggestionsAnimation();
      }

      if (step === 'suggestions') {
        const cleaned = pruneEmptySuggestions(suggestions);
        setSuggestions(cleaned);
        formStateRef.current = {
          ...(formStateRef.current || formState),
          suggestions: cleaned,
        };
      }

      // Persist typed links (like questions — already in the list) then arm trusted answers.
      if (step === 'knowledge') {
        if (!hasKnowledgeContent(sources, linkRowsRef.current)) {
          setError(t('wizard.knowledgeRequired'));
          return;
        }
        const filledLinks = linkRowsRef.current.filter((r) => String(r?.url || '').trim());
        const needsProbe =
          committingLinkIdsRef.current.size > 0 ||
          filledLinks.some((r) => !r.sourceId || !r.status);

        if (needsProbe) {
          setBusy(true);
          try {
            setFocusedLinkId(null);
            const waitStarted = Date.now();
            while (committingLinkIdsRef.current.size > 0 && Date.now() - waitStarted < 20000) {
              await sleep(60);
            }
            for (const row of linkRowsRef.current) {
              if (!String(row?.url || '').trim()) continue;
              if (row.sourceId && row.status) continue;
              await commitLinkRow(row.localId);
            }
            // Only sync orphans / brand-new rows — settled ✓/✕ must not re-POST.
            await flushLinks({ skipSettledProbe: true });
          } catch (err) {
            setError(err.message);
            setBusy(false);
            return;
          }
          setBusy(false);
        }

        const knowledgeCount =
          countKnowledgeSources(sourcesRef.current) ||
          linkRowsRef.current.filter((r) => r.sourceId).length ||
          fileSources.length;
        if (knowledgeCount < 1) {
          setError(t('wizard.knowledgeRequired'));
          return;
        }
        armKeyFactsAnimation();
      }

      if (['name', 'voice', 'suggestions', 'keyFacts', 'look', 'knowledge', 'citations'].includes(step)) {
        setBusy(true);
        try {
          await ensureBot();
        } catch (err) {
          if (err?.status === 409 || err?.data?.error === 'duplicate_name') {
            setNameTaken(true);
            setError('');
          } else {
            setError(err.message);
          }
          setBusy(false);
          return;
        }
        setBusy(false);
      }

      if (stepIndex < STEPS.length - 1) goTo(stepIndex + 1);
    } finally {
      goNextLockRef.current = false;
    }
  };

  const chooseGender = (value) => {
    if (voiceFieldsLocked) return;
    genderLockedRef.current = true;
    setGenderLocked(true);
    setPersonaGender(value);
    const botName = wizardName() || DEFAULT_BOT_NAME;
    setWelcomeMessage((prev) => applyGreekPersonaGrammar(prev, botName, value));
    setSuggestions((prev) =>
      (Array.isArray(prev) ? prev : []).map((q) => applyGreekPersonaGrammar(q, botName, value))
    );
    formStateRef.current = {
      ...(formStateRef.current || formState),
      personaGender: value,
      welcomeMessage: applyGreekPersonaGrammar(
        formStateRef.current?.welcomeMessage || welcomeMessage,
        botName,
        value
      ),
      suggestions: (formStateRef.current?.suggestions || suggestions).map((q) =>
        applyGreekPersonaGrammar(q, botName, value)
      ),
    };
  };

  const onVoiceFieldAnimComplete = (id) => {
    voiceAnimPendingRef.current.delete(id);
    if (voiceAnimPendingRef.current.size === 0) {
      voiceAnimatedForNameRef.current = wizardName();
      setVoiceFieldsLocked(false);
      setCopyAnimKey(0);
    }
  };

  const goBack = async () => {
    if (voiceFieldsLocked || suggestionsLocked || keyFactsLocked || busy || building)
      return;
    if (step === 'suggestions') {
      const cleaned = pruneEmptySuggestions(suggestions);
      setSuggestions(cleaned);
      formStateRef.current = {
        ...(formStateRef.current || formState),
        suggestions: cleaned,
      };
    }
    if (step === 'knowledge') {
      setBusy(true);
      try {
        await flushLinks();
      } catch (err) {
        setError(err.message);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    if (stepIndex > 0) {
      setBusy(true);
      try {
        await ensureBot();
        goTo(stepIndex - 1);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      // Leaving from the name step with no bot yet — don't create a leftover draft.
      const existingId = botIdRef.current || bot?.id || readWizardBotId();
      if (!existingId && stepIndex === 0) {
        clearWizardSession();
        navigate('/bots');
        return;
      }
      const saved = await ensureBot();
      if (trackAsSetupRef.current) {
        pauseSetupWizard(saved.id, stepIndex);
      } else {
        clearWizardSession();
      }
      navigate('/bots');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
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
        try {
          await api(`/bots/${b.id}/sources/upload`, {
            method: 'POST',
            username,
            formData: fd,
          });
        } catch (err) {
          if (err?.status === 409) continue;
          throw err;
        }
      }
      await refreshSources(b.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const focusLinkRow = (localId) => {
    requestAnimationFrame(() => {
      linkInputRefs.current[localId]?.focus();
    });
  };

  const setLinkRow = (localId, patch) => {
    setLinkRows((prev) => {
      const next = prev.map((row) => (row.localId === localId ? { ...row, ...patch } : row));
      linkRowsRef.current = next;
      return next;
    });
  };

  const upsertSourceLocal = (source) => {
    if (!source?.id) return;
    setSources((prev) => {
      const idx = prev.findIndex((s) => s.id === source.id);
      let next;
      if (idx < 0) next = [...prev, source];
      else {
        next = [...prev];
        next[idx] = { ...prev[idx], ...source };
      }
      sourcesRef.current = next;
      return next;
    });
  };

  /** Probe + attach URL as soon as the row settles so ✓/✕ appear on the knowledge step. */
  const commitLinkRow = async (localId) => {
    if (committingLinkIdsRef.current.has(localId)) return;
    const row = linkRowsRef.current.find((r) => r.localId === localId);
    if (!row || leavingLinkIdsRef.current.has(localId)) return;
    const normalized = ensureHttpsUrl(row.url);
    if (!normalized) return;
    linksHydratedRef.current = true;
    if (normalized !== String(row.url || '').trim()) {
      setLinkRow(localId, { url: normalized });
    }

    const scrapeMode = row.onlyPage ? 'page' : 'site';
    const rowMode = row.onlyPage ? 'page' : 'site';
    const linked = row.sourceId
      ? sourcesRef.current.find((s) => s.id === row.sourceId)
      : null;
    const linkedMatches =
      Boolean(linked) &&
      String(linked.uri || '').trim() === normalized &&
      (linked.scrapeMode === 'site' ? 'site' : 'page') === scrapeMode &&
      Boolean(linked.status);
    // Row already showed ✓/✕ after blur — never delete/re-POST (that re-counts pages).
    if (
      row.sourceId &&
      row.status &&
      ensureHttpsUrl(row.url) === normalized &&
      rowMode === scrapeMode
    ) {
      setLinkRow(localId, {
        sourceId: row.sourceId,
        url: normalized,
        status: linked?.status || row.status,
        pageCount: Number(linked?.pageCount) || Number(row.pageCount) || 0,
      });
      return;
    }
    // Only probe again when we never got a status — not when pageCount is legitimately 0.
    const needsPageRecount =
      scrapeMode === 'site' &&
      linkedMatches &&
      !Number(linked.pageCount) &&
      !Number(row.pageCount) &&
      !linked.status &&
      !row.status;

    if (linkedMatches && !needsPageRecount) {
      // Already attached — keep local row in sync so ✓/pages stay visible.
      setLinkRow(localId, {
        sourceId: linked.id,
        url: normalized,
        status: linked.status,
        pageCount: Number(linked.pageCount) || 0,
      });
      return;
    }

    committingLinkIdsRef.current.add(localId);
    setCommittingLinkIds(new Set(committingLinkIdsRef.current));
    setError('');
    try {
      const b = await ensureBot();
      let source = null;

      const postUrl = async () => {
        try {
          const data = await api(`/bots/${b.id}/sources/url`, {
            method: 'POST',
            username,
            body: { url: normalized, scrapeMode },
          });
          return data?.source || null;
        } catch (err) {
          if (err?.status === 409) {
            if (err?.data?.source) return err.data.source;
            const data = await api(`/bots/${b.id}`, { username });
            setBot(data.bot);
            botIdRef.current = data.bot?.id || null;
            setSources(data.sources || []);
            return (
              (data.sources || []).find(
                (s) => s.type === 'url' && String(s.uri || '').trim() === normalized
              ) || null
            );
          }
          throw err;
        }
      };

      if (!linked || needsPageRecount) {
        if (linked && needsPageRecount) {
          await api(`/bots/${b.id}/sources/${linked.id}`, { method: 'DELETE', username });
          setSources((prev) => prev.filter((s) => s.id !== linked.id));
        }
        source = await postUrl();
      } else if (String(linked.uri || '').trim() !== normalized) {
        await api(`/bots/${b.id}/sources/${linked.id}`, { method: 'DELETE', username });
        setSources((prev) => prev.filter((s) => s.id !== linked.id));
        source = await postUrl();
      } else {
        try {
          const data = await api(`/bots/${b.id}/sources/${linked.id}`, {
            method: 'PATCH',
            username,
            body: { scrapeMode },
          });
          source = data?.source || null;
        } catch (err) {
          if (err?.status !== 409) throw err;
          source = err?.data?.source || linked;
        }
      }

      if (source) {
        upsertSourceLocal(source);
        setLinkRows((prev) => {
          const next = [];
          let placed = false;
          for (const r of prev) {
            const sameUrl =
              r.localId !== localId &&
              ensureHttpsUrl(r.url) &&
              ensureHttpsUrl(r.url) === normalized;
            if (sameUrl) continue; // drop duplicate drafts of the same URL
            if (r.localId === localId) {
              next.push({
                ...r,
                sourceId: source.id,
                url: normalized,
                status: source.status || 'pending',
                pageCount: Number(source.pageCount) || 0,
              });
              placed = true;
            } else {
              next.push(r);
            }
          }
          if (!placed) {
            next.push(
              createLinkRow({
                localId,
                sourceId: source.id,
                url: normalized,
                onlyPage: scrapeMode === 'page',
                status: source.status || 'pending',
                pageCount: Number(source.pageCount) || 0,
              })
            );
          }
          linkRowsRef.current = next;
          return next;
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      committingLinkIdsRef.current.delete(localId);
      setCommittingLinkIds(new Set(committingLinkIdsRef.current));
    }
  };

  const markLinkEntering = (id) => {
    setEnteringLinkIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const clearLinkEntering = (id) => {
    setEnteringLinkIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const addLinkRow = (onlyPage) => {
    linksHydratedRef.current = true;
    setLinkRows((prev) => {
      const emptySame = [...prev]
        .reverse()
        .find((row) => !String(row.url || '').trim() && Boolean(row.onlyPage) === Boolean(onlyPage));
      if (emptySame) {
        focusLinkRow(emptySame.localId);
        return prev;
      }
      const row = createLinkRow({ onlyPage: Boolean(onlyPage) });
      markLinkEntering(row.localId);
      focusLinkRow(row.localId);
      return [...prev, row];
    });
  };

  const insertLinkRowAfter = (index) => {
    const current = linkRowsRef.current[index];
    const row = createLinkRow({ onlyPage: Boolean(current?.onlyPage) });
    markLinkEntering(row.localId);
    setLinkRows((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, row);
      return next;
    });
    focusLinkRow(row.localId);
  };

  const flushLinks = async ({ skipSettledProbe = false } = {}) => {
    const filled = linkRowsRef.current
      .map((row) => ({ ...row, url: ensureHttpsUrl(row.url) }))
      .filter((row) => row.url);
    const b = await ensureBot();
    const existing = (await api(`/bots/${b.id}`, { username })).sources || [];
    const existingUrls = existing.filter((s) => s.type === 'url');
    const keepIds = new Set(filled.map((row) => row.sourceId).filter(Boolean));

    for (const src of existingUrls) {
      if (!keepIds.has(src.id)) {
        await api(`/bots/${b.id}/sources/${src.id}`, { method: 'DELETE', username });
      }
    }

    for (const row of filled) {
      const scrapeMode = row.onlyPage ? 'page' : 'site';
      // Already probed on blur (✓/✕) — never POST/DELETE (page count is the slow part).
      if (skipSettledProbe && row.sourceId && row.status) continue;

      const postUrl = async () => {
        try {
          await api(`/bots/${b.id}/sources/url`, {
            method: 'POST',
            username,
            body: { url: row.url, scrapeMode },
          });
        } catch (err) {
          // Already attached (page/site/host clash) — treat as success and resync.
          if (err?.status === 409) return;
          throw err;
        }
      };
      if (!row.sourceId) {
        await postUrl();
        continue;
      }
      const src = existingUrls.find((s) => s.id === row.sourceId);
      if (!src) {
        await postUrl();
        continue;
      }
      const prevUri = ensureHttpsUrl(src.uri) || String(src.uri || '').trim();
      const prevMode = src.scrapeMode === 'site' ? 'site' : 'page';
      if (prevUri !== row.url) {
        await api(`/bots/${b.id}/sources/${src.id}`, { method: 'DELETE', username });
        await postUrl();
      } else if (prevMode !== scrapeMode) {
        try {
          await api(`/bots/${b.id}/sources/${src.id}`, {
            method: 'PATCH',
            username,
            body: { scrapeMode },
          });
        } catch (err) {
          if (err?.status !== 409) throw err;
        }
      }
    }

    // Avoid a second full fetch when we only skipped settled rows and changed nothing.
    if (skipSettledProbe) {
      const touched =
        filled.some((row) => !row.sourceId || !row.status) ||
        existingUrls.some((src) => !keepIds.has(src.id));
      if (!touched) return;
    }

    await refreshSources(b.id);
    const data = await api(`/bots/${b.id}`, { username });
    const nextUrls = (data.sources || []).filter((s) => s.type === 'url');
    setLinkRows(linkRowsFromSources(nextUrls));
    linksHydratedRef.current = true;
  };

  const commitRemoveLinkRow = async (localId) => {
    const row = linkRowsRef.current.find((r) => r.localId === localId);
    setLeavingLinkIds((prev) => {
      if (!prev.has(localId)) return prev;
      const next = new Set(prev);
      next.delete(localId);
      return next;
    });
    setLinkRows((prev) => prev.filter((r) => r.localId !== localId));
    if (!row?.sourceId) return;
    setError('');
    try {
      const b = bot || (await ensureBot());
      await api(`/bots/${b.id}/sources/${row.sourceId}`, { method: 'DELETE', username });
      setSources((prev) => prev.filter((s) => s.id !== row.sourceId));
    } catch (err) {
      setError(err.message);
    }
  };

  const removeLinkRow = (localId) => {
    if (leavingLinkIds.has(localId)) return;
    setLeavingLinkIds((prev) => {
      const next = new Set(prev);
      next.add(localId);
      return next;
    });
  };

  const removeSource = async (sourceId) => {
    const source = sources.find((s) => s.id === sourceId);
    const label =
      (source && (fileSourceDisplayName(source) || source.label || source.uri)) ||
      t('editor.thisSource');
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
    const b = bot || (await ensureBot());
    if (!b?.id) return;
    setError('');
    try {
      await api(`/bots/${b.id}/sources/${sourceId}`, { method: 'DELETE', username });
      await refreshSources(b.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const openFilePreview = async (source) => {
    if (!source?.id || previewLoadingId) return;
    setError('');
    setPreviewLoadingId(source.id);
    setPreview({ source, kind: 'loading' });
    try {
      const next = await buildSourcePreview(source);
      setPreview(next);
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const renderFileSourceItem = (s) => (
    <li key={s.id} className="wizard-source-item">
      <div className="wizard-source-item-main">
        <FileTypeIcon source={s} />
        <strong>{fileSourceDisplayName(s) || s.label || s.uri}</strong>
      </div>
      <div className="wizard-source-item-actions">
        <button
          type="button"
          className="icon-btn"
          title={t('common.view')}
          aria-label={t('common.view')}
          disabled={busy || previewLoadingId === s.id}
          onClick={() => openFilePreview(s)}
        >
          <EyeIcon />
        </button>
        <button
          type="button"
          className="icon-btn danger"
          title={t('list.remove')}
          disabled={busy}
          onClick={() => removeSource(s.id)}
        >
          ×
        </button>
      </div>
    </li>
  );

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

  const spawnDriftText = (forcedLine) => {
    if (forcedLine) {
      const cleaned = String(forcedLine)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 96);
      if (cleaned.length >= 12) {
        const prev = driftPoolRef.current || [];
        // Newest source lines first — floaters prefer these.
        driftPoolRef.current = [cleaned, ...prev.filter((l) => l !== cleaned)].slice(0, 80);
      }
    }
    let pool = driftPoolRef.current;
    if (!pool.length) {
      pool = wizardContentChunks(keyFacts, welcomeMessage, systemPrompt);
      driftPoolRef.current = pool;
    }
    if (!pool.length) return;

    let line = forcedLine
      ? String(forcedLine).replace(/\s+/g, ' ').trim().slice(0, 96)
      : pickLatestFloaterLine(pool, lastDriftSrcRef.current);
    if (!line || line.length < 8) {
      line = pickLatestFloaterLine(pool, lastDriftSrcRef.current);
    }
    if (!line) return;
    lastDriftSrcRef.current = line;
    driftSeqRef.current += 1;
    const id = driftSeqRef.current;

    const band = driftBandRef.current;
    driftBandRef.current += 1;
    const pos = scatterFloaterPosition(band, driftPositionsRef.current);
    const motion = makeFloaterMotion(pos);
    const item = {
      id,
      text: line,
      left: pos.left,
      top: pos.top,
      ...motion,
    };

    setDriftTexts((prev) => {
      // Wait for an old floater to fade out — never snap-remove text for a new one.
      if (prev.length >= MAX_DRIFT_ON_SCREEN) return prev;
      const next = [...prev, item];
      driftPositionsRef.current = next.map((d) => ({ left: d.left, top: d.top }));
      const fadeMs = motion.life + 120 + Math.floor(Math.random() * 400);
      window.setTimeout(() => {
        setDriftTexts((p) => {
          const filtered = p.filter((d) => d.id !== id);
          driftPositionsRef.current = filtered.map((d) => ({ left: d.left, top: d.top }));
          return filtered;
        });
      }, fadeMs);
      return next;
    });
  };
  spawnDriftTextRef.current = spawnDriftText;

  const pushFakeBuildMessage = (rawMessage, botLabel) => {
    lastBuildMsgRef.current = rawMessage;
    const text = formatWizardBuildMessage(rawMessage, botLabel, t, personaGender);
    spawnDriftText();
    setBuildLog((prev) => {
      buildLogSeqRef.current += 1;
      return pushBuildLogEntry(prev, {
        id: buildLogSeqRef.current,
        text,
        status: 'active',
      });
    });
  };

  const setBuildProgressSmooth = (value) => {
    const next = Math.max(0, Math.min(100, Number(value) || 0));
    buildTargetRef.current = Math.max(buildTargetRef.current, next);
    setBuildProgress(buildTargetRef.current);
  };

  const revealDoneStep = () => {
    setBuilding(false);
    setDriftTexts([]);
    lastDriftSrcRef.current = '';
    setDoneReveal(false);
    const doneIdx = STEPS.indexOf('done');
    if (doneIdx >= 0) {
      setError('');
      setStepIndex(doneIdx);
      setAnimKey((k) => k + 1);
    }
    // Title first (smooth), then CTA, while immersive eases back to light.
    window.clearTimeout(immersiveTimerRef.current);
    immersiveTimerRef.current = window.setTimeout(() => {
      setDoneReveal(true);
      immersiveTimerRef.current = window.setTimeout(() => {
        beginImmersiveExit();
      }, 420);
    }, 180);
  };

  const finishBuildSuccess = async (runId) => {
    if (buildRunRef.current && buildRunRef.current !== runId) return;

    setBuildLog((prev) =>
      prev.map((item) => (item.status === 'active' ? { ...item, status: 'done' } : item))
    );
    setBuildProgressSmooth(96);

    const started = buildStartedAtRef.current || Date.now();
    const elapsed = Date.now() - started;
    const wait = Math.max(900, BUILD_MIN_VISIBLE_MS - elapsed);
    await sleep(wait);

    if (buildRunRef.current && buildRunRef.current !== runId) return;

    setBuildProgressSmooth(100);
    await sleep(280);
    if (buildRunRef.current && buildRunRef.current !== runId) return;

    buildRunRef.current = 0;
    revealDoneStep();
  };

  const runFakeBuild = async (runId) => {
    const stillRunning = () => buildRunRef.current === runId;
    const botLabel = String(name.trim() || appliedNameRef.current || 'DialogosAI');
    const files = Array.isArray(fileSources) ? fileSources : [];
    const urls = Array.isArray(urlSources) ? urlSources : [];
    const sharedChunks = wizardContentChunks(keyFacts, welcomeMessage, systemPrompt);
    const contentByKey = new Map();

    await Promise.all(
      files.map(async (s) => {
        const key = String(s.id || s.label || s.uri || '');
        if (!key) return;
        try {
          const preview = await buildSourcePreview(s);
          if (preview?.kind === 'text' && preview.text) {
            contentByKey.set(key, splitIntoChunkLines(preview.text));
          }
        } catch {
          /* ignore — fall back to shared wizard content */
        }
      })
    );

    const poolFor = (src) => {
      const key = String(src.sourceId || src.id || src.label || '');
      const own = (key && contentByKey.get(key)) || [];
      const merged = [...own, ...sharedChunks].filter(Boolean);
      return merged.length ? merged : sharedChunks;
    };

    const previewSources = [
      ...files.map((s) => ({
        kind: 'file',
        id: s.id,
        sourceId: s.id,
        label: String(s.label || s.uri || 'file').trim() || 'file',
      })),
      ...urls.map((s) => ({
        kind: 'url',
        id: s.id,
        sourceId: s.id,
        site: s.scrapeMode === 'site' || s.scrape_mode === 'site',
        label: String(s.uri || s.label || 'link').trim() || 'link',
      })),
    ];
    const list =
      previewSources.length > 0
        ? previewSources.slice(0, 6)
        : [
            { kind: 'file', label: 'notes.pdf' },
            { kind: 'url', site: true, label: 'https://example.com' },
          ];

    driftPoolRef.current = sharedChunks.length ? sharedChunks : [];

    try {
      pushFakeBuildMessage('Starting build…', botLabel);
      setBuildProgressSmooth(4);
      await sleep(400);

      const ambientWhile = async (ms) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (!stillRunning()) return;
          const slice = Math.min(700 + Math.random() * 650, end - Date.now());
          if (slice <= 0) break;
          await sleep(slice);
          if (!stillRunning()) return;
          if (Math.random() < 0.48) spawnDriftText();
        }
      };

      const total = list.length;
      for (let i = 0; i < total; i += 1) {
        if (!stillRunning()) return;
        const src = list[i];
        const sliceStart = (i / total) * 92;
        const sliceEnd = ((i + 1) / total) * 92;
        const sourceBudget = randBetween(3000, 5000);
        const nextPool = poolFor(src);
        if (nextPool.length) driftPoolRef.current = nextPool;

        pushFakeBuildMessage(`Indexing: ${src.label}`, botLabel);
        setBuildProgressSmooth(sliceStart + (sliceEnd - sliceStart) * 0.12);
        await ambientWhile(sourceBudget * 0.14);

        if (src.kind === 'url' && src.site) {
          const pages = 6 + Math.floor(Math.random() * 3);
          const pageBudget = (sourceBudget * 0.72) / pages;
          for (let p = 1; p <= pages; p += 1) {
            if (!stillRunning()) return;
            const pageLabel = fakeSitePageLabel(src.label, p - 1);
            const crawlMsg =
              p < pages
                ? `Crawling (${p}/${pages}): ${pageLabel}`
                : `Embedded ${pageLabel} (${p}/${pages})`;
            pushFakeBuildMessage(crawlMsg, botLabel);
            setBuildProgressSmooth(
              sliceStart + (sliceEnd - sliceStart) * (0.14 + 0.72 * (p / pages))
            );
            await ambientWhile(pageBudget);
          }
        } else {
          const embedMsg = `Embedded ${shortenBuildLabel(src.label)} (1/1)`;
          pushFakeBuildMessage(embedMsg, botLabel);
          setBuildProgressSmooth(sliceStart + (sliceEnd - sliceStart) * 0.72);
          await ambientWhile(sourceBudget * 0.62);
        }

        pushFakeBuildMessage(`Indexed: ${src.label}`, botLabel);
        setBuildProgressSmooth(sliceEnd);
        await ambientWhile(sourceBudget * 0.14);
      }

      if (!stillRunning()) return;
      pushFakeBuildMessage(`Ready — ${12 + list.length * 4} chunks`, botLabel);
      await finishBuildSuccess(runId);
    } finally {
      // Success path clears buildRunRef inside finishBuildSuccess. Only unlock here on abort.
      if (buildRunRef.current === runId) {
        buildRunRef.current = 0;
        setBuilding(false);
      }
    }
  };

  const enableBuildImmersive = () => {
    window.clearTimeout(immersiveTimerRef.current);
    setWizardBuildImmersive(true);
    setWizardBuildImmersiveExit(false);
    setImmersiveUi(true);
    setImmersiveExit(false);
    setDoneReveal(false);
    setDriftTexts([]);
    lastDriftSrcRef.current = '';
    driftPositionsRef.current = [];
    driftBandRef.current = Math.floor(Math.random() * 4);
  };

  const clearBuildImmersiveNow = () => {
    window.clearTimeout(immersiveTimerRef.current);
    setWizardBuildImmersive(false);
    setWizardBuildImmersiveExit(false);
    setImmersiveUi(false);
    setImmersiveExit(false);
    setDriftTexts([]);
    lastDriftSrcRef.current = '';
    driftPositionsRef.current = [];
  };

  /** Soft exit: keep contrast readable while bg + text ease back with the light gradient. */
  const beginImmersiveExit = () => {
    window.clearTimeout(immersiveTimerRef.current);
    setDriftTexts([]);
    lastDriftSrcRef.current = '';
    setImmersiveExit(true);
    setWizardBuildImmersiveExit(true);
    immersiveTimerRef.current = window.setTimeout(() => {
      clearBuildImmersiveNow();
    }, IMMERSIVE_EXIT_MS);
  };

  const clearBuildImmersive = (delayMs = 0) => {
    window.clearTimeout(immersiveTimerRef.current);
    if (!delayMs) {
      clearBuildImmersiveNow();
      return;
    }
    beginImmersiveExit();
    // beginImmersiveExit already schedules full clear; shorten if caller asked for less.
    if (delayMs < IMMERSIVE_EXIT_MS) {
      window.clearTimeout(immersiveTimerRef.current);
      immersiveTimerRef.current = window.setTimeout(() => {
        clearBuildImmersiveNow();
      }, delayMs);
    }
  };

  // Poll effect is declared above — always call the latest handoff helpers.
  buildHandoffRef.current = { finishBuildSuccess, clearBuildImmersive };

  const startBuild = () => {
    if (buildRunRef.current) return;
    if (countKnowledgeSources(sources) < 1) {
      setError(t('wizard.knowledgeRequired'));
      return;
    }

    setError('');
    setBuildFailed(false);
    setBusy(false);
    setBuildLog([]);
    setBuildProgress(0);
    buildTargetRef.current = 0;
    lastBuildMsgRef.current = '';
    lastDriftSnippetRef.current = '';
    buildLogSeqRef.current = 0;
    setJob(null);
    setDriftTexts([]);
    lastDriftSrcRef.current = '';
    driftPoolRef.current = wizardContentChunks(keyFacts, welcomeMessage, systemPrompt);
    const runId = Date.now();
    buildRunRef.current = runId;
    buildStartedAtRef.current = Date.now();
    enableBuildImmersive();
    setBuilding(true);

    if (WIZARD_FAKE_BUILD) {
      const safety = window.setTimeout(() => {
        if (buildRunRef.current !== runId) return;
        buildRunRef.current = 0;
        setBuilding(false);
        setBuildFailed(true);
        setError('Build preview timed out — try again.');
        clearBuildImmersive(500);
      }, 60000);
      void runFakeBuild(runId)
        .catch((err) => {
          setError(err?.message || 'Preview build failed');
          setBuilding(false);
          setBuildFailed(true);
          if (buildRunRef.current === runId) buildRunRef.current = 0;
          clearBuildImmersive(500);
        })
        .finally(() => window.clearTimeout(safety));
      return;
    }

    void (async () => {
      setBusy(true);
      try {
        const b = await ensureBot();
        const latest = await api(`/bots/${b.id}`, { username });
        setSources(latest.sources || []);
        if (countKnowledgeSources(latest.sources) < 1) {
          throw new Error(t('wizard.knowledgeRequired'));
        }
        const label = String(name.trim() || appliedNameRef.current || 'DialogosAI');
        buildLogSeqRef.current += 1;
        setBuildLog([
          {
            id: buildLogSeqRef.current,
            text: t('wizard.buildLogStarting', { name: label }),
            status: 'active',
          },
        ]);
        lastBuildMsgRef.current = 'Starting build…';
        // Full rebuild on create — adaptive can finish in ms if a prior attempt already indexed.
        const data = await api(`/bots/${b.id}/build`, {
          method: 'POST',
          username,
          body: { mode: 'full' },
        });
        setJob(data.job);
      } catch (err) {
        setError(err.message);
        setBuilding(false);
        setBuildFailed(true);
        buildRunRef.current = 0;
        clearBuildImmersive(500);
      } finally {
        setBusy(false);
      }
    })();
  };

  const finishToTest = async () => {
    setBusy(true);
    try {
      const b = await ensureBot();
      trackAsSetupRef.current = false;
      completeSetupBot();
      navigate(`/bots/${b.id}/test`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const stepTitle = {
    name: t('wizard.nameTitle'),
    look: t('wizard.lookTitle'),
    voice: t('wizard.voiceTitle'),
    suggestions: t('wizard.suggestionsTitle'),
    keyFacts: t('wizard.keyFactsTitle'),
    knowledge: t('wizard.knowledgeTitle'),
    citations: t('wizard.citationsTitle'),
    build: t('wizard.buildTitle', greekBuildNameVars(name.trim() || 'DialogosAI', personaGender)),
  }[step];

  const stepHint = {
    name: t('wizard.nameHint'),
    look: t('wizard.lookHint'),
    voice: t('wizard.voiceHint'),
    suggestions: t('wizard.suggestionsHint'),
    keyFacts: t('wizard.keyFactsHint'),
    knowledge: t('wizard.knowledgeHint'),
    citations: t('wizard.citationsHint'),
    build: t('wizard.buildHint'),
  }[step];

  const showFooter = step !== 'done' && !(step === 'build' && building);
  const showFooterNext = step !== 'build' && step !== 'done';
  const doneName = name.trim() || 'DialogosAI';
  const buildNameVars = greekBuildNameVars(doneName, personaGender);
  const buildPct = Math.max(0, Math.min(100, Number(buildProgress) || 0));

  const footerLocked =
    busy || building || voiceFieldsLocked || suggestionsLocked || keyFactsLocked;
  // Knowledge: Next only after links settle (blur + ✓/✕), not while typing.
  const nextDisabled =
    footerLocked ||
    (step === 'name' && (nameTaken || nameChecking || !name.trim())) ||
    (step === 'knowledge' && (!knowledgeReady || linksPendingSettle));
  const backDisabled = footerLocked;
  return (
    <div
      className={`wizard-page${building || immersiveUi ? ' is-build-immersive' : ''}${
        immersiveExit ? ' is-build-immersive-exit' : ''
      }`}
    >
      {typeof document !== 'undefined' &&
        immersiveUi &&
        createPortal(
          <>
            <div
              className={`wizard-build-atmosphere is-on${immersiveExit ? ' is-exiting' : ''}`}
              aria-hidden="true"
            />
            {!immersiveExit ? (
              <div className="wizard-build-floaters" aria-hidden="true">
                {driftTexts.map((d) => (
                  <span
                    key={d.id}
                    className="wizard-build-floater"
                    style={{
                      left: `${d.left}%`,
                      top: `${d.top}%`,
                      '--df-dx': `${d.dx}px`,
                      '--df-dy': `${d.dy}px`,
                      '--df-dur': `${d.dur}s`,
                    }}
                  >
                    <span
                      className="wizard-build-floater-inner"
                      style={{
                        '--df-rot': `${d.rot}deg`,
                        '--df-spin-end': `${d.spinEnd}deg`,
                        '--df-size': d.size,
                      }}
                    >
                      {d.text}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </>,
          document.body
        )}
      <div className="wizard-shell">
        {step !== 'done' && !(step === 'build' && building) && (
          <div className="wizard-progress" aria-hidden="true">
            {STEPS.slice(0, -1).map((id, i) => (
              <span
                key={id}
                className={`wizard-dot${i === stepIndex ? ' is-active' : ''}${
                  i < stepIndex ? ' is-done' : ''
                }`}
              />
            ))}
          </div>
        )}

        {step !== 'done' && !(step === 'build' && building) && (
          <p
            key={`meta-${stepIndex}`}
            className={`wizard-step-meta muted${stepDir < 0 ? ' is-back' : ''}`}
          >
            {t('wizard.stepOf', { current: displayStep, total: totalSteps })}
          </p>
        )}

        <div
          key={animKey}
          className={`wizard-step${stepDir < 0 ? ' is-back' : ' is-forward'}${
            step === 'build' && building ? ' is-build-live' : ''
          }`}
        >
          {step === 'done' ? (
            <div className={`wizard-done${doneReveal ? ' is-reveal' : ''}`}>
              {error && (
                <div className="login-error" role="alert">
                  {error}
                </div>
              )}
              <h2 className="wizard-title wizard-done-title">
                {t('wizard.doneTitle', buildNameVars)}
              </h2>
              <button
                type="button"
                className="btn btn-accent wizard-done-btn"
                onClick={finishToTest}
                disabled={!doneReveal || busy}
                aria-label={t('wizard.doneOpen')}
              >
                {t('wizard.doneOpen')}
              </button>
            </div>
          ) : step === 'build' ? (
            <div className={`wizard-build${building ? ' is-building' : ''}`}>
              {error && (
                <div className="login-error" role="alert">
                  {error}
                </div>
              )}
              {building ? (
                <>
                  <h2 className="wizard-title wizard-build-live-title">
                    <span className="wizard-build-live-label">
                      {t('wizard.buildLiveTitle', buildNameVars)}
                    </span>
                    <span className="wizard-build-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </h2>
                  <div
                    className="wizard-build-meter"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(buildPct)}
                    aria-label={t('wizard.buildLiveTitle', buildNameVars)}
                  >
                    <div className="wizard-build-meter-fill" style={{ width: `${buildPct}%` }}>
                      <span className="wizard-build-meter-sheen" aria-hidden="true" />
                    </div>
                  </div>
                  <ul className="wizard-build-log" aria-live="polite">
                    {buildLog.map((item) => (
                      <li
                        key={item.id}
                        className={`wizard-build-log-item is-${item.status}`}
                      >
                        <span className="wizard-build-log-mark" aria-hidden="true">
                          <span className="wizard-build-log-mark-core" />
                          <span className="wizard-build-log-mark-ring" />
                        </span>
                        <span className="wizard-build-log-text">
                          <span className="wizard-build-log-copy">{item.text}</span>
                          {item.status === 'active' && (
                            <span className="wizard-build-inline-dots" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <h2 className="wizard-title wizard-build-ready-title">{stepTitle}</h2>
                  <button
                    type="button"
                    className="btn btn-accent wizard-build-btn wizard-build-btn--hero"
                    disabled={building}
                    onClick={startBuild}
                  >
                    {buildFailed ? t('wizard.buildRetry') : t('wizard.buildAction')}
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <h2 className="wizard-title">{stepTitle}</h2>
              {stepHint ? <p className="wizard-hint muted">{stepHint}</p> : null}

              {error && step !== 'name' && (
                <div className="login-error" role="alert">
                  {error}
                </div>
              )}
            </>
          )}

          {step === 'name' && (
            <div className="wizard-fields">
              <div className="field">
                <label>{t('editor.botName')}</label>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTaken(false);
                  }}
                  placeholder={t('wizard.namePlaceholder')}
                  autoFocus
                  aria-invalid={nameTaken || undefined}
                  aria-describedby="wizard-name-hint"
                />
                <p
                  id="wizard-name-hint"
                  className={`wizard-name-hint${nameHintVisible ? ' is-visible' : ''}`}
                  role={nameTaken ? 'alert' : undefined}
                  aria-live="polite"
                  aria-hidden={!nameHintText || undefined}
                >
                  <span className="wizard-name-hint-text">
                    {nameHintText || '\u00a0'}
                  </span>
                </p>
              </div>
            </div>
          )}

          {step === 'look' && (
            <div className="wizard-fields wizard-look">
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
          )}

          {step === 'voice' && (
            <div className={`wizard-fields${voiceFieldsLocked ? ' is-anim-locked' : ''}`}>
              <div className="field">
                <label>{t('editor.gender')}</label>
                <GenderPicker
                  value={personaGender}
                  onChange={chooseGender}
                  loading={genderDetecting}
                  disabled={voiceFieldsLocked && !genderDetecting}
                  labels={{
                    group: t('editor.gender'),
                    he: t('wizard.genderHe'),
                    she: t('wizard.genderShe'),
                    it: t('wizard.genderIt'),
                    detecting: t('wizard.genderDetecting'),
                  }}
                />
              </div>
              <div className="field">
                <label>{t('editor.welcome')}</label>
                <TypewriterField
                  multiline
                  rows={2}
                  value={welcomeMessage}
                  animateKey={copyAnimKey}
                  locked={voiceFieldsLocked}
                  onComplete={() => onVoiceFieldAnimComplete('welcome')}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 'suggestions' && (
            <div className={`wizard-fields${suggestionsLocked ? ' is-anim-locked' : ''}`}>
              <div className="field">
                <label>{t('editor.suggestions')}</label>
                <OrderedListEditor
                  items={suggestions}
                  onChange={setSuggestions}
                  addLabel={t('editor.addQuestion')}
                  placeholder={t('editor.newQuestion')}
                  animateKey={suggestionsAnimKey}
                  locked={suggestionsLocked}
                  onAllComplete={() => {
                    suggestionsAnimatedForNameRef.current = wizardName();
                    setSuggestionsLocked(false);
                    setSuggestionsAnimKey(0);
                  }}
                />
              </div>
            </div>
          )}

          {step === 'knowledge' && (
            <div className="wizard-fields wizard-knowledge">
              <section className="wizard-knowledge-section">
                <h4 className="wizard-knowledge-heading">{t('wizard.filesSection')}</h4>
                <div
                  className={`files-block${fileSources.length === 0 ? ' files-block--solo' : ''}${
                    uploading ? ' is-busy' : ''
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
                      <p className="muted" style={{ margin: 0 }}>
                        {t('editor.uploading')}
                      </p>
                    ) : (
                      <p style={{ margin: 0 }}>
                        {t('editor.dropFiles')}{' '}
                        <label
                          style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
                        >
                          {t('editor.browse')}
                          <input
                            type="file"
                            accept=".pdf,.txt,.md,text/plain,application/pdf"
                            multiple
                            hidden
                            onChange={(e) => {
                              uploadFiles([...e.target.files]);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </p>
                    )}
                  </div>
                  {fileSources.length > 0 && (
                    <ul className="wizard-source-list wizard-source-list--attached">
                      {fileSources.map((s) => renderFileSourceItem(s))}
                    </ul>
                  )}
                </div>
              </section>

              <section className="wizard-knowledge-section">
                <h4 className="wizard-knowledge-heading">{t('wizard.linksSection')}</h4>
                <div className="wizard-link-list">
                  {linkRows.map((row, index) => {
                    const focused = focusedLinkId === row.localId;
                    const settled = Boolean(row.url.trim()) && !focused;
                    const entering = enteringLinkIds.has(row.localId);
                    const leaving = leavingLinkIds.has(row.localId);
                    const committing = committingLinkIds.has(row.localId);
                    const linkedSource = row.sourceId
                      ? sources.find((s) => s.id === row.sourceId)
                      : null;
                    const validityStatus = linkedSource?.status || row.status;
                    const pageCount =
                      Number(linkedSource?.pageCount) || Number(row.pageCount) || 0;
                    const invalid =
                      validityStatus === 'skipped' || validityStatus === 'error';
                    const showPageCount =
                      settled &&
                      !committing &&
                      validityStatus &&
                      !invalid &&
                      !row.onlyPage &&
                      pageCount > 0;
                    const pagesLabel = showPageCount
                      ? t(
                          pageCount === 1
                            ? 'editor.pagesFoundOne'
                            : 'editor.pagesFound',
                          { count: pageCount }
                        )
                      : null;
                    return (
                      <div
                        key={row.localId}
                        className={`wizard-link-row${
                          focused || !row.url.trim() ? ' is-editing' : ' has-value'
                        }${
                          settled
                            ? row.onlyPage
                              ? ' is-mode-page'
                              : ' is-mode-site'
                            : ''
                        }${entering ? ' is-entering' : ''}${leaving ? ' is-leaving' : ''}`}
                        onAnimationEnd={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (leavingLinkIds.has(row.localId)) {
                            void commitRemoveLinkRow(row.localId);
                            return;
                          }
                          clearLinkEntering(row.localId);
                        }}
                      >
                        {committing ? (
                          <span
                            className="source-validity-group"
                            title={
                              row.onlyPage
                                ? t('editor.checkingUrl')
                                : t('editor.findingPages')
                            }
                            aria-label={
                              row.onlyPage
                                ? t('editor.checkingUrl')
                                : t('editor.findingPages')
                            }
                          >
                            <span className="source-validity is-checking" aria-hidden="true">
                              <span className="spinner" />
                            </span>
                          </span>
                        ) : settled && validityStatus ? (
                          <span className="source-validity-group">
                            <span
                              className={`source-validity${
                                invalid ? ' is-invalid' : ' is-valid'
                              }`}
                              title={
                                invalid ? t('editor.urlInvalid') : t('editor.urlValid')
                              }
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
                            {showPageCount ? (
                              <span className="source-page-count">{pagesLabel}</span>
                            ) : null}
                          </span>
                        ) : null}
                        <input
                          ref={(el) => {
                            if (el) linkInputRefs.current[row.localId] = el;
                            else delete linkInputRefs.current[row.localId];
                          }}
                          className="wizard-link-input"
                          value={row.url}
                          onChange={(e) => setLinkRow(row.localId, { url: e.target.value })}
                          placeholder={
                            row.onlyPage
                              ? t('wizard.urlPlaceholderPage')
                              : t('wizard.urlPlaceholderSite')
                          }
                          disabled={busy || leaving || committing}
                          onFocus={() => setFocusedLinkId(row.localId)}
                          onBlur={() => {
                            setFocusedLinkId((id) => (id === row.localId ? null : id));
                            void commitLinkRow(row.localId).catch((err) => {
                              setError(err?.message || String(err));
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void (async () => {
                                try {
                                  await commitLinkRow(row.localId);
                                  insertLinkRowAfter(index);
                                } catch (err) {
                                  setError(err?.message || String(err));
                                }
                              })();
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
                          disabled={busy || leaving || committing}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => removeLinkRow(row.localId)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <div className="wizard-link-add-row">
                    <button
                      type="button"
                      className="btn btn-secondary ordered-list-add wizard-link-add-site"
                      disabled={busy}
                      onClick={() => addLinkRow(false)}
                    >
                      + {t('wizard.addWebsite')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary ordered-list-add wizard-link-add-page"
                      disabled={busy}
                      onClick={() => addLinkRow(true)}
                    >
                      + {t('wizard.addPage')}
                    </button>
                    <FieldLabelHelp help={t('wizard.linksModeHelp')} />
                  </div>
                </div>
              </section>
            </div>
          )}

          {step === 'keyFacts' && (
            <div className={`wizard-fields${keyFactsLocked ? ' is-anim-locked' : ''}`}>
              <div className="field">
                <label>
                  <FieldLabelHelp label={t('editor.keyFacts')} help={t('editor.keyFactsHelp')} />
                </label>
                <KeyFactsEditor
                  items={keyFacts}
                  onChange={setKeyFacts}
                  animateKey={keyFactsAnimKey}
                  locked={keyFactsLocked}
                  onAllComplete={() => {
                    keyFactsAnimatedForNameRef.current = wizardName();
                    setKeyFactsLocked(false);
                    setKeyFactsAnimKey(0);
                  }}
                />
              </div>
            </div>
          )}

          {step === 'citations' && (
            <div className="wizard-fields wizard-citations">
              <label className="url-fullsite-check source-citation-master">
                <input
                  type="checkbox"
                  checked={sourceCitations.showSources !== false}
                  onChange={(e) =>
                    setSourceCitations((prev) => ({ ...prev, showSources: e.target.checked }))
                  }
                />
                {t('editor.showSources')}
              </label>
              <div
                className={`source-citation-collapse${
                  sourceCitations.showSources !== false ? ' is-open' : ''
                }`}
              >
                <div className="source-citation-collapse-inner">
                  <div className="source-citation-filters">
                    <label className="url-fullsite-check">
                      <input
                        type="checkbox"
                        checked={typesHidden(sourceCitations.hideTypes, ['pdf', 'txt', 'text'])}
                        onChange={(e) =>
                          setSourceCitations((prev) => ({
                            ...prev,
                            hideTypes: toggleHiddenTypes(
                              prev.hideTypes,
                              ['pdf', 'txt', 'text'],
                              e.target.checked
                            ),
                          }))
                        }
                      />
                      {t('editor.hideFiles')}
                    </label>
                    <label className="url-fullsite-check">
                      <input
                        type="checkbox"
                        checked={typesHidden(sourceCitations.hideTypes, ['url'])}
                        onChange={(e) =>
                          setSourceCitations((prev) => ({
                            ...prev,
                            hideTypes: toggleHiddenTypes(prev.hideTypes, ['url'], e.target.checked),
                          }))
                        }
                      />
                      {t('editor.hideUrls')}
                    </label>
                    <label className="url-fullsite-check">
                      <input
                        type="checkbox"
                        checked={typesHidden(sourceCitations.hideTypes, ['key_facts'])}
                        onChange={(e) =>
                          setSourceCitations((prev) => ({
                            ...prev,
                            hideTypes: toggleHiddenTypes(
                              prev.hideTypes,
                              ['key_facts'],
                              e.target.checked
                            ),
                          }))
                        }
                      />
                      {t('editor.hideKeyFacts')}
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {showFooter && (
          <div className="wizard-footer">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={goBack}
              disabled={backDisabled}
              aria-disabled={backDisabled}
            >
              {t('wizard.back')}
            </button>
            <div className="wizard-footer-right">
              {showFooterNext && (
                <button
                  type="button"
                  className="btn btn-accent"
                  disabled={nextDisabled}
                  aria-disabled={nextDisabled}
                  onClick={goNext}
                >
                  {t('wizard.next')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <SourcePreviewModal preview={preview} onClose={() => setPreview(null)} />
      {dialog}
    </div>
  );
}
