"""Interpreta el resultado del protocolo de idioma por defecto y lista los casos especiales.

Uso: python3 -I analyse_default_language.py <csv> <visits.jsonl> <salida_casos.csv>
Escribe un CSV con una fila por caso especial e imprime el resumen.
"""
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from urllib.parse import urlparse

KEYS = ("es", "va", "en")
LOW_PROBABILITY = 0.9
SHORT_TEXT_CHARS = 200
VALID_LANG = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
EXPECTED_FOR_KEY = {"es": "es", "va": "ca", "en": "en"}


def host(url):
    return (urlparse(url).hostname or "").removeprefix("www.")


def base_lang(code):
    code = (code or "").lower().replace("_", "-")
    return "ca" if re.match(r"^(ca|va|vl|val|x-va)(-|$)", code) else code.split("-")[0]


def bad_tag(code):
    """Etiquetas que no significan lo que el sitio pretende (BCP 47)."""
    low = (code or "").lower().replace("_", "-")
    if not low or low == "x-default":
        return None
    meaning = {
        "va": "va no es un idioma ISO (VA es el Vaticano)", "va-va": "idioma va inexistente, región Vaticano",
        "vl": "vl no es un código de idioma", "val": "val es la lengua vehes (ISO 639-3)",
        "x-va": "x-VA es de uso privado", "es-va": "español del Vaticano", "ca-ca": "catalán de Canadá",
        "zxx": "zxx significa sin contenido lingüístico",
    }
    return meaning.get(low)


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh, delimiter=";"))


def read_visits(path):
    """Última visita registrada por (fila, idioma)."""
    latest = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            visit = json.loads(line)
            latest[(visit["row"], visit["key"])] = visit
    return latest


def size_band(population):
    bands = [(1000, "<1.000"), (5000, "1.000-4.999"), (20000, "5.000-19.999"), (50000, "20.000-49.999")]
    return next((label for limit, label in bands if population < limit), ">=50.000")


def triple(row):
    return tuple(row[f"{k}_idioma_texto"] for k in KEYS)


def adaptive_pattern(row):
    es, va, en = triple(row)
    if (es, va, en) == ("es", "ca", "en"):
        return "sigue los tres idiomas"
    if es == "es" and va == "ca":
        return "distingue español y valenciano; inglés cae en " + en
    if es == "es" and va == "es":
        return "valenciano recibe español; inglés recibe " + en
    return f"otro patrón: es={es} va={va} en={en}"


def special_cases(row, number, visits):
    """Devuelve lista de (tipo, detalle) para una fila."""
    cases = []
    name_visits = {k: visits.get((number, k), {}) for k in KEYS}
    behaviour = row["comportamiento_idioma"]
    urls = {row[f"{k}_url_final"] for k in KEYS if row[f"{k}_url_final"]}
    langs = {row[f"{k}_lang"] for k in KEYS if row[f"{k}_url_final"]}
    errors = {k: v.get("error") for k, v in name_visits.items() if v.get("error")}

    if errors:
        kind = "fallo en las tres visitas" if len(errors) == 3 else "fallo solo en algunas visitas"
        cases.append((kind, "; ".join(f"{k}: {e[:90]}" for k, e in errors.items())))
    if behaviour == "revisar":
        hashes = {name_visits[k].get("textSha256") for k in KEYS}
        reliable = all(name_visits[k].get("isReliable") for k in KEYS)
        declared = {base_lang(row[f"{k}_lang"]) for k in KEYS}
        if len(hashes) == 1:
            kind = "revisar: misma página en las tres visitas, poco texto"
        elif len(declared) > 1:
            kind = "revisar: lang cambia con el navegador"
        elif not reliable:
            kind = "revisar: detector inseguro y texto distinto"
        else:
            kind = "revisar: la etiqueta cambia en la misma página"
        text = (name_visits["es"].get("text") or "").replace("\n", " ")
        cases.append((kind, f"lang={row['es_lang']}/{row['va_lang']}/{row['en_lang']}; texto: {' '.join(text.split())[:120]}"))
    if behaviour == "sin_datos" and not errors:
        chars = {k: name_visits[k].get("textChars") for k in KEYS}
        cases.append(("sin texto identificable", f"caracteres: {chars}"))

    if behaviour == "adaptativo":
        same_url = len(urls) == 1
        same_lang = len(langs) == 1
        if same_url and same_lang:
            cases.append(("adaptativo solo por el texto (misma URL y lang)",
                          f"idiomas {triple(row)}; caracteres "
                          f"{[name_visits[k].get('textChars') for k in KEYS]}; "
                          f"prob {[round(name_visits[k].get('probability', 0), 2) for k in KEYS]}"))
        cases.append(("adaptativo", f"{adaptive_pattern(row)}; URLs: "
                      + " | ".join(row[f"{k}_url_final"] for k in KEYS)))

    if behaviour == "fijo":
        if len(urls) > 1:
            cases.append(("fijo por el texto pero cambia la URL", " | ".join(row[f"{k}_url_final"] for k in KEYS)))
        if len(langs) > 1:
            cases.append(("fijo por el texto pero cambia lang", " | ".join(row[f"{k}_lang"] for k in KEYS)))

    for key in KEYS:
        if not row[f"{key}_url_final"]:
            continue
        declared, shown = row[f"{key}_lang"], row[f"{key}_idioma_texto"]
        if declared and shown and base_lang(declared) != shown:
            cases.append(("lang no coincide con el texto", f"{key}: lang={declared} texto={shown}"))
            break
    first = next((k for k in KEYS if row[f"{k}_url_final"]), None)
    if first:
        declared = row[f"{first}_lang"]
        if not declared:
            cases.append(("sin atributo lang", ""))
        else:
            problems = [(row[f"{k}_lang"], bad_tag(row[f"{k}_lang"])) for k in KEYS if bad_tag(row[f"{k}_lang"])]
            if problems:
                cases.append(("valor de lang incorrecto", "; ".join(sorted({f"{a}: {b}" for a, b in problems}))))
        if host(row["web"]) != host(row[f"{first}_url_final"]) and not host(row[f"{first}_url_final"]).endswith("." + host(row["web"])):
            cases.append(("termina en otro dominio", f"{row['web']} -> {row[f'{first}_url_final']}"))
        offered = row[f"{first}_hreflang"]
        if offered and not any(base_lang(v) == "ca" for v in offered.split("|")) and row.get("valenciano") == "true":
            cases.append(("hreflang sin valenciano aunque hay botón", offered))
        wrong = sorted({f"{v}: {bad_tag(v)}" for v in offered.split("|") if bad_tag(v)})
        if wrong:
            cases.append(("hreflang incorrecto", "; ".join(wrong)))
        if offered and any(base_lang(v) == "en" for v in offered.split("|")) and "en" not in triple(row):
            cases.append(("hreflang anuncia inglés pero en-US no lo recibe", offered))

    outside = sorted({row[f"{k}_idioma_texto"] for k in KEYS} - {"es", "ca", "en", ""})
    if outside:
        cases.append(("detector da otro idioma", ", ".join(outside)))
    weak = [k for k in KEYS if name_visits[k].get("probability") is not None and row[f"{k}_url_final"]
            and row[f"{k}_idioma_texto"] and name_visits[k]["probability"] < LOW_PROBABILITY]
    if weak:
        cases.append(("baja confianza del detector",
                      "; ".join(f"{k}: {name_visits[k]['probability']:.2f} ({name_visits[k]['textChars']} car.)" for k in weak)))
    short = [k for k in KEYS if row[f"{k}_url_final"] and (name_visits[k].get("textChars") or 0) < SHORT_TEXT_CHARS]
    if short:
        cases.append(("muy poco texto", "; ".join(f"{k}: {name_visits[k].get('textChars')} car." for k in short)))
    if any(name_visits[k].get("textFromFrames") for k in KEYS):
        cases.append(("texto leído de un iframe", ""))

    if row.get("interior_comportamiento_idioma"):
        inner = row["interior_es_idioma_texto"]
        if inner:
            misled = " (el texto de la portada engaña)" if base_lang(row["es_lang"]) == inner and row["es_idioma_texto"] != inner else ""
            cases.append(("portada de entrada: interior re-comprobado",
                          f"interior {row['interior_comportamiento_idioma']} {inner}; texto de portada {row['es_idioma_texto']}; "
                          f"lang portada {row['es_lang']}{misled}; {row['interior_es_url_final']}"))
        else:
            cases.append(("portada de entrada: sin página interior", "no hay enlace a una web municipal"))
    if behaviour == "fijo" and row.get("interior_comportamiento_idioma") == "fijo" and row["es_idioma_texto"] != row["interior_es_idioma_texto"]:
        cases.append(("etiqueta de portada corregida por el interior",
                      f"portada {row['es_idioma_texto']} -> interior {row['interior_es_idioma_texto']}; lang {row['es_lang']}"))
    if behaviour == "fijo" and (name_visits["es"].get("textChars") or 0) < SHORT_TEXT_CHARS and not row.get("interior_comportamiento_idioma"):
        if row["es_lang"] and base_lang(row["es_lang"]) != row["es_idioma_texto"]:
            cases.append(("portada corta: lang contradice la etiqueta, sin re-comprobar",
                          f"lang={row['es_lang']} texto={row['es_idioma_texto']} ({name_visits['es'].get('textChars')} car.)"))

    if behaviour == "fijo":
        fixed = row.get("interior_es_idioma_texto") or row["es_idioma_texto"]
        earlier = {"español": "es", "valenciano": "ca", "inglés": "en"}.get(row.get("idioma_defecto", ""))
        if earlier and earlier != fixed:
            cases.append(("idioma_defecto anterior no coincide", f"antes {row['idioma_defecto']}, texto {fixed}"))
    return cases


def main(csv_path, visits_path, out_path):
    rows = read_csv(csv_path)
    visits = read_visits(visits_path)
    done = [(i + 2, r) for i, r in enumerate(rows) if r.get("comportamiento_idioma")]
    print(f"filas con resultado: {len(done)} de {len(rows)}; visitas registradas: {len(visits)}")
    print("comportamiento:", Counter(r["comportamiento_idioma"] for _, r in done))
    print("fijo, idioma:", Counter(r["es_idioma_texto"] for _, r in done if r["comportamiento_idioma"] == "fijo"))
    print("triples adaptativos:", Counter(triple(r) for _, r in done if r["comportamiento_idioma"] == "adaptativo"))
    by_province = defaultdict(Counter)
    by_size = defaultdict(Counter)
    for _, r in done:
        behaviour = r["comportamiento_idioma"]
        label = f"fijo {r['es_idioma_texto']}" if behaviour == "fijo" else behaviour
        by_province[r["Provincia"]][label] += 1
        by_size[size_band(int(r["Población"]))][label] += 1
    print("por provincia:", {k: dict(v) for k, v in by_province.items()})
    print("por población:", {k: dict(v) for k, v in by_size.items()})
    print("errores:", Counter((v.get("error") or "")[:40].split(" at ")[0] for v in visits.values() if v.get("error")))
    print("lang (primera visita):", Counter(r["es_lang"] for _, r in done if r["es_url_final"]).most_common(25))
    print("Vary Accept-Language (visita es):",
          sum(1 for (n, k), v in visits.items() if k == "es" and "accept-language" in (v.get("vary") or "").lower()))
    print("con <link hreflang>:", sum(1 for _, r in done if r["es_hreflang"]))
    valores = Counter(v for _, r in done for v in r["es_hreflang"].split("|") if v)
    print("valores hreflang:", valores.most_common(25))

    table = []
    for number, row in done:
        for kind, detail in special_cases(row, number, visits):
            table.append({"tipo": kind, "fila": number, "Provincia": row["Provincia"], "Municipio": row["Municipio"],
                          "web": row["web"], "es": row["es_idioma_texto"], "va": row["va_idioma_texto"],
                          "en": row["en_idioma_texto"], "comportamiento": row["comportamiento_idioma"], "detalle": detail})
    table.sort(key=lambda c: (c["tipo"], c["fila"]))
    with open(out_path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(table[0]) if table else ["tipo"], delimiter=";", lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(table)
    print("casos especiales por tipo:")
    for kind, count in Counter(c["tipo"] for c in table).most_common():
        print(f"  {count:4} {kind}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
