// Default-language protocol: each homepage is opened three times in a fresh browser context, with
// the browser language set to Spanish, Valencian and English, and the results are compared.
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadModule } from 'cld3-asm';
import { isInterstitial } from './language.mjs';
import { evaluateSettled, loadHomepage } from './page-utils.mjs';
import { isForeignRedirect } from './redirects.mjs';

export const LOCALES = Object.freeze({ es: 'es-ES', va: 'ca-ES-valencia', en: 'en-US' });
export const BEHAVIOUR_COLUMN = 'comportamiento_idioma';
const VISIT_COLUMNS = ['url_final', 'lang', 'hreflang', 'idioma_texto'];
const columnsFor = (prefix) => [
  ...Object.keys(LOCALES).flatMap((key) => VISIT_COLUMNS.map((field) => `${prefix}${key}_${field}`)),
  `${prefix}${BEHAVIOUR_COLUMN}`,
];
export const COLUMNS = Object.freeze(columnsFor(''));
// Same protocol on the page behind a landing page; the homepage columns stay as measured.
export const INNER_PREFIX = 'interior_';
export const INNER_COLUMNS = Object.freeze(columnsFor(INNER_PREFIX));
export const FINAL_COLUMN = 'resultado_idioma';
const LANGUAGE_NAMES = Object.freeze({ es: 'español', ca: 'valenciano', en: 'inglés' });

const BEHAVIOUR = Object.freeze({
  fixed: 'fijo', adaptive: 'adaptativo', review: 'revisar', noData: 'sin_datos',
});
const CONCLUSIVE = [BEHAVIOUR.fixed, BEHAVIOUR.adaptive];
// Any other label on these sites is the detector misreading a few menu words.
const STUDY_LANGUAGES = ['es', 'ca', 'en'];
const MAX_TEXT_CHARS = 20000;
const MAX_DETECTOR_BYTES = 100000;
const MIN_MAIN_TEXT_CHARS = 50;
// Pages with less text than this may still be rendering, so they get extra time.
const MIN_SETTLED_TEXT_CHARS = 200;
const STABLE_INTERVAL_MS = 1000;
const SHORT_TEXT_WAIT_MS = 8000;
const VISIT_DEADLINE_MS = 120000;
const CLOSE_DEADLINE_MS = 10000;
// Translations of a page share few words (0.2-0.3 on real sites); the same page shares nearly all.
const MIN_SAME_TEXT_SIMILARITY = 0.6;
const HAS_LETTERS = /\p{L}/u;
const WORD = /[\p{L}·]+/gu;
const NO_LANGUAGE = Object.freeze({ language: '', probability: 0, isReliable: false, proportion: 0 });
// Hosting and CMS error pages, which are not the municipality's content (and are in English).
const UNAVAILABLE_PAGE = /account suspended|account has been suspended|database error|error establishing a database connection/i;
const UNAVAILABLE_URL = /\/cgi-sys\/suspendedpage/i;
const UNAVAILABLE_TEXT_CHARS = 300;
const PORTADA_PATH = /^\/((ca|va|es|en)\/)?portada\/?$/i;
const MUNICIPAL_SITE_TEXT = /\b(web|portal) municipal\b/i;
// "Ajuntament", "Ayuntamiento »" or "AJUNTAMENT I TRÀMITS", but not a long headline.
const GATEWAY_TEXT = /^(l'|l’|el )?(ajuntament|ayuntamiento)(\W+\p{L}+){0,2}\W*$/iu;

export function formatHreflang(values) {
  return [...new Set(values ?? [])].sort().join('|');
}

export function visitColumns(key, visit) {
  const ok = !visit.error;
  return {
    [`${key}_url_final`]: ok ? visit.finalUrl : '',
    [`${key}_lang`]: ok ? visit.htmlLang : '',
    [`${key}_hreflang`]: ok ? formatHreflang(visit.linkHreflang) : '',
    [`${key}_idioma_texto`]: ok ? visit.textLanguage : '',
  };
}

function wordSet(text) {
  return new Set((text ?? '').toLowerCase().match(WORD) ?? []);
}

/** Share of distinct words two texts have in common (Jaccard), from 0 to 1. */
export function textSimilarity(a, b) {
  const first = wordSet(a);
  const second = wordSet(b);
  if (!first.size && !second.size) return 1;
  const shared = [...first].filter((word) => second.has(word)).length;
  return shared / (first.size + second.size - shared);
}

function pageChanged(visits) {
  const list = Object.values(visits);
  const differs = (field) => new Set(list.map((visit) => visit[field])).size > 1;
  if (differs('finalUrl') || differs('htmlLang')) return true;
  return list.some((visit, i) => list.slice(i + 1)
    .some((other) => textSimilarity(visit.text, other.text) < MIN_SAME_TEXT_SIMILARITY));
}

// "es", "es-ES" and "es_ES" declare the same language, and sites write Valencian in many ways.
function declaredLanguage(lang) {
  const code = (lang ?? '').toLowerCase().replace('_', '-');
  return /^(ca|va|vl|val|x-va)(-|$)/.test(code) ? 'ca' : code.split('-')[0];
}

function declaredLanguageChanged(visits) {
  return new Set(Object.values(visits).map((visit) => declaredLanguage(visit.htmlLang))).size > 1;
}

/**
 * fijo: same text language in all visits. adaptativo: it changes and the page really changed.
 * revisar: the detector is unsure or names a language outside the study, its label flips on an
 * unchanged page (bilingual homepages with rotating news do this), or the page declares a different
 * language per visit while the text stays in one (only the menu is translated).
 * sin_datos: a visit failed or had no identifiable language.
 */
export function classifyBehaviour(visits) {
  const list = Object.values(visits);
  if (list.some((visit) => visit.error || !visit.textLanguage)) return BEHAVIOUR.noData;
  if (list.some((visit) => !visit.isReliable || !STUDY_LANGUAGES.includes(visit.textLanguage))) {
    return BEHAVIOUR.review;
  }
  if (new Set(list.map((visit) => visit.textLanguage)).size === 1) {
    return declaredLanguageChanged(visits) ? BEHAVIOUR.review : BEHAVIOUR.fixed;
  }
  return pageChanged(visits) ? BEHAVIOUR.adaptive : BEHAVIOUR.review;
}

export function isUnavailablePage({ title, text, href }) {
  return UNAVAILABLE_URL.test(href ?? '') || UNAVAILABLE_PAGE.test(title ?? '')
    || UNAVAILABLE_PAGE.test((text ?? '').slice(0, UNAVAILABLE_TEXT_CHARS));
}

export function isDone(record, prefix = '') {
  return CONCLUSIVE.includes(record[`${prefix}${BEHAVIOUR_COLUMN}`]);
}

export function applyVisits(record, visits, prefix = '') {
  const behaviour = classifyBehaviour(visits);
  // A rerun that fails or is inconclusive (site down today) must not erase a conclusive result.
  if (isDone(record, prefix) && !CONCLUSIVE.includes(behaviour)) return { ...record };
  const columns = Object.entries(visits).map(([key, visit]) => visitColumns(`${prefix}${key}`, visit));
  return { ...record, ...Object.assign({}, ...columns), [`${prefix}${BEHAVIOUR_COLUMN}`]: behaviour };
}

/**
 * The result to analyse for a municipality. A fixed inner page decides the language, because a
 * homepage with only tiles can show a different language from the site behind it.
 */
export function finalResult(record) {
  const home = record[BEHAVIOUR_COLUMN];
  const inner = record[`${INNER_PREFIX}${BEHAVIOUR_COLUMN}`];
  const fixedIn = (code) => `${BEHAVIOUR.fixed}_${LANGUAGE_NAMES[code] ?? code}`;
  if (home === BEHAVIOUR.adaptive || inner === BEHAVIOUR.adaptive) return BEHAVIOUR.adaptive;
  if (inner === BEHAVIOUR.fixed) return fixedIn(record[`${INNER_PREFIX}es_idioma_texto`]);
  if (home === BEHAVIOUR.fixed) return fixedIn(record.es_idioma_texto);
  return home ?? '';
}

/** Unresolved rows that returned the same page in all visits: too little text to tell the language. */
export function isLandingCandidate(record) {
  const same = (field) => new Set(Object.keys(LOCALES).map((key) => record[`${key}_${field}`])).size === 1;
  return record[BEHAVIOUR_COLUMN] === BEHAVIOUR.review && same('url_final') && same('lang');
}

function httpUrl(href) {
  try {
    const url = new URL(href);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/** The link from a landing page to the municipal website, or null if it has none. */
export function chooseInnerLink(links, pageUrl) {
  const page = new URL(pageUrl);
  const host = page.hostname.replace(/^www\./, '');
  const samePage = (url) => url.origin === page.origin && url.pathname.replace(/\/$/, '') === page.pathname.replace(/\/$/, '');
  const candidates = links
    .map((link) => ({ ...link, url: httpUrl(link.href) }))
    .filter(({ url }) => {
      if (!url || samePage(url)) return false;
      const target = url.hostname.replace(/^www\./, '');
      return target === host || target.endsWith(`.${host}`);
    });
  const found = candidates.find(({ url }) => PORTADA_PATH.test(url.pathname))
    ?? candidates.find(({ text }) => MUNICIPAL_SITE_TEXT.test(text))
    ?? candidates.find(({ text }) => GATEWAY_TEXT.test(text));
  return found ? found.href : null;
}

/**
 * Language identification with Google's CLD3. It reports ISO codes, and Valencian as "ca": no
 * mainstream detector separates Valencian from Catalan.
 */
export async function createDetector() {
  const factory = await loadModule();
  const identifier = factory.create(0, MAX_DETECTOR_BYTES);
  return (text) => {
    if (!HAS_LETTERS.test(text ?? '')) return NO_LANGUAGE;
    // NFKC turns decorative letters (pasted "bold" social media posts) into normal ones.
    const { language, probability, is_reliable: isReliable, proportion } = identifier.findLanguage(text.normalize('NFKC'));
    return { language: language === 'und' ? '' : language, probability, isReliable, proportion };
  };
}

// Runs in the browser: must stay self-contained (no imports or outer variables).
export function collectLinks() {
  return [...document.querySelectorAll('a[href]')].map((a) => ({
    href: a.href,
    text: (a.textContent || a.getAttribute('aria-label') || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 60),
  }));
}

// Runs in the browser: must stay self-contained (no imports or outer variables).
export function collectVisit(maxTextChars) {
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const hreflangOf = (selector) => [...document.querySelectorAll(selector)].map((el) => el.getAttribute('hreflang'));
  const anchors = hreflangOf('a[hreflang]');
  return {
    href: location.href,
    title: document.title || '',
    htmlLang: document.documentElement.getAttribute('lang') || '',
    navigatorLanguage: navigator.language,
    linkHreflang: unique(hreflangOf('link[rel~="alternate"][hreflang]')),
    anchorHreflang: unique(anchors),
    anchorHreflangCount: anchors.length,
    text: (document.body ? document.body.innerText : '').slice(0, maxTextChars),
  };
}

function isSameOriginFrame(frame, pageUrl) {
  const url = frame.url();
  if (url === 'about:srcdoc') return true;
  try {
    return new URL(url).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

// Old sites may show all their content inside frames, leaving the main document empty. Frames from
// other sites are skipped: consent, map and video widgets translate themselves to the browser
// language and would make the site look adaptive.
async function framesText(page, maxTextChars) {
  const frames = page.frames()
    .filter((frame) => frame !== page.mainFrame() && isSameOriginFrame(frame, page.url()));
  const texts = await Promise.all(frames.map((frame) => frame
    .evaluate(() => (document.body ? document.body.innerText : ''))
    // A frame that navigated away or was detached simply has no text to add.
    .catch(() => '')));
  return texts.join('\n').trim().slice(0, maxTextChars);
}

// Late redirects and slow pages: accept a read only when the URL and text have stopped changing,
// and give pages with very little text (often still loading) until shortTextWaitMs.
async function readStablePage(page, { maxTextChars, settleMs, stableIntervalMs, shortTextWaitMs }) {
  const read = () => evaluateSettled(page, collectVisit, maxTextChars, { isBlocked: isInterstitial, settleMs });
  const started = Date.now();
  let previous = await read();
  for (;;) {
    await delay(stableIntervalMs);
    const current = await read();
    const unchanged = current.href === previous.href && current.text.length === previous.text.length;
    const enoughText = current.text.trim().length >= MIN_SETTLED_TEXT_CHARS;
    if ((unchanged && enoughText) || Date.now() - started >= shortTextWaitMs) return current;
    previous = current;
  }
}

async function readPage(page, options) {
  const snapshot = await readStablePage(page, options);
  if (snapshot.text.trim().length >= MIN_MAIN_TEXT_CHARS) return { ...snapshot, textFromFrames: false };
  const fromFrames = await framesText(page, options.maxTextChars);
  return fromFrames.length > snapshot.text.trim().length
    ? { ...snapshot, text: fromFrames, textFromFrames: true }
    : { ...snapshot, textFromFrames: false };
}

// The link is looked up in each visit, in the same context, as a visitor would follow it.
async function goToInnerPage(page, options) {
  const landingUrl = page.url();
  const links = await evaluateSettled(page, collectLinks, undefined, { isBlocked: () => false, settleMs: options.settleMs });
  const innerLink = chooseInnerLink(links, landingUrl);
  if (!innerLink) throw new Error(`No inner page link found at ${landingUrl}`);
  await loadHomepage(page, innerLink, options);
  return { landingUrl, innerLink };
}

async function readVisit(context, url, options) {
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeout);
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  let documentResponse = null;
  page.on('response', (response) => {
    // An exception in a Playwright listener would kill the process. request.frame() throws for a
    // navigation whose frame is not attached yet, which cannot be the final document.
    try {
      const request = response.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentResponse = response;
    } catch {
      // Not the final document: nothing to record.
    }
  });
  await loadHomepage(page, url, options);
  const landing = options.followInnerPage ? await goToInnerPage(page, options) : {};
  const snapshot = await readPage(page, options);
  if (isForeignRedirect(url, snapshot.href) || isForeignRedirect(url, page.url())) {
    throw new Error(`Redirected to another site: ${page.url()}`);
  }
  const status = documentResponse ? documentResponse.status() : null;
  if (status >= 400) throw new Error(`HTTP ${status} at ${snapshot.href}`);
  if (isUnavailablePage(snapshot)) throw new Error(`Site unavailable: "${snapshot.title}" at ${snapshot.href}`);
  const headers = documentResponse ? documentResponse.headers() : {};
  const { language, probability, isReliable, proportion } = options.detector(snapshot.text);
  return {
    ...landing,
    ...snapshot,
    status,
    finalUrl: snapshot.href,
    contentLanguage: headers['content-language'] ?? '',
    vary: headers.vary ?? '',
    linkHeader: headers.link ?? '',
    textChars: snapshot.text.length,
    textSha256: createHash('sha256').update(snapshot.text).digest('hex'),
    textLanguage: language,
    probability,
    isReliable,
    proportion,
  };
}

// After a browser crash or with a hung page, closing can fail or never finish: do not wait for it.
async function closeContext(context) {
  await Promise.race([context.close().catch(() => {}), delay(CLOSE_DEADLINE_MS)]);
}

/** One protocol visit, in its own context so no cookies or cache carry over. Never throws for page errors. */
export async function visitHomepage(browser, url, locale, {
  detector, timeout, waitMs,
  settleMs,
  stableIntervalMs = STABLE_INTERVAL_MS,
  shortTextWaitMs = SHORT_TEXT_WAIT_MS,
  deadlineMs = VISIT_DEADLINE_MS,
  maxTextChars = MAX_TEXT_CHARS,
  followInnerPage = false,
}) {
  const base = { locale, requestedAt: new Date().toISOString(), error: null, textLanguage: '' };
  let context;
  let timer;
  try {
    context = await browser.newContext({
      locale,
      extraHTTPHeaders: { 'Accept-Language': locale },
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
    });
    // page.evaluate has no timeout: a page stuck in a loop would stall the whole run.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Visit exceeded ${deadlineMs} ms`)), deadlineMs);
    });
    const options = {
      detector, timeout, waitMs, settleMs, stableIntervalMs, shortTextWaitMs, maxTextChars, followInnerPage,
    };
    return { ...base, ...await Promise.race([readVisit(context, url, options), deadline]) };
  } catch (error) {
    return { ...base, error: String(error?.message ?? error).split('\n')[0] };
  } finally {
    clearTimeout(timer);
    if (context) await closeContext(context);
  }
}
