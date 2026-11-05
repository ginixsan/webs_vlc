# Municipality homepage screenshots

Reads the semicolon-separated CSV in order, visits each `web` address with
Playwright Chromium, and saves a full-page PNG in `webs/`.

## Setup

Requires Node.js 20 or newer.

```sh
npm install
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
