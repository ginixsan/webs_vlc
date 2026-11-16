import { access, realpath } from 'node:fs/promises';
import path from 'node:path';

export function integerOption(value, name, minimum) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}.`);
  }
  return result;
}

/** "5, 2,10" -> Set {5, 2, 10}. Row 1 is the header, so rows start at 2. */
export function parseRows(value) {
  return new Set(value.split(',').map((part) => integerOption(part.trim() || NaN, '--rows', 2)));
}

export function websiteUrl(value) {
  if (!value.trim()) throw new Error('Missing web value.');
  const input = value.trim();
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error(`Unsupported website: ${input}`);
  }
  // Reject other explicit protocols instead of treating them as hostnames.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^https?:\/\//i.test(input)) {
    throw new Error(`Unsupported website: ${input}`);
  }
  return url.href;
}

export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function sameFile(a, b) {
  if (path.resolve(a) === path.resolve(b)) return true;
  if (!await exists(b)) return false;
  return (await realpath(a)) === (await realpath(b));
}
