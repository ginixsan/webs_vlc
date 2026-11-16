import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  LABEL_VOCABULARY, LANGUAGES, analysePage, collectLanguageSnapshot,
} from './language.mjs';

const PAGE = 'https://www.example.es/';
const SPANISH = '<p>' + 'Los vecinos con las ayudas para el ayuntamiento y también noticias. '.repeat(6) + '</p>';
let browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

// Runs collectLanguageSnapshot in a real page, then the Node-side analysis.
async function analyseHtml(html) {
  const page = await browser.newPage();
  try {
    await page.setContent(`<html lang="es"><head><title>Ayuntamiento</title></head><body>${html}</body></html>`);
    const snapshot = await page.evaluate(collectLanguageSnapshot, {
      maxTextChars: 20000, vocabulary: LABEL_VOCABULARY,
    });
    return { snapshot, result: analysePage(snapshot, PAGE) };
  } finally {
    await page.close();
  }
}

test('switcher links wrapping spans: Spanish page stays Spanish', async () => {
  const { result } = await analyseHtml(
    `<nav><a href="/va"><span>VA</span></a> <a href="/es"><span>ES</span></a></nav>${SPANISH}`,
  );
  assert.equal(result.eleccionIdioma, true);
  assert.equal(result.idiomaDefecto, LANGUAGES.espanol);
  assert.deepEqual(result.opcionesIdioma, [LANGUAGES.valenciano, LANGUAGES.espanol]);
});

test('data-lang spans and an aria-label on a long link count as language choices', async () => {
  const spans = await analyseHtml('<span data-lang="va">VA</span><span data-lang="es">ES</span>');
  assert.equal(spans.result.eleccionIdioma, true);
  const long = await analyseHtml(
    '<a href="/va" aria-label="Valencià">Cambiar el idioma de toda la página web a la otra lengua</a>',
  );
  assert.deepEqual(long.result.opcionesIdioma, [LANGUAGES.valenciano]);
});

test('a huge menu before the switcher does not hide it', async () => {
  const menu = Array.from({ length: 600 }, (_, i) => `<li><a href="/p${i}">Ayuntamiento de Agost ${i}</a></li>`).join('');
  const { snapshot, result } = await analyseHtml(
    `<ul>${menu}</ul><a href="/va/">Valencià</a> <a href="/es/">Castellano</a>`,
  );
  assert.ok(snapshot.candidates.length < 10, `only language-like elements are kept (${snapshot.candidates.length})`);
  assert.equal(result.eleccionIdioma, true);
});

test('a logo link with lang="es" alone is not a language selector', async () => {
  const { result } = await analyseHtml(`<a href="/" lang="es"><img src="logo.png"></a>${SPANISH}`);
  assert.equal(result.eleccionIdioma, false);
  assert.equal(result.idiomaDefecto, LANGUAGES.espanol);
});

test('links whose text contains escaped <img> markup are still recognised', async () => {
  const { result } = await analyseHtml(
    '<a href="/va/inici/">&lt;img src="https://example.es/wp-content/flags/ca.png" alt="Valencià"&gt; Valencià</a>'
    + '<a href="/es/inicio/">&lt;img src="https://example.es/wp-content/flags/es.png" alt="Español"&gt; Español</a>',
  );
  assert.deepEqual(result.opcionesIdioma, [LANGUAGES.valenciano, LANGUAGES.espanol]);
});

test('language widgets rendered inside a shadow DOM are found', async () => {
  const { result } = await analyseHtml(
    '<div id="widget"></div><script>'
    + 'document.getElementById("widget").attachShadow({ mode: "open" }).innerHTML ='
    + ' \'<a href="#" data-lang="ca">CA</a><a href="#" data-lang="es">ES</a>\';</script>',
  );
  assert.equal(result.eleccionIdioma, true);
});

test('the active option in a translator select decides the default language', async () => {
  const { result } = await analyseHtml(
    '<select><option value="">Idioma</option><option value="ca">Valencià</option>'
    + '<option value="es" selected>Castellano</option></select>',
  );
  assert.equal(result.eleccionIdioma, true);
  assert.equal(result.idiomaDefecto, LANGUAGES.espanol);
  assert.equal(result.fuenteIdioma, 'selector');
});
