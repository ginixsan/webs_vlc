import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exists, integerOption, parseRows, sameFile, websiteUrl } from './cli-utils.mjs';

test('parseRows reads a comma-separated list of CSV rows', () => {
  assert.deepEqual([...parseRows('5, 2,5,10')].sort((a, b) => a - b), [2, 5, 10]);
  assert.throws(() => parseRows('2,abc'), /--rows must be an integer >= 2/);
  assert.throws(() => parseRows('1'), /--rows/, 'row 1 is the header');
  assert.throws(() => parseRows(''), /--rows/);
});

test('integerOption accepts valid integers and rejects the rest', () => {
  assert.equal(integerOption('5', '--limit', 1), 5);
  assert.throws(() => integerOption('0', '--limit', 1), /--limit must be an integer >= 1/);
  assert.throws(() => integerOption('abc', '--limit', 1), /--limit/);
});

test('websiteUrl normalises addresses and rejects invalid ones', () => {
  assert.equal(websiteUrl(' https://www.agost.es/ '), 'https://www.agost.es/');
  assert.equal(websiteUrl('www.agost.es'), 'https://www.agost.es/');
  assert.throws(() => websiteUrl(''), /Missing web/);
  assert.throws(() => websiteUrl('ftp://x.es'), /Unsupported website|Invalid URL/);
  assert.throws(() => websiteUrl('no es una url'), /Invalid URL/);
});

test('exists and sameFile resolve real paths and links', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-utils-test-'));
  const file = path.join(dir, 'a.csv');
  const link = path.join(dir, 'link.csv');
  await writeFile(file, 'x');
  await symlink(file, link);
  assert.equal(await exists(file), true);
  assert.equal(await exists(path.join(dir, 'missing.csv')), false);
  assert.equal(await sameFile(file, file), true);
  assert.equal(await sameFile(file, link), true);
  assert.equal(await sameFile(file, path.join(dir, 'missing.csv')), false);
});
