import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import {
  exists, integerOption, parseRows, sameFile, websiteUrl,
} from './cli-utils.mjs';
import { backupOnce, mergePreviousColumns, readCsv, writeCsvAtomic } from './csv-output.mjs';
import {
  BEHAVIOUR_COLUMN, COLUMNS, FINAL_COLUMN, INNER_COLUMNS, INNER_PREFIX, LOCALES, applyVisits,
  classifyBehaviour, createDetector, finalResult, isDone, isLandingCandidate, visitHomepage,
} from './default-language-core.mjs';

const help = `Usage: npm run default-language -- [csv-path] [options]

Opens each homepage three times in a new browser context (no cookies or cache), with the
browser language set to es-ES, ca-ES-valencia and en-US, and records what each visit returned.

Default CSV: ~/Downloads/Municipios_542_web_comprobadas_actualizado.csv

Options:
  --csv-output <file>  CSV to write (default: the input CSV, updated in place; the first run
                       keeps a <file>.bak copy). An existing output keeps its earlier values
  --results <file>     Raw evidence as JSON lines, appended after every visit (default:
                       output/default-language/visits.jsonl, or inner-visits.jsonl)
  --inner-pages        Re-check landing pages: only rows that are revisar and returned the
                       same URL and lang in all visits. Each visit follows the link to the
                       municipal website and fills interior_* columns instead
  --rows <list>        Only these CSV rows, comma-separated. With --inner-pages they replace
                       the automatic choice, so rows already classified can be re-checked
  --final-only         Recalculate resultado_idioma for every row without visiting any site
  --start-row <n>      First CSV row to process (default: 2; header is row 1)
  --limit <n>          Process at most n rows
  --skip-existing      Skip rows already classified as fijo or adaptativo
  --timeout <ms>       Navigation timeout (default: 45000)
  --wait-ms <ms>       Extra rendering time after load (default: 2000)
  --headed             Show the Chromium browser
  --help               Show this help

Columns added (es_, va_ and en_ versions of the first four):
  es_url_final           Final URL after any redirects
  es_lang                lang attribute of <html>, as written by the site
  es_hreflang            hreflang values of <link rel="alternate">, sorted and joined with |
  es_idioma_texto        Language of the visible text according to CLD3 (ca = Valencian/Catalan)
  comportamiento_idioma  fijo: same text language in the three visits
                         adaptativo: it changes, and the URL, lang or text really changed
                         revisar: the detector is unsure or names a language other than es, ca, en;
                                  its label flips on an unchanged page; or lang changes per visit
                                  while the text language does not
                         sin_datos: a visit failed or had no identifiable language
  resultado_idioma       The result to analyse, recalculated on every save: fijo_español,
                         fijo_valenciano, fijo_inglés, adaptativo, revisar or sin_datos.
                         A fixed inner page (interior_*) decides over the homepage label
`;

function checkedUrl(record) {
  try {
    return { url: websiteUrl(record.web) };
  } catch (error) {
    return { error: `Invalid web value: ${error.message}` };
  }
}

async function visitAllLocales(getBrowser, record, evidence, options) {
  const { url, error } = checkedUrl(record);
  const visits = {};
  // Deliberately sequential: one request at a time to each municipal server.
  for (const [key, locale] of Object.entries(LOCALES)) {
    visits[key] = url
      ? await visitHomepage(await getBrowser(), url, locale, options)
      : { locale, requestedAt: new Date().toISOString(), error, textLanguage: '' };
    await appendFile(evidence.file, `${JSON.stringify({
      runId: evidence.runId, row: evidence.row, municipio: record.Municipio, web: record.web, key, ...visits[key],
    })}\n`);
  }
  return visits;
}

function describe(visits, behaviour) {
  const languages = Object.entries(visits)
    .map(([key, visit]) => `${key}=${visit.error ? 'ERROR' : visit.textLanguage || '?'}`).join(' ');
  const kept = behaviour !== classifyBehaviour(visits) ? ' (kept earlier result)' : '';
  return `${languages} -> ${behaviour}${kept}`;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'csv-output': { type: 'string' },
      results: { type: 'string' },
      'inner-pages': { type: 'boolean', default: false },
      rows: { type: 'string' },
      'final-only': { type: 'boolean', default: false },
      'start-row': { type: 'string', default: '2' },
      limit: { type: 'string' },
      'skip-existing': { type: 'boolean', default: false },
      timeout: { type: 'string', default: '45000' },
      'wait-ms': { type: 'string', default: '2000' },
      headed: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (positionals.length > 1) throw new Error('Provide only one CSV path.');

  const csvPath = path.resolve(positionals[0] ?? path.join(
    homedir(), 'Downloads', 'Municipios_542_web_comprobadas_actualizado.csv',
  ));
  const csvOutput = path.resolve(values['csv-output'] ?? csvPath);
  const innerPages = values['inner-pages'];
  const prefix = innerPages ? INNER_PREFIX : '';
  const columns = innerPages ? INNER_COLUMNS : COLUMNS;
  const behaviourColumn = `${prefix}${BEHAVIOUR_COLUMN}`;
  const resultsFile = path.resolve(values.results
    ?? path.join('output', 'default-language', innerPages ? 'inner-visits.jsonl' : 'visits.jsonl'));
  const onlyRows = values.rows === undefined ? null : parseRows(values.rows);
  const startRow = integerOption(values['start-row'], '--start-row', 2);
  const limit = values.limit === undefined ? Infinity : integerOption(values.limit, '--limit', 1);
  const timeout = integerOption(values.timeout, '--timeout', 1);
  const waitMs = integerOption(values['wait-ms'], '--wait-ms', 0);

  const { headers: inputHeaders, records: inputRecords } = await readCsv(csvPath);
  const inPlace = await sameFile(csvPath, csvOutput);
  // Resuming into a separate output: keep the values it already has.
  const records = !inPlace && await exists(csvOutput)
    ? mergePreviousColumns(inputRecords, (await readCsv(csvOutput)).records, columns)
    : inputRecords;
  const csvHeaders = [
    ...inputHeaders.filter((name) => name !== FINAL_COLUMN),
    ...columns.filter((name) => !inputHeaders.includes(name)),
    FINAL_COLUMN,
  ];
  const updated = new Map();
  const backupState = { done: !inPlace };
  const saveCsv = async () => {
    await backupOnce(csvPath, backupState);
    const current = records.map((record, index) => updated.get(index) ?? record);
    await writeCsvAtomic(csvOutput, csvHeaders, current.map((record) => ({
      ...record, [FINAL_COLUMN]: finalResult(record),
    })));
  };
  if (values['final-only']) {
    await saveCsv();
    console.log(`CSV: ${csvOutput}`);
    return;
  }
  // Row numbers count the header as row 1, as in capture-webs.mjs.
  const selected = records.map((record, index) => ({ record, index, row: index + 2 }))
    .filter(({ record, row }) => row >= startRow
      && (onlyRows ? onlyRows.has(row) : (!innerPages || isLandingCandidate(record))))
    .slice(0, limit);
  if (!selected.length) throw new Error('No CSV rows match the requested range.');

  await mkdir(path.dirname(resultsFile), { recursive: true });
  const detector = await createDetector();
  const launch = () => chromium.launch({ headless: !values.headed });
  let browser = await launch();
  // A browser crash during a long run must not stop the remaining visits.
  const getBrowser = async () => {
    if (!browser.isConnected()) browser = await launch();
    return browser;
  };
  const runId = new Date().toISOString();
  const counts = {};
  try {
    for (const { record, index, row } of selected) {
      if (values['skip-existing'] && isDone(record, prefix)) {
        counts.skipped = (counts.skipped ?? 0) + 1;
        continue;
      }
      const visits = await visitAllLocales(getBrowser, record, { file: resultsFile, runId, row }, {
        detector, timeout, waitMs, followInnerPage: innerPages,
      });
      const result = applyVisits(record, visits, prefix);
      updated.set(index, result);
      await saveCsv();
      const behaviour = result[behaviourColumn];
      counts[behaviour] = (counts[behaviour] ?? 0) + 1;
      console.log(`[${row}] ${record.Municipio}: ${describe(visits, behaviour)}`);
    }
  } finally {
    await browser.close();
  }

  console.log(`Finished: ${JSON.stringify(counts)}`);
  console.log(`CSV: ${csvOutput}`);
  console.log(`Raw evidence: ${resultsFile}`);
  if (counts.sin_datos) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
