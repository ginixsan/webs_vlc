import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { backupOnce, mergePreviousColumns, readCsv, toCsv, writeCsvAtomic } from './csv-output.mjs';

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), 'csv-output-test-'));
}

test('readCsv handles the BOM, quoted separators and multiline fields', async () => {
  const file = path.join(await tempDir(), 'in.csv');
  await writeFile(file, '﻿Municipio ;web;Email\r\nAgost;https://a.es/;"x@a.es;y@a.es"\r\nBiar;https://b.es/;"dos\nlíneas"\r\n');
  const { headers, records } = await readCsv(file);
  assert.deepEqual(headers, ['Municipio', 'web', 'Email']);
  assert.equal(records.length, 2);
  assert.equal(records[0].Email, 'x@a.es;y@a.es');
  assert.equal(records[1].Email, 'dos\nlíneas');
});

test('readCsv refuses a file without the required columns', async () => {
  const file = path.join(await tempDir(), 'in.csv');
  await writeFile(file, 'Nombre;web\r\nAgost;https://a.es/\r\n');
  await assert.rejects(readCsv(file), /Missing CSV column.*Municipio/);
});

test('mergePreviousColumns keeps values from an earlier output with the same rows', () => {
  const records = [{ Municipio: 'Agost', web: 'a' }, { Municipio: 'Aigües', web: 'b' }];
  const previous = [
    { Municipio: 'Agost', web: 'a', eleccion_idioma: 'true', idioma_defecto: 'español' },
    { Municipio: 'Aigües', web: 'b', eleccion_idioma: '', idioma_defecto: '' },
  ];
  const merged = mergePreviousColumns(records, previous, ['eleccion_idioma', 'idioma_defecto']);
  assert.deepEqual(merged[0], { Municipio: 'Agost', web: 'a', eleccion_idioma: 'true', idioma_defecto: 'español' });
  assert.equal(merged[1].eleccion_idioma, '');
  assert.equal(records[0].eleccion_idioma, undefined, 'input records are not mutated');
});

test('mergePreviousColumns does not let a blank earlier value erase a value in the input', () => {
  const records = [{ Municipio: 'Agost', eleccion_idioma: 'true' }];
  const previous = [{ Municipio: 'Agost', eleccion_idioma: '' }];
  assert.equal(mergePreviousColumns(records, previous, ['eleccion_idioma'])[0].eleccion_idioma, 'true');
});

test('mergePreviousColumns refuses an output that does not match the input rows', () => {
  const records = [{ Municipio: 'Agost' }];
  assert.throws(() => mergePreviousColumns(records, [], ['x']), /rows/);
  assert.throws(() => mergePreviousColumns(records, [{ Municipio: 'Biar' }], ['x']), /Agost/);
});

test('backupOnce copies the file only if no backup exists yet', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'data.csv');
  await writeFile(file, 'original');
  await backupOnce(file, { done: false });
  await writeFile(file, 'changed');
  await backupOnce(file, { done: false });
  assert.equal(await readFile(`${file}.bak`, 'utf8'), 'original');
});

test('writeCsvAtomic writes the CSV and leaves no temporary file', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'out.csv');
  await writeCsvAtomic(file, ['a'], [{ a: '1' }]);
  assert.equal(await readFile(file, 'utf8'), '﻿a\r\n1\r\n');
  assert.deepEqual(await readdir(dir), ['out.csv']);
});

test('toCsv writes a BOM, semicolons and CRLF line endings', () => {
  const csv = toCsv(['a', 'b'], [{ a: '1', b: '2' }]);
  assert.equal(csv, '﻿a;b\r\n1;2\r\n');
});

test('toCsv quotes fields with separators, quotes and line breaks', () => {
  const csv = toCsv(['a'], [{ a: 'x;y' }, { a: 'say "hi"' }, { a: 'line1\nline2' }]);
  assert.equal(csv, '﻿a\r\n"x;y"\r\n"say ""hi"""\r\n"line1\nline2"\r\n');
});

test('toCsv writes empty strings for missing values', () => {
  assert.equal(toCsv(['a', 'b'], [{ a: '1' }]), '﻿a;b\r\n1;\r\n');
});

test('toCsv output parses back to the same records', () => {
  const records = [
    { Municipio: "Alcúdia, l'", Email: 'a@x.es;b@x.es', Nota: 'dos\nlíneas', eleccion_idioma: 'true' },
    { Municipio: 'Agost', Email: '', Nota: '"citado"', eleccion_idioma: 'false' },
  ];
  const headers = Object.keys(records[0]);
  const parsed = parse(toCsv(headers, records), { bom: true, delimiter: ';', columns: true });
  assert.deepEqual(parsed, records);
});
