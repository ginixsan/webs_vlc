import { access, copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

const REQUIRED_COLUMNS = ['Municipio', 'web'];

// Parse quoted semicolons and the UTF-8 BOM correctly; never split CSV lines manually.
export async function readCsv(file) {
  let headers = [];
  const records = parse(await readFile(file, 'utf8'), {
    bom: true,
    delimiter: ';',
    skip_empty_lines: true,
    columns: (names) => {
      headers = names.map((header) => header.trim());
      for (const required of REQUIRED_COLUMNS) {
        if (!headers.includes(required)) throw new Error(`Missing CSV column in ${file}: ${required}`);
      }
      return headers;
    },
  });
  return { headers, records };
}

function csvField(value) {
  const text = value == null ? '' : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Same format as the input: UTF-8 with BOM, ';' separator and CRLF between records.
export function toCsv(headers, records) {
  const lines = [headers, ...records.map((record) => headers.map((header) => record[header]))]
    .map((cells) => cells.map(csvField).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

// Write to a temporary file and rename it, so an interrupted run never leaves a half-written CSV.
export async function writeCsvAtomic(file, headers, records) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, toCsv(headers, records), 'utf8');
  await rename(temporary, file);
}

// Keep the very first backup: later runs must not replace it with an already modified file.
export async function backupOnce(file, state) {
  if (state.done) return;
  const backup = `${file}.bak`;
  try {
    await access(backup);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(file, backup);
  }
  state.done = true;
}

/**
 * Copies `columns` from a previous output into the input records (new objects), so a run that
 * writes to a separate --csv-output file can be resumed without losing earlier results.
 */
export function mergePreviousColumns(records, previous, columns) {
  if (previous.length !== records.length) {
    throw new Error(`Previous output has ${previous.length} rows but the input has ${records.length} rows.`);
  }
  return records.map((record, index) => {
    if (previous[index].Municipio !== record.Municipio) {
      throw new Error(`Previous output row ${index + 2} is "${previous[index].Municipio}", expected "${record.Municipio}".`);
    }
    // A blank in the older output must not erase a value the input already has.
    const kept = Object.fromEntries(columns
      .filter((column) => column in previous[index] && (previous[index][column] !== '' || !record[column]))
      .map((column) => [column, previous[index][column]]));
    return { ...record, ...kept };
  });
}
