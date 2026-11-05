import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import {
  BEHAVIOUR_COLUMN, COLUMNS, INNER_COLUMNS, INNER_PREFIX, LOCALES, applyVisits, chooseInnerLink,
  classifyBehaviour, collectVisit, createDetector, finalResult, formatHreflang, isDone, isLandingCandidate,
  isUnavailablePage, textSimilarity, visitColumns, visitHomepage,
} from './default-language-core.mjs';

const VALENCIAN = "L'Ajuntament informa als veïns que el termini per a les ajudes està obert amb tota la informació. ".repeat(3);
const SPANISH = 'El Ayuntamiento informa a los vecinos de que el plazo para las ayudas está abierto con toda la información. '.repeat(3);
const ENGLISH = 'The Town Council informs residents that the period for the grants is open with all the information. '.repeat(3);

const good = (language, extra = {}) => ({
  finalUrl: 'https://x.es/',
  htmlLang: 'es',
  linkHreflang: [],
  textLanguage: language,
  isReliable: true,
  text: 'Portada del municipio con las noticias de hoy y los servicios',
  error: null,
  ...extra,
});

let detector;
let browser;
let server;
let origin;
const requests = [];

function page(lang, body, head = '') {
  return `<!doctype html><html lang="${lang}"><head><title>Ayuntamiento</title>${head}</head><body>${body}</body></html>`;
}

function respond(req, res) {
  const language = req.headers['accept-language'] ?? '';
  requests.push({ path: req.url, language, cookie: req.headers.cookie, etag: req.headers['if-none-match'] });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/') {
    res.statusCode = 302;
    res.setHeader('Location', language.startsWith('ca') ? '/va/' : language.startsWith('en') ? '/en/' : '/es/');
    res.end();
  } else if (req.url === '/va/') {
    res.end(page('ca', VALENCIAN));
  } else if (req.url === '/es/') {
    res.setHeader('Set-Cookie', 'seen=1; Path=/; Max-Age=3600');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('ETag', '"es-page"');
    res.setHeader('Content-Language', 'es');
    res.setHeader('Vary', 'Accept-Language');
    res.end(page('es', SPANISH, '<link rel="alternate" hreflang="va-VA" href="/va/"><link rel="alternate" hreflang="es" href="/es/">'));
  } else if (req.url === '/en/') {
    res.end(page('en', ENGLISH));
  } else if (req.url === '/js-redirect') {
    res.end(page('es', '<script>location.replace("/va/")</script>'));
  } else if (req.url === '/down') {
    res.statusCode = 503;
    res.end('unavailable');
  } else if (req.url === '/challenge') {
    res.end('<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>');
  } else if (req.url === '/frameset') {
    res.end(page('es', `<iframe srcdoc="${SPANISH}"></iframe>`));
  } else if (req.url === '/foreign-frame') {
    const { port } = server.address();
    res.end(page('es', `<iframe src="http://localhost:${port}/es/"></iframe>`));
  } else if (req.url === '/spinner') {
    res.end(page('es', `<p id="c">Cargando...</p><script>setTimeout(() => {
      document.getElementById('c').textContent = ${JSON.stringify(SPANISH)}; }, 600)</script>`));
  } else if (req.url === '/hang') {
    res.end(page('es', `<p>${SPANISH}</p><script>setTimeout(() => { while (true) {} }, 10)</script>`));
  } else if (req.url === '/suspended') {
    res.end('<!doctype html><html><head><title>Account Suspended</title></head><body>This Account has been suspended. Contact your hosting provider for more information.</body></html>');
  } else if (req.url === '/landing') {
    res.end(page('es', '<a href="/va/portada"><img src="/logo.png"></a><a href="https://facebook.com/x">Facebook</a><p>AJUNTAMENT</p>'));
  } else if (req.url === '/va/portada') {
    res.end(page('ca', VALENCIAN));
  } else if (req.url === '/no-inner-link') {
    res.end(page('es', '<a href="https://facebook.com/x">Facebook</a><p>AYUNTAMIENTO</p>'));
  } else if (req.url === '/js-to-missing') {
    res.end(page('es', '<script>location.replace("/missing")</script>'));
  } else {
    res.statusCode = 404;
    res.end('not found');
  }
}

before(async () => {
  detector = await createDetector();
  browser = await chromium.launch();
  server = createServer(respond);
  await new Promise((resolve) => server.listen(0, resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function visit(path, locale, options = {}) {
  return visitHomepage(browser, `${origin}${path}`, locale, {
    detector, timeout: 10000, waitMs: 50, settleMs: 10, stableIntervalMs: 50, shortTextWaitMs: 1500, ...options,
  });
}

test('the protocol uses the three locales and adds 13 columns in a fixed order', () => {
  assert.deepEqual(LOCALES, { es: 'es-ES', va: 'ca-ES-valencia', en: 'en-US' });
  assert.deepEqual(COLUMNS, [
    'es_url_final', 'es_lang', 'es_hreflang', 'es_idioma_texto',
    'va_url_final', 'va_lang', 'va_hreflang', 'va_idioma_texto',
    'en_url_final', 'en_lang', 'en_hreflang', 'en_idioma_texto',
    'comportamiento_idioma',
  ]);
});

test('formatHreflang sorts and de-duplicates values without changing them', () => {
  assert.equal(formatHreflang(['x-default', 'va-VA', 'es', 'es']), 'es|va-VA|x-default');
  assert.equal(formatHreflang([]), '');
  assert.equal(formatHreflang(undefined), '');
});

test('visitColumns maps a visit to its four columns', () => {
  const columns = visitColumns('va', {
    finalUrl: 'https://x.es/va', htmlLang: 'ca-valencia', linkHreflang: ['ca', 'es'], textLanguage: 'ca',
  });
  assert.deepEqual(columns, {
    va_url_final: 'https://x.es/va', va_lang: 'ca-valencia', va_hreflang: 'ca|es', va_idioma_texto: 'ca',
  });
});

test('visitColumns leaves a failed visit blank', () => {
  assert.deepEqual(visitColumns('en', { error: 'HTTP 503' }), {
    en_url_final: '', en_lang: '', en_hreflang: '', en_idioma_texto: '',
  });
});

test('classifyBehaviour: the same language in the three visits is fijo', () => {
  assert.equal(classifyBehaviour({ es: good('es'), va: good('es'), en: good('es') }), 'fijo');
});

test('classifyBehaviour: a language change backed by a different URL, lang or text is adaptativo', () => {
  const url = { finalUrl: 'https://x.es/va' };
  assert.equal(classifyBehaviour({ es: good('es'), va: good('ca', url), en: good('ca', url) }), 'adaptativo');
  const lang = { htmlLang: 'ca' };
  assert.equal(classifyBehaviour({ es: good('es'), va: good('ca', lang), en: good('es') }), 'adaptativo');
  const translated = { text: VALENCIAN };
  assert.equal(classifyBehaviour({ es: good('es', { text: SPANISH }), va: good('ca', translated), en: good('es', { text: SPANISH }) }), 'adaptativo');
});

test('classifyBehaviour: a language flip on an unchanged page is revisar, not adaptativo', () => {
  // Bilingual homepage whose news block rotates: same URL, same lang, nearly the same words.
  const mixed = `${SPANISH} ${VALENCIAN}`;
  const visits = { es: good('es', { text: mixed }), va: good('ca', { text: `${mixed} Fira` }), en: good('es', { text: mixed }) };
  assert.equal(classifyBehaviour(visits), 'revisar');
});

test('classifyBehaviour: same text but different declared languages is revisar', () => {
  // Xaló: /es/, / and /en/ with lang es, va-VA and en-US; only the menu is translated.
  const visits = {
    es: good('ca', { htmlLang: 'es', finalUrl: 'https://x.es/es/' }),
    va: good('ca', { htmlLang: 'va-VA', finalUrl: 'https://x.es/' }),
    en: good('ca', { htmlLang: 'en-US', finalUrl: 'https://x.es/en/' }),
  };
  assert.equal(classifyBehaviour(visits), 'revisar');
});

test('classifyBehaviour: a language outside the study is revisar, even if reliable', () => {
  // CLD3 reads a few menu words ("AJUNTAMENT SEU ELECTRÒNICA") as Basque with high confidence.
  assert.equal(classifyBehaviour({ es: good('eu'), va: good('eu'), en: good('eu') }), 'revisar');
});

test('classifyBehaviour: variants of the same declared language stay fijo', () => {
  const spanish = { es: good('es', { htmlLang: 'es' }), va: good('es', { htmlLang: 'es-ES' }), en: good('es', { htmlLang: 'es_ES' }) };
  assert.equal(classifyBehaviour(spanish), 'fijo');
  const valencian = { es: good('ca', { htmlLang: 'ca' }), va: good('ca', { htmlLang: 'va-VA' }), en: good('ca', { htmlLang: 'ca-valencia' }) };
  assert.equal(classifyBehaviour(valencian), 'fijo');
});

test('finalResult uses the homepage when no inner page was checked', () => {
  assert.equal(finalResult({ comportamiento_idioma: 'fijo', es_idioma_texto: 'es' }), 'fijo_español');
  assert.equal(finalResult({ comportamiento_idioma: 'fijo', es_idioma_texto: 'ca' }), 'fijo_valenciano');
  assert.equal(finalResult({ comportamiento_idioma: 'fijo', es_idioma_texto: 'en' }), 'fijo_inglés');
  assert.equal(finalResult({ comportamiento_idioma: 'adaptativo', es_idioma_texto: 'es' }), 'adaptativo');
  assert.equal(finalResult({ comportamiento_idioma: 'revisar', es_idioma_texto: 'ro' }), 'revisar');
  assert.equal(finalResult({ comportamiento_idioma: 'sin_datos' }), 'sin_datos');
});

test('finalResult prefers a fixed inner page over the homepage label', () => {
  // Silla: Spanish tiles on the homepage, Valencian site behind them.
  assert.equal(finalResult({
    comportamiento_idioma: 'fijo', es_idioma_texto: 'es', interior_comportamiento_idioma: 'fijo', interior_es_idioma_texto: 'ca',
  }), 'fijo_valenciano');
  // Alboraya: only a nonsense label on the homepage.
  assert.equal(finalResult({
    comportamiento_idioma: 'revisar', es_idioma_texto: 'lb', interior_comportamiento_idioma: 'fijo', interior_es_idioma_texto: 'ca',
  }), 'fijo_valenciano');
});

test('finalResult falls back to the homepage when the inner page gave no answer', () => {
  // Monóvar: bilingual homepage with no inner page to follow.
  assert.equal(finalResult({
    comportamiento_idioma: 'revisar', es_idioma_texto: 'ca', interior_comportamiento_idioma: 'sin_datos',
  }), 'revisar');
  assert.equal(finalResult({
    comportamiento_idioma: 'fijo', es_idioma_texto: 'es', interior_comportamiento_idioma: 'sin_datos',
  }), 'fijo_español');
});

test('finalResult reports adaptive behaviour on either page', () => {
  assert.equal(finalResult({ comportamiento_idioma: 'fijo', es_idioma_texto: 'es', interior_comportamiento_idioma: 'adaptativo' }), 'adaptativo');
  assert.equal(finalResult({ comportamiento_idioma: 'adaptativo', interior_comportamiento_idioma: 'fijo', interior_es_idioma_texto: 'es' }), 'adaptativo');
});

test('finalResult is empty for a row that has not been measured', () => {
  assert.equal(finalResult({ Municipio: 'Agost' }), '');
  assert.equal(finalResult({ comportamiento_idioma: '' }), '');
});

test('isUnavailablePage detects hosting and database error pages', () => {
  const page = (title, text, href = 'https://x.es/') => ({ title, text, href });
  assert.equal(isUnavailablePage(page('Account Suspended', 'This Account has been suspended.')), true);
  assert.equal(isUnavailablePage(page('', '', 'https://x.es/cgi-sys/suspendedpage.cgi')), true);
  assert.equal(isUnavailablePage(page('Database Error', 'Error establishing a database connection')), true);
  assert.equal(isUnavailablePage(page('Ajuntament de Llombai', 'Notícies del municipi')), false);
});

test('classifyBehaviour: an unreliable detection is revisar even if the labels agree', () => {
  const spinner = { isReliable: false, text: 'Cargando...' };
  assert.equal(classifyBehaviour({ es: good('gl', spinner), va: good('gl', spinner), en: good('gl', spinner) }), 'revisar');
});

test('classifyBehaviour reports no data when a visit failed or its language is unknown', () => {
  assert.equal(classifyBehaviour({ es: good('es'), va: { error: 'HTTP 503' }, en: good('es') }), 'sin_datos');
  assert.equal(classifyBehaviour({ es: good(''), va: good('es'), en: good('es') }), 'sin_datos');
});

test('textSimilarity separates translations from the same page', () => {
  assert.ok(textSimilarity(SPANISH, VALENCIAN) < 0.6);
  assert.ok(textSimilarity(SPANISH, `${SPANISH} Fiestas`) > 0.9);
  assert.equal(textSimilarity('', ''), 1);
});

test('applyVisits returns a new record with every column', () => {
  const record = { Municipio: 'Agost', web: 'https://x.es/' };
  const updated = applyVisits(record, { es: good('es'), va: good('es'), en: good('es') });
  assert.equal(updated.comportamiento_idioma, 'fijo');
  assert.equal(updated.va_idioma_texto, 'es');
  assert.equal(updated.Municipio, 'Agost');
  assert.equal(record.comportamiento_idioma, undefined, 'the input record is not mutated');
});

test('applyVisits keeps earlier results when every visit of a rerun fails', () => {
  const record = { Municipio: 'Agost', [BEHAVIOUR_COLUMN]: 'fijo', es_idioma_texto: 'es' };
  const failed = { error: 'timeout' };
  const updated = applyVisits(record, { es: failed, va: failed, en: failed });
  assert.equal(updated.comportamiento_idioma, 'fijo');
  assert.equal(updated.es_idioma_texto, 'es');
});

test('applyVisits keeps a conclusive result when a rerun only partly fails or is inconclusive', () => {
  const record = { Municipio: 'Agost', [BEHAVIOUR_COLUMN]: 'adaptativo', en_idioma_texto: 'ca' };
  const partial = applyVisits(record, { es: good('es'), va: good('es'), en: { error: 'HTTP 503' } });
  assert.equal(partial.comportamiento_idioma, 'adaptativo');
  assert.equal(partial.en_idioma_texto, 'ca');
  const unreliable = applyVisits(record, { es: good('gl', { isReliable: false }), va: good('es'), en: good('es') });
  assert.equal(unreliable.comportamiento_idioma, 'adaptativo');
});

test('applyVisits replaces earlier results when the rerun is conclusive', () => {
  const record = { Municipio: 'Agost', [BEHAVIOUR_COLUMN]: 'adaptativo', es_idioma_texto: 'ca' };
  const updated = applyVisits(record, { es: good('es'), va: good('es'), en: good('es') });
  assert.equal(updated.comportamiento_idioma, 'fijo');
  assert.equal(updated.es_idioma_texto, 'es');
});

test('isDone only accepts rows with a conclusive behaviour', () => {
  assert.equal(isDone({ comportamiento_idioma: 'fijo' }), true);
  assert.equal(isDone({ comportamiento_idioma: 'adaptativo' }), true);
  assert.equal(isDone({ comportamiento_idioma: 'revisar' }), false);
  assert.equal(isDone({ comportamiento_idioma: 'sin_datos' }), false);
  assert.equal(isDone({}), false);
});

test('createDetector identifies the three languages and reports confidence', () => {
  assert.equal(detector(SPANISH).language, 'es');
  assert.equal(detector(VALENCIAN).language, 'ca');
  const english = detector(ENGLISH);
  assert.equal(english.language, 'en');
  assert.ok(english.probability > 0.5);
});

test('createDetector returns an empty language for pages without text', () => {
  assert.equal(detector('').language, '');
  assert.equal(detector('   \n ').language, '');
  assert.equal(detector('12345 - 678').language, '');
});

test('createDetector marks junk labels from very short text as unreliable', () => {
  assert.equal(detector('Cargando...').isReliable, false);
  assert.equal(detector(SPANISH).isReliable, true);
});

test('visitHomepage waits for short pages to finish rendering', async () => {
  const result = await visit('/spinner', 'es-ES');
  assert.equal(result.error, null);
  assert.equal(result.textLanguage, 'es');
  assert.ok(result.isReliable);
});

test('visitHomepage gives up on a page that hangs the browser', async () => {
  const result = await visit('/hang', 'es-ES', { deadlineMs: 1000, waitMs: 100 });
  assert.match(result.error, /exceeded/);
  assert.equal(result.textLanguage, '');
});

test('visitHomepage fails when a JavaScript redirect ends on an error page', async () => {
  const result = await visit('/js-to-missing', 'es-ES', { waitMs: 300 });
  assert.match(result.error, /HTTP 404/);
});

test('visitHomepage fails on a suspended hosting account instead of reading it as English', async () => {
  const result = await visit('/suspended', 'es-ES');
  assert.match(result.error, /Site unavailable/);
  assert.equal(result.textLanguage, '');
});

test('chooseInnerLink prefers the /portada link of the same site', () => {
  const pageUrl = 'https://www.x.es/';
  const link = (href, text = '') => ({ href, text });
  assert.equal(chooseInnerLink([
    link('https://www.facebook.com/portada', 'Facebook'),
    link('https://www.x.es/pagina/turismo', 'TURISME'),
    link('https://www.x.es/va/portada'),
  ], pageUrl), 'https://www.x.es/va/portada');
  for (const path of ['/portada', '/ca/portada', '/es/portada/']) {
    assert.equal(chooseInnerLink([link(`https://www.x.es${path}`)], pageUrl), `https://www.x.es${path}`);
  }
});

test('chooseInnerLink falls back to a link named as the municipal website', () => {
  const pageUrl = 'https://www.x.es/';
  const link = (href, text) => ({ href, text });
  assert.equal(chooseInnerLink([link('https://www.x.es/turismo', 'TURISME'), link('https://www.x.es/inici', 'WEB MUNICIPAL')], pageUrl), 'https://www.x.es/inici');
  assert.equal(chooseInnerLink([link('https://web.x.es/', 'Ajuntament')], pageUrl), 'https://web.x.es/');
  assert.equal(chooseInnerLink([link('https://www.x.es/ajuntament', 'Ayuntamiento »')], pageUrl), 'https://www.x.es/ajuntament');
  assert.equal(chooseInnerLink([link('https://www.x.es/poble', 'CONEIX EL POBLE'), link('https://www.x.es/ajuntament/', 'AJUNTAMENT I TRÀMITS')], pageUrl), 'https://www.x.es/ajuntament/');
});

test('chooseInnerLink ignores headlines that merely start with the word Ajuntament', () => {
  const pageUrl = 'https://www.x.es/';
  const headline = { href: 'https://www.x.es/noticia/1', text: "Ajuntament de Benissa convoca el ple de la setmana que ve" };
  assert.equal(chooseInnerLink([headline], pageUrl), null);
});

test('chooseInnerLink returns null without a suitable link', () => {
  const pageUrl = 'https://www.x.es/portada';
  const link = (href, text = '') => ({ href, text });
  assert.equal(chooseInnerLink([], pageUrl), null);
  assert.equal(chooseInnerLink([link('https://www.x.es/turismo', 'TURISME')], pageUrl), null);
  assert.equal(chooseInnerLink([link('https://www.y.es/portada')], pageUrl), null);
  assert.equal(chooseInnerLink([link('https://www.x.es/portada')], pageUrl), null, 'already on that page');
  assert.equal(chooseInnerLink([link('mailto:a@x.es', 'Ajuntament')], pageUrl), null);
});

test('isLandingCandidate selects unresolved rows that look the same in all visits', () => {
  const row = (extra) => ({
    comportamiento_idioma: 'revisar',
    es_url_final: 'https://x.es/',
    va_url_final: 'https://x.es/',
    en_url_final: 'https://x.es/',
    es_lang: 'ca',
    va_lang: 'ca',
    en_lang: 'ca',
    ...extra,
  });
  assert.equal(isLandingCandidate(row()), true);
  assert.equal(isLandingCandidate(row({ comportamiento_idioma: 'fijo' })), false);
  assert.equal(isLandingCandidate(row({ en_url_final: 'https://x.es/en/' })), false, 'Xaló');
  assert.equal(isLandingCandidate(row({ en_lang: 'en' })), false, 'Callosa de Segura');
});

test('inner-page columns mirror the homepage ones and do not touch them', () => {
  assert.equal(INNER_COLUMNS.length, 13);
  assert.equal(INNER_COLUMNS[0], 'interior_es_url_final');
  assert.equal(INNER_COLUMNS.at(-1), 'interior_comportamiento_idioma');
  const record = { Municipio: 'Agost', comportamiento_idioma: 'revisar', es_idioma_texto: 'ro' };
  const updated = applyVisits(record, { es: good('ca'), va: good('ca'), en: good('ca') }, INNER_PREFIX);
  assert.equal(updated.interior_comportamiento_idioma, 'fijo');
  assert.equal(updated.interior_va_idioma_texto, 'ca');
  assert.equal(updated.comportamiento_idioma, 'revisar');
  assert.equal(updated.es_idioma_texto, 'ro');
  assert.equal(isDone(updated, INNER_PREFIX), true);
  assert.equal(isDone(updated), false);
});

test('visitHomepage can follow a landing page to its inner page', async () => {
  const result = await visit('/landing', 'ca-ES-valencia', { followInnerPage: true });
  assert.equal(result.error, null);
  assert.equal(new URL(result.landingUrl).pathname, '/landing');
  assert.equal(new URL(result.finalUrl).pathname, '/va/portada');
  assert.equal(result.htmlLang, 'ca');
  assert.equal(result.textLanguage, 'ca');
  assert.equal(result.isReliable, true);
});

test('visitHomepage reports when a landing page has no inner page link', async () => {
  const result = await visit('/no-inner-link', 'es-ES', { followInnerPage: true });
  assert.match(result.error, /No inner page link/);
  assert.equal(result.textLanguage, '');
});

test('createDetector reads decorative Unicode letters as normal text', () => {
  // Facebook posts pasted with "bold" letters: Benicolet goes from unreliable to reliable.
  const decorative = [...VALENCIAN].map((char) => {
    const code = char.codePointAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d5d4 + code - 65);
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d5ee + code - 97);
    return char;
  }).join('');
  const result = detector(decorative);
  assert.equal(result.language, 'ca');
  assert.equal(result.isReliable, true);
});

test('visitHomepage ignores iframes from other sites', async () => {
  const result = await visit('/foreign-frame', 'es-ES', { waitMs: 300 });
  assert.equal(result.textFromFrames, false);
  assert.equal(result.textLanguage, '');
});

test('visitHomepage takes the final URL from the same read as the text', async () => {
  const result = await visit('/va/', 'ca-ES-valencia');
  assert.equal(new URL(result.finalUrl).pathname, '/va/');
  assert.equal(new URL(result.href).pathname, '/va/');
});

test('collectVisit separates link and anchor hreflang and skips hidden text', async () => {
  const tab = await browser.newPage();
  try {
    await tab.setContent(`<html lang="va-VA"><head><link rel="alternate" hreflang="es" href="/es">
      <link rel="alternate" hreflang="es" href="/es2"><link rel="stylesheet" hreflang="fr" href="/x.css"></head>
      <body><a href="/n1" hreflang="und">Noticia</a><a href="/n2" hreflang="und">Otra</a>
      <p>Texto visible</p><p style="display:none">Texto oculto</p></body></html>`);
    const snapshot = await tab.evaluate(collectVisit, 1000);
    assert.equal(snapshot.htmlLang, 'va-VA');
    assert.deepEqual(snapshot.linkHreflang, ['es']);
    assert.deepEqual(snapshot.anchorHreflang, ['und']);
    assert.equal(snapshot.anchorHreflangCount, 2);
    assert.match(snapshot.text, /Texto visible/);
    assert.doesNotMatch(snapshot.text, /Texto oculto/);
  } finally {
    await tab.close();
  }
});

test('visitHomepage follows the redirect chosen for each locale', async () => {
  for (const [locale, finalPath, htmlLang, language] of [
    ['es-ES', '/es/', 'es', 'es'],
    ['ca-ES-valencia', '/va/', 'ca', 'ca'],
    ['en-US', '/en/', 'en', 'en'],
  ]) {
    const result = await visit('/', locale);
    assert.equal(result.error, null);
    assert.equal(new URL(result.finalUrl).pathname, finalPath);
    assert.equal(result.htmlLang, htmlLang);
    assert.equal(result.textLanguage, language);
    assert.equal(result.navigatorLanguage, locale);
  }
});

test('visitHomepage sends the exact Accept-Language value on every request', async () => {
  requests.length = 0;
  await visit('/', 'ca-ES-valencia');
  assert.ok(requests.length >= 2);
  assert.ok(requests.every((request) => request.language === 'ca-ES-valencia'));
});

test('each visit starts without cookies or cache from the previous one', async () => {
  await visit('/', 'es-ES');
  requests.length = 0;
  await visit('/', 'es-ES');
  const pageRequest = requests.find((request) => request.path === '/es/');
  assert.ok(pageRequest, 'the cached page is requested again from the server');
  assert.equal(pageRequest.cookie, undefined);
  assert.equal(pageRequest.etag, undefined);
});

test('visitHomepage records evidence from the final document', async () => {
  const result = await visit('/', 'es-ES');
  assert.deepEqual([...result.linkHreflang].sort(), ['es', 'va-VA']);
  assert.equal(result.contentLanguage, 'es');
  assert.equal(result.vary, 'Accept-Language');
  assert.equal(result.status, 200);
  assert.ok(result.textChars > 100);
  assert.match(result.textSha256, /^[0-9a-f]{64}$/);
  assert.ok(result.requestedAt);
});

test('visitHomepage records JavaScript redirects in the final URL', async () => {
  const result = await visit('/js-redirect', 'es-ES', { waitMs: 300 });
  assert.equal(new URL(result.finalUrl).pathname, '/va/');
  assert.equal(result.textLanguage, 'ca');
});

test('visitHomepage reads the text of an iframe when the main page has almost none', async () => {
  const result = await visit('/frameset', 'es-ES', { waitMs: 200 });
  assert.equal(result.textLanguage, 'es');
  assert.equal(result.textFromFrames, true);
});

test('visitHomepage reports failures instead of throwing', async () => {
  const down = await visit('/down', 'es-ES');
  assert.match(down.error, /HTTP 503/);
  assert.equal(down.textLanguage, '');
  const challenge = await visit('/challenge', 'es-ES');
  assert.match(challenge.error, /Anti-bot page/);
  assert.equal(challenge.textLanguage, '');
});
