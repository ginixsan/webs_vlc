import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGES, analysePage, classifyLabel, detectTextLanguage, isInterstitial, languageFromCode,
} from './language.mjs';

const PAGE = 'https://www.example.es/va/inici';
const SPANISH_TEXT = 'los vecinos con las ayudas para el ayuntamiento y también noticias '.repeat(6);

function link(label, extra = {}) {
  return { tag: 'a', isLink: true, insideLink: false, label, title: '', ariaLabel: '', dataLang: '', hreflang: '', lang: '', href: '#', active: false, ...extra };
}

function marker(label, extra = {}) {
  return { ...link(label), tag: 'span', isLink: false, ...extra };
}

function snapshot(extra) {
  return { title: '', htmlLang: '', text: '', translateWidget: false, candidates: [], ...extra };
}

test('classifyLabel recognises language names and codes', () => {
  assert.equal(classifyLabel('Valencià'), LANGUAGES.valenciano);
  assert.equal(classifyLabel('VA'), LANGUAGES.valenciano);
  assert.equal(classifyLabel('Cambiar a Valenciano'), LANGUAGES.valenciano);
  assert.equal(classifyLabel('ca Català'), LANGUAGES.valenciano);
  assert.equal(classifyLabel('Castellano'), LANGUAGES.espanol);
  assert.equal(classifyLabel('ES'), LANGUAGES.espanol);
  assert.equal(classifyLabel('Switch to English'), LANGUAGES.ingles);
  assert.equal(classifyLabel('en'), LANGUAGES.ingles);
  assert.equal(classifyLabel('Deutsch'), LANGUAGES.otro);
});

test('classifyLabel accepts common wording around the language name', () => {
  assert.equal(classifyLabel('English version'), LANGUAGES.ingles);
  assert.equal(classifyLabel('Página en español'), LANGUAGES.espanol);
  assert.equal(classifyLabel('Web en valenciano'), LANGUAGES.valenciano);
  assert.equal(classifyLabel('Español (España)'), LANGUAGES.espanol);
  assert.equal(classifyLabel('Web'), null);
});

test('classifyLabel ignores ordinary text that only mentions Valencia', () => {
  assert.equal(classifyLabel('Diputación de Valencia'), null);
  assert.equal(classifyLabel('Av. País Valenciano, 76'), null);
  assert.equal(classifyLabel('Generalitat Valenciana'), null);
  assert.equal(classifyLabel('València'), null);
  assert.equal(classifyLabel(''), null);
  assert.equal(classifyLabel('a'), null);
});

test('languageFromCode maps html lang and hreflang codes', () => {
  assert.equal(languageFromCode('ca'), LANGUAGES.valenciano);
  assert.equal(languageFromCode('ca-ES-valencia'), LANGUAGES.valenciano);
  assert.equal(languageFromCode('va-VA'), LANGUAGES.valenciano);
  assert.equal(languageFromCode('es-ES'), LANGUAGES.espanol);
  assert.equal(languageFromCode('en-US'), LANGUAGES.ingles);
  assert.equal(languageFromCode('fr'), LANGUAGES.otro);
  assert.equal(languageFromCode('zxx'), null);
  assert.equal(languageFromCode(''), null);
});

test('detectTextLanguage identifies Spanish, Valencian and English text', () => {
  const es = 'El Ayuntamiento informa a los vecinos de que el plazo para las ayudas está abierto. '
    .repeat(4) + 'Consulta las noticias y los trámites con el horario de atención para más información.';
  const va = "L'Ajuntament informa als veïns que el termini per a les ajudes està obert amb tota la informació. "
    .repeat(4) + 'Consulta les notícies i els tràmits amb l’horari d’atenció per a més informació també.';
  const en = 'The Town Council informs residents that the period for the grants is open and you can read more. '
    .repeat(4) + 'Check the news and contact our office for more information about this.';
  assert.equal(detectTextLanguage(es).language, LANGUAGES.espanol);
  assert.equal(detectTextLanguage(va).language, LANGUAGES.valenciano);
  assert.equal(detectTextLanguage(en).language, LANGUAGES.ingles);
});

test('detectTextLanguage handles short landing pages with portal vocabulary', () => {
  const altea = 'Altea Et donem la benvinguda a Altea WEB MUNICIPAL ÀREES TRANSPARÈNCIA SEU ELECTRÒNICA';
  const spanish = 'Bienvenidos AYUNTAMIENTO TRANSPARENCIA SEDE ELECTRÓNICA TURISMO';
  assert.equal(detectTextLanguage(altea).language, LANGUAGES.valenciano);
  assert.equal(detectTextLanguage(spanish).language, LANGUAGES.espanol);
});

test('detectTextLanguage does not count e-mail and web domains as Valencian', () => {
  const contacts = 'info@gmail.com www.ayuntamiento.com '.repeat(10);
  assert.equal(detectTextLanguage(contacts).scores.valenciano, 0);
});

test('detectTextLanguage reports whether the result is strong', () => {
  assert.equal(detectTextLanguage(SPANISH_TEXT).strong, true);
  assert.equal(detectTextLanguage('Bienvenidos AYUNTAMIENTO TRANSPARENCIA SEDE').strong, false);
});

test('detectTextLanguage returns null for short or mixed text', () => {
  assert.equal(detectTextLanguage('Inicio').language, null);
  assert.equal(detectTextLanguage('').language, null);
  const mixed = 'los vecinos con las ayudas para '.repeat(6) + 'els veïns amb les ajudes per a '.repeat(6);
  assert.equal(detectTextLanguage(mixed).language, null);
});

test('analysePage: switcher with active Valencian option', () => {
  const result = analysePage({
    htmlLang: 'ca', text: '', translateWidget: false,
    candidates: [link('VA', { href: '/va', active: true }), link('ES', { href: '/es' })],
  }, PAGE);
  assert.equal(result.eleccionIdioma, true);
  assert.equal(result.idiomaDefecto, LANGUAGES.valenciano);
  assert.equal(result.fuenteIdioma, 'selector');
  assert.deepEqual(result.opcionesIdioma, [LANGUAGES.valenciano, LANGUAGES.espanol]);
});

test('analysePage: no switcher falls back to text, then to html lang', () => {
  const spanish = 'los vecinos con las ayudas para el ayuntamiento y también noticias '.repeat(6);
  const byText = analysePage({ htmlLang: 'ca', text: spanish, translateWidget: false, candidates: [] }, PAGE);
  assert.equal(byText.eleccionIdioma, false);
  assert.equal(byText.idiomaDefecto, LANGUAGES.espanol);
  assert.equal(byText.fuenteIdioma, 'texto');

  const byLang = analysePage({ htmlLang: 'es-ES', text: 'Inicio', translateWidget: false, candidates: [] }, PAGE);
  assert.equal(byLang.idiomaDefecto, LANGUAGES.espanol);
  assert.equal(byLang.fuenteIdioma, 'atributo lang');

  const unknown = analysePage({ htmlLang: '', text: '', translateWidget: false, candidates: [] }, PAGE);
  assert.equal(unknown.idiomaDefecto, '');
});

test('analysePage: a translation widget counts as a language choice', () => {
  const result = analysePage({ htmlLang: 'es', text: '', translateWidget: true, candidates: [] }, PAGE);
  assert.equal(result.eleccionIdioma, true);
});

test('analysePage ignores links to other sites and content links with hreflang', () => {
  const result = analysePage({
    htmlLang: 'es', text: '', translateWidget: false,
    candidates: [
      link('es', { href: 'https://twitter.com/ayto' }),
      link('Fiestas 2026', { href: '/noticias/fiestas-2026', hreflang: 'es' }),
      link('', { href: '/noticias/una-noticia-larga-sobre-algo', lang: 'es' }),
    ],
  }, PAGE);
  assert.equal(result.eleccionIdioma, false);
});

test('analysePage accepts flags without text and Valencian subdomains', () => {
  const flags = analysePage({
    htmlLang: 'es', text: '', translateWidget: false,
    candidates: [link('', { href: '/va/', hreflang: 'ca' }), link('', { href: '/es/', hreflang: 'es' })],
  }, PAGE);
  assert.equal(flags.eleccionIdioma, true);
  assert.deepEqual(flags.opcionesIdioma, [LANGUAGES.valenciano, LANGUAGES.espanol]);

  const subdomain = analysePage({
    htmlLang: 'es', text: '', translateWidget: false,
    candidates: [link('valencia', { href: 'http://va.example.es/' }), link('castellano', { href: 'http://www.example.es/' })],
  }, PAGE);
  assert.deepEqual(subdomain.opcionesIdioma, [LANGUAGES.valenciano, LANGUAGES.espanol]);
});

test('analysePage ignores language spans inside the switcher links', () => {
  // <a href="/va"><span>VA</span></a><a href="/es"><span>ES</span></a> on a Spanish page
  const result = analysePage(snapshot({
    text: SPANISH_TEXT,
    candidates: [link('VA', { href: '/va' }), marker('VA', { insideLink: true }),
      link('ES', { href: '/es' }), marker('ES', { insideLink: true })],
  }), PAGE);
  assert.equal(result.idiomaDefecto, LANGUAGES.espanol);
  assert.equal(result.fuenteIdioma, 'texto');
});

test('analysePage: strong text beats a loose marker, explicit active option beats text', () => {
  const stray = analysePage(snapshot({
    text: SPANISH_TEXT,
    candidates: [link('VA', { href: '/va' }), link('ES', { href: '/es' }), marker('EN')],
  }), PAGE);
  assert.equal(stray.idiomaDefecto, LANGUAGES.espanol);

  const explicit = analysePage(snapshot({
    text: SPANISH_TEXT,
    candidates: [link('VA', { href: '/va', active: true }), link('ES', { href: '/es' })],
  }), PAGE);
  assert.equal(explicit.idiomaDefecto, LANGUAGES.valenciano);
  assert.equal(explicit.fuenteIdioma, 'selector');
});

test('analysePage needs flags for two languages before calling it a switcher', () => {
  const logo = analysePage(snapshot({ candidates: [link('', { href: '/', lang: 'es' })] }), PAGE);
  assert.equal(logo.eleccionIdioma, false);
});

test('isInterstitial detects anti-bot and challenge pages', () => {
  assert.equal(isInterstitial(snapshot({ title: 'www.peniscola.org | Protección Anti-DDoS y Firewall' })), true);
  assert.equal(isInterstitial(snapshot({ title: 'Just a moment...' })), true);
  assert.equal(isInterstitial(snapshot({ text: 'Checking your browser before accessing the site' })), true);
  assert.equal(isInterstitial(snapshot({ title: 'Un momento…' })), true);
  assert.equal(isInterstitial(snapshot({ text: 'Verificando que eres humano. Esto puede tardar unos segundos.' })), true);
  assert.equal(isInterstitial(snapshot({ text: 'Verifying you are human. This may take a few seconds.' })), true);
  assert.equal(isInterstitial(snapshot({ title: 'Ayuntamiento de Altea', text: 'Et donem la benvinguda' })), false);
});

test('analysePage uses a non-link current-language marker when a switcher exists', () => {
  const result = analysePage({
    htmlLang: '', text: '', translateWidget: false,
    candidates: [marker('VAL'), link('CAS', { href: '/es/inicio' })],
  }, PAGE);
  assert.equal(result.idiomaDefecto, LANGUAGES.valenciano);
  assert.equal(result.fuenteIdioma, 'selector');
  assert.deepEqual(result.opcionesIdioma, [LANGUAGES.espanol, LANGUAGES.valenciano]);
});
