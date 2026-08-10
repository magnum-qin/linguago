#!/usr/bin/env python3
"""Export versioned Open WordNet alignments to a small evidence SQLite DB."""

import argparse
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

import wn


LEXICONS = (
    {
        "spec": "own-pt:1.0.0",
        "source_key": "openwn-pt-1.0.0",
        "source_family": "omw",
        "lang": "pt-BR",
        "license": "CC BY-SA",
    },
    {
        "spec": "omw-cmn:2.0",
        "source_key": "chinese-open-wordnet-2.0",
        "source_family": "omw",
        "lang": "zh",
        "license": "WordNet license",
    },
)
ENGLISH_LEXICON = "omw-en:2.0"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wn-dir", required=True)
    parser.add_argument("--out", required=True)
    return parser.parse_args()


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


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


def main():
    args = parse_args()
    wn.config.data_directory = Path(args.wn_dir).resolve()
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    db = sqlite3.connect(out)
    create_schema(db)
    insert_source = db.cursor()
    insert_evidence = db.cursor()
    counts = {}

    for config in LEXICONS:
        wordnet = wn.Wordnet(config["spec"])
        insert_source.execute(
            """
            INSERT INTO evidence_sources
              (source_key, source_family, lang, lexicon_spec, license, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                config["source_key"],
                config["source_family"],
                config["lang"],
                config["spec"],
                config["license"],
                json.dumps({"english_lexicon": ENGLISH_LEXICON}, ensure_ascii=False),
            ),
        )
        inserted = 0
        for synset in wordnet.synsets():
            english_lemmas = {
                word.lemma()
                for translated in synset.translate(lexicon=ENGLISH_LEXICON)
                for word in translated.words()
                if word.lemma().strip()
            }
            if not english_lemmas:
                continue
            terms = {word.lemma() for word in synset.words() if word.lemma().strip()}
            concept_match = re.search(r"(\d{8}-[nvars])$", synset.id)
            concept_id = concept_match.group(1) if concept_match else synset.id
            rows = [
                (
                    config["source_key"],
                    config["source_family"],
                    config["lang"],
                    term,
                    normalize(term),
                    english_lemma,
                    normalize(english_lemma),
                    concept_id,
                )
                for term in terms
                for english_lemma in english_lemmas
            ]
            before = db.total_changes
            insert_evidence.executemany(
                """
                INSERT OR IGNORE INTO lexical_evidence
                  (source_key, source_family, lang, term, normalized_key,
                   english_gloss, english_normalized_key, concept_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            inserted += db.total_changes - before
        counts[config["source_key"]] = inserted
        db.commit()

    db.execute("PRAGMA journal_mode = DELETE")
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    total = db.execute("SELECT COUNT(1) FROM lexical_evidence").fetchone()[0]
    db.close()
    print(
        json.dumps(
            {"ok": integrity == "ok", "integrity": integrity, "rows": total, "sources": counts},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
