#!/usr/bin/env python3
"""Stream a PanLex CSV snapshot into the supplemental evidence SQLite schema.

Unmapped PanLex sources deliberately share the non-production
``panlex-unmapped`` family. A reviewed family map is required before records can
count as independent lexical evidence.
"""

import argparse
import csv
import gzip
import json
import sqlite3
import unicodedata
from collections import defaultdict
from pathlib import Path


TABLE_FILES = {
    "langvar": ("langvar", "lv"),
    "expr": ("expr", "ex"),
    "denotation": ("denotation", "dn"),
    "meaning": ("meaning", "mn"),
    "source": ("source", "ap"),
}
LANG_CODES = {
    "eng": "en",
    "por": "pt-BR",
    "cmn": "zh",
    "zho": "zh",
    "jpn": "ja",
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--family-map", help="JSON mapping PanLex source IDs to reviewed families")
    parser.add_argument("--max-terms-per-meaning", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=10000)
    return parser.parse_args()


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", str(value)).casefold().split())


def open_text(path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8-sig", newline="")
    return path.open("r", encoding="utf-8-sig", newline="")


def find_table(snapshot_dir, names):
    suffixes = (".csv", ".tsv", ".csv.gz", ".tsv.gz")
    for name in names:
        for suffix in suffixes:
            path = snapshot_dir / f"{name}{suffix}"
            if path.exists():
                return path
    raise FileNotFoundError(f"Missing PanLex table {names} in {snapshot_dir}")


def rows(path):
    with open_text(path) as handle:
        sample = handle.read(8192)
        handle.seek(0)
        delimiter = "\t" if path.name.endswith((".tsv", ".tsv.gz")) else ","
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=",\t").delimiter
        except csv.Error:
            pass
        yield from csv.DictReader(handle, delimiter=delimiter)


def value(row, *aliases, required=True):
    lowered = {str(key).strip().lower(): item for key, item in row.items()}
    for alias in aliases:
        item = lowered.get(alias.lower())
        if item is not None and str(item).strip() != "":
            return str(item).strip()
    if required:
        raise KeyError(f"Missing columns {aliases}; available={sorted(lowered)}")
    return None


def create_schema(db):
    db.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE evidence_sources (
          source_key TEXT PRIMARY KEY,
          source_family TEXT NOT NULL,
          lang TEXT NOT NULL,
          lexicon_spec TEXT NOT NULL,
          license TEXT NOT NULL,
          metadata_json TEXT NOT NULL
        );
        CREATE TABLE lexical_evidence (
          id INTEGER PRIMARY KEY,
          source_key TEXT NOT NULL REFERENCES evidence_sources(source_key),
          source_family TEXT NOT NULL,
          lang TEXT NOT NULL,
          term TEXT NOT NULL,
          normalized_key TEXT NOT NULL,
          english_gloss TEXT NOT NULL,
          english_normalized_key TEXT NOT NULL,
          concept_id TEXT NOT NULL,
          UNIQUE(source_key, lang, normalized_key, english_gloss, concept_id)
        );
        CREATE INDEX idx_lexical_evidence_lookup
          ON lexical_evidence(lang, normalized_key);
        CREATE INDEX idx_lexical_evidence_english
          ON lexical_evidence(lang, english_normalized_key);
        CREATE TEMP TABLE stage_expr (
          expr_id TEXT PRIMARY KEY,
          lang TEXT NOT NULL,
          term TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TEMP TABLE stage_denotation (
          meaning_id TEXT NOT NULL,
          expr_id TEXT NOT NULL,
          PRIMARY KEY (meaning_id, expr_id)
        ) WITHOUT ROWID;
        CREATE TEMP TABLE stage_meaning (
          meaning_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL
        ) WITHOUT ROWID;
        """
    )


def load_family_map(path):
    if not path:
        return {}
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    mapping = data.get("sources", data)
    return {str(key): str(item) for key, item in mapping.items()}


def main():
    args = parse_args()
    if args.max_terms_per_meaning < 1 or args.batch_size < 1:
        raise ValueError("Batch and meaning limits must be positive")
    snapshot_dir = Path(args.snapshot_dir).resolve()
    paths = {name: find_table(snapshot_dir, aliases) for name, aliases in TABLE_FILES.items()}
    family_map = load_family_map(args.family_map)
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    db = sqlite3.connect(out)
    create_schema(db)

    selected_langvars = {}
    for row in rows(paths["langvar"]):
        langvar_id = value(row, "id", "lv", "langvar_id")
        uid = value(row, "uid", "langvar_uid", required=False)
        code = value(row, "lang_code", "lc", "lang", required=False)
        if not code and uid:
            code = uid.split("-", 1)[0]
        output_lang = LANG_CODES.get(str(code or "").lower())
        if output_lang:
            selected_langvars[langvar_id] = output_lang

    expr_ids = set()
    expr_batch = []
    for row in rows(paths["expr"]):
        langvar_id = value(row, "langvar", "lv", "langvar_id")
        lang = selected_langvars.get(langvar_id)
        if not lang:
            continue
        expr_id = value(row, "id", "ex", "expr_id")
        term = value(row, "txt", "text", "term")
        if not term:
            continue
        expr_ids.add(expr_id)
        expr_batch.append((expr_id, lang, term))
        if len(expr_batch) >= args.batch_size:
            db.executemany("INSERT OR IGNORE INTO stage_expr VALUES (?, ?, ?)", expr_batch)
            expr_batch.clear()
    if expr_batch:
        db.executemany("INSERT OR IGNORE INTO stage_expr VALUES (?, ?, ?)", expr_batch)
    db.commit()

    meaning_ids = set()
    denotation_batch = []
    for row in rows(paths["denotation"]):
        expr_id = value(row, "expr", "ex", "expr_id")
        if expr_id not in expr_ids:
            continue
        meaning_id = value(row, "meaning", "mn", "meaning_id")
        meaning_ids.add(meaning_id)
        denotation_batch.append((meaning_id, expr_id))
        if len(denotation_batch) >= args.batch_size:
            db.executemany("INSERT OR IGNORE INTO stage_denotation VALUES (?, ?)", denotation_batch)
            denotation_batch.clear()
    if denotation_batch:
        db.executemany("INSERT OR IGNORE INTO stage_denotation VALUES (?, ?)", denotation_batch)
    db.commit()

    source_ids = set()
    meaning_batch = []
    for row in rows(paths["meaning"]):
        meaning_id = value(row, "id", "mn", "meaning_id")
        if meaning_id not in meaning_ids:
            continue
        source_id = value(row, "source", "ap", "source_id")
        source_ids.add(source_id)
        meaning_batch.append((meaning_id, source_id))
        if len(meaning_batch) >= args.batch_size:
            db.executemany("INSERT OR IGNORE INTO stage_meaning VALUES (?, ?)", meaning_batch)
            meaning_batch.clear()
    if meaning_batch:
        db.executemany("INSERT OR IGNORE INTO stage_meaning VALUES (?, ?)", meaning_batch)
    db.commit()

    source_metadata = {}
    for row in rows(paths["source"]):
        source_id = value(row, "id", "ap", "source_id")
        if source_id in source_ids:
            source_metadata[source_id] = row

    grouped = defaultdict(lambda: defaultdict(list))
    query = """
      SELECT d.meaning_id, m.source_id, e.lang, e.term
      FROM stage_denotation d
      JOIN stage_expr e ON e.expr_id = d.expr_id
      JOIN stage_meaning m ON m.meaning_id = d.meaning_id
      ORDER BY d.meaning_id, e.lang, e.term
    """
    current_meaning = None
    inserted = 0
    skipped_ambiguous = 0
    evidence_rows = []

    def flush(meaning_id, source_id, terms_by_lang):
        nonlocal inserted, skipped_ambiguous
        if not meaning_id or not terms_by_lang.get("en"):
            return
        if any(len(terms) > args.max_terms_per_meaning for terms in terms_by_lang.values()):
            skipped_ambiguous += 1
            return
        source_key = f"panlex-source-{source_id}"
        source_family = family_map.get(source_id, "panlex-unmapped")
        metadata = source_metadata.get(source_id, {})
        db.execute(
            """
            INSERT OR IGNORE INTO evidence_sources
              (source_key, source_family, lang, lexicon_spec, license, metadata_json)
            VALUES (?, ?, 'mul', 'PanLex snapshot', 'CC0', ?)
            """,
            (
                source_key,
                source_family,
                json.dumps(
                    {
                        "panlex_source_id": source_id,
                        "panlex_source": metadata,
                        "production_publishable": source_id in family_map,
                        "requires_family_mapping": source_id not in family_map,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            ),
        )
        for lang in ("pt-BR", "zh", "ja"):
            for term in terms_by_lang.get(lang, []):
                for english in terms_by_lang["en"]:
                    evidence_rows.append(
                        (
                            source_key,
                            source_family,
                            lang,
                            term,
                            normalize(term),
                            english,
                            normalize(english),
                            f"panlex:{meaning_id}",
                        )
                    )
        if len(evidence_rows) >= args.batch_size:
            before = db.total_changes
            db.executemany(
                """INSERT OR IGNORE INTO lexical_evidence
                   (source_key, source_family, lang, term, normalized_key,
                    english_gloss, english_normalized_key, concept_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                evidence_rows,
            )
            inserted += db.total_changes - before
            evidence_rows.clear()

    current_source = None
    current_terms = defaultdict(list)
    for meaning_id, source_id, lang, term in db.execute(query):
        if current_meaning is not None and meaning_id != current_meaning:
            flush(current_meaning, current_source, current_terms)
            current_terms = defaultdict(list)
        current_meaning = meaning_id
        current_source = source_id
        if term not in current_terms[lang]:
            current_terms[lang].append(term)
    flush(current_meaning, current_source, current_terms)
    if evidence_rows:
        before = db.total_changes
        db.executemany(
            """INSERT OR IGNORE INTO lexical_evidence
               (source_key, source_family, lang, term, normalized_key,
                english_gloss, english_normalized_key, concept_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            evidence_rows,
        )
        inserted += db.total_changes - before
    db.commit()
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    counts = dict(db.execute("SELECT lang, COUNT(*) FROM lexical_evidence GROUP BY lang"))
    unmapped = db.execute(
        "SELECT COUNT(*) FROM evidence_sources WHERE source_family = 'panlex-unmapped'"
    ).fetchone()[0]
    db.execute("PRAGMA journal_mode = DELETE")
    db.close()
    print(
        json.dumps(
            {
                "ok": integrity == "ok",
                "integrity": integrity,
                "rows": inserted,
                "by_lang": counts,
                "selected_langvars": len(selected_langvars),
                "selected_expressions": len(expr_ids),
                "selected_meanings": len(meaning_ids),
                "panlex_sources": len(source_ids),
                "unmapped_sources": unmapped,
                "skipped_ambiguous_meanings": skipped_ambiguous,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
