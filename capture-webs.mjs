import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { exists, integerOption, sameFile, websiteUrl } from './cli-utils.mjs';
import {
  LABEL_VOCABULARY, analysePage, collectLanguageSnapshot, isInterstitial,
} from './language.mjs';
import { backupOnce, mergePreviousColumns, readCsv, writeCsvAtomic } from './csv-output.mjs';
import { evaluateSettled, loadHomepage } from './page-utils.mjs';
import { isForeignRedirect } from './redirects.mjs';

const LANGUAGE_COLUMNS = ['eleccion_idioma', 'idioma_defecto'];
const MAX_TEXT_CHARS = 20000;

const help = `Usage: npm run capture -- [csv-path] [options]

Default CSV: ~/Downloads/Municipios_542_web_comprobadas_actualizado.csv

Options:
  --output <folder>     Screenshot folder (default: ./webs)
  --csv-output <file>   CSV to write with the language columns (default: the input
                        CSV, updated in place; the first run keeps a <file>.bak copy).
                        An existing output keeps its earlier values when resuming
  --start-row <n>       First CSV row to process (default: 2; header is row 1)
  --limit <n>           Process at most n rows
  --skip-existing       Skip rows whose screenshot and language columns are done
  --no-screenshots      Only detect languages; do not save screenshots
  --timeout <ms>        Navigation/screenshot timeout (default: 45000)
  --wait-ms <ms>        Extra rendering time after load (default: 2000)
  --viewport-only       Capture just the initial 1440x1000 viewport
  --headed              Show the Chromium browser
  --help                Show this help

Screenshots: {csv_row_number}_{Municipio}.png
Full-page screenshots are the default. Unsupported filename characters are
replaced with underscores; accents, spaces, and apostrophes are preserved.
Each run writes capture-results.json in the output folder.

Language columns (added to the CSV after every row):
  eleccion_idioma  true/false: the page has language buttons, links or a translator
  idioma_defecto   español/valenciano/inglés/otro: language shown on first load;
                   empty when it cannot be determined
Rows that fail to load (or only show an anti-bot page) keep their previous values,
which are empty if the row was never checked.
`;

function filenameFor(rowNumber, municipality) {
  const safeName = municipality.normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '') || 'Municipio';
  return `${rowNumber}_${safeName}.png`;
}

function languageDone(record) {
  return ['true', 'false'].includes(record.eleccion_idioma);
}

async function detectLanguages(page) {
  const snapshot = await evaluateSettled(page, collectLanguageSnapshot, {
    maxTextChars: MAX_TEXT_CHARS, vocabulary: LABEL_VOCABULARY,
  }, { isBlocked: isInterstitial });
  return analysePage(snapshot, page.url());
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', default: 'webs' },
      'csv-output': { type: 'string' },
      'start-row': { type: 'string', default: '2' },
      limit: { type: 'string' },
      'skip-existing': { type: 'boolean', default: false },
      'no-screenshots': { type: 'boolean', default: false },
      timeout: { type: 'string', default: '45000' },
      'wait-ms': { type: 'string', default: '2000' },
      'viewport-only': { type: 'boolean', default: false },
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
  const output = path.resolve(values.output);
  const csvOutput = path.resolve(values['csv-output'] ?? csvPath);
  const screenshots = !values['no-screenshots'];
  const startRow = integerOption(values['start-row'], '--start-row', 2);
  const limit = values.limit === undefined ? Infinity : integerOption(values.limit, '--limit', 1);
  const timeout = integerOption(values.timeout, '--timeout', 1);
  const waitMs = integerOption(values['wait-ms'], '--wait-ms', 0);

  const { headers: inputHeaders, records: inputRecords } = await readCsv(csvPath);
  const inPlace = await sameFile(csvPath, csvOutput);
  // Resuming into a separate output: keep the language values it already has.
  const records = !inPlace && await exists(csvOutput)
    ? mergePreviousColumns(inputRecords, (await readCsv(csvOutput)).records, LANGUAGE_COLUMNS)
    : inputRecords;
  const csvHeaders = [...inputHeaders, ...LANGUAGE_COLUMNS.filter((name) => !inputHeaders.includes(name))];
  // Language values found in this run, by record index; merged into the CSV after every row.
  const languageUpdates = new Map();
  const backupState = { done: !inPlace };
  const saveCsv = async () => {
    await backupOnce(csvPath, backupState);
    await writeCsvAtomic(csvOutput, csvHeaders, records.map((record, index) => ({
      ...record, ...languageUpdates.get(index),
    })));
  };
  // Numbers refer to CSV records, counting the header as row 1. Quoted multiline
  // fields belong to a single record and do not shift subsequent record numbers.
  const selected = records.map((record, index) => ({ record, rowNumber: index + 2 }))
    .filter(({ rowNumber }) => rowNumber >= startRow)
    .slice(0, limit);
  if (!selected.length) throw new Error('No CSV rows match the requested range.');

  await mkdir(output, { recursive: true });
  const results = [];
  const browser = await chromium.launch({ headless: !values.headed });
  try {
    // Deliberately sequential: never start the next municipality before this one finishes.
    for (const { record, rowNumber } of selected) {
      const municipality = record.Municipio.trim();
      const filename = filenameFor(rowNumber, municipality);
      const destination = path.join(output, filename);
      const result = { row: rowNumber, municipality, website: record.web, filename };
      let context;
      try {
        const screenshotDone = !screenshots || await exists(destination);
        if (values['skip-existing'] && screenshotDone && languageDone(record)) {
          result.status = 'skipped';
          console.log(`[${rowNumber}] Already done: ${municipality}`);
        } else {
          const url = websiteUrl(record.web);
          console.log(`[${rowNumber}] ${municipality}: ${url}`);
          // A fresh context keeps each website's cookies and storage isolated.
          context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            deviceScaleFactor: 1,
            locale: 'es-ES',
            ignoreHTTPSErrors: true,
          });
          const page = await context.newPage();
          page.setDefaultTimeout(timeout);
          page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
          await loadHomepage(page, url, { timeout, waitMs });
          // Detect languages before the screenshot so a screenshot timeout does not lose them.
          const languages = await detectLanguages(page);
          // Checked after detection too: injected scripts may redirect while the page is analysed.
          if (isForeignRedirect(url, page.url())) {
            throw new Error(`Redirected to another site: ${page.url()}`);
          }
          languageUpdates.set(rowNumber - 2, {
            eleccion_idioma: String(languages.eleccionIdioma),
            idioma_defecto: languages.idiomaDefecto,
          });
          Object.assign(result, languages);
          console.log(`  Languages: eleccion_idioma=${languages.eleccionIdioma}, `
            + `idioma_defecto=${languages.idiomaDefecto || '?'} (${languages.fuenteIdioma})`);
          if (screenshots && !(values['skip-existing'] && screenshotDone)) {
            await page.screenshot({
              path: destination,
              fullPage: !values['viewport-only'],
              animations: 'disabled',
              timeout,
            });
            console.log(`  Saved ${filename}`);
          }
          result.status = 'saved';
          result.finalUrl = page.url();
        }
      } catch (error) {
        result.status = 'failed';
        result.error = error.message;
        console.error(`  Failed row ${rowNumber} (${municipality}): ${error.message}`);
      } finally {
        if (context) await context.close();
      }
      results.push(result);
      // Persist after every row so completed work is recorded during long runs.
      await writeFile(path.join(output, 'capture-results.json'), JSON.stringify({
        csvPath, csvOutput, results,
      }, null, 2) + '\n');
      if (languageUpdates.has(rowNumber - 2)) await saveCsv();
    }
  } finally {
    await browser.close();
  }

  const count = (status) => results.filter((result) => result.status === status).length;
  console.log(`Finished: ${count('saved')} saved, ${count('skipped')} skipped, ${count('failed')} failed.`);
  console.log(`Output: ${output}`);
  console.log(`CSV with language columns: ${csvOutput}`);
  if (count('failed')) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
