#!/usr/bin/env python3
"""Export ranked UTF-8 word lists from the Python wordfreq package."""

import argparse
from pathlib import Path

from wordfreq import top_n_list


LANGUAGES = {
    "en": "en",
    "pt": "pt",
    "zh": "zh",
    "ja": "ja",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--limit", type=int, default=200_000)
    args = parser.parse_args()
    if args.limit < 1:
        raise ValueError("--limit must be positive")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for output_lang, wordfreq_lang in LANGUAGES.items():
        terms = top_n_list(wordfreq_lang, args.limit)
        out_path = out_dir / f"wordfreq-{output_lang}-{args.limit}.txt"
        out_path.write_text("\n".join(terms) + "\n", encoding="utf-8")
        print(f"{output_lang}\t{len(terms)}\t{out_path}")


if __name__ == "__main__":
    main()
