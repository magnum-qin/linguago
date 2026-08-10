#!/usr/bin/env python3
"""Probe newer Open WordNet releases against source-gap reverse residuals.

This is a diagnostic only. Its output must not be treated as publication
evidence until the corresponding lexicons are imported with stable provenance.
"""

import argparse
import json
import re
import unicodedata
from pathlib import Path

import wn


LEXICONS = {
    "pt-BR": "own-pt:1.0.0",
    "zh": "omw-cmn:2.0",
}
ENGLISH_LEXICON = "omw-en:2.0"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--generation", required=True)
    parser.add_argument("--reverse", required=True)
    parser.add_argument("--wn-dir", required=True)
    parser.add_argument("--out", required=True)
    return parser.parse_args()


def normalize(value):
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return " ".join(re.findall(r"[\w]+", value, flags=re.UNICODE))


def lexical_match(anchor, lemma):
    left = set(normalize(anchor).split())
    right = set(normalize(lemma).split())
    return bool(left and right and left.intersection(right))


def main():
    args = parse_args()
    wn.config.data_directory = Path(args.wn_dir).resolve()

    generation = json.loads(Path(args.generation).read_text(encoding="utf-8"))
    reverse = json.loads(Path(args.reverse).read_text(encoding="utf-8"))
    generated = {
        str(row.get("source_entry_id")): row
        for row in generation.get("generated", [])
        if row.get("valid") is True
    }
    wordnets = {lang: wn.Wordnet(spec) for lang, spec in LEXICONS.items()}

    rows = []
    for validation in reverse.get("validations", []):
        if validation.get("decision") == "supported":
            continue
        generated_row = generated.get(str(validation.get("source_entry_id")))
        if not generated_row:
            continue
        output = generated_row.get("output", {})
        anchor = validation.get("anchor") or output.get("gloss_key") or validation.get("word")
        for lang, decision in validation.get("languages", {}).items():
            if decision.get("decision") == "supported" or lang not in wordnets:
                continue
            term = str(output.get("localizations", {}).get(lang, {}).get("term") or "").strip()
            synsets = wordnets[lang].synsets(term) if term else []
            synset_rows = []
            for synset in synsets:
                english_lemmas = sorted(
                    {
                        word.lemma()
                        for translated in synset.translate(lexicon=ENGLISH_LEXICON)
                        for word in translated.words()
                    }
                )
                synset_rows.append(
                    {
                        "id": synset.id,
                        "english_lemmas": english_lemmas,
                        "anchor_match": any(lexical_match(anchor, lemma) for lemma in english_lemmas),
                    }
                )
            rows.append(
                {
                    "source_entry_id": validation.get("source_entry_id"),
                    "word": validation.get("word"),
                    "anchor": anchor,
                    "lang": lang,
                    "term": term,
                    "previous_decision": decision.get("decision"),
                    "previous_reason": decision.get("reason"),
                    "lexicon": LEXICONS[lang],
                    "synsets": synset_rows,
                    "has_term": bool(synset_rows),
                    "has_anchor_match": any(row["anchor_match"] for row in synset_rows),
                }
            )

    summary = {
        "residual_localizations": len(rows),
        "terms_found": sum(row["has_term"] for row in rows),
        "anchor_matches": sum(row["has_anchor_match"] for row in rows),
        "by_lang": {},
    }
    for lang in LEXICONS:
        subset = [row for row in rows if row["lang"] == lang]
        summary["by_lang"][lang] = {
            "residual_localizations": len(subset),
            "terms_found": sum(row["has_term"] for row in subset),
            "anchor_matches": sum(row["has_anchor_match"] for row in subset),
        }

    result = {
        "ok": True,
        "diagnostic_only": True,
        "policy": {
            "wordnets": LEXICONS,
            "english_lexicon": ENGLISH_LEXICON,
            "publication_evidence": False,
        },
        "summary": summary,
        "rows": rows,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
