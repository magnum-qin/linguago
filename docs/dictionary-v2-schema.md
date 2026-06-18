# Dictionary V2 Schema

This schema is the target structure for the rewritten four-language dictionary pipeline.

## Goal

The v2 dictionary aligns data by `sense_id + lang`.

Do not align language arrays by index, such as `translations.en[0]` with `translations.zh[0]`. That is the failure mode that caused the current database to contain mismatched Chinese definitions and empty Japanese/Portuguese fields.

## Files

```text
data/schema/dictionary-v2.sql
```

The schema is SQLite and Cloudflare D1 compatible.

## Layers

The schema has two layers:

```text
source/staging
  dictionary_sources
  source_entries
  source_senses

canonical
  entries
  entry_forms
  pronunciation_groups
  senses
  sense_source_links
  sense_localizations
  examples
  example_localizations
  llm_completion_jobs
  quality_issues
```

## Canonical Shape

Each entry contains one or more senses. Each sense contains one localization per language.
For polyphonic or homographic entries, senses should be attached to a pronunciation group before localization rendering. For example, Chinese `中` should keep `zhōng` senses and `zhòng` senses in separate groups instead of flattening all definitions under one character.

```json
{
  "word": "bank",
  "source_lang": "en",
  "senses": [
    {
      "sense_order": 1,
      "part_of_speech": "noun",
      "gloss_key": "financial institution",
      "localized": {
        "en": {
          "term": "bank",
          "reading": "",
          "pronunciation": "baeng k",
          "pronunciation_system": "ipa",
          "definition": "an institution that holds and lends money"
        },
        "zh": {
          "term": "银行",
          "reading": "yin hang",
          "reading_system": "pinyin",
          "pronunciation": "",
          "definition": "经营存款、贷款等业务的金融机构"
        },
        "ja": {
          "term": "銀行",
          "reading": "ぎんこう",
          "reading_system": "kana",
          "pronunciation": "",
          "definition": "預金や融資などを扱う金融機関"
        },
        "pt-BR": {
          "term": "banco",
          "reading": "",
          "pronunciation": "ban ku",
          "pronunciation_system": "ipa",
          "definition": "instituição financeira que guarda e empresta dinheiro"
        }
      },
      "examples": [
        {
          "source_lang": "en",
          "source_text": "She opened an account at the bank.",
          "localized": {
            "en": "She opened an account at the bank.",
            "zh": "她在银行开了一个账户。",
            "ja": "彼女は銀行で口座を開設しました。",
            "pt-BR": "Ela abriu uma conta no banco."
          }
        }
      ]
    }
  ]
}
```

The SQL stores this JSON shape across normalized tables:

- `entries`: lookup key and source language.
- `entry_forms`: searchable written forms, localized terms, readings, and normalized reading keys.
- `pronunciation_groups`: optional entry-level reading groups such as Chinese pinyin with tone keys; published D1 uses `v2_pronunciation_groups`.
- `senses`: sense identity, order, part of speech, domain, register, and `gloss_key`.
- `senses.pronunciation_group_id`: optional link from a sense to the reading group that owns it.
- `sense_localizations`: one row per `sense_id + lang`, with `term`, `reading`, `pronunciation`, and `definition`.
- `examples`: one row per example attached to a sense.
- `example_localizations`: one row per `example_id + lang`.

## Language Rules

Supported language keys are fixed:

```text
en
zh
ja
pt-BR
```

Use `pt-BR`, not `pt`, in canonical tables.

Use `reading` for language-specific readings:

- Chinese: pinyin.
- Japanese: kana.

Use `pronunciation` for phonetic pronunciation when available:

- English: IPA or project phonetic spelling.
- Brazilian Portuguese: IPA or project phonetic spelling.

`reading_system` and `pronunciation_system` should say what the value is, for example `pinyin`, `kana`, `ipa`, or `project-phonetic`.

## Source And Confidence

Every accepted row should carry:

- `source`: where the value came from, such as `cc-cedict`, `jmdict`, `ecdict`, `kaikki`, `llm`, or `manual`.
- `confidence`: `0.0` to `1.0`.
- `needs_review`: `1` when a value is generated, weakly matched, or suspicious.

LLM output should first be recorded in `llm_completion_jobs`; only validated output should be copied into canonical localization/example tables.

## Minimum Acceptance Checks

Before exporting a v2 D1 database, checks should verify:

- Each production sense has `sense_localizations` for `en`, `zh`, `ja`, and `pt-BR`.
- Each localization has `term` and `definition`.
- Chinese rows have pinyin when possible.
- Japanese rows have kana reading when possible.
- Portuguese rows are Brazilian Portuguese.
- Examples belong to a sense and have four language localizations.
- No language field contains the wrong script or obvious mojibake.
- No `source_lang` conflicts with the entry word script.
