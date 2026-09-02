# v219 Daily Recovery

## Current Result

Follow-up `validation100f`: raw-source investigation verified that all 29
Portuguese selected translations in 100e occur in the local FreeDict TEI.
The importer explicitly uses the first translation as `gloss`; the daily
selector then awards native-source and first-sense bonuses. This establishes
provenance and selection bias, NOT correctness or independence of the sources.
The original TEI and product database were not edited.

The FreeDict Portuguese lane is temporarily quarantined for evidence review
in the daily candidate filter (including additional senses). This is not a
claim that every FreeDict entry is wrong, and no alternate sense is silently
substituted. Abbreviation redirects and two observed specialized-term patterns
are also deferred. Re-enable the source lane only after a separately recorded
evidence review; merely changing model or lowering the score is insufficient.

The remote 100f rebuild yielded **75 headwords: zh 30, ja 30, en 15; zero
additional senses**. Its 75 rows have zero deterministic findings, but the
100-candidate validation gate was NOT met. No LLM was called and no 500 batch
started. The wrapper now reports a clean quota shortage as
`candidate_shortfall` (or zero as `candidate_exhausted`) with
`ValidationGatePassed=false`, instead of misreporting a system failure.
Next, review/rebalance the remaining daily zh/ja candidates and resolve the
Portuguese evidence queue; do not fill the shortage with low-value entries.
The first 50 of 100f were also inspected: examples such as `找事 / to look for
employment` still need modern-primary-sense review, so this subset has not been
semantically approved. Source first-sense order and a high score are not proof
of everyday priority.

Reproducible local provenance command:

```powershell
node scripts/report-dictionary-v2-daily-freedict-provenance.mjs --report logs/v219-daily-mixed-validation100e.json --tei data/raw/freedict-por-eng.tei --out logs/v219-freedict-provenance.json
```

The report binds both input hashes and keeps all raw translations for inspection.
It is not an approval report.

Recovery tooling was implemented and exercised on the jump host. Production
is **not approved to resume**: the 100e cohort passes deterministic checks but
fails semantic/daily-value spot review. No LLM requests or product writes were
made by these validation runs. The v218 online baseline is unchanged by this
work; an online release audit was not rerun.

The 100e cohort contains 96 new headwords and four additional senses:
zh 30, ja 30, pt-BR 29, en 11. The nominal 60/40 lane ratio could not be met.
Only qualified headword reserves filled the additional-sense shortfall; this
is not evidence that all 100 rows are semantically publishable.

## Implemented Controls

- Empty candidates stop normally as `candidate_exhausted`, without GPU startup.
- Atomic UTF-8 JSON state replaces stack-trace serialization.
- Child-process handles are retained so Windows PowerShell preserves exit codes.
- Candidate-build heartbeats report lane, PID and elapsed time. Native scanning
  additionally reports counts every 10,000 rows through a progress file.
- Mainland simplified headwords retain original traditional forms as aliases.
- Exact historical sense attempts remain excluded. Historical entry exclusions
  are not indiscriminately replayed.
- New headwords cannot select a lower-scoring leftover sense while a higher
  unblocked primary sense exists. Additional senses still use the existing
  independent-source and semantic-duplicate gates.
- Candidate audit checks all rows; the first 50 are a review preview, not the
  entire audited scope. Its `ok` means deterministic-only, not semantic approval.
- `state/daily-production-quality-hold.json` stops mixed-lane GPU startup while
  the observed source-quality problems remain unresolved.

## Historical Classification

158,450 historical exclusions were classified read-only:

| Disposition | Entries |
| --- | ---: |
| Published or semantic duplicate | 30,144 |
| No unattempted native sense, manual review | 80,845 |
| Low value, proper name or variant | 7,886 |
| High-frequency gap pending evidence | 19,821 |
| Previous failure requiring repair evidence | 19,735 |
| Traditional form already covered by simplified | 19 |

The 19,821 are eligible for further selection only, not validated vocabulary.
An earlier rank-only recovery was rejected because it replayed too much history.

## Failed Spot Review

Report: `batches/v219-daily-mixed-validation100e.json` on the runner.
The first 50 and the remainder were inspected. Findings require source evidence
review, not automatic replacement based on an agent's preferred translation:

| Position | Source entry / sense | Pair | Concern |
| --- | --- | --- | --- |
| 7 | 1632344 / 1632344 | purê / gruel | Possible source-semantic mismatch |
| 11 | 1626602 / 1626602 | delito / blame | Possible source-semantic mismatch |
| 13 | 1631590 / 1631590 | percurso / class | Possible source-semantic mismatch |
| 18 | 1631042 / 1631042 | obscuro / humble | Primary everyday sense not established |
| 24 | 1622834 / 1622834 | activo / active | Regional/orthographic variant needs review |
| 53 | 1128598 / 1193112 | 国际足联 / FIFA | Organization abbreviation, not this cohort's priority |
| 66 | 1401285 / 1401285 | 体外 / ectogenesis | Possible source-semantic mismatch |
| 73 | 1366419 / 1366419 | メチル / methyl- | Specialized term, defer from daily cohort |

Do not fix these by silently changing source glosses or merely blacklisting
these eight words. Check original native senses, extraction boundaries and
frequency provenance, then rebuild a genuinely daily cohort.

## Validation and Next Step

- Real Windows subprocess tests cover zero candidates/no GPU and child failure
  with parseable status and preserved exit code.
- Lane deduplication and primary-sense ordering regression tests pass.
- Two attempted 500 orchestration starts failed before any pipeline or DB write
  due to the child exit-code bug. The retained-handle fix is integration-tested;
  a successful real 500 run has not occurred.
- Next: repair source selection/evidence, rebuild 100, inspect first 50, and
  record semantic acceptance before clearing the quality hold.
- Then run one 500 controlled batch, retaining the Qwen/reverse/Gemma/draft/
  deterministic-promote gates. Verify rates and fast/published-risk audits.
- Do not claim +5,000 completion or deploy D1 from candidate counts. Full export,
  remote backup, deployment and online regressions remain pending.

Logs, state/checkpoints, local DBs and exports remain uncommitted. Do not overwrite
unrelated local changes. The authoritative product DB remains on the jump host.
