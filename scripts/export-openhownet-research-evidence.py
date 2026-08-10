#!/usr/bin/env python3
"""Export official OpenHowNet Chinese-English pairs as licensed evidence.

The downloaded artifact is a Python pickle, so this importer requires an exact
SHA-256 allow-list match before deserializing it. Publication status is read
from a version-controlled license provenance record. Missing or incomplete
provenance always falls back to research-only.
"""

import argparse
import hashlib
import json
import pickle
import re
import sqlite3
import unicodedata
from pathlib import Path


OFFICIAL_ARCHIVE_SHA256 = "DAAA31E2627E099E03CE15371F472C6F9EC5B3AAC71A4E5E2AB5C4F4F38C44D4"
SOURCE_URL = "https://thunlp.oss-cn-qingdao.aliyuncs.com/OpenHowNet/resources.zip"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Extracted HowNet_dict_complete pickle")
    parser.add_argument("--archive", required=True, help="Original official resources.zip")
    parser.add_argument("--out", required=True)
    parser.add_argument("--batch-size", type=int, default=10000)
    parser.add_argument("--expected-archive-sha256", default=OFFICIAL_ARCHIVE_SHA256)
    parser.add_argument(
        "--license-metadata",
        default="config/dictionary-sources/openhownet-license.json",
        help="Version-controlled license provenance JSON",
    )
    return parser.parse_args()


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", str(value)).casefold().split())


def useful_term(value):
    text = str(value or "").strip()
    if not text or len(text) > 160:
        return False
    return bool(re.search(r"[^\W\d_]", text, flags=re.UNICODE))


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
        CREATE TABLE openhownet_sense_metadata (
          sense_id TEXT PRIMARY KEY,
          zh_term TEXT NOT NULL,
          en_term TEXT NOT NULL,
          zh_pos TEXT,
          en_pos TEXT,
          sememe_definition TEXT
        );
        CREATE INDEX idx_openhownet_metadata_en_term
          ON openhownet_sense_metadata(en_term);
        """
    )


def load_license_metadata(path):
    metadata_path = Path(path).resolve()
    if not metadata_path.exists():
        return {
            "license": "data-license-unverified",
            "production_publishable": False,
            "research_only": True,
            "reason": "License provenance file is missing.",
        }
    with metadata_path.open("r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    required = ["license", "verified_at", "official_license_page", "official_repository"]
    missing = [key for key in required if not metadata.get(key)]
    publishable = metadata.get("production_publishable") is True and not missing
    return {
        **metadata,
        "production_publishable": publishable,
        "research_only": not publishable,
        "license_metadata_path": str(metadata_path),
        "license_metadata_sha256": file_sha256(metadata_path),
        "reason": metadata.get("reason") or (
            "License provenance is complete." if publishable else f"Incomplete license provenance: {missing}"
        ),
    }


def main():
    args = parse_args()
    if args.batch_size < 1:
        raise ValueError("--batch-size must be positive")
    input_path = Path(args.input).resolve()
    archive_path = Path(args.archive).resolve()
    out_path = Path(args.out).resolve()
    expected_hash = args.expected_archive_sha256.upper()
    actual_hash = file_sha256(archive_path)
    if actual_hash != expected_hash:
        raise ValueError(
            f"Official OpenHowNet archive SHA-256 mismatch: expected={expected_hash} actual={actual_hash}"
        )

    # Pickle loading is safe here only because the enclosing official artifact
    # has matched the pinned digest above.
    with input_path.open("rb") as handle:
        senses = pickle.load(handle)
    if not isinstance(senses, dict):
        raise TypeError(f"Unexpected OpenHowNet payload type: {type(senses)!r}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()
    db = sqlite3.connect(out_path)
    create_schema(db)
    license_metadata = load_license_metadata(args.license_metadata)
    metadata = {
        "artifact_url": SOURCE_URL,
        "archive_sha256": actual_hash,
        "archive_last_modified": "2021-09-20T05:26:28Z",
        "repository": "https://github.com/thunlp/OpenHowNet",
        **license_metadata,
        "archive_contains_license_file": False,
    }
    db.execute(
        """
        INSERT INTO evidence_sources
          (source_key, source_family, lang, lexicon_spec, license, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            "openhownet-official-2021",
            "openhownet",
            "zh",
            "OpenHowNet HowNet_dict_complete sense pairs",
            license_metadata["license"],
            json.dumps(metadata, ensure_ascii=False, sort_keys=True),
        ),
    )

    rows = []
    metadata_rows = []
    paired = 0
    skipped = 0
    inserted = 0
    for sense_id, sense in senses.items():
        if not isinstance(sense, dict):
            skipped += 1
            continue
        zh_term = str(sense.get("ch_word") or "").strip()
        en_term = str(sense.get("en_word") or "").strip()
        if not useful_term(zh_term) or not useful_term(en_term):
            skipped += 1
            continue
        paired += 1
        rows.append(
            (
                "openhownet-official-2021",
                "openhownet",
                "zh",
                zh_term,
                normalize(zh_term),
                en_term,
                normalize(en_term),
                f"openhownet:{sense_id}",
            )
        )
        metadata_rows.append(
            (
                str(sense_id),
                zh_term,
                en_term,
                str(sense.get("ch_grammar") or "").strip() or None,
                str(sense.get("en_grammar") or "").strip() or None,
                str(sense.get("Def") or "").strip() or None,
            )
        )
        if len(rows) >= args.batch_size:
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
            db.executemany(
                """
                INSERT OR REPLACE INTO openhownet_sense_metadata
                  (sense_id, zh_term, en_term, zh_pos, en_pos, sememe_definition)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                metadata_rows,
            )
            metadata_rows.clear()
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
        db.executemany(
            """
            INSERT OR REPLACE INTO openhownet_sense_metadata
              (sense_id, zh_term, en_term, zh_pos, en_pos, sememe_definition)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            metadata_rows,
        )
    db.commit()
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    db.close()
    print(
        json.dumps(
            {
                "ok": integrity == "ok",
                "input_senses": len(senses),
                "paired_useful_senses": paired,
                "skipped": skipped,
                "inserted": inserted,
                "archive_sha256": actual_hash,
                "production_publishable": metadata["production_publishable"],
                "research_only": metadata["research_only"],
                "license": metadata["license"],
                "license_metadata_sha256": metadata["license_metadata_sha256"],
                "integrity": integrity,
                "out": str(out_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
