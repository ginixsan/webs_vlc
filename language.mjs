// Language detection for municipal homepages.
// collectLanguageSnapshot() runs inside the page (Playwright page.evaluate) and only gathers
// raw data; everything else is pure Node code so it can be unit-tested.

export const LANGUAGES = Object.freeze({
  valenciano: 'valenciano',
  espanol: 'español',
  ingles: 'inglés',
  otro: 'otro',
});

// Words a language button may contain, checked in this order ("en" is filler and English).
const LABEL_WORDS = new Map([
  [LANGUAGES.valenciano, ['valencià', 'valenciano', 'valencian', 'va', 'val', 'vl', 'ca', 'cat',
    'català', 'catalán', 'catalan']],
  [LANGUAGES.espanol, ['español', 'espanol', 'castellano', 'castellà', 'es', 'esp', 'cas', 'spanish']],
  [LANGUAGES.ingles, ['english', 'inglés', 'ingles', 'anglès', 'en', 'eng']],
  [LANGUAGES.otro, ['français', 'francés', 'francès', 'french', 'fr', 'deutsch', 'alemán', 'alemany',
    'german', 'de', 'italiano', 'italià', 'it', 'português', 'portugués', 'pt', 'nederlands', 'nl',
    'русский', 'ru']],
]);
const LABEL_FILLER = new Set(['cambiar', 'canviar', 'canvia', 'cambia', 'switch', 'to', 'a', 'al', 'en',
  'ver', 'veure', 'versió', 'versión', 'version', 'idioma', 'language', 'lengua', 'llengua', 'el', 'la',
  'in', 'selecciona', 'seleccionar', 'bandera', 'flag', 'icon', 'icono', 'página', 'pàgina', 'web',
  'españa', 'espanya']);
const MAX_LABEL_WORDS = 5;
// Every word a language label may contain; passed to the in-page collector to pre-filter elements.
export const LABEL_VOCABULARY = Object.freeze([
  ...new Set([...[...LABEL_WORDS.values()].flat(), ...LABEL_FILLER, 'valencia']),
]);
const INTERSTITIAL = /anti-?ddos|just a moment|attention required|checking your browser|ddos protection|security check|comprobando (su|tu) navegador|un momento[.,…]|verificando que (eres|usted es) humano|verifying you are human/i;

// Function words that tell the three languages apart (shared words such as "de" are excluded).
const TEXT_MARKERS = new Map([
  [LANGUAGES.valenciano, ['amb', 'els', 'les', 'per', 'pel', 'pels', 'dels', 'aquest', 'aquesta',
    'aquests', 'aquestes', 'més', 'també', 'seus', 'seues', 'molt', 'però', 'fins', 'ajuntament',
    'notícies', 'inici', 'veïns', 'veïnes', 'informació', 'tràmits', 'horari', 'i', 'quan',
    'anys', 'són', 'què', 'hi', 'ho', 'l', 'd', 'és', 'ací', 'està', 'estan',
    // menús y portadas de entrada
    'benvinguda', 'benvinguts', 'àrees', 'transparència', 'electrònica', 'seu', 'serveis', 'turisme',
    'esports', 'festes', 'educació', 'contacte', 'cercar', 'enllaços', 'empreses', 'ciutadania',
    'municipi', 'ocupació']],
  [LANGUAGES.espanol, ['con', 'los', 'las', 'para', 'por', 'este', 'esta', 'estos', 'estas', 'más',
    'también', 'sus', 'su', 'muy', 'pero', 'hasta', 'desde', 'ayuntamiento', 'noticias', 'inicio',
    'vecinos', 'vecinas', 'información', 'trámites', 'horario', 'y', 'como', 'cuando', 'años', 'son',
    'qué', 'está', 'están', 'hay',
    'bienvenida', 'bienvenidos', 'áreas', 'transparencia', 'electrónica', 'sede', 'servicios', 'turismo',
    'deportes', 'fiestas', 'educación', 'contacto', 'buscar', 'enlaces', 'empresas', 'ciudadanía',
    'municipio', 'empleo']],
  [LANGUAGES.ingles, ['the', 'and', 'with', 'of', 'for', 'to', 'is', 'are', 'this', 'from', 'news',
    'council', 'town', 'city', 'hall', 'home', 'contact', 'our', 'you', 'your', 'about', 'more',
    'read', 'will', 'have', 'welcome', 'transparency', 'electronic', 'office', 'services', 'tourism',
    'sports', 'search']],
]);
// Clear when there is plenty of text and a majority, or little text but an overwhelming majority.
const MIN_TEXT_HITS = 20;
const MIN_TEXT_RATIO = 1.5;
const MIN_SHORT_TEXT_HITS = 4;
const MIN_SHORT_TEXT_RATIO = 3;
const MAX_LANG_PATH = 12; // flag links point to "/", "/va/", "/es/index.aspx"..., not to articles
const WORD = /[\p{L}·]+/gu;
const VALENCIAN_LINK = /^https?:\/\/(va|ca|val)\.|\/(va|ca|val|vl)(\/|$|\?)|[?&](lang|idioma|language|locale)=(va|ca|val)\b/i;
const LANG_PATH = /^\/(ca|va|val|vl|es|en|cas)(\/|$)/i;
const LANG_QUERY = /[?&](?:lang|idioma|language|locale|lng|hl)=([a-z]{2,3})\b/i;

function words(text) {
  return (text ?? '').toLowerCase().match(WORD) ?? [];
}

export function classifyLabel(label) {
  const tokens = words(label);
  if (!tokens.length || tokens.length > MAX_LABEL_WORDS) return null;
  for (const [language, list] of LABEL_WORDS) {
    const vocabulary = new Set(list);
    const onlyLanguageWords = tokens.every((w) => vocabulary.has(w) || LABEL_FILLER.has(w));
    if (onlyLanguageWords && tokens.some((w) => vocabulary.has(w))) return language;
  }
  return null;
}

export function languageFromCode(code) {
  const value = (code ?? '').trim().toLowerCase();
  if (/^(ca|va|val|vl)([-_]|$)/.test(value)) return LANGUAGES.valenciano;
  if (/^es([-_]|$)/.test(value)) return LANGUAGES.espanol;
  if (/^en([-_]|$)/.test(value)) return LANGUAGES.ingles;
  if (/^(fr|de|it|pt|nl|ru)([-_]|$)/.test(value)) return LANGUAGES.otro;
  return null;
}

export function detectTextLanguage(text) {
  const counts = new Map([...TEXT_MARKERS.keys()].map((language) => [language, 0]));
  const markers = new Map([...TEXT_MARKERS].map(([language, list]) => [language, new Set(list)]));
  for (const word of words(text)) {
    for (const [language, set] of markers) {
      if (set.has(word)) counts.set(language, counts.get(language) + 1);
    }
  }
  const [[top, best], [, second]] = [...counts].sort((a, b) => b[1] - a[1]);
  const strong = best >= MIN_TEXT_HITS && best >= MIN_TEXT_RATIO * second;
  const clear = strong || (best >= MIN_SHORT_TEXT_HITS && best >= MIN_SHORT_TEXT_RATIO * second);
  return { language: clear ? top : null, strong, scores: Object.fromEntries(counts) };
}

export function isInterstitial(snapshot) {
  return INTERSTITIAL.test(snapshot.title ?? '') || INTERSTITIAL.test((snapshot.text ?? '').slice(0, 500));
}

function siteHost(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

function resolve(href, pageUrl) {
  try {
    return new URL(href, pageUrl);
  } catch {
    return null;
  }
}

function sameSite(href, pageUrl) {
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return true;
  const target = resolve(href, pageUrl);
  if (!target || !['http:', 'https:'].includes(target.protocol)) return false;
  const host = siteHost(pageUrl);
  const targetHost = target.hostname.replace(/^www\./, '');
  return targetHost === host || targetHost.endsWith(`.${host}`) || host.endsWith(`.${targetHost}`);
}

function hrefLanguage(href, pageUrl) {
  const target = resolve(href, pageUrl);
  if (!target) return null;
  const pathMatch = target.pathname.match(LANG_PATH);
  if (pathMatch) return languageFromCode(pathMatch[1] === 'cas' ? 'es' : pathMatch[1]);
  const queryMatch = target.search.match(LANG_QUERY);
  return queryMatch ? languageFromCode(queryMatch[1]) : null;
}

// Returns { language, flag }: flag=true when only a code/href identified it (no readable label).
function candidateLanguage(candidate, pageUrl) {
  for (const label of [candidate.label, candidate.title, candidate.ariaLabel, candidate.dataLang]) {
    const language = classifyLabel(label);
    if (language) return { language, flag: false };
  }
  // "valencia" without accent only counts when the link leads to the Valencian version
  if (/\bvalencia\b/i.test(candidate.label) && VALENCIAN_LINK.test(candidate.href)) {
    return { language: LANGUAGES.valenciano, flag: false };
  }
  // Flags without text: rely on hreflang/lang or a language root in the link
  const target = resolve(candidate.href, pageUrl);
  const shortPath = !candidate.href || (target && target.pathname.length <= MAX_LANG_PATH);
  if (candidate.isLink && !words(candidate.label).length && shortPath) {
    const language = languageFromCode(candidate.hreflang || candidate.lang) ?? hrefLanguage(candidate.href, pageUrl);
    return language ? { language, flag: true } : null;
  }
  return null;
}

function collectOptions(snapshot, pageUrl) {
  const links = [];
  const flags = [];
  const markers = [];
  for (const candidate of snapshot.candidates) {
    if (!sameSite(candidate.href, pageUrl)) continue;
    const found = candidateLanguage(candidate, pageUrl);
    if (!found) continue;
    const item = { language: found.language, active: candidate.active };
    if (!candidate.isLink) {
      // A language word inside a switcher link (<a><span>VA</span></a>) says nothing about the
      // current language; only standalone markers (e.g. <li class="current"><span>VAL</span>) do.
      if (!candidate.insideLink) markers.push(item);
    } else {
      (found.flag ? flags : links).push(item);
    }
  }
  // A lone flag-like link (e.g. a logo with lang="es") is not a selector: require two languages.
  const flagLanguages = new Set(flags.map((item) => item.language));
  return { links: flagLanguages.size >= 2 ? [...links, ...flags] : links, markers };
}

/**
 * eleccionIdioma: the page offers a way to change language (buttons, links, select or translator).
 * idiomaDefecto, by priority: option explicitly marked active in the selector, clear majority in a
 * long visible text, standalone current-language marker, short visible text, <html lang>; '' when
 * nothing is conclusive.
 */
export function analysePage(snapshot, pageUrl) {
  const { links, markers } = collectOptions(snapshot, pageUrl);
  const eleccionIdioma = snapshot.translateWidget || links.length > 0;
  const textResult = detectTextLanguage(snapshot.text);
  const explicit = eleccionIdioma
    ? ([...links, ...markers].find((item) => item.active)?.language ?? null) : null;
  const looseMarker = eleccionIdioma ? (markers[0]?.language ?? null) : null;
  const htmlLanguage = languageFromCode(snapshot.htmlLang);
  const [idiomaDefecto, fuenteIdioma] = explicit ? [explicit, 'selector']
    : textResult.strong ? [textResult.language, 'texto']
      : looseMarker ? [looseMarker, 'selector']
        : textResult.language ? [textResult.language, 'texto']
          : htmlLanguage ? [htmlLanguage, 'atributo lang']
            : ['', 'sin determinar'];
  const current = fuenteIdioma === 'selector' ? [idiomaDefecto] : [];
  return {
    eleccionIdioma,
    idiomaDefecto,
    fuenteIdioma,
    opcionesIdioma: [...new Set([...links.map((item) => item.language), ...current])],
    puntuacionTexto: textResult.scores,
  };
}

// Runs in the browser: must stay self-contained (no imports or outer variables).
// `vocabulary` is LABEL_VOCABULARY: elements are kept only if a label consists of those words.
export function collectLanguageSnapshot({ maxTextChars, vocabulary }) {
  const ACTIVE = /(^|[\s_-])(active|current|selected|activo|actual|is-active)([\s_-]|$)|current-lang|current-language|wpml-ls-current-language|gt-current-lang|lang-active/i;
  const MAX_LABEL = 40;
  const MAX_LABEL_WORDS = 5;
  const MAX_CANDIDATES = 500;
  const LINKISH = 'a, button, option, [role="button"], [role="menuitem"], [onclick], [data-lang], [data-gt-lang]';
  const LANGUAGE_HREF = /(^|\/)(ca|va|val|vl|es|en|cas)(\/|$|\?)|[?&](lang|idioma|language|locale|lng|hl)=|^https?:\/\/(va|ca|val|es|en)\./i;
  const known = new Set(vocabulary);
  // Some themes print the flag <img> tag as text inside the link: drop that markup.
  const clean = (value) => (value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const className = (el) => (el && typeof el.className === 'string' ? el.className : '');
  const isLanguageLabel = (text) => {
    const tokens = text.toLowerCase().match(/[\p{L}·]+/gu) || [];
    return tokens.length > 0 && tokens.length <= MAX_LABEL_WORDS && tokens.every((w) => known.has(w));
  };
  const candidates = [];
  const selector = `${LINKISH}, li, span, strong, div`;
  // Translation widgets may live in open shadow roots, which querySelectorAll does not enter.
  const roots = [document];
  for (let i = 0; i < roots.length; i += 1) {
    for (const el of roots[i].querySelectorAll('*')) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  const elements = roots.flatMap((root) => [...root.querySelectorAll(selector)]);
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const isLink = ['a', 'button', 'option'].includes(tag) || role === 'button' || role === 'menuitem'
      || el.hasAttribute('onclick') || el.hasAttribute('data-gt-lang') || el.hasAttribute('data-lang');
    if (!isLink && el.children.length > 0) continue;
    const img = el.querySelector('img');
    const fullLabel = clean(el.textContent) || clean(img && (img.getAttribute('alt') || img.getAttribute('title')));
    // Long visible text can still carry a language name in title/aria-label
    const label = fullLabel.length > MAX_LABEL ? '' : fullLabel;
    const attrs = ['title', 'aria-label', 'data-lang', 'data-gt-lang', 'hreflang', 'lang']
      .map((name) => clean(el.getAttribute(name)));
    const hasLetters = /\p{L}/u.test(label);
    // Flags: links without readable text that carry a language code or point to a language root
    const flagLike = isLink && !hasLetters && fullLabel.length <= MAX_LABEL
      && Boolean(attrs[4] || attrs[5] || LANGUAGE_HREF.test(el.getAttribute('href') || ''));
    const relevant = isLanguageLabel(label) || attrs.slice(0, 4).some(isLanguageLabel) || flagLike;
    if (!relevant) continue;
    const item = el.closest('li');
    const ariaCurrent = el.getAttribute('aria-current');
    const active = ACTIVE.test(`${className(el)} ${className(item)}`)
      || ariaCurrent === 'true' || ariaCurrent === 'page'
      || (tag === 'option' && el.selected && el.value !== '');
    const insideLink = !isLink && Boolean(el.parentElement && el.parentElement.closest(LINKISH));
    candidates.push({
      tag, isLink, insideLink, label, title: attrs[0], ariaLabel: attrs[1], dataLang: attrs[2] || attrs[3],
      hreflang: attrs[4], lang: attrs[5], href: el.getAttribute('href') || '', active,
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  const translateWidget = Boolean(document.querySelector(
    'select.goog-te-combo, #google_translate_element, .gtranslate_wrapper, .gt_switcher, [data-gt-lang], a.glink',
  ));
  return {
    title: document.title || '',
    htmlLang: document.documentElement.lang || '',
    text: (document.body ? document.body.innerText : '').slice(0, maxTextChars),
    translateWidget,
    candidates,
  };
}
