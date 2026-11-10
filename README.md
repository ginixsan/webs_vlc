# Research code: Official on request

Research software accompanying Ginés Sanz Sanchis’s article, “Official on request:
Technical defaults and the unequal standing of Valencian speakers on municipal
websites.” The study covers the websites of all 542 municipalities in the Valencian
Country (Valencian Community, Spain).

The scripts read a semicolon-separated CSV, visit municipal websites with
Playwright Chromium, capture screenshots, detect language controls and default
languages, and compare responses to different browser-language preferences.
Automated observations require the manual checks described below.

## Software versions used in the study

| Software | Study version |
|---|---|
| Node.js | 24.13.0 |
| Playwright | 1.64.1 |
| Chrome Headless Shell | 156.0.8078.4 (Playwright revision 1248) |
| cld3-asm | 4.0.0 |
| csv-parse | 7.0.3 |

These are the versions recorded for the main study crawl. The article reports
that the follow-up checks of Xaló and Xeraco on 7 November 2026 used Google
Chrome 155.0.8059.85 and Node.js 26.3.0 instead. Later executions should record
their own environment rather than assume they use the historical versions.

Use Node.js 24.13.0 and `npm ci` to install the JavaScript dependencies recorded
in `package-lock.json`. Unlike `npm install`, this preserves the locked dependency
versions. Install the associated browser with `npx playwright install chromium`.
Check the installed environment before collecting data:

```sh
node --version
npm ls playwright cld3-asm csv-parse
node --input-type=module -e 'import { chromium } from "playwright"; const browser = await chromium.launch(); console.log(browser.version()); await browser.close();'
```

## Repeating the procedure

1. Prepare a UTF-8, semicolon-separated CSV with one row per municipality and
   the exact headers `Municipio` (municipality name) and `web` (website address).
   Other columns are retained. Use the study’s archived address list when
   repeating its coverage; for a new collection, validate the addresses and
   document replacements. The scripts do not obtain a complete municipal census
   or independently verify that each address belongs to the intended authority.
2. Install the dependencies and browser as described above. Keep the input CSV,
   software versions, collection dates, commands and code version with the results.
3. Capture the landing pages with Spanish as the browser language. For example,
   from the repository directory, with `municipalities.csv` as the input:

   ```sh
   npm run capture -- municipalities.csv --csv-output observations.csv --output webs
   ```

   This captures full pages and records detected language controls and default
   language. Review failed rows in `webs/capture-results.json`; retry selected
   ranges with `--start-row` and `--limit`, using `--timeout 60000` and, where
   needed, `--viewport-only`. Archive each run’s JSON report before another run
   in the same output folder replaces it. Record retry settings and dates.
4. If language detection needs a separate pass without screenshots, run:

   ```sh
   npm run capture -- observations.csv --no-screenshots
   ```

5. Compare the landing pages under the three browser-language preferences:

   ```sh
   npm run default-language -- observations.csv --results output/default-language/visits.jsonl
   ```

   Each homepage is visited with `es-ES`, `ca-ES-valencia` and `en-US`, using a
   fresh browser context for each visit. The script records redirects, HTML
   `lang`, alternative-language `hreflang` annotations and CLD3 text-language
   results. Visits run sequentially. See the output definitions below.
6. Review `revisar`, `sin_datos`, failed requests and mixed-language pages against
   the screenshots and visit evidence. Manually check language selectors in fresh
   browser sessions: activate the option, record the destination and language of
   the main content, and distinguish mixed content and machine-translation
   widgets from an available version in the other language. Repeat the check in
   the opposite direction. The scripts detect controls but do not establish that
   those controls lead to usable content in the other language.
7. Preserve the CSV, screenshots, request logs and manual-check records together.
   Raw `visits.jsonl` includes visible page text; the article’s deposited request
   log excludes that text. Prepare a separate export without page text for that
   deposit and exclude personal contact fields from source datasets as described
   in the article.

The optional `--inner-pages` procedure documented below follows links beyond the
landing page. Those observations were not used in the article: use the homepage
columns for its landing-page analysis. `resultado_idioma` can incorporate inner-page
results and must not replace the homepage observations when reproducing that analysis.
The scripts do not reproduce the article’s manual platform/layout checks, population
and political-data joins, or statistical tables automatically.

Municipal websites change over time. A new crawl repeats the measurement procedure;
it need not return the historical observations collected in October–November 2026.

## Applying the code to another territory

There is no hard-coded limit of 542 municipalities. Supply a different CSV path to
both commands; this avoids the study-specific default filename in Downloads.
Keep the required `Municipio` and `web` headers to reuse the code unchanged.
For a study of the same languages, the address list may be the only necessary
change. For other languages or website conventions, review these code locations:

| File / setting | Adaptation |
|---|---|
| `capture-webs.mjs`: `browser.newContext` | Change the initial `locale: 'es-ES'` to the baseline browser language for the new study. |
| `language.mjs`: `LANGUAGES`, `LABEL_WORDS`, `LABEL_FILLER`, `TEXT_MARKERS` | Replace language names, selector labels and abbreviations, and text markers with those appropriate to the languages studied. |
| `language.mjs`: `languageFromCode`, `VALENCIAN_LINK`, `LANG_PATH`, `LANG_QUERY` | Adapt recognized language codes and language-specific URL patterns; review other language-specific matching rules in the same file. |
| `default-language-core.mjs`: `LOCALES` | Set the browser locales and request-header values to compare. Its keys also define output-column prefixes. |
| `default-language-core.mjs`: `LANGUAGE_NAMES`, `STUDY_LANGUAGES`, `declaredLanguage` | Update expected CLD3 codes, output labels and normalization of HTML language declarations. CLD3 reports Valencian/Catalan as `ca`; check support for the new languages. |
| `default-language-core.mjs`: `PORTADA_PATH`, `MUNICIPAL_SITE_TEXT`, `GATEWAY_TEXT` | Adapt the optional inner-page link recognition to local words and URL conventions. |
| `default-language-core.mjs`: `finalResult` | This function currently reads `es_idioma_texto` for fixed-language results. If the `es` locale key is removed or renamed, update that reference for homepage and inner-page results. |
| `csv-output.mjs`, `capture-webs.mjs`, `default-language.mjs` | If changing input headers, update both the required-column validation and every `record.Municipio` / `record.web` access. Adapt CSV parsing and serialization together if changing the delimiter. |
| Tests and README | Update expected language labels, locales, headers, examples and output descriptions to match the adapted protocol. Run `npm test` before collecting data. |

Validate the adapted heuristics against manually checked pages in the target
languages, including short and mixed-language pages. Define local territorial,
population and institutional categories separately: these are study inputs and
interpretive choices, not settings supplied by the crawler.

## License

The original source code and this README are licensed under the MIT License;
see [LICENSE](LICENSE). Copyright (c) 2026 Ginés Sanz Sanchis.
Research data and the screenshot collection are licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), to the extent of the
author’s rights. See [webs/LICENSE.md](webs/LICENSE.md) and
[output/LICENSE.md](output/LICENSE.md) for scope, attribution and third-party
exclusions. Municipal website content and externally sourced materials retain
their respective rights and applicable original licenses. Third-party software
dependencies retain their own licenses. The accompanying article is not covered
by these repository licenses.

## Setup

Requires Node.js 20 or newer.

```sh
npm ci
npx playwright install chromium
```

## Run

```sh
npm run capture -- "/Users/ginixsan/Downloads/Municipios_542_web_comprobadas_actualizado.csv"
```

The CSV path is optional; it defaults to that filename in your Downloads folder.
Output defaults to `webs/` in the current working directory.

The header counts as CSV row 1, so the first files are:

```text
webs/2_Agost.png
webs/3_Aigües.png
webs/4_Alicante.png
```

Row numbers refer to CSV records, ignoring empty lines; a quoted field spanning
multiple lines still belongs to one record. Accents and spaces are preserved in
municipality names; characters unsafe in filenames, such as `/`, become `_`.

Try the first three websites:

```sh
npm run capture -- --limit 3
```

Resume without recapturing existing files:

```sh
npm run capture -- --start-row 100 --skip-existing
```

Capture only the initial 1440×1000 viewport instead of the entire page:

```sh
npm run capture -- --viewport-only
```

Run `npm run capture -- --help` for all options, including a custom output folder,
navigation timeout, rendering delay, and visible browser mode.

Websites are processed one at a time. Failed or missing websites are logged and
the script continues with the next CSV row. `webs/capture-results.json` records
the current run's saved, skipped, and failed rows; it is updated after each row
and replaced on the next run. The process exits with status 1 if any row fails.
Existing screenshots are overwritten unless `--skip-existing` is set.

Screenshots preserve the site's initial appearance, including cookie banners.
HTTPS certificate errors are ignored to accommodate older municipal websites.

## Language columns

While each page is open, the script also checks its languages and writes two
columns to the CSV after every row:

| Column | Values | Meaning |
|---|---|---|
| `eleccion_idioma` | `true` / `false` | The page has language buttons, links, a language `<select>` or a translation widget |
| `idioma_defecto` | `español` / `valenciano` / `inglés` / `otro` / empty | Language shown on first load (browser locale `es-ES`); empty when it cannot be determined |

`idioma_defecto` is decided in this order:

1. the option the language selector marks as active (class, `aria-current`, selected `<option>`);
2. a clear majority in a long visible text (function words of each language);
3. a standalone current-language marker next to the selector, such as `<li class="lang"><span>VAL</span></li>`;
4. a majority in a short visible text, such as a portal landing page;
5. the `<html lang>` attribute.

`capture-results.json` records which source was used (`fuenteIdioma`), the
languages offered (`opcionesIdioma`) and the text scores. Rows that fail to
load, or only show an anti-bot page, keep their previous values, which are
empty if the row was never checked.

By default the input CSV is updated in place. The first run keeps a copy as
`<csv>.bak`, and later runs never overwrite it. Use `--csv-output <file>` to
write elsewhere instead. If that file already exists and has the same rows, its
language values are kept, so a run can be resumed with `--skip-existing`. To
detect languages without taking screenshots:

```sh
npm run capture -- --no-screenshots
```

With `--skip-existing`, rows that already have a screenshot and language values
are skipped, so an interrupted run can be resumed.

## Default language (fixed or following the visitor)

`default-language.mjs` opens each homepage three times, each in a new browser
context with no cookies or cache. The browser `locale` and the `Accept-Language`
header are both set to `es-ES`, `ca-ES-valencia` and `en-US` in turn.

```sh
npm run default-language -- "/path/to/municipios.csv"
```

It takes about 2.5 to 3 hours for all municipalities, because visits run one at
a time. Interrupted runs continue with `--skip-existing`. Run
`npm run default-language -- --help` for all options.

It adds 13 columns: four per visit, with the prefixes `es_`, `va_` and `en_`, plus
the classification.

| Column | Meaning |
|---|---|
| `es_url_final` | Final URL after any redirects |
| `es_lang` | `lang` attribute of `<html>`, exactly as the site writes it |
| `es_hreflang` | `hreflang` values of `<link rel="alternate">`, sorted and joined with `\|` |
| `es_idioma_texto` | Language of the visible text according to CLD3 |
| `comportamiento_idioma` | See below |

`comportamiento_idioma` takes one of four values:

- `fijo`: the three visits return the same text language.
- `adaptativo`: the language changes and the page really changed: the URL or `lang`
  differs, or the texts share under 60% of their words.
- `revisar`: the detector marked a visit as unreliable or named a language other than
  `es`, `ca` or `en`; or its label changed on a page
  that otherwise stayed the same, which homepages mixing Spanish and Valencian can do;
  or the page declares a different `lang` per visit while the text stays in one language.
- `sin_datos`: a visit failed or had no identifiable language.

CLD3 returns ISO codes and reports Valencian as `ca`, because no mainstream
detector separates Valencian from Catalan.

A read is accepted once the URL and text length stop changing between two reads a
second apart. Pages with under 200 characters of text, which are often still loading,
are watched for up to 8 seconds. A redirect that fires later than this on a page
that already looks settled is not seen.

The evidence behind each visit is appended to
`output/default-language/visits.jsonl`: the visible text and its hash, detector
confidence, HTTP status, `Content-Language`, `Vary`, `Link` headers, `<a hreflang>`
values and any error. Each line has a `runId`, and reruns append new lines.

A visit fails on HTTP errors, timeouts, anti-bot pages that do not clear, suspended
hosting or database error pages, pages that hang for 2 minutes, and redirects to an
unrelated domain. A rerun that fails or is
inconclusive keeps the row's earlier `fijo` or `adaptativo` result.

### Landing pages

Some homepages are only a few tiles ("AJUNTAMENT, SEU ELECTRÒNICA"), too little text
for a reliable language. `--inner-pages` re-checks the rows that are `revisar` and
returned the same URL and `lang` in the three visits:

```sh
npm run default-language -- "/path/to/municipios.csv" --inner-pages
```

Each visit opens the homepage and follows the link to the municipal website in the
same context: a `/portada` link, otherwise one named "web municipal" or "Ajuntament".
Results go to 13 `interior_*` columns with the same meaning as the homepage ones,
which stay as measured, and the evidence goes to
`output/default-language/inner-visits.jsonl`. A row with no such link gets
`interior_comportamiento_idioma=sin_datos`.

To re-check other rows, such as very short homepages already classified as `fijo`
from their tile text, name them with `--rows 280,283,284`.

### Final result

`resultado_idioma`, the last column, is the value to analyse for each municipality:
`fijo_español`, `fijo_valenciano`, `fijo_inglés`, `adaptativo`, `revisar` or `sin_datos`.

- If either the homepage or the inner page is `adaptativo`, the result is `adaptativo`.
- Otherwise a `fijo` inner page decides the language, even over a `fijo` homepage,
  because a homepage with only tiles can show a different language from the site.
- Otherwise the homepage decides.

It is recalculated for every row each time the CSV is saved. To recalculate it without
visiting any site:

```sh
npm run default-language -- "/path/to/municipios.csv" --final-only
```

## Tests

Run the tests with `npm test`. `snapshot.test.mjs` and `default-language.test.mjs`
start Playwright Chromium; the latter also uses a local HTTP server to check that
visits send the exact header and do not share cookies or cache.

API references: [Playwright Page](https://playwright.dev/docs/api/class-page)
and [CSV parser options](https://csv.js.org/parse/options/).
