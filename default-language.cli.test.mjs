import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readCsv } from './csv-output.mjs';

const run = promisify(execFile);
const SCRIPT = path.join(import.meta.dirname, 'default-language.mjs');
const SPANISH = 'El Ayuntamiento informa a los vecinos de que el plazo para las ayudas está abierto con toda la información. '.repeat(3);
const VALENCIAN = "L'Ajuntament informa als veïns que el termini per a les ajudes està obert amb tota la informació. ".repeat(3);
const FAST = ['--wait-ms', '0'];
let server;
let origin;
let downVisits = 0;
let siteIsUp = false;

function html(lang, body) {
  return `<!doctype html><html lang="${lang}"><head><title>Ayuntamiento</title></head><body>${body}</body></html>`;
}

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const language = req.headers['accept-language'] ?? '';
    if (req.url === '/fixed/') {
      res.end(html('es', SPANISH));
    } else if (req.url === '/adaptive/') {
      res.end(language.startsWith('ca') ? html('ca', VALENCIAN) : html('es', SPANISH));
    } else if (req.url === '/landing/') {
      res.end(html('ca', '<a href="/ca/portada"><img src="/logo.png"></a><p>AJUNTAMENT</p>'));
    } else if (req.url === '/ca/portada') {
      res.end(html('ca', VALENCIAN));
    } else if (req.url === '/flaky/') {
      downVisits += 1;
      res.statusCode = siteIsUp ? 200 : 503;
      res.end(html('es', SPANISH));
    } else {
      res.statusCode = 404;
      res.end('missing');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function workspace() {
  const dir = await mkdtemp(path.join(tmpdir(), 'default-language-cli-'));
  const csv = path.join(dir, 'in.csv');
  await writeFile(csv, `﻿Municipio;web;Nota\r\nFijo;${origin}/fixed/;"a;b"\r\nSinWeb;;\r\n`
    + `Adaptativo;${origin}/adaptive/;"dos\nlíneas"\r\nCaido;${origin}/flaky/;x\r\n`);
  return { dir, csv, out: path.join(dir, 'out.csv'), results: path.join(dir, 'visits.jsonl') };
}

async function runScript(args) {
  try {
    const { stdout } = await run(process.execPath, [SCRIPT, ...args], { timeout: 120000 });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test('a full run classifies each row, survives a bad web value and keeps the other columns', async () => {
  siteIsUp = false;
  const { csv, out, results } = await workspace();
  const { code, stdout } = await runScript([csv, '--csv-output', out, '--results', results, ...FAST]);
  assert.equal(code, 1, 'exit status 1 because some rows have no data');
  assert.match(stdout, /SinWeb/);
  const { headers, records } = await readCsv(out);
  assert.deepEqual(headers.slice(0, 3), ['Municipio', 'web', 'Nota']);
  assert.equal(headers.length, 17);
  assert.equal(headers.at(-1), 'resultado_idioma');
  assert.deepEqual(records.map((r) => r.comportamiento_idioma), ['fijo', 'sin_datos', 'adaptativo', 'sin_datos']);
  assert.deepEqual(records.map((r) => r.resultado_idioma), ['fijo_español', 'sin_datos', 'adaptativo', 'sin_datos']);
  assert.equal(records[0].Nota, 'a;b');
  assert.equal(records[2].Nota, 'dos\nlíneas');
  assert.equal(records[2].va_idioma_texto, 'ca');
  assert.equal(records[2].es_idioma_texto, 'es');
  const lines = (await readFile(results, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 12, 'three evidence lines per row');
  assert.equal(new Set(lines.map((line) => line.runId)).size, 1);
  assert.ok(lines.filter((line) => line.municipio === 'SinWeb').every((line) => /web/i.test(line.error)));
});

test('--skip-existing only retries rows without a conclusive result', async () => {
  siteIsUp = false;
  const { csv, out, results } = await workspace();
  await runScript([csv, '--csv-output', out, '--results', results, ...FAST]);
  const before = await readCsv(out);
  siteIsUp = true;
  downVisits = 0;
  const { stdout } = await runScript([csv, '--csv-output', out, '--results', results, '--skip-existing', ...FAST]);
  const { records } = await readCsv(out);
  assert.doesNotMatch(stdout, /\[2\] Fijo/);
  assert.equal(downVisits, 3, 'the failed site is visited once per locale');
  assert.equal(records[3].comportamiento_idioma, 'fijo');
  assert.equal(records[0].es_url_final, before.records[0].es_url_final);
  assert.equal(records[2].comportamiento_idioma, 'adaptativo');
});

test('a rerun where the site fails does not erase an earlier result', async () => {
  siteIsUp = true;
  const { csv, out, results } = await workspace();
  await runScript([csv, '--csv-output', out, '--results', results, ...FAST]);
  assert.equal((await readCsv(out)).records[3].comportamiento_idioma, 'fijo');
  siteIsUp = false;
  const { stdout } = await runScript([csv, '--csv-output', out, '--results', results, ...FAST]);
  assert.equal((await readCsv(out)).records[3].comportamiento_idioma, 'fijo');
  assert.match(stdout, /Caido.*kept earlier result/);
});

test('--inner-pages only re-checks landing candidates and keeps the homepage columns', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'default-language-inner-'));
  const csv = path.join(dir, 'in.csv');
  const results = path.join(dir, 'inner.jsonl');
  const landing = `${origin}/landing/`;
  const fixed = `${origin}/fixed/`;
  const columns = 'Municipio;web;es_url_final;es_lang;es_idioma_texto;va_url_final;va_lang;en_url_final;en_lang;comportamiento_idioma';
  await writeFile(csv, `﻿${columns}\r\n`
    + `Tiles;${landing};${landing};ca;ro;${landing};ca;${landing};ca;revisar\r\n`
    + `Normal;${fixed};${fixed};es;es;${fixed};es;${fixed};es;fijo\r\n`);
  const { stdout } = await runScript([csv, '--inner-pages', '--results', results, ...FAST]);
  assert.doesNotMatch(stdout, /Normal/);
  const { headers, records } = await readCsv(csv);
  assert.ok(headers.includes('interior_comportamiento_idioma'));
  assert.equal(headers.at(-1), 'resultado_idioma', 'the final column stays last');
  assert.equal(records[0].interior_comportamiento_idioma, 'fijo');
  assert.equal(records[0].resultado_idioma, 'fijo_valenciano');
  assert.equal(records[1].resultado_idioma, 'fijo_español');
  assert.equal(records[0].interior_es_idioma_texto, 'ca');
  assert.equal(new URL(records[0].interior_en_url_final).pathname, '/ca/portada');
  assert.equal(records[0].comportamiento_idioma, 'revisar', 'homepage columns unchanged');
  assert.equal(records[0].es_idioma_texto, 'ro');
  assert.equal(records[1].interior_comportamiento_idioma, '');
  const lines = (await readFile(results, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.equal(new URL(lines[0].landingUrl).pathname, '/landing/');
});

test('--rows chooses the rows, including ones already classified as fijo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'default-language-rows-'));
  const csv = path.join(dir, 'in.csv');
  const results = path.join(dir, 'inner.jsonl');
  const landing = `${origin}/landing/`;
  const columns = 'Municipio;web;es_url_final;es_lang;es_idioma_texto;va_url_final;va_lang;en_url_final;en_lang;comportamiento_idioma;interior_comportamiento_idioma';
  await writeFile(csv, `﻿${columns}\r\n`
    + `Otra;${landing};${landing};ca;ca;${landing};ca;${landing};ca;fijo;\r\n`
    + `Corta;${landing};${landing};ca;es;${landing};ca;${landing};ca;fijo;\r\n`
    + `Pendiente;${landing};${landing};ca;ro;${landing};ca;${landing};ca;revisar;\r\n`);
  const { stdout } = await runScript([csv, '--inner-pages', '--rows', '3', '--results', results, ...FAST]);
  assert.match(stdout, /\[3\] Corta/);
  assert.doesNotMatch(stdout, /Otra|Pendiente/);
  const { records } = await readCsv(csv);
  assert.equal(records[1].interior_comportamiento_idioma, 'fijo');
  assert.equal(records[1].interior_es_idioma_texto, 'ca');
  assert.equal(records[1].es_idioma_texto, 'es', 'homepage columns unchanged');
  assert.equal(records[1].comportamiento_idioma, 'fijo');
  assert.equal(records[0].interior_comportamiento_idioma, '');
  assert.equal(records[2].interior_comportamiento_idioma, '');
});

test('--final-only fills the final column for every row without visiting any site', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'default-language-final-'));
  const csv = path.join(dir, 'in.csv');
  const out = path.join(dir, 'out.csv');
  const results = path.join(dir, 'never.jsonl');
  const columns = 'Municipio;web;es_idioma_texto;comportamiento_idioma;interior_es_idioma_texto;interior_comportamiento_idioma;Nota';
  await writeFile(csv, `﻿${columns}\r\n`
    + `Silla;${origin}/flaky/;es;fijo;ca;fijo;"a;b"\r\n`
    + `Mislata;${origin}/flaky/;es;adaptativo;;;x\r\n`
    + `Elda;${origin}/flaky/;es;fijo;;;y\r\n`
    + `Monovar;${origin}/flaky/;ca;revisar;;sin_datos;z\r\n`);
  downVisits = 0;
  const { code } = await runScript([csv, '--final-only', '--csv-output', out, '--results', results]);
  assert.equal(code, 0);
  assert.equal(downVisits, 0, 'no site is visited');
  const { headers, records } = await readCsv(out);
  assert.equal(headers.at(-1), 'resultado_idioma');
  assert.deepEqual(records.map((r) => r.resultado_idioma), ['fijo_valenciano', 'adaptativo', 'fijo_español', 'revisar']);
  assert.equal(records[0].Nota, 'a;b');
  await assert.rejects(readFile(results, 'utf8'), /ENOENT/, 'no evidence file is created');
});

test('updating the input in place keeps a backup of the original', async () => {
  siteIsUp = true;
  const { csv, results } = await workspace();
  const original = await readFile(csv, 'utf8');
  await runScript([csv, '--results', results, '--limit', '1', ...FAST]);
  assert.equal(await readFile(`${csv}.bak`, 'utf8'), original);
  assert.equal((await readCsv(csv)).records[0].comportamiento_idioma, 'fijo');
});
