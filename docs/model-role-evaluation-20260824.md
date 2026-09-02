# Model role evaluation (2026-08-24)

## Required model roles

The current dictionary pipeline needs two mandatory model families and one
optional fast reviewer:

1. **Generation and first-pass source review.** This role needs high throughput,
   strict JSON, and good four-language generation. Qwen3.6-35B-A3B-MTP remains
   the production baseline.
2. **Independent semantic adjudication.** This role must be from a different
   model family and is responsible for source-sense and final no-correction
   review. Gemma 4 31B remains the quality baseline.
3. **Optional targeted review.** A faster independent model may triage invalid,
   ambiguous, regional, or high-risk rows before the 31B reviewer. It must not
   promote or reject rows without the final gate until disagreement samples
   have human labels.

Reverse lexical evidence, schema validation, duplicate checks, source licensing,
and database promotion remain deterministic. They do not need another model.

## Candidate selection

- `unsloth/gemma-4-26B-A4B-it-qat-GGUF`: independent Gemma MoE family, 3.8B
  active parameters, and documented MTP support. Tested with `UD-Q4_K_XL`,
  `draft-mtp`, and `spec_draft_n_max=4`.
- `unsloth/GLM-4.7-Flash-GGUF`: independent 30B-A3B MoE candidate. Tested
  without speculative decoding.
- `unsloth/Qwen3.8-27B-GGUF`: current high-interest MTP model, but it is not an
  independent reviewer for a Qwen generation pipeline.
- Smaller Gemma E4B was not repeated because its existing 72-row replay returned
  `manual_review` for every row. Instella 16B-A3B was excluded because its model
  card does not establish multilingual quality for this four-language contract.

## 155 product-contract benchmark

Each model received three repetitions of the current Worker prompts for preview
translation, full sentence translation, and four-language word generation.
Inference used temperature 0, disabled thinking, one parallel slot, and
`UD-Q4_K_XL` on the A6000 node at port 11445.

| Model | Speculation | Contract | Valid JSON | Preview median | Sentence median | Word median |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Qwen3.6-35B-A3B | MTP, n=2 | 114/120 | 9/9 | 0.93 s | 3.45 s | 3.84 s |
| Gemma 4 26B-A4B QAT | MTP, n=4 | 114/120 | 9/9 | 1.15 s | 3.10 s | 4.09 s |
| GLM-4.7-Flash | off | 114/120 | 9/9 | 1.40 s | 3.77 s | 6.27 s |
| Qwen3.8-27B | MTP, n=4 | 114/120 | 9/9 | 2.00 s | 8.73 s | 10.85 s |
| Gemma 4 31B QAT | off | 114/120 | 9/9 | 5.37 s | 19.53 s | 25.30 s |

The fixed contract did not separate overall structural quality: every model
scored 114/120. Qwen3.6, Gemma 26B, GLM, and Qwen3.8 repeatedly missed the same
Japanese-reading checks. Gemma 31B instead missed one Japanese-reading and one
Japanese-explanation check per repetition. These scores are schema checks, not
a human semantic-quality score.

## MTP A/B result

Gemma 4 26B-A4B was also tested with MTP disabled under the same conditions:

| Mode | Preview median | Sentence median | Word median | Contract |
| --- | ---: | ---: | ---: | ---: |
| MTP off | 1.29 s | 4.10 s | 6.33 s | 114/120 |
| MTP n=4 | 1.15 s | 3.10 s | 4.09 s | 114/120 |

MTP reduced median latency by about 11% for preview, 25% for a full sentence,
and 35% for a word entry without changing the contract score.

## Locked semantic-review replay

The independent candidates replayed the frozen 72-row
`v101-four-lang-quality100` source-review cohort. Existing Gemma 31B decisions
are a comparison baseline, not human ground truth.

| Model | Accept | Reject | Manual | Median/model call | Agreement with 31B |
| --- | ---: | ---: | ---: | ---: | ---: |
| Gemma 4 31B QAT | 54 | 18 | 0 | 5.03 s | baseline |
| Gemma 4 26B-A4B QAT MTP | 28 | 32 | 12 | 1.49 s | 43/72 |
| GLM-4.7-Flash | 51 | 16 | 5 | 2.60 s | 55/72 |

Gemma 26B produced valid model responses for all 72 rows and was substantially
more conservative than 31B. Many disagreements cite plausible part-of-speech,
regional-use, gender, or semantic-breadth mismatches, so agreement with 31B alone
cannot determine which model is correct. GLM was closer to the 31B distribution,
but five of its 72 responses contained malformed JSON and were safely converted
to `manual_review`; only 67 rows had usable model decisions.

## Recommendation

1. Keep Qwen3.6-35B-A3B-MTP as the default generator. Qwen3.8-27B was slower in
   every measured product path and does not add reviewer independence.
2. Add Gemma 4 26B-A4B QAT with MTP n=4 as a **shadow targeted reviewer** on 155.
   It is the fastest audit candidate and has no JSON failures, but its 29
   disagreements with 31B require a human-labeled sample before it can become a
   promotion or rejection gate.
3. Keep Gemma 4 31B as the final semantic authority for now. Route only ambiguous
   and disagreement rows to it after a 26B shadow stage; this is the safest path
   to lower review latency without weakening the final gate.
4. Keep GLM-4.7-Flash cached for a second-opinion experiment, but do not put it in
   the production gate until the malformed-JSON behavior is fixed and Portuguese,
   Chinese, and Japanese disagreements are manually scored.
5. Improve Japanese reading validation and candidate/evidence quality before
   adding more model stages. The current project funnel remains constrained by
   lexical evidence more than by raw model throughput.

## Reproducibility and limits

Reports are under `logs/unsloth-155-*-20260824.json`. The product contract uses
one fixed preview, sentence, and word prompt repeated three times; it is useful
for regressions but too small to rank semantic quality. The locked review cohort
has production history but no independent human gold labels. At the end of the
test, port 11445 was unloaded and returned to its original idle state.

The node reported llama.cpp installed tag `b10360` and latest tag
`b10472-mix-4b653db` (`llama_cpp_prebuilt_stale=true`). Performance should be
rechecked after a controlled runtime update before making capacity commitments.
