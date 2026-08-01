const WIZARD_BOT_STORAGE_KEY = 'df_wizard_bot_id';
const WIZARD_STEP_STORAGE_KEY = 'df_wizard_step';
const SETUP_BOT_STORAGE_KEY = 'df_setup_bot_id';
const SETUP_STEP_STORAGE_KEY = 'df_setup_step';
const HAS_DASHBOARD_BOT_KEY = 'df_has_dashboard_bot';
const GENDER_LOCKED_KEY = 'df_gender_locked';
const GENDER_INFERRED_NAME_KEY = 'df_gender_inferred_name';
const OWNER_KEY = 'df_wizard_owner';

const LEGACY_LOCAL_KEYS = [
  SETUP_BOT_STORAGE_KEY,
  SETUP_STEP_STORAGE_KEY,
  HAS_DASHBOARD_BOT_KEY,
  GENDER_LOCKED_KEY,
  GENDER_INFERRED_NAME_KEY,
];

/** Survives React Strict Mode remount so /bots/new creates one bot per wizard visit. */
let wizardCreateInflight = null;
let activeUserKey = null;

function scoped(base) {
  if (!activeUserKey) return base;
  return `${base}:${activeUserKey}`;
}

function lsGet(base) {
  try {
    return localStorage.getItem(scoped(base));
  } catch {
    return null;
  }
}

function lsSet(base, value) {
  try {
    localStorage.setItem(scoped(base), value);
  } catch {
    /* ignore */
  }
}

function lsRemove(base) {
  try {
    localStorage.removeItem(scoped(base));
  } catch {
    /* ignore */
  }
}

function clearLegacyUnscopedKeys() {
  try {
    for (const key of LEGACY_LOCAL_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export function getWizardCreateInflight() {
  return wizardCreateInflight;
}

export function setWizardCreateInflight(promise) {
  wizardCreateInflight = promise;
}

export function clearWizardCreateInflight() {
  wizardCreateInflight = null;
}

export function clearWizardSession() {
  wizardCreateInflight = null;
  try {
    sessionStorage.removeItem(WIZARD_BOT_STORAGE_KEY);
    sessionStorage.removeItem(WIZARD_STEP_STORAGE_KEY);
    if (activeUserKey) {
      sessionStorage.removeItem(`${WIZARD_BOT_STORAGE_KEY}:${activeUserKey}`);
      sessionStorage.removeItem(`${WIZARD_STEP_STORAGE_KEY}:${activeUserKey}`);
    }
  } catch {
    /* ignore */
  }
}

function clearGenderSession() {
  lsRemove(GENDER_LOCKED_KEY);
  lsRemove(GENDER_INFERRED_NAME_KEY);
}

/**
 * Bind wizard local state to the signed-in user.
 * Prevents resuming another account's in-progress bot ("Not your bot").
 */
export function bindWizardUser(userKey) {
  const next = String(userKey || '').trim();
  let prev = '';
  try {
    prev = localStorage.getItem(OWNER_KEY) || '';
  } catch {
    prev = '';
  }

  if (!next) {
    clearWizardSession();
    wizardCreateInflight = null;
    activeUserKey = null;
    try {
      localStorage.removeItem(OWNER_KEY);
    } catch {
      /* ignore */
    }
    return;
  }

  if (prev && prev !== next) {
    clearWizardSession();
    wizardCreateInflight = null;
  }

  // Drop pre-scoping keys so they cannot leak across accounts on this browser.
  clearLegacyUnscopedKeys();

  activeUserKey = next;
  try {
    localStorage.setItem(OWNER_KEY, next);
  } catch {
    /* ignore */
  }
}

/** Drop in-progress setup pointers after a forbidden/stale bot id. */
export function abandonWizardBot() {
  clearWizardSession();
  wizardCreateInflight = null;
  lsRemove(SETUP_BOT_STORAGE_KEY);
  lsRemove(SETUP_STEP_STORAGE_KEY);
  clearGenderSession();
  botIdSessionClear();
}

function botIdSessionClear() {
  try {
    sessionStorage.removeItem(WIZARD_BOT_STORAGE_KEY);
    if (activeUserKey) {
      sessionStorage.removeItem(`${WIZARD_BOT_STORAGE_KEY}:${activeUserKey}`);
    }
  } catch {
    /* ignore */
  }
}

export function isGenderLocked() {
  return lsGet(GENDER_LOCKED_KEY) === '1';
}

export function setGenderLocked(locked) {
  if (locked) lsSet(GENDER_LOCKED_KEY, '1');
  else lsRemove(GENDER_LOCKED_KEY);
}

export function readInferredGenderName() {
  return lsGet(GENDER_INFERRED_NAME_KEY) || '';
}

export function writeInferredGenderName(name) {
  if (name) lsSet(GENDER_INFERRED_NAME_KEY, name);
  else lsRemove(GENDER_INFERRED_NAME_KEY);
}

export function readWizardBotId() {
  try {
    const sessionKey = activeUserKey
      ? `${WIZARD_BOT_STORAGE_KEY}:${activeUserKey}`
      : WIZARD_BOT_STORAGE_KEY;
    return sessionStorage.getItem(sessionKey) || lsGet(SETUP_BOT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeWizardBotId(id) {
  try {
    const sessionKey = activeUserKey
      ? `${WIZARD_BOT_STORAGE_KEY}:${activeUserKey}`
      : WIZARD_BOT_STORAGE_KEY;
    sessionStorage.setItem(sessionKey, id);
  } catch {
    /* ignore */
  }
}

export function readWizardStep() {
  try {
    const sessionKey = activeUserKey
      ? `${WIZARD_STEP_STORAGE_KEY}:${activeUserKey}`
      : WIZARD_STEP_STORAGE_KEY;
    const raw = sessionStorage.getItem(sessionKey) || lsGet(SETUP_STEP_STORAGE_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeWizardStep(stepIndex) {
  try {
    const sessionKey = activeUserKey
      ? `${WIZARD_STEP_STORAGE_KEY}:${activeUserKey}`
      : WIZARD_STEP_STORAGE_KEY;
    sessionStorage.setItem(sessionKey, String(stepIndex));
    if (lsGet(SETUP_BOT_STORAGE_KEY)) {
      lsSet(SETUP_STEP_STORAGE_KEY, String(stepIndex));
    }
  } catch {
    /* ignore */
  }
}

export function markSetupBot(id) {
  lsSet(SETUP_BOT_STORAGE_KEY, id);
}

export function getSetupBotId() {
  return lsGet(SETUP_BOT_STORAGE_KEY);
}

export function hasDashboardBot() {
  return lsGet(HAS_DASHBOARD_BOT_KEY) === '1';
}

export function markHasDashboardBot() {
  lsSet(HAS_DASHBOARD_BOT_KEY, '1');
}

export function clearHasDashboardBot() {
  lsRemove(HAS_DASHBOARD_BOT_KEY);
}

/** Pause guided setup and return to the invite home (keep bot + step). */
export function pauseSetupWizard(botId, stepIndex) {
  if (!botId) return;
  markSetupBot(botId);
  writeWizardBotId(botId);
  writeWizardStep(stepIndex);
  lsSet(SETUP_STEP_STORAGE_KEY, String(stepIndex));
}

/** Call when the guided first-bot flow is finished (done step). */
export function completeSetupBot() {
  markHasDashboardBot();
  clearWizardSession();
  clearGenderSession();
  lsRemove(SETUP_BOT_STORAGE_KEY);
  lsRemove(SETUP_STEP_STORAGE_KEY);
}

/** @deprecated Prefer resuming the in-progress wizard; kept for rare forced resets. */
export function startFreshWizard() {
  clearWizardSession();
  clearGenderSession();
  wizardCreateInflight = null;
  lsRemove(SETUP_BOT_STORAGE_KEY);
  lsRemove(SETUP_STEP_STORAGE_KEY);
}
