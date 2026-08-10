#!/usr/bin/env python3
"""Export Apertium Chinese/Portuguese evidence aligned through Spanish lemmas."""

import argparse
import json
import shutil
import sqlite3
import unicodedata
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zho-spa", required=True)
    parser.add_argument("--eng-spa", required=True)
    parser.add_argument("--spa-pt", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--base-db")
    parser.add_argument("--max-pivot-terms", type=int, default=6)
    return parser.parse_args()


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def node_text(node):
    parts = []
    if node.text:
        parts.append(node.text)
    for child in node:
        if child.tag == "b":
            parts.append(" ")
        elif child.tag in {"j", "a"}:
            parts.append(child.text or "")
        if child.tail:
            parts.append(child.tail)
    return "".join(parts).strip()


def read_pairs(path):
    pairs = set()
    for _, element in ET.iterparse(path, events=("end",)):
        if element.tag != "e":
            continue
        pair = element.find("p")
        if pair is not None:
            left = node_text(pair.find("l"))
            right = node_text(pair.find("r"))
            if left and right:
                pairs.add((left, right))
        element.clear()
    return pairs


def index_pairs(pairs, pivot_side):
    result = defaultdict(set)
    for left, right in pairs:
        pivot = left if pivot_side == "left" else right
        term = right if pivot_side == "left" else left
        result[normalize(pivot)].add(term)
    return result


def create_schema(db):
    db.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS evidence_sources (
          source_key TEXT PRIMARY KEY,
          source_family TEXT NOT NULL,
          lang TEXT NOT NULL,
          lexicon_spec TEXT NOT NULL,
          license TEXT NOT NULL,
          metadata_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lexical_evidence (
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
        CREATE INDEX IF NOT EXISTS idx_lexical_evidence_lookup
          ON lexical_evidence(lang, normalized_key);
        CREATE INDEX IF NOT EXISTS idx_lexical_evidence_english
          ON lexical_evidence(lang, english_normalized_key);
        """
    )


def insert_language(db, lang, source_key, term_index, english_index, max_terms):
    inserted = 0
    skipped_ambiguous = 0
    rows = []
    for pivot in sorted(set(term_index) & set(english_index)):
        terms = term_index[pivot]
        english_terms = english_index[pivot]
        if len(terms) > max_terms or len(english_terms) > max_terms:
            skipped_ambiguous += 1
            continue
        concept_id = f"apertium-spa:{pivot}"
        for term in terms:
            for english in english_terms:
                rows.append(
                    (
                        source_key,
                        "apertium",
                        lang,
                        term,
                        normalize(term),
                        english,
                        normalize(english),
                        concept_id,
                    )
                )
        if len(rows) >= 10000:
            before = db.total_changes
            db.executemany(
                """
                INSERT OR IGNORE INTO lexical_evidence
                  (source_key, source_family, lang, term, normalized_key,
                   english_gloss, english_normalized_key, concept_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            inserted += db.total_changes - before
            rows.clear()
    if rows:
        before = db.total_changes
        db.executemany(
            """
            INSERT OR IGNORE INTO lexical_evidence
              (source_key, source_family, lang, term, normalized_key,
               english_gloss, english_normalized_key, concept_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        inserted += db.total_changes - before
    return inserted, skipped_ambiguous


def main():
    args = parse_args()
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    if args.base_db:
        shutil.copy2(Path(args.base_db).resolve(), out)

    zho_spa = read_pairs(args.zho_spa)
    eng_spa = read_pairs(args.eng_spa)
    spa_pt = read_pairs(args.spa_pt)
    zho_by_spa = index_pairs(zho_spa, "right")
    eng_by_spa = index_pairs(eng_spa, "right")
    pt_by_spa = index_pairs(spa_pt, "left")

    db = sqlite3.connect(out)
    create_schema(db)
    metadata = {
        "alignment": "deterministic_spanish_lemma_pivot",
        "repos": [
            "apertium/apertium-zho-spa",
            "apertium/apertium-eng-spa",
            "apertium/apertium-es-pt",
        ],
        "max_pivot_terms": args.max_pivot_terms,
        "production_publishable": True,
        "family_count_rule": "all Apertium repositories count as one family",
    }
    for source_key, lang in (("apertium-zho-spa-eng-pivot", "zh"), ("apertium-pt-spa-eng-pivot", "pt-BR")):
        db.execute(
            """
            INSERT OR REPLACE INTO evidence_sources
              (source_key, source_family, lang, lexicon_spec, license, metadata_json)
            VALUES (?, 'apertium', ?, 'Apertium bilingual dictionaries via Spanish pivot',
                    'GPL-2.0/GPL-3.0', ?)
            """,
            (source_key, lang, json.dumps(metadata, ensure_ascii=False, sort_keys=True)),
        )

    zh_count, zh_skipped = insert_language(
        db, "zh", "apertium-zho-spa-eng-pivot", zho_by_spa, eng_by_spa, args.max_pivot_terms
    )
    pt_count, pt_skipped = insert_language(
        db, "pt-BR", "apertium-pt-spa-eng-pivot", pt_by_spa, eng_by_spa, args.max_pivot_terms
    )
    db.commit()
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    total = db.execute("SELECT COUNT(*) FROM lexical_evidence").fetchone()[0]
    db.execute("PRAGMA journal_mode = DELETE")
    db.close()
    print(
        json.dumps(
            {
                "ok": integrity == "ok",
                "integrity": integrity,
                "rows": total,
                "added": {"zh": zh_count, "pt-BR": pt_count},
                "skipped_ambiguous_pivots": {"zh": zh_skipped, "pt-BR": pt_skipped},
                "pair_counts": {"zho-spa": len(zho_spa), "eng-spa": len(eng_spa), "spa-pt": len(spa_pt)},
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
