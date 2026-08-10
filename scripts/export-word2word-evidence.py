#!/usr/bin/env python3
"""Export Apache-2.0 word2word lexicons into the supplemental evidence schema."""

import argparse
import json
import pickle
import sqlite3
import unicodedata
from pathlib import Path


PAIR_CONFIGS = (
    ("zh_cn-en.pkl", "zh", "target_to_en"),
    ("en-zh_cn.pkl", "zh", "en_to_target"),
    ("pt_br-en.pkl", "pt-BR", "target_to_en"),
    ("en-pt_br.pkl", "pt-BR", "en_to_target"),
    ("ja-en.pkl", "ja", "target_to_en"),
    ("en-ja.pkl", "ja", "en_to_target"),
)


class DataOnlyUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        raise pickle.UnpicklingError(f"global objects are forbidden: {module}.{name}")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default=".tmp/word2word")
    parser.add_argument("--out", default=".tmp/word2word/word2word-evidence.db")
    parser.add_argument("--base-db")
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument(
        "--langs",
        default="zh,pt-BR,ja",
        help="comma-separated target languages to export",
    )
    return parser.parse_args()


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", str(value)).casefold().split())


def has_artifact(value):
    text = str(value)
    return "\ufffd" in text or "<" in text or ">" in text or "&amp;" in text


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
        """
    )


def copy_base(db, base_path):
    if not base_path:
        return 0
    db.execute("ATTACH DATABASE ? AS base_evidence", (str(base_path),))
    db.execute("INSERT INTO evidence_sources SELECT * FROM base_evidence.evidence_sources")
    db.execute(
        """
        INSERT INTO lexical_evidence
          (source_key, source_family, lang, term, normalized_key,
           english_gloss, english_normalized_key, concept_id)
        SELECT source_key, source_family, lang, term, normalized_key,
               english_gloss, english_normalized_key, concept_id
        FROM base_evidence.lexical_evidence
        """
    )
    count = db.execute("SELECT COUNT(*) FROM lexical_evidence").fetchone()[0]
    db.commit()
    db.execute("DETACH DATABASE base_evidence")
    return count


def load_lexicon(file_path):
    with file_path.open("rb") as handle:
        value = DataOnlyUnpickler(handle).load()
    if not isinstance(value, tuple) or len(value) != 3:
        raise ValueError(f"unexpected word2word payload in {file_path}")
    word_to_source, target_to_word, source_to_targets = value
    if not all(isinstance(item, dict) for item in value):
        raise ValueError(f"unexpected word2word dictionaries in {file_path}")
    return word_to_source, target_to_word, source_to_targets


def main():
    args = parse_args()
    if args.top_k < 1 or args.top_k > 10:
        raise ValueError("--top-k must be between 1 and 10")
    input_dir = Path(args.input_dir).resolve()
    out = Path(args.out).resolve()
    base = Path(args.base_db).resolve() if args.base_db else None
    selected_langs = {value.strip() for value in args.langs.split(",") if value.strip()}
    selected_configs = [config for config in PAIR_CONFIGS if config[1] in selected_langs]
    if not selected_configs:
        raise ValueError("--langs did not select any supported language")
    for file_name, _, _ in selected_configs:
        if not (input_dir / file_name).exists():
            raise FileNotFoundError(input_dir / file_name)
    if base and not base.exists():
        raise FileNotFoundError(base)

    out.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(f"{out}{suffix}")
        if candidate.exists():
            candidate.unlink()

    db = sqlite3.connect(out)
    create_schema(db)
    base_rows = copy_base(db, base)
    insert_source = db.cursor()
    insert_row = db.cursor()
    counts = {}

    for file_name, lang, direction in selected_configs:
        source_key = f"word2word-{file_name[:-4]}"
        insert_source.execute(
            """
            INSERT INTO evidence_sources
              (source_key, source_family, lang, lexicon_spec, license, metadata_json)
            VALUES (?, 'corpus_word2word', ?, ?, 'Apache-2.0', ?)
            """,
            (
                source_key,
                lang,
                f"kakaobrain/word2word:{file_name}",
                json.dumps(
                    {
                        "derived_from": "OpenSubtitles2018",
                        "evidence_strength": "weak_corpus",
                        "top_k": args.top_k,
                    },
                    ensure_ascii=False,
                ),
            ),
        )
        word_to_source, target_to_word, source_to_targets = load_lexicon(input_dir / file_name)
        source_to_word = {index: word for word, index in word_to_source.items()}
        before = db.total_changes
        rows = []
        for source_index, target_indexes in source_to_targets.items():
            source_word = source_to_word.get(source_index)
            if not source_word:
                continue
            for rank, target_index in enumerate(target_indexes[: args.top_k], start=1):
                target_word = target_to_word.get(target_index)
                if not target_word:
                    continue
                term = source_word if direction == "target_to_en" else target_word
                english = target_word if direction == "target_to_en" else source_word
                if has_artifact(term) or has_artifact(english):
                    continue
                rows.append(
                    (
                        source_key,
                        "corpus_word2word",
                        lang,
                        term,
                        normalize(term),
                        english,
                        normalize(english),
                        f"{source_key}:{source_index}:{rank}",
                    )
                )
                if len(rows) >= 10000:
                    insert_row.executemany(
                        """
                        INSERT OR IGNORE INTO lexical_evidence
                          (source_key, source_family, lang, term, normalized_key,
                           english_gloss, english_normalized_key, concept_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        rows,
                    )
                    rows.clear()
        if rows:
            insert_row.executemany(
                """
                INSERT OR IGNORE INTO lexical_evidence
                  (source_key, source_family, lang, term, normalized_key,
                   english_gloss, english_normalized_key, concept_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
        counts[source_key] = db.total_changes - before
        db.commit()

    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    total = db.execute("SELECT COUNT(*) FROM lexical_evidence").fetchone()[0]
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.execute("PRAGMA journal_mode = DELETE")
    db.close()
    print(
        json.dumps(
            {
                "ok": integrity == "ok",
                "integrity": integrity,
                "rows": total,
                "base_rows": base_rows,
                "sources": counts,
                "out": str(out),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
