#!/usr/bin/env python3

"""Extract exact cross-language TUFS vocabulary concepts from pg_dump files.

Install the small parser outside the repository source tree before running:
  python -m pip install --target .tmp/python-packages pgdumplib==4.0.0
  $env:PYTHONPATH = (Resolve-Path .tmp/python-packages)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from collections import defaultdict

try:
    import pgdumplib
except ImportError as exc:
    raise SystemExit(
        "pgdumplib is required; install pgdumplib==4.0.0 into .tmp/python-packages"
    ) from exc


LANG_FILES = {
    "en": "vmod_en.dump",
    "pt-BR": "vmod_pb.dump",
    "zh": "vmod_zh.dump",
    "ja": "vmod_ja.dump",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default="data/raw/tufs-vmod")
    parser.add_argument("--out", default=".tmp/tufs-vmod/tufs-vmod-concepts.jsonl")
    parser.add_argument("--report", default="logs/tufs-vmod-concept-extraction.json")
    return parser.parse_args()


def clean_term(value: str | None, lang: str) -> list[str]:
    text = (value or "").strip().replace("\u3000", " ")
    if lang == "zh":
        text = re.sub(r"\s+[A-Za-z\u00c0-\u024f\u0100-\u01ff].*$", "", text).strip()
    values = re.split(r"[,;/]", text) if lang == "zh" else [text]
    return [re.sub(r"\s+", " ", item).strip() for item in values if item.strip()]


def file_hash(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_language(path: pathlib.Path, lang: str) -> tuple[dict[str, set[str]], dict[str, dict]]:
    dump = pgdumplib.load(path)
    words = {row[0]: row for row in dump.table_data("public", "t_word")}
    usages = {row[0]: row for row in dump.table_data("public", "t_usage")}
    concepts: dict[str, set[str]] = defaultdict(set)
    metadata: dict[str, dict] = {}

    for row in dump.table_data("public", "t_usage_classified_rel"):
        usage_id, classified_id = row[0], row[1]
        usage = usages.get(usage_id)
        if not usage:
            continue
        word = words.get(usage[1])
        if not word:
            continue
        for term in clean_term(word[1], lang):
            concepts[classified_id].add(term)
        metadata[classified_id] = {
            "bunrui_no": row[2],
            "category": row[7],
            "japanese_label": row[9],
            "japanese_reading": row[10],
        }
        if lang == "ja":
            for term in clean_term(row[9], "ja"):
                concepts[classified_id].add(term)

    return concepts, metadata


def main() -> None:
    args = parse_args()
    input_dir = pathlib.Path(args.input_dir).resolve()
    out_path = pathlib.Path(args.out).resolve()
    report_path = pathlib.Path(args.report).resolve()
    paths = {lang: input_dir / name for lang, name in LANG_FILES.items()}
    missing = [str(path) for path in paths.values() if not path.exists()]
    if missing:
        raise SystemExit(f"Missing TUFS dumps: {missing}")

    by_lang: dict[str, dict[str, set[str]]] = {}
    concept_meta: dict[str, dict] = {}
    for lang, path in paths.items():
        concepts, metadata = extract_language(path, lang)
        by_lang[lang] = concepts
        concept_meta.update(metadata)

    concept_ids = sorted(set().union(*(set(rows) for rows in by_lang.values())), key=int)
    records = []
    for concept_id in concept_ids:
        terms = {
            lang: sorted(by_lang[lang].get(concept_id, set()))
            for lang in LANG_FILES
            if by_lang[lang].get(concept_id)
        }
        meta = concept_meta.get(concept_id, {})
        if meta.get("japanese_label"):
            terms.setdefault("ja", [])
            if meta["japanese_label"] not in terms["ja"]:
                terms["ja"].append(meta["japanese_label"])
                terms["ja"].sort()
        if "en" not in terms or len(terms) < 2:
            continue
        records.append({
            "concept_id": concept_id,
            "terms": terms,
            **meta,
        })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    report = {
        "ok": True,
        "source": "TUFS Language Modules basic vocabularies",
        "license": "CC-BY-4.0",
        "source_url": "https://www.coelang.tufs.ac.jp/mt/vmod/",
        "input_hashes": {lang: file_hash(path) for lang, path in paths.items()},
        "concepts": len(records),
        "concepts_by_language_set": {},
        "terms_by_language": {
            lang: sum(len(record["terms"].get(lang, [])) for record in records)
            for lang in LANG_FILES
        },
        "out": str(out_path),
    }
    for record in records:
        key = "+".join(lang for lang in LANG_FILES if lang in record["terms"])
        report["concepts_by_language_set"][key] = report["concepts_by_language_set"].get(key, 0) + 1
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
