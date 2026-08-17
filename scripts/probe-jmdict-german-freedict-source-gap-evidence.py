#!/usr/bin/env python3
"""Probe full JMdict German glosses through an independent FreeDict English-German anchor."""

from __future__ import annotations

import argparse
import gzip
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
ELIGIBLE_REASONS = {
    "insufficient_independent_target_evidence",
    "no_strong_reverse_dictionary_evidence",
    "existing_localization_does_not_round_trip",
    "english_anchor_does_not_translate_back_to_source_term",
}


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").casefold()
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"\b(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\b", " ", value)
    value = re.sub(r"[^\w\- ]+", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def normalize_english(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").casefold()
    value = re.split(r"[;|]", value, maxsplit=1)[0]
    value = re.sub(r"^en:\s*", "", value)
    return re.sub(r"\s+", " ", value).strip()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def all_text(element: ET.Element) -> str:
    return " ".join(part.strip() for part in element.itertext() if part.strip())


def parse_freedict(path: Path, wanted_anchors: set[str]) -> tuple[dict[str, set[str]], int]:
    result: dict[str, set[str]] = defaultdict(set)
    scanned = 0
    for _, entry in ET.iterparse(path, events=("end",)):
        if local_name(entry.tag) != "entry":
            continue
        scanned += 1
        anchors = {
            normalize_english(all_text(node))
            for node in entry.iter()
            if local_name(node.tag) == "orth"
        } & wanted_anchors
        if anchors:
            german = {
                normalize(all_text(node))
                for node in entry.iter()
                if local_name(node.tag) == "quote" and node.attrib.get(XML_LANG) == "de"
            }
            german.discard("")
            for anchor in anchors:
                result[anchor].update(german)
        entry.clear()
    return result, scanned


def parse_jmdict(path: Path, wanted_words: set[str]) -> tuple[dict[str, set[str]], int]:
    result: dict[str, set[str]] = defaultdict(set)
    scanned = 0
    with gzip.open(path, "rb") as stream:
        for _, entry in ET.iterparse(stream, events=("end",)):
            if local_name(entry.tag) != "entry":
                continue
            scanned += 1
            forms = {
                unicodedata.normalize("NFKC", all_text(node)).strip()
                for node in entry.iter()
                if local_name(node.tag) in {"keb", "reb"}
            }
            matched = forms & wanted_words
            if matched:
                german = {
                    normalize(all_text(node))
                    for node in entry.iter()
                    if local_name(node.tag) == "gloss" and node.attrib.get(XML_LANG, "eng") == "ger"
                }
                german.discard("")
                for word in matched:
                    result[word].update(german)
            entry.clear()
    return result, scanned


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", default="logs/product-coverage-gaps-v95-naer141-moj-mainland-first-aligned.json")
    parser.add_argument("--evidence", default="logs/product-coverage-gaps-v97-northeuralex-mainland-first-strict-evidence.json")
    parser.add_argument("--jmdict", default="data/raw/JMdict.gz")
    parser.add_argument("--freedict", default="data/raw/freedict-eng-deu/eng-deu/eng-deu.tei")
    parser.add_argument("--out", default="logs/product-source-gap-v97-jmdict-german-freedict-de-pivot-probe.json")
    args = parser.parse_args()

    candidate_report = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    evidence_report = json.loads(Path(args.evidence).read_text(encoding="utf-8"))
    candidates = candidate_report.get("selected", [])
    evidence_by_key = {str(row["candidate_key"]): row for row in evidence_report.get("validations", [])}
    japanese = []
    for candidate in candidates:
        if candidate.get("source_lang") != "ja":
            continue
        key = str(candidate.get("candidate_key") or f'{candidate.get("source_entry_id")}:{candidate.get("first_sense_id")}')
        evidence = evidence_by_key.get(key)
        if not evidence or evidence.get("decision") == "supported":
            continue
        anchor = normalize_english(evidence.get("evidence", {}).get("anchor") or candidate.get("gloss_key", ""))
        word = unicodedata.normalize("NFKC", str(candidate.get("word", ""))).strip()
        if anchor and word:
            japanese.append((key, candidate, evidence, anchor, word))

    anchors = {row[3] for row in japanese}
    words = {row[4] for row in japanese}
    english_to_german, freedict_scanned = parse_freedict(Path(args.freedict), anchors)
    japanese_to_german, jmdict_scanned = parse_jmdict(Path(args.jmdict), words)
    matches = []
    for key, candidate, evidence, anchor, word in japanese:
        english_terms = english_to_german.get(anchor, set())
        japanese_terms = japanese_to_german.get(word, set())
        overlap = sorted(english_terms & japanese_terms)
        if not english_terms or not japanese_terms:
            continue
        decision = "no_exact_german_overlap" if not overlap else (
            "single_exact_german_overlap" if len(overlap) == 1 else "multiple_exact_german_overlaps"
        )
        existing = sorted(set(evidence.get("evidence", {}).get("matching_source_families", [])))
        eligible_reason = evidence.get("reason") in ELIGIBLE_REASONS
        adds_independent_family = "jmdict" not in existing
        production_candidate = bool(overlap) and bool(existing) and eligible_reason and adds_independent_family
        matches.append({
            "candidate_key": key,
            "source_entry_id": candidate.get("source_entry_id"),
            "source_sense_id": candidate.get("first_sense_id"),
            "word": word,
            "frequency_rank": candidate.get("frequency_rank"),
            "english_anchor": anchor,
            "decision": decision,
            "previous_decision": evidence.get("decision"),
            "previous_reason": evidence.get("reason"),
            "existing_source_families": existing,
            "exact_german_overlap": overlap,
            "english_german_terms": sorted(english_terms)[:30],
            "japanese_german_terms": sorted(japanese_terms)[:30],
            "adds_independent_family": adds_independent_family,
            "production_evidence_candidate": production_candidate,
            "production_publishable": False,
        })

    exact = [row for row in matches if row["exact_german_overlap"]]
    production = [row for row in matches if row["production_evidence_candidate"]]
    output = {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "inputs": vars(args),
        "provenance": {
            "jmdict": {"version": "downloaded full multilingual JMdict", "family": "jmdict", "license": "EDRDG/JMdict license"},
            "freedict": {"version": "eng-deu 1.9-fd1", "family": "freedict-ding", "source": "TU Chemnitz Ding", "license": "GPL-3.0 and AGPL-3.0 components"},
            "policy": "exact normalized Japanese form, English anchor, and German translation overlap; no model evidence",
            "publication_boundary": "probe candidates require downstream source review and deterministic validation before export",
        },
        "summary": {
            "input_candidates": len(candidates),
            "eligible_japanese_candidates": len(japanese),
            "unique_japanese_words": len(words),
            "unique_english_anchors": len(anchors),
            "freedict_entries_scanned": freedict_scanned,
            "jmdict_entries_scanned": jmdict_scanned,
            "freedict_anchor_hits": len(english_to_german),
            "jmdict_word_hits": len(japanese_to_german),
            "matched_candidates": len(matches),
            "exact_overlap_candidates": len(exact),
            "production_evidence_candidates": len(production),
            "production_unique_source_entries": len({row["source_entry_id"] for row in production}),
            "by_decision": dict(Counter(row["decision"] for row in matches)),
            "production_by_previous_reason": dict(Counter(row["previous_reason"] for row in production)),
        },
        "matches": matches,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "out": str(out), "summary": output["summary"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
