# v219 Daily Recovery

## Current Result

### 100r completed review reconciliation

Proposal-generation lane: source-review instructions explicitly allow null
preferred terms where lexical evidence is absent. Repeating that review is
not a translation-completion strategy. `build-source-sense-proposals.mjs`
therefore constructs a separate 76-row input from exact valid dual sense
accepts, binds the three input hashes, removes stale translation approvals,
and sets `proposal_only=true` and `promote_allowed=false` on every row.
This is NOT the strict translation-consensus report and cannot replace it.
Remote select-only accepted all 76 inputs. Full Qwen proposal generation was
started with apply=false, examples required, checkpoint/resume and two safe
nodes (143/56 checked for foreign GPU processes before invocation).
Output is `logs/v219-native-holdout100r-proposal-generation.json`.
Generation completed: 76 attempted, 58 structure-valid, 18 rejected,
zero infrastructure rejects and zero database inserts/upserts. Rejection
categories (overlap allowed): en_term_gloss_mismatch=11,
ja_term_not_in_jmdict=6, mojibake_reading_ja=1, zh_reading_mismatch=1.
The generated report records no_promote_selected=76 and no_promote_accepted=58.
Read-only reverse validation of the 58 valid outputs completed: supported=21,
unsupported=25, manual_review=12, using source reverse evidence and the
Wiktionary-family 3-supported/1-manual policy. Outputs are
`logs/v219-native-holdout100r-proposal-reverse.json` and `-supported.json`.
Full Gemma review of only the 21 supported outputs completed on safe
144/147 nodes: valid=21, accepted=15, rejected=6, failed=0.
Report: `logs/v219-native-holdout100r-proposal-final-gemma.json`.
This is 15/76 proposal inputs and 15/100 original cohort, not an 80% production
qualification. No draft/main-product write or promote was performed. The
existing hold stays in place. All model subprocesses returned terminal exits.

One bounded structured-correction round then processed the six final rejects,
using the existing correction builder and retaining proposal_only/no-promote
flags. Qwen produced six structurally valid outputs; reverse evidence supported
five and rejected one (Japanese evidence conflict). Gemma accepted three of
the five: two hands, one drop and migaru. Two remain rejected. Exact source
entry/sense IDs show no overlap with the original 15 accepts, hence 18 distinct
final accepts from the original 100-row cohort after repair, NOT 18 new database
senses. Reports use `logs/v219-native-holdout100r-correction-*`.
All processes terminated successfully, and generation reports show zero DB
writes. This targeted repair is diagnostic and does not clear qualification.

Compact retry diagnosis: single-row buildCompactPrompt returned without
ordinary latest_errors feedback, unlike the full prompt and compact batch
prompt. Thus automatic retries could repeat the same request after structural
failure. The local generator now includes targeted error feedback via
dictionary-generation-retry-feedback.mjs (anchor/grammatical-role preservation,
Japanese lexical term checks, attested readings, and complete examples).
Validators and acceptance thresholds are unchanged. Tests and TypeScript check
pass; remote inference improvement is NOT yet measured and the modified
generator has NOT been deployed to the runner.
Prepared `logs/v219-native-holdout100r-structure-retry.json` for exactly the
18 structurally invalid outputs, preserving proposal_only and no-promote flags.
All 18 receive error feedback. This retry does not include prior valid outputs
or change the original cohort denominator.

After explicit user authorization, the three exact approved deployment hashes
were installed and only their manifest entries updated. Backup:
`logs/v219-approved-retry-deploy/backup-20260904-162029` on the runner.
The bounded 18-row structure retry completed: generated=18, valid=11,
rejected=7, infrastructure_rejected=0, all insert/upsert counts=0.
Report: `logs/v219-native-holdout100r-structure-retry-generation.json`.
Remaining failures: Japanese index absence=4, Japanese reading artifact=1,
English anchor mismatch=1, final JSON parse failure=1. Transient parse errors
also occurred; do not infer zero JSON failure rate from endpoint failures=0.
The 11 recovered outputs have NOT passed reverse evidence or final Gemma yet.
There was no old-prompt control run, so recovery is not a causal benchmark.
Product DB before/after SHA-256 remained
`2F74DD67552B423C40B8C6F5F57B4839D93ADFBE1260035EA227BEFA0AA3DDB5`;
quality hold before/after remained
`65D2737405EA28D55C564FECBC50309E85D73DB0ACF073BC8BBAA05BB65C09A8`.
The remote process exited. No production hold was removed and no release ran.

Follow-through of structure retry: reverse evidence checked the 11 valid
outputs, yielding supported=2, unsupported=7, manual_review=2. Only the two
supported rows went to Gemma: both accepted (ji mou and soutai). Reports:
`logs/v219-native-holdout100r-structure-retry-reverse.json` and
`logs/v219-native-holdout100r-structure-retry-final-gemma.json`.
Exact entry/sense ID de-duplication across initial, correction and structure
retry final reports confirms 20 distinct final accepts from the original
100-row cohort. This is NOT 20 inserted draft or publishable senses. All runs
remain report-only, with no hold removal or scale qualification.
Reverse evidence and review of the generated translations remain required;
the production quality hold is unchanged.

Generation readiness correction: running the strict source-review intersection
on 100r yields ZERO generation-ready rows, despite 76 dual sense approvals.
Many Qwen preferred-term fields are absent, while Gemma independently supplied
translations. These are not reviews of the same locked four-language proposal.
`logs/v219-native-holdout100r-consensus.json` preserves the 76 term disagreements.
Do not disable term agreement to pass this batch. Complete Qwen proposals,
bind them to evidence, and have Gemma review the locked proposal before generation.

The intersection now validates unique positive source identities, exact
word/language/gloss binding and both valid/accept/approved flags. Unit tests
cover malformed, duplicate and mismatched reviews. This local change has not
been deployed to the remote runner or added to its manifest.

Remote Gemma report was retrieved and parsed as UTF-8. It contains 79 valid
reviews, 76 approved; the matching remote Node process is absent. Qwen
reviewed all 100 and approved 79. Thus dual approval is 76/100, not 76/79
for cohort qualification. The quality hold must remain.

Exact word, source-sense ID and gloss binding was checked by the rejection
triage tool for both reports. Local reports are
`logs/v219-native-holdout100r-qwen-triage.json` (21 nonaccepts, 19 with
alternatives) and `logs/v219-native-holdout100r-gemma-triage.json`
(3 nonaccepts, all with alternatives). These are diagnostic reports, not
automatic repair or publication approvals.

Native alternatives establish actionable primary-sense selection problems:
the selected private/personal sense has a secretly/without-approval alternative;
the calculate sense has value-for-money/cost-effective alternatives; and the
ponzu citrus-juice sense has a sauce alternative. Preserve their distinct
source-sense IDs when reviewing repairs. Do not overwrite the original cohort
or add repaired acceptances to its numerator. Other objections concern wording
or priority (direction of current versus direction of flow, floating versus
float), and require adjudication rather than automatic deletion.

Next implementation should address native primary-sense selection before
locking another qualification cohort. Existing consensus rows may be used
for draft-generation validation, but cannot qualify a 500-row production run.
No database mutation or model request was performed during this reconciliation.

### Qualification correction (2026-09-04)

The original Qwen cohort accepted 71/100. A separate replacement cohort
accepted 20/30; combined acceptance is 91/130 (70%), NOT 91/100. This does
not satisfy the 80% daily-primary qualification gate. Gemma accepted 89/91
Qwen accepts. Subsequent generation produced 21 valid records and final
Gemma accepted 19. Isolated replay promoted 19/19 and passed audits, but
this selected-subset result does not qualify a 500-candidate production run.

Run `v219-daily-controlled500-20260903-182847` requested 500 candidates but
selected only 81 (zh=4, ja=2, en=75). Its automatic commit orchestrator was
stopped while waiting; the model pipeline was retained as a dry-run and
the quality hold restored. Main DB hash at that stop remained
`2F74DD67552B423C40B8C6F5F57B4839D93ADFBE1260035EA227BEFA0AA3DDB5`.
Do not count this run as the 500-row qualification or claim a main DB increment.

Local control fixes now report `candidate_shortfall` before GPU startup when
selected candidates are below the requested batch size. The completion
supervisor also checks the quality hold before invoking controlled publish.
Real PowerShell subprocess tests cover both cases. Deployment of these new
control fixes were deployed with exact remote manifest updates:
orchestrator `BE3B435256FE7347303991D77942A0B5CB23A71B697A038EEAB97852174C7545`,
completion supervisor `4A5C4668364F56FC8B67A8F6C607CDFADFD3B7C1D742142C2D250BF3E704B264`.
The orchestrator's native scan targets now match the candidate builder defaults
(`zh=30000,ja=10000,pt-BR=5000,en=5000`). Previously its smaller overrides
could exhaust the scan reservoir before downstream filters filled quotas.
This fixes configuration drift, not semantic qualification; no threshold was lowered.

Next: diagnose rejected daily senses and cohort shortages, freeze a fresh
100-row cohort before review, and calculate acceptance using every reviewed
candidate in that cohort. Keep the hold until the original thresholds pass.

### Reservoir rebuild and intake review

`v219-zhja-reservoir500j` rebuilt 500 new-headword candidates (zh=250,
ja=250); the additional-sense lane still yielded zero. No model or product
write was involved. The first frozen sample `v219-zhja-fresh100k` excluded
205 previously selected/reviewed candidate keys, but manual inspection found
biographical names, organizations, historical titles and form redirects.
It is NOT semantically approved and must not be used as passed qualification.

Local generic entity/redirect filters retained 490/500 reservoir candidates,
rejecting seven biographical/organization rows, two historical-scope rows,
and one form redirect. Tests preserve generic terms such as publisher and
prime minister, and named dishes. These filters still require remote deployment
and the revised cohort still needs a frozen 100-row model review. Do not count
the 490 deterministic survivors as model accepts or newly published senses.

### Frozen 100l pre-review result

`v219-zhja-fresh100l.json` was frozen before inference at SHA-256
`04EDA49F4AD90E0375E0CBF4F62D713D86D737F7CD780B9D0C5580704FE9A235`.
It contains zh=50/ja=50 and excludes the previous 205 reviewed/selected keys.
Qwen on 143/56 reviewed all 100: valid=100, approved=66, rejected=34,
failed=0; endpoint runtime recorded 100 calls with zero failures/timeouts.
This fails the 80% acceptance gate. No replacements were used in the denominator.
Keep production on hold. Diagnose locked-primary selection and review errors
before spending more compute on new random cohorts. Local TypeScript check passed.

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

### Same-cohort calibration comparison

#### Remote evidence calibration completed

- Full 490-row reservoir enrichment matched all 247 JA rows exactly. Scope
  filtering retained 478, including deferral of two Taiwan-marked senses for
  Mainland-equivalent review (no headword rewrite or permanent exclusion).
- New 100r: 50 ZH/50 JA, 100 unique entries, 50 bound JA metadata records,
  SHA256 `a9b1e3130af5b5ee5589c9123f8392d62ebb6fa0ee0abf9c5d9f1d458c6c2557`.
  Qwen completed: valid 100, accept 79, reject 20, manual 1, failures/timeouts 0.
  Report `logs/v219-native-holdout100r-qwen.json`. This is below 80/100, not a
  rounded pass; no replacement/retry acceptance may be added to its numerator.
  No product writes or hold removal. Reviewer/metadata helper synced for this
  read-only run; manifest reconciliation is still required before production.

- Implemented local native metadata enrichment with structured XML parsing,
  written/reading restrictions, inherited POS, exact English gloss matching and
  ambiguity preservation. All 50 Japanese rows in 100q match uniquely. Locked
  DB sense IDs and glosses are unchanged. The reviewer exposes only metadata
  still bound to the same word/ID/gloss; stale metadata is ignored.
- Applying native `product` and `vulg` metadata deferrals removes two rows from
  100q without a word blacklist. Output has 98 rows and is not a 100-row gate.
  `logs/v219-zhja-holdout100q-metadata.json` retains provenance and raw-file hash.
  Restriction, ambiguity and stale-binding tests pass. Local only; remote files
  and manifest have not been updated for this enrichment. Taiwan preference
  remains unresolved for the Chinese regional candidate; no model run started.

- Holdout100q was built (50/50, 100 unique entries, generic filter zero flags),
  but pre-model inspection found Taiwan-marked usage, a product and vulgar slang.
  It was NOT sent to a model. Hash:
  `232ec535e11251448ba62a7c39ab666b48fc353091d799f9480edccb94e832b7`.
- Verified local raw `data/raw/JMdict_e.gz` using fast-xml-parser (entities kept):
  ent_seq 5741167 marks Prius as `misc=&product;`; 2110450 marks the vulgar term
  as `misc=[&sl;,&vulg;]`. These fields are absent in the candidate alternatives.
  ent_seq 1574430 for 餃子 supplies food domain, readings and an explanatory
  English gloss in addition to gyoza/pot sticker. Reviewing only the first short
  gloss discards useful disambiguation. Next repair should join exact native
  sense metadata (respect written/reading restrictions), retain original ID and
  gloss, and expose the explanation/domain/register to screening. Do not replace
  a locked source gloss with a guessed meaning or keep adding word blacklists.

- System-role fix calibrated on unchanged 100p: valid 100, accepted 81 (was
  70), rejected 19, failed/timeouts 0. Exact IDs/glosses match. Twelve nonaccepts
  became accepts; the console brand changed from accepted to rejected.
  `logs/v219-zhja-fresh100p-qwen-system-calibration.json` and
  `logs/v219-zhja-fresh100p-system-diff.json` preserve this comparison.
- This is calibration, not a new holdout. One newly accepted reason explicitly
  cites technical data/signal usage (送り込み/feed), so the higher acceptance
  rate alone does not prove everyday scope. Keep hold pending independent review
  and fresh-cohort validation. Reviewer and contract helper were synced after
  confirming no remote Node process; manifest reconciliation remains outstanding.

- Gemma finished the 70 Qwen accepts from 100p: valid 70, accepted 68, rejected
  2, failed 0. Exact identities/glosses checked against Qwen accepts. It also
  accepted the branded console, so agreement is not proof of daily scope.
  `logs/v219-zhja-fresh100p-gemma.json` retains all reasons.
- Found a prompt hierarchy conflict: the system message asked to judge ONLY
  real lexical meaning, while daily priority was in the user message. Local
  `sourceReviewSystemPrompt(requireDailyPrimary)` now aligns the system role
  with daily priority and scope, leaving the non-daily role unchanged. Tests and
  reviewer syntax pass. This change was NOT uploaded during the active run and
  has no measured semantic improvement yet; calibrate before deployment.

- Fresh cohort 100p completed Qwen screening: exactly 100 reviewed/valid,
  70 accepted, 28 rejected, 2 manual, zero reported failures/timeouts. It fails
  the 80/100 gate; do not clear the hold. `logs/v219-zhja-fresh100p-qwen.json`.
  Pre-model scope-v3 filtering retained 483/490 reservoir rows; the selector
  found 330 eligible and selected 50 ZH/50 JA. 100m/100n were preflight reports,
  not model runs. Only 100p was sent for this new validation.
- Qwen accepted a branded-game-console candidate in 100p, showing scope errors
  persist beyond the repaired annotations. More blacklist additions or random
  cohort reruns alone are not evidence of a reliable semantic gate. Preserve all
  results and review both false accepts and false rejects before scaling.

- Prepared `logs/v219-zhja-fresh100m.json` via the existing daily-scale selector
  against the remote product DB: 488 input, 335 eligible, 100 selected (50/50).
  First-50 inspection found an explicit `(name)` gloss missed by existing rules;
  the shared filter now defers that annotation (generic `name` stays eligible).
  Do not treat this report as model-validated; no LLM call was made for 100m.
  The selection produced its complete report before a wrapper exit-code quoting
  error; downloaded JSON was inspected instead of blindly rerunning selection.

- Native alternate diagnostic completed remotely: Qwen reviewed 59, valid 59,
  accepted 14, rejected 44, manual 1. Gemma reviewed only the 14 accepts and
  accepted all 14; both stages had zero reported network/JSON failures. Reports:
  `logs/v219-native-alternate-qwen-review.json` and
  `logs/v219-native-alternate-gemma-review.json`. Source IDs/glosses cross-checked.
- These 14 rows cover only 12 entries (two near-synonym pairs for the same
  entries). They are repair proposals, not 14 new words or additional published
  senses. Examples: Chinese-food sense for 中餐 and third-son sense for 三男.
  Do not add the 14 to the original 63/100 acceptance numerator: this is a
  post-review alternate search, not a fresh frozen-cohort qualification.

- Built `logs/v219-native-alternate-repair-review.json`: 59 exact native source
  senses across 30 rejected entries. The other three entries with alternatives
  have no eligible native alternative under this builder. This is a diagnostic
  cohort, not 59 new headwords or qualification samples. Old localization hints,
  approvals and alignment fields are deliberately not carried into replacement
  candidates. Every ID/gloss/source is checked against the original alternatives;
  no proposed English wording is promoted to a source sense. Builder tests pass.

- Rejection triage now binds each review to the exact candidate identity/gloss
  and enumerates only unblocked, unlinked source alternatives. It never assigns
  a model-proposed English anchor a source ID or selects a replacement itself.
  The 100-row evidence calibration has 37 nonaccepts: 33 have source alternatives
  requiring semantic review, four have none. These alternatives may still be
  equivalent, secondary or unsuitable; their presence is not repair approval.
  Report: `logs/v219-zhja-fresh100l-rejection-triage.json`; duplicate/mismatched
  review and blocked/linked-alternative regression tests pass.

- Local scope follow-up adds explicit named-classic/author-attributed-work and
  narrow meningeal-anatomy deferrals. Ordinary books, poems, brain, skin, headache,
  hospital and blood-test vocabulary remain eligible in negative-control tests.
  Refiltering the 490 reservoir leaves 488; only the named classic and meninges
  rows are deferred. Output: `logs/v219-zhja-reservoir488-scope-clean.json`.
  This limited scope repair does not fix the 37 Qwen non-accepts, change the
  original denominator, or qualify production. Entity and lane tests pass.

- Synced the reviewer and `lib/source-review-evidence.mjs` after the remote
  Node process check returned no processes. Ran the same locked 100 on Qwen
  11441/11447: valid 100, accept 63, reject 35, manual 2, failures/timeouts 0.
- Gemma 11442/11444 reviewed only those 63 accepted rows: valid 63, accept 61,
  reject 1, manual 1, failures/timeouts 0, elapsed 171.44 seconds. Exact source
  entry/sense IDs and gloss equality against Qwen accepts were checked locally.
- Reports: `logs/v219-zhja-fresh100l-qwen-evidence-calibration.json` and
  `logs/v219-zhja-fresh100l-gemma-evidence-calibration.json`.
- The 61 consensus rows are NOT a passing 80/100 cohort. Both reviewers also
  accepted a book title and an anatomical term; semantic agreement alone does
  not establish everyday-vocabulary scope. No generation/promote was started.
- GPU availability checks preceded each run. No hold or manifest relaxation
  was performed. Remote reviewer/helper hashes require reconciliation before
  production; calibration output does not authorize that transition.

- Follow-up input inspection found native candidates store lexical evidence in
  `daily_sense_selection.alternatives`, while the review evidence compactor only
  read `sense_alignment.candidates`. Alternatives were visible elsewhere in the
  prompt, but the dedicated source evidence array was empty. The local fix binds
  the unblocked exact selected ID first, including source/gloss/POS; unrelated
  alternatives are never silently substituted. Existing alignment evidence is
  retained and deduplicated. Evidence and review-contract regression tests pass.
  This is a local input repair, not evidence of improved model acceptance; remote
  calibration and runner manifest reconciliation remain pending.

- Compared `v219-zhja-fresh100l-qwen.json` with
  `v219-zhja-fresh100l-qwen-calibration.json`: both contain the same 100 exact
  source entry/sense identities and locked glosses; both valid 100, accepted 66.
- Ten decisions changed (five accepted to rejected, five rejected to accepted).
  Unchanged aggregate acceptance therefore does not establish stable decisions.
- Calibration is not a fresh holdout and cannot qualify the 80/100 gate.
  Do not union accepted rows across retries to manufacture a passing cohort.
- `compare-dictionary-source-reviews.mjs` checks identity uniqueness, cohort
  equality and unchanged word/language/gloss before reporting per-row changes.
  Tests cover duplicate/replaced identities, changed gloss and invalid responses.
- Local diagnostic: `logs/v219-zhja-fresh100l-calibration-diff.json`.
  The language-mismatch rejection for the Japanese headword sharing Chinese
  characters persists; the prompt change alone has not resolved reviewer errors.
- No hold removal, remote production start or database write was performed in
  this diagnostic step. The previously uploaded experimental reviewer still
  needs manifest reconciliation before any production restart.

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

## 100r Alternate-Sense Diagnostic

The locked 100r input has 99 rows carrying the first-source-sense bonus; 78 of
those were Qwen accepted, plus the remaining one row. This association alone
does not justify changing the ranking weights or certify a causal improvement.

The 33 alternate senses across 18 previously nonaccepted entries were reviewed
on idle 143/56 using the existing Qwen source reviewer with daily-primary checks.
All 33 responses were valid: 21 accepted, 12 rejected, no failed requests or
timeouts. The 21 accepts cover 15 distinct entries, not 21 new headwords.
Exact source entry/sense identities, words and glosses were checked against the
diagnostic input with no duplicate reviews. Reports:
- `logs/v219-native-holdout100r-alternate-diagnostics.json`
- `logs/v219-native-holdout100r-alternate-qwen.json`

These are source-selection diagnostics only. They are not unioned with the old
79 accepts to manufacture a passing 100-row cohort. No database write, generation,
hold removal or publication occurred. Accepted alternatives still need independent
review and per-entry resolution before any generation, especially entries with
multiple near-synonymous accepted alternatives.

Gemma follow-up on 144/147 reviewed only the 21 Qwen accepts using original
candidate rows without Qwen verdicts or reasons. All 21 were valid and accepted;
zero failed requests/timeouts. Exact identities, words and glosses match both
reviews. `logs/v219-native-holdout100r-alternate-resolution.json` groups the
21 consensus senses into 15 entries: ten have one accepted alternative, five
have multiple alternatives. The review is at
`logs/v219-native-holdout100r-alternate-gemma.json`.

Do not automatically generate all 21: source entry 926443 still needs manual
source/reading reconciliation. Both models accepted source sense 1304441
(miss a chance), but the original rejection identified fail/come to nothing as
the primary meaning, and that gloss exists in source sense 926443. Consensus
does not resolve this discrepancy. No source sense was changed and no database
write or quality-hold removal occurred.

## CC-CEDICT Homograph Identity Defect

Read-only inspection of remote entry 926443 found source senses 926443,
1304440 and 1304441, but no sense localization rows carrying their readings.
The default raw `data/raw/CC-CEDICT.txt.gz` is absent on the runner.
Current MDBG records distinguish the readings and senses of this headword:
https://www.mdbg.net/chinese/dictionary?wdqb=%E8%90%BD%E7%A9%BA
This current reference is not proof of the contents of the historical import.

Code inspection found a reproducible staging import collision: CC-CEDICT entry
keys used only traditional/simplified forms; source sense keys added only the
definition index. INSERT OR IGNORE could therefore discard later homographs
with different readings. Local fix uses versioned form-plus-pinyin identities
and refuses importing over legacy CC-CEDICT identities. Do not rewrite existing
source IDs or rerun canonical import against the production source DB.

`node scripts/test-cedict-reading-identity.mjs` passed real isolated SQLite/CLI
tests: three readings preserve five senses, repeated import stays idempotent,
and legacy identities stop the import. `npm.cmd run check` passed. The importer
fix is local only; remote deployment, fresh staging reconstruction, historical
loss quantification and controlled source-link repair are not yet performed.

### Current Snapshot Isolated Rebuild

Downloaded the public MDBG CC-CEDICT gzip to `logs/v219-cedict-current.txt.gz`;
SHA-256 `2ecb528d2f45e4ee7f2b6a736d338878901c65cc099d02eec550c7b15309aa1e`.
`audit-cedict-reading-collisions.mjs` compares old INSERT-OR-IGNORE identities
against a real fresh staging import using the repaired importer, then checks
every stored key, gloss and reading against the input.

Result: 124,968 source lines, 2,267 multiple-reading form pairs, 196,386 senses
under the old identities versus 199,650 under the new identities: 3,264 additional
senses preserved. SQLite quick_check returned ok. These are current-snapshot
experimental counts, NOT verified historical or online damage counts.

Report: `logs/v219-cedict-reading-collisions.json`.
Completed isolated DB: `logs/v219-cedict-isolated-rebuild-wal/staging.db`.
The first experiment in `logs/v219-cedict-isolated-rebuild` timed out after
five minutes under rollback-journal per-entry commits and is incomplete; retain
it as a failed run, not an import baseline. A new isolated WAL DB completed the
same import and verification. No production journal setting was changed.

Next compare preserved readings and source identities against the authoritative
remote source/product links before designing a bounded repair. Do not wholesale
replace source DB IDs or promote newly recovered meanings automatically.

### Remote Exact-Match Reconciliation

`audit-cedict-recovered-source-coverage.mjs` ran on the jump host from `logs/`
with read-only/query-only SQLite connections and indexed entry/sense/link lookups.
No production script or manifest was changed. Report:
`logs/v219-cedict-recovered-remote-coverage.json`.

Of 3,264 recovered snapshot rows: 3,053 had no exact normalized source gloss;
159 matched only another source; nine matched CC-CEDICT gloss and reading text;
43 matched CC-CEDICT gloss but reading could not be verified. These categories
sum to 3,264 across 2,250 simplified forms. Exact-gloss absence is not proof of
semantic absence, and raw pinyin text comparison is not phonetic normalization.

1,208 rows belong to entries having accepted product-source links for some
existing sense. This is not 1,208 corrupted or published senses. Linking a
different meaning cannot prove that the recovered meaning is already covered.

Intersecting the original 100r Chinese headwords with these rows finds only
source entry 926443 (two recovered readings). Thus the collision defect does
not explain all 21 original nonaccepts. Keep its repair separately scoped;
do not delay the other source-selection work on a whole-database rebuild.
# Same-Cohort Source Selection Repair (2026-09-04)

## Completed Draft22 Write

The 22 final-reviewed entries were written to the remote product DB under the
goal's draft-only stage, after SQLite consistent backup
`logs/v219-revised-draft22-before.db`. Write report:
`logs/v219-native-holdout100r-revised-draft22-apply.json`.
Inserted 22 entries, 22 senses, 88 localizations, 22 source links, 22 examples
and 88 example localizations. All new senses are `draft_single_source`; all
new localization/example content has `needs_review=1`. No accepted sense was
reused or overwritten. Six-table EXCEPT comparison against the backup proves
every existing row remains unchanged. Verification report:
`logs/v219-revised-draft22-verification.json` (quick_check OK, no FK violations,
quality-hold hash unchanged).

Post-write fast audit passed: 57,120 publishable senses, zero review
localization leakage, bad localization counts, duplicate sense orders,
orphans, mojibake and HTML artifacts. Published-risk audit passed with
`flagged_senses=0`. Overall DB is now 49,359 entries / 58,353 senses /
233,404 localizations; accepted senses remain 57,131 (distinct from publishable).
Fast audit still reports 1,018 duplicate-localization warnings and 8,908 invalid
part-of-speech observations; do not describe the whole DB as warning-free.
No promote, hold removal, D1 export or Worker deployment occurred. These 22
drafts do not establish the >=80% promote rate required for scale production.

## Controlled Input and Read-only Replay22

Final-review accepts were rebound to the repaired original source rows and
both source-review approvals. The old builder selected 19/22: three revised
source selections were rejected solely because their selection policy was not
recognized. Local builder support now accepts the revised policy only with
the final generation/evidence/consensus gate enabled, exact selected glossary,
unlinked source sense and the existing native source/identity checks. Tests:
`test-revised-controlled-source-lock.mjs`, fingerprint CLI tests and TypeScript
check passed. This local builder change has NOT been deployed remotely.

`logs/v219-native-holdout100r-revised-controlled-replay22.json` contains 22
unchanged final-reviewed outputs (zh11/ja11), generated locally. Only the report
was uploaded; no remote code or manifest changed. The already deployed generator
completed `logs/v219-native-holdout100r-revised-replay22-dryrun.json`:
22 matched/accepted, zero rejected, `apply=false`, `dry-run=true`, all writes
zero. Deep comparison confirmed all 22 output objects unchanged. No model call
or database insertion occurred. This is preparation for controlled draft writes,
not a completed draft/promote batch or permission to clear the quality hold.

## Repaired-Cohort Generation and Final Review

Completed after the source review below, using existing remote scripts with
`apply=false`, `dry-run=true`, `publishable=false` and proposal-only candidates.
Qwen 143/56 generated all 85 entries with four-language examples, max attempts 2,
compact prompt, 8192 context and 2400 output tokens. Report:
`logs/v219-native-holdout100r-revised-generation.json`.
76 passed validation (89.4%), nine rejected. Six rejects were Japanese terms
not found in JMdict, one Japanese-reading mojibake flag, and two English
term/gloss mismatches. Two malformed JSON response events were observed and
recovered; final infrastructure rejects were zero. Do not equate final zero
infrastructure rejects with zero JSON failure events.

Reverse report: `logs/v219-native-holdout100r-revised-reverse.json`.
Of 76 valid outputs, 28 supported, 36 unsupported, 12 manual. Same policy:
source reverse evidence required, Wiktionary family unified, at least three
supported target languages and at most one manual. Portuguese reasons included
32 no-reverse-evidence, 18 conflicting-gloss, six Wiktionary-only and two
OMW-only rows; these are evidence diagnostics, not proof all translations are wrong.

Gemma 144 final report: `logs/v219-native-holdout100r-revised-final-gemma.json`.
28 reviewed/valid, 22 no-correction accepts, six rejects, zero failed. Generation
and evidence SHA-256 fingerprints match local copies. Rejections concern
translation scope, unnatural examples, quantity preservation and target usage.
Reviewer suggestions remain proposals; do not replace source headwords blindly
(in particular the suggestion to change the Japanese source term for "one by one").

No draft insertion or promote occurred. All write counts remain zero; product
DB and quality-hold hashes unchanged and no Node process remained after review.
22 final accepts are not a promote rate: controlled draft replay and audits are
still required. Source qualification now passes, but generation 89.4% and reverse
support 28/76 (36.8%) do not establish readiness for 500-row controlled production.

## Invalid-Generation Retry Follow-up

The repaired 85-row generation report contained nine deterministic validation
failures: six `ja_term_not_in_jmdict`, one `mojibake_reading_ja`, and two
`en_term_gloss_mismatch`. The exact nine source entry/sense identities were
rebuilt from the proposal report; no candidate was added or substituted.

The first remote retry on Qwen 143/56 produced two valid outputs and seven
validation rejects, with zero infrastructure failures and zero writes. Strict
reverse evidence classified the two valid outputs as one `manual_review` and
one `unsupported`; neither advanced to Gemma final review or draft insertion.

Investigation found that compact generation prompts included only the previous
error names, while detailed retry guidance was limited to the non-compact
prompt. The compact builder now includes `compactRetryFeedback`, including the
failed Japanese term and the locked English meaning requirement. The deployed
generator SHA-256 is
`0DEE94BCAE70025D67F5CBD13F88A9263A47B456140AA1B47C989BB95258512E`;
the manifest entry has the same hash. Remote backup:
`logs/v219-compact-retry-backup/backup-20260905-153416`.

The corrected compact retry still produced only one valid output and eight
validation rejects, again with zero infrastructure failures and zero writes.
Five rows remained outside JMdict, one repeated a corrupt Japanese reading, and
two attempts still included an English anchor mismatch across the two runs.
This demonstrates that these residuals are not suitable for repeated automatic
generation. They require a deterministic attested-term repair or manual review;
the validator and reverse-evidence thresholds must not be relaxed to recover
them.

Post-run checks found no Node process. The quality-hold SHA-256 remained
`65D2737405EA28D55C564FECBC50309E85D73DB0ACF073BC8BBAA05BB65C09A8`.
No promote, D1 operation, Worker deployment, or hold removal occurred.

## Completed Repaired-Cohort Review

The repaired same 100 entries were re-reviewed in full, rather than combining
old and retry approvals. Input: `logs/v219-native-holdout100r-revised-source-review.json`;
all 50 Japanese rows have exact sense-bound JMdict metadata. Nine source sense
choices changed; all 100 headwords and ordering were preserved. This is a repaired
cohort, not an unseen holdout or proof of general production performance.

- Qwen: `logs/v219-native-holdout100r-revised-qwen.json`: 100 reviewed/valid,
  88 approved, 12 rejected, zero manual/failed. Nodes 143/56 handled 43/57 calls;
  active request failures and timeouts were zero.
- Gemma: `logs/v219-native-holdout100r-revised-gemma.json`: 88 reviewed/valid,
  85 approved, one rejected, two manual, zero failed. Input contains original
  source rows filtered to Qwen accepts, without Qwen verdicts or reasons.
- All 88 Gemma calls ran on 144. Node 147 prewarm failed immediately with
  HTTP 500 and was excluded. Do not report a successful two-node Gemma run or
  zero infrastructure failures; zero request failures applies only to active calls.
- 85 exact entry/sense/word/gloss-bound proposals are in
  `logs/v219-native-holdout100r-revised-proposals.json`, marked proposal-only and
  no-promote. Source agreement is not agreement on as-yet-ungenerated translations.

The repaired cohort passes the requested source pre-review thresholds (100%
valid, 88% accepted), with 85/100 independent source consensus. The original
79/100 result remains historical evidence and is not rewritten. Next: generate
four-language outputs, reverse evidence and final independent translation review,
then controlled draft replay. Do not remove the quality hold or start 500 solely
on these source-review results. No drafts, promotes, D1 or Worker changes occurred.
Post-run product DB and quality-hold SHA-256 match the pre-run guard snapshot;
no Node process remained.

After the authorized remote 20-row preservation replay passed, source
qualification remains the blocker: original Qwen acceptance is 79/100.
`logs/v219-first-sense-bonus-ablation.json` shows that removing the 2,000-point
first-source-sense bonus changes eight choices, six previously accepted. It
also moves the Japanese whole/total entry to "from the start". Do not deploy
this scoring ablation as a general correction.

`scripts/build-dictionary-source-review-revision.mjs` instead constructs a
same-cohort repair report from locked original candidates and alternate source
reviews. It binds IDs, words, languages and glosses; requires both reviews to
accept at confidence >=0.9 without risk flags; permits only one consensus
alternative; preserves previously accepted choices and explicit source holds;
and strips stale translation hints from changed rows. This is source-selection
repair, not an unseen holdout or a new qualification pass.

Report: `logs/v219-native-holdout100r-revised-source-selection.json`.
All original 100 headword identities and their order are preserved. Nine
selections change; 12 original nonaccepted choices are deferred unchanged.
Entry 926443 remains held because of the CC-CEDICT pronunciation collision.
The artifact includes input file hashes, `qualified=false` and a requirement
to re-review all 100. Do not combine old accepts with alternate accepts to
claim a new acceptance rate. Re-enrich sense-specific Japanese metadata before
remote review where needed; no previous review verdict should appear in the
model-facing input.

`node scripts/test-source-review-revision.mjs`, builder syntax and
`npm.cmd run check` pass. No remote code deployment, model call, DB write,
hold removal or publication was performed for this repair report.

## Expanded Reservoir And v6 Qualification

The original 4,000-row ZH/JA reservoir did not exhaust its deterministic
upstream pool. A second selection excluded the first reservoir and retained
3,640 distinct rows (2,450 ZH, 1,190 JA). JMdict enrichment matched 1,174 JA
rows exactly and marked 16 ambiguous; the daily-quality filter retained 3,573.
The unchanged v119 independent-evidence prefilter retained 97 rows. Combining
these with 16 unused rows from the first reservoir produced the frozen v5
100-row report, SHA-256
`B9FDB772289B1A8E928B83737AC98099297BF6CB8AC1DC474673D848782AAC44`.

Qwen source review ran on 143/155/47/56 and completed 100 valid responses with
79 accepts, 20 rejects and one manual item. Endpoint counts were 33/34/9/23;
network failures and timeouts were zero. The fixed cohort therefore did not
meet the 90/100 source-review gate. Rejections were predominantly target-term
specificity and POS errors, for example generic room for `座敷`, generic family
for `家庭成员`, and primary battery mixed into `蓄电池`.

Qwen was then used explicitly as a prescreener over the expanded pool. Gemma
reviewed 156 Qwen-accepted candidates in three bound batches and accepted 90,
rejected 39, and returned 27 evidence-contract manual items. This 90 is a
prescreened production queue, not a fresh 90/100 holdout result. The first
Gemma attempt accidentally loaded both 143 and 155 with a 1,024-token context;
all requests failed with `context_length_exceeded`. Reloading the same frozen
input at 8,192 tokens fixed the infrastructure issue. Future Gemma source
review commands must set `--max-seq-length 8192` when using the compact prompt.

`filter-dictionary-v2-source-review-to-pool.mjs` now trims merged review
reports to an exact candidate pool and fails on any entry/sense/word/language/
gloss mismatch. It enabled a bound 90-row proposal report, SHA-256
`F0EE224E4BE5F4E363561400E6017E418271EB7AC9D50B194B37ECCC6E10D583`.
Qwen generation on 47/56 produced 86 valid four-language entries out of 90
(95.6%), with four deterministic validation rejects and zero infrastructure
failures. Strict reverse evidence supported 54, sent 22 to manual review, and
rejected 10. Portuguese accounted for 18 manual decisions. The 60% supported
rate is below the 80% gate, so final Gemma translation review, draft replay,
promotion, hold removal, D1 publication, and Worker deployment were not run.

### v6c reverse-evidence retry diagnosis

Replaying the same 86 valid generations against the newer v121 supplemental
evidence database did not change the result: 54 supported, 22 manual and 10
unsupported. The evidence database version was therefore not the cause. Exact
inspection showed that most manual rows had strong, independently sourced
generation hints, but full generation had run with
`enforce_generation_hint_terms=false`. Qwen frequently paraphrased those locked
terms into natural but unindexed phrases, for example `grama verde` instead of
`grama`, `articulação do quadril` instead of `quadril`, and `bufalo` instead of
the evidence-bound `búfalo`. This makes a
translation unverifiable even when its meaning appears plausible.

`select-dictionary-v2-reverse-evidence-retry.mjs` now selects retry rows by the
exact source entry/sense key from a reverse-validation report. The current
retry report contains 22 rows (15 JA and 7 ZH) and remains proposal-only. The
remote pipeline and runner manager now default to enforcing generation-hint
terms; an explicit `--enforce-generation-hint-terms false` remains available
for diagnostic experiments. Retry only these 22 rows, merge them with the 54
unchanged supported generations, and rerun strict reverse validation. Do not
regenerate already supported rows and do not treat model agreement as source
evidence.

After the jump host reboot, SSH still reaches the `James` account and the
runner tree is intact, but `UNSLOTH_API_KEY` is absent from that user's
persistent environment. Do not embed it in scripts, logs or the repository.
Restore it in the jump-host user environment before starting the 22-row remote
retry.

The credential was subsequently restored in the jump-host `James` user
environment. The repository-local loader also confirms that the ignored
`.env.local` contains the expected variable; no token value was added to Git,
the runner manifest, or documentation.

The locked-term retry generated all 22 rows successfully on 47/56, with 11
calls per endpoint and no transport, JSON or deterministic validation failure.
Replacing only those exact rows in the original 90-row generation report raised
strict reverse-evidence support from 54 to 76 rows. The new rate is 76/90
(84.4%), above the 80% reverse-evidence gate. Ten rows remain unsupported and
four original generation rows remain invalid; neither category was silently
dropped from the denominator.

Gemma final review of the 76 supported rows ran on 143/155 at an 8,192-token
context. It returned 51 accepts, 23 semantic rejects and two manual rows, with
zero infrastructure failures. The two manual rows (`垂水` and `梦到`) remained
manual after one targeted retry because both reviewers attempted to override a
`deterministic:jmdict-unique` reading; the validator correctly refused that
override. The 23 rejects identify real term-scope, sense, definition or example
problems. Do not write this cohort to the product database yet. Preserve the 51
accepted rows and build a correction-feedback retry only for the 23 semantic
rejects, followed by reverse evidence and a fresh Gemma review.

The 23-reject correction retry was executed with exact candidate binding and
the original Gemma reasons included as Qwen QA feedback. Qwen returned 22 valid
revisions and one deterministic validation failure, with no infrastructure
failure. Replacing only those rows left 75/90 strict reverse-supported entries
(83.3%), still above the 80% reverse-evidence gate.

Gemma reviewed only the 22 valid revised rows; the original 51 accepts stayed
frozen. The second review accepted two (`オペ` and `パイレーツ`), rejected 19,
and left one manual. This raises the frozen accepted set to 53, but does not
meet the final-review quality threshold. Repeated generation is no longer an
appropriate action for the remaining 20 rows: their source candidate, locked
target term, semantic breadth, or everyday-use priority is the problem. Move
them to a candidate/evidence residual lane and do not write them to the product
database. Future scale cohorts must use this failure signal to reject such
candidates before full four-language generation.

`build-dictionary-v2-product-source-gap-consensus-retry-report.mjs` now accepts
an explicit `--decisions` filter. Use `--decisions reject` for semantic repair;
do not mix infrastructure/manual outcomes into a correction batch.

### v219 exact-sense residual exclusion and daily replacement gate

The 37 terminal generation/final-review residuals are now stored as an exact
source entry/sense exclusion report. A first 100-row native-daily dry build
revealed one leak: `基础教育` re-entered through an entry that still had another
eligible sense, after which the selector chose the previously rejected sense.
Entry-level exclusion alone is therefore insufficient for residual handling.

`build-dictionary-v2-additional-sense-attempt-index.mjs` now accepts explicit
history reports, and `new-remote-dictionary-production-batch.ps1` passes exact
sense histories independently from entry-level history. The UTF-8 Node checker
`verify-dictionary-v2-residual-exclusion.mjs` replaces PowerShell 5.1 JSON
inspection for these deeply nested multilingual reports. The rebuilt 100-row
cohort had zero overlap with all 37 final-review residuals and zero overlap with
the 38 rows not approved in the first source review. No product DB write was
performed.

The first Qwen source review of the corrected 100-row daily cohort was fully
valid but accepted only 62 rows; 37 were semantic rejects and one additional
row was not approved. The dominant causes were wrong primary sense, uncommon
or historical sense, proper names, and overly narrow glosses. Those exact
senses were fed back into the attempt index rather than weakening the source
review contract.

A replacement cohort then produced 91/100 Qwen approvals with 100 valid JSON
responses and zero network, timeout or circuit-breaker failures across
143/155/47/56. Independent Gemma review on 143/155 accepted 87 of those 91,
rejected four, and had zero infrastructure failures. The frozen dual-model
consensus is therefore 87/100, below the 90% source-quality gate. Do not start
four-language generation or write drafts for this cohort. Preserve the 87
accepted rows and replace only the 13 non-consensus exact senses in the next
iteration.

The 87-row consensus was subsequently frozen by exact source entry/sense ID.
A new cohort retained all 87 frozen rows and supplied exactly 13 replacements.
Qwen accepted eight replacements and Gemma independently accepted all eight,
raising the immutable source-review consensus to 95/100. Both stages had zero
transport, timeout, JSON or circuit-breaker failures. The merged 95-row report
has SHA-256 `E2DFD569AE548545718205AF36CE25F6972282C9787F50063DECF090D22B569F`.

Dry-run Qwen generation on 47/56 produced 90 valid four-language entries from
the 95 source-approved candidates (94.7%), with five deterministic validation
rejects and zero endpoint failures. No database write occurred. Strict reverse
dictionary validation supported only 2 of the original 95 rows; 58 were manual
and 30 unsupported among the 90 valid generations. Portuguese had 53 manual
and 16 conflicting terms, while Japanese had 34 manual and 17 conflicting
terms. This cohort therefore fails the 80% deterministic-support gate and must
not proceed to final Gemma review, draft insertion or promotion. The next work
is deterministic PT/JA target-term acquisition and binding for these exact
source senses, followed by regeneration of only the affected rows. Repeating
free-form generation or weakening the evidence-family policy is prohibited.

### v219 PT/JA generated target-term acquisition

The 95-row dry generation report was joined to its strict reverse-evidence
report by exact source entry/sense ID. This produced 120 target-term acquisition
tasks: 69 for Brazilian Portuguese and 51 for Japanese. Only languages whose
generated term was not already deterministically supported were included.

Qwen target-term suggestion ran as a report-only task on ports 11447/11448. It
returned valid suggestions for 119/120 tasks; port 11447 handled nearly the
entire batch while port 11448 had one invalid result. No database write was
performed, and model suggestions were not treated as dictionary evidence.

Strict validation against the source DB and the v121 supplemental evidence DB
accepted only 2/120 candidates and 4 terms. Both accepted candidates were
Japanese: `空荡荡` (`空っぽ`, `がらんどう`) and `必要条件` (`要件`, `条件`).
Each accepted term had matching JMdict and Wiktionary-family evidence. All 69
Portuguese tasks failed the two-independent-family requirement; the other 49
Japanese tasks also lacked sufficient same-term independent evidence. This
confirms that another LLM retry cannot unlock the cohort. The next prerequisite
is additional independent Portuguese and Japanese lexical evidence, followed
by rerunning this deterministic validator and regenerating only rows whose
locked target terms become supported.

Operational note: the v121 evidence database is local to the main project and
is not present in `D:\linguago-runner`. An earlier remote inventory appeared to
show it only because malformed PowerShell quoting caused part of the command to
run in the local shell. Use Base64-encoded PowerShell for SSH commands and
verify absolute paths with `Test-Path` before starting a remote validation.

### v219 v122 target-term evidence repair and controlled commit

Dicionario Aberto exact-term probing found 69 review candidates across 28 of
the 69 Portuguese target gaps. Qwen reviewed the definitions on 11447/11448
and strictly approved 22/69; Gemma independently reviewed the same fixed shards
on 11441/11445 and approved 52/69. Requiring both models to approve the same
definition with empty risk flags left 16 candidate-bound Portuguese evidence
rows. These rows were merged with v121 into the local v122 supplemental DB.

Deterministic validation against v122 improved the target-term result from two
to four exact candidate senses. The two new Portuguese repairs are `走掉 ->
partir` and `等同 -> equiparar`, each supported by Dicionario Aberto and the
unified Wiktionary family. The Japanese repairs remain `空荡荡 -> 空っぽ` and
`必要条件 -> 要件`, with acceptable alternates retained in the validation
report. The other reviewed Dicionario terms still lacked a second allowed
independent family and were not promoted.

`apply-dictionary-v2-product-target-term-repair-report.mjs` now copies accepted
repairs into evidence-bearing `generation_hints`; this is required because the
generator only locks reviewed preferred terms and generation hints. A focused
regression test verifies preservation of existing hints and the PT repair
provenance. Qwen 11447/11448 then regenerated only the four exact source senses:
4/4 valid, no endpoint failures. Strict post-generation reverse validation was
4/4 supported, with all 16 language decisions supported. Gemma 11442/11445
accepted all four without corrections at confidence 1.0.

The first local isolated replay exposed that the local product DB is stale
(`42,005 entries / 48,535 senses`) and reproduces an existing `征/徵` alias
configuration mismatch. It is not a valid release baseline. The jump-host DB
was verified as authoritative before commit: SHA-256
`0BC1DFC6651B1FE6EEEF2A865B7DB2546F62B96FD75719169CD181C052A66530`,
`49,359 entries / 58,353 senses`, and `57,120` publishable senses.

The remote release controller reran isolated draft insertion, idempotency,
promote, fast audit, published-risk, native export, and full in-memory import.
Results were 4 draft senses inserted, zero writes on replay, 4/4 promoted,
`flagged_senses=0`, and all blocking full-audit counters zero. It then atomically
committed the isolated DB to the jump-host main product DB. The new main SHA-256
is `8AB3D41C1F2791F3D85A93F1B8162518C9716312FE3E93C80F5F8EA97D3301C6`;
the rollback backup is
`backups/v219-target-repair4-v122-isolated-main-before-commit-20260908-215210.db`.
Post-commit export counts are `48,230 entries / 57,124 senses / 228,496 sense
localizations`. D1 and the Worker were not updated; continue accumulating the
release cohort before the next online deployment.

### v220 simplified draft-production pilot

The production runner now separates `draft-production` from
`release-validation`. Draft production may write only `draft_single_source`
senses with `needs_review=1`; it stops before generated reverse validation,
final Gemma review, promotion, export or deployment. Release validation remains
a separate explicit run over a completed draft source run.

The first remote pilot exposed three control defects before any publishable
data changed. Candidate shortfall incorrectly stopped a usable draft batch,
the candidate builder verified unrelated mutable manifest entries, and an old
v219 automatic-commit quality hold blocked the new non-publishable mode. Draft
mode now continues with any nonzero audited cohort, skips only the broad runner
manifest check, and ignores old automatic-commit holds. Full publication mode
retains the strict behavior. The current batch still ran its own 375-row
candidate audit with zero findings.

Run `v220-simplified-draft500-20260909-015720` selected 375 new headwords:
150 Chinese, 150 Japanese and 75 English. Source alignment retained 323, Gemma
source review retained 237, reverse-supported semantic locking retained 91,
semantic preview review retained 79, and the generation preflight retained 70.
Qwen generated 70/70 structurally valid entries with zero endpoint failures
across the dynamically discovered pool.

The initial generator invocation correctly marked all 70 rows as not yet
promotable, but incorrectly suppressed their draft writes. The generator now
has `--allow-no-promote-draft-writes`, which is valid only with `--apply true`
and `--publishable false`. A no-model replay revalidated and inserted exactly
70 draft entries, 70 draft senses, 280 review localizations and 70 source links.
The authoritative DB moved to `49,433 entries / 58,427 senses / 233,700 sense
localizations`; publishable senses remained exactly `57,124`.

Post-write fast audit and published-risk both passed: localization count errors,
review-localization leakage, duplicate sense order, orphans, mojibake, HTML
artifacts and flagged publishable senses are all zero. The draft cohort is not
approved for publication. Next run release validation over the frozen 70-row
generation report, then promote only accepted rows through the existing
isolated commit and full export gates.

Release validation reused the frozen 70-row Qwen generation report without
calling the generator again. Deterministic reverse evidence supported 17 rows
and routed 53 to manual review. Final Gemma review accepted all 17 supported
rows without correction. Promote dry-run and isolated apply both accepted
17/17 and promoted 68 localizations.

The staged database passed fast audit, published-risk, native D1 export and a
full in-memory import audit. Export counts are `48,247 entries / 57,141 senses /
228,564 sense localizations`; all blocking counters are zero and
`flagged_senses=0`. The staged database was atomically committed to the remote
authoritative product DB. Its SHA-256 is
`3BF39CCEE5CF86B4FD866A47C9A56C0888645165DC5E495585287E2924C600A4`.
The rollback backup is
`backups/v220-simplified-draft70-promote17-main-before-commit-20260909-113458.db`.
Post-commit fast and published-risk audits also passed. D1 and the Worker were
not updated because this cohort adds only 17 publishable senses; continue
accumulating validated cohorts toward the release threshold.

The second simplified cohort, `v220-simplified-draft-b2-20260909-024053`,
selected another 375 audited daily headwords (150 Chinese, 150 Japanese and 75
English). Source alignment retained 319, Gemma source review approved 235,
reverse evidence retained 88, semantic preview accepted 80, and generation
preflight retained 71. Qwen produced 70 valid draft rows and inserted 70
non-publishable senses plus 280 review localizations. Gemma source and preview
review dynamically used 143/144/147/155/224/47/56; Qwen generation also used
048 after dynamic discovery confirmed that Qwen was installed there.

Release validation reused the frozen generation output. Reverse evidence
supported 17 rows and final Gemma review accepted 15 without correction.
Promote dry-run and staged apply accepted 15/15. The staged database passed
fast audit, published-risk, native export and full in-memory import with all
blocking counters zero. Export counts are `48,262 entries / 57,156 senses /
228,624 sense localizations` and `flagged_senses=0`.

The staged database was atomically committed to the remote authoritative DB.
Its SHA-256 is
`724DF5349BE1D79B8B37B25605199439939932E71247EBC932FE626F84DF0A36`.
The rollback backup is
`backups/v220-b2-draft70-promote15-main-before-commit-20260909-162810.db`.
The release cohort is now 36 publishable senses above online v218: four target
repairs, 17 from the first simplified cohort, and 15 from this cohort. D1 and
the Worker remain unchanged until the configured release threshold is reached.

The third simplified cohort, `v220-simplified-draft-b3-20260909-073218`,
selected 375 audited headwords and aligned 325 source senses. Gemma source
review approved 235, reverse evidence retained 92, semantic preview accepted
86, and Qwen generated 76/76 valid draft entries. The draft stage inserted 76
non-publishable senses and 304 review localizations. The additional-sense lane
was scanned but contributed no selected rows after the historical attempt
index; this cohort therefore consisted of new headwords.

Release validation supported 14/76 rows by reverse evidence and final Gemma
review accepted 13 without correction. Promote dry-run and staged apply
accepted 13/13. Fast audit, published-risk, native export and full in-memory
import all passed with blocking counters zero. Export counts are `48,275
entries / 57,169 senses / 228,676 sense localizations`.

The staged database was atomically committed to the remote authoritative DB.
Its SHA-256 is
`4689816232D50312751F979954C4107BD2F407A5C223C2CB9C71D901A2654968`.
The rollback backup is
`backups/v220-b3-draft76-promote13-main-before-commit-20260909-164320.db`.
The release cohort is now 49 publishable senses above online v218. D1 and the
Worker remain unchanged.

The fourth simplified cohort, `v220-simplified-draft-b4-20260909-074450`,
selected 375 audited headwords and aligned 314 source senses. Gemma source
review approved 223, source reverse evidence retained 70, semantic preview
accepted 63, and the JMdict preflight retained 58. Qwen generated and inserted
58/58 valid non-publishable draft senses with 232 review localizations.

Release validation reused the frozen generation output. Deterministic reverse
evidence supported 15/58 rows and final Gemma review accepted 14 without
correction. The existing-draft promote scope accepted and promoted 14/14. Fast
audit, published-risk, native export and full in-memory import all passed with
all blocking counters zero. Export counts are `48,289 entries / 57,183 senses /
228,732 sense localizations`, and `flagged_senses=0`.

The staged database was atomically committed to the remote authoritative DB.
Its SHA-256 is
`C99928A7EF84D5161791413740A702BF642AF40C3FA066E0E57901FD5B136B7B`.
The rollback backup is
`backups/v220-b4-draft58-promote14-main-before-commit-20260909-165724.db`.
The release cohort is now 63 publishable senses above online v218, leaving
4,937 senses before the configured 5,000-sense release threshold. D1 and the
Worker remain unchanged.

The fifth simplified cohort, `v220-simplified-draft-b5-20260909-085331`,
selected 375 audited new headwords (150 Chinese, 150 Japanese and 75 English)
with zero candidate-quality findings. Source alignment retained 319, Gemma
source review approved 228, source reverse evidence retained 95, semantic
preview accepted 90, and generation preflight retained 85. Qwen produced 84
valid rows and inserted 84 non-publishable draft senses with 336 review
localizations.

Release validation reused the frozen generation output. Deterministic reverse
evidence supported 28 rows and final Gemma review accepted all 28 without
correction. The existing-draft promote scope accepted and promoted 28/28.
Fast audit, published-risk, native export and full in-memory import passed with
all blocking counters zero. Export counts are `48,317 entries / 57,211 senses /
228,844 sense localizations`, and `flagged_senses=0`.

The staged database was atomically committed to the remote authoritative DB.
Its SHA-256 is
`6173077FCC566348C7574F4F0C21A4F80A4593FFFE17E8146D68396DA62E1492`.
The rollback backup is
`backups/v220-b5-draft84-promote28-main-before-commit-20260909-180523.db`.
The release cohort is now 91 publishable senses above online v218, leaving
4,909 senses before the configured release threshold. D1 and the Worker remain
unchanged.

The sixth simplified cohort, `v220-simplified-draft-b6-20260909-091301`,
selected 375 audited new headwords (150 Chinese, 150 Japanese and 75 English)
with zero candidate-quality findings. Source alignment retained 319, Gemma
source review approved 239, source reverse evidence retained 98, semantic
preview accepted 93, and generation preflight retained 86. Qwen generated and
inserted 86/86 valid non-publishable draft senses with 344 review
localizations.

Release validation reused the frozen generation output. Deterministic reverse
evidence supported 31 rows, routed 55 to manual review, and final Gemma review
accepted 29 without correction. The existing-draft promote scope accepted and
promoted 29/29. Fast audit, published-risk, native export and full in-memory
import passed with all blocking counters zero. Export counts are `48,346
entries / 57,240 senses / 228,960 sense localizations`, and
`flagged_senses=0`.

The staged database was atomically committed to the remote authoritative DB.
Its SHA-256 is
`0B2A6FF2F821F2FD329BD751C91A101E73CD716D753CF1223CE05DB0E70C2DA3`.
The rollback backup is
`backups/v220-b6-draft86-promote29-main-before-commit-20260909-182903.db`.
The release cohort is now 120 publishable senses above online v218, leaving
4,880 senses before the configured release threshold. D1 and the Worker remain
unchanged.

The seventh simplified cohort, `v220-simplified-draft-b7-20260909-095701`,
selected 375 audited new headwords (150 Chinese, 150 Japanese and 75 English)
with zero candidate-quality findings. Source alignment retained 321, Gemma
source review approved 252, source reverse evidence retained 88, semantic
preview accepted 82, and generation preflight retained 75. Qwen generated 74
valid non-publishable draft senses, rejected one row during structural
validation, and inserted 296 review localizations. All eight dynamically
discovered Qwen endpoints completed calls with zero network failures.

Release validation reused the frozen generation output. Deterministic reverse
evidence supported 20 rows, routed 53 to manual review, and final Gemma review
accepted 19 while rejecting one. The existing-draft promote scope accepted and
promoted 19/19. Fast audit, published-risk, native export and full in-memory
import passed with all blocking counters zero. Export counts are `48,365
entries / 57,259 senses / 229,036 sense localizations`, and
`flagged_senses=0`.

The staged database was atomically committed to the remote authoritative DB.
Its SHA-256 is
`0ABECE99992B04FD76CBE96BC55AA84C119F6FC31C46C2676A89E7B521AFFD24`.
The rollback backup is
`backups/v220-b7-draft74-promote19-main-before-commit-20260909-190904.db`.
The release cohort is now 139 publishable senses above online v218, leaving
4,861 senses before the configured release threshold. D1 and the Worker remain
unchanged.

The eighth simplified cohort, `v220-simplified-draft-b8-20260909-160315`,
selected 376 audited candidates: 375 new headwords and one additional sense,
balanced as 150 Chinese, 150 Japanese and 76 English rows. Candidate quality
reported zero findings. Source alignment retained 324, Gemma source review
approved 237, source reverse evidence retained 94, semantic preview accepted
89, and generation preflight retained 83. Qwen generated and inserted 83/83
valid non-publishable draft senses with 332 review localizations. Seven
dynamically discovered Qwen nodes completed the generation stage; a node with
an unrelated GPU workload was excluded, and no endpoint failed.

Release validation reused the frozen generation output. Deterministic reverse
evidence supported 24 rows and routed 57 to manual review. Final review accepted
all 24 supported rows without correction. Promote dry-run and isolated apply
accepted and promoted 24/24. Fast audit, published-risk, native export and full
in-memory import passed with all blocking counters zero. Export counts are
`48,389 entries / 57,283 senses / 229,132 sense localizations`, and
`flagged_senses=0`.

The staged database was atomically committed to the remote authoritative DB.
Its SHA-256 is
`01EFD01771D0DF0C0D341CA905059184997286121B5828762A8C4B6DA604EC8F`.
The rollback backup is
`backups/v220-b8-draft83-promote24-main-before-commit-20260910-012123.db`.
The release cohort is now 163 publishable senses above online v218, leaving
4,837 senses before the configured release threshold. D1 and the Worker remain
unchanged.

The ninth simplified cohort, `v220-simplified-draft-b9-20260909-164117`,
selected 376 audited candidates: 375 new headwords and one additional sense,
balanced as 150 Chinese, 150 Japanese and 76 English rows. Candidate quality
reported zero findings. Source alignment retained 332, Gemma source review
approved 243, source reverse evidence retained 114, semantic preview accepted
102, and generation preflight retained 91. Qwen returned 90 structurally valid
draft writes and inserted 90 non-publishable senses with 360 review
localizations. Dynamic endpoint discovery selected seven Qwen nodes and
excluded one node carrying an unrelated GPU process.

Release validation reused the frozen generation output and made no database
writes. Reverse evidence supported 90 rows; final Gemma review accepted 89 and
rejected one. The controlled replay selected 89 rows, and promote dry-run plus
isolated apply accepted and promoted all 89 with 356 localizations. Fast audit,
published-risk, native export and full in-memory import passed with all
blocking counters zero. Export counts are `48,477 entries / 57,372 senses /
229,488 sense localizations`, and `flagged_senses=0`.

The staged database was atomically committed to the remote authoritative DB.
Its SHA-256 is
`146505360FE27294F4460692C67CE9671583A19DC1FFA5F093BC7C5A70053738`.
The rollback backup is
`backups/v220-b9-draft90-promote89-main-before-commit-20260910-015917.db`.
The release cohort is now 252 publishable senses above online v218, leaving
4,748 senses before the configured release threshold. The entry delta is 251
because this cohort promoted one additional sense onto an existing entry. D1
and the Worker remain unchanged.

### b10 production and controlled commit, 2026-09-13

Run `v220-simplified-draft-b10` processed the frozen 300 candidates.
Source alignment retained 267; Gemma source review approved 201, rejected
61 and routed five to manual review. Source reverse evidence retained 26,
semantic preview accepted 25, and generation preflight retained 24. Qwen
wrote 24 draft senses with 96 review localizations. Six dynamically selected
endpoints completed source review without network failures or timeouts.
Fixed elastic model restoration was disabled to avoid loading models onto
an externally occupied node; per-stage dynamic discovery remained enabled.

Read-only release validation supported all 24 generated rows. Final Gemma
review accepted 22 and rejected two. Controlled promote dry-run and isolated
apply promoted all 22 approved senses. Fast audit, published-risk and full
native export/in-memory import passed; blocking counters remained zero.
Post-commit counts are `48,499 entries / 57,394 senses / 229,576 sense
localizations`, with `flagged_senses=0`.

The staged DB was atomically committed. Main DB SHA-256:
`42E72EF676901A1021CB61A3768DC074A43F6965158B0DEC8E97BECBD8877F35`.
Rollback backup:
`backups/v220-b10-draft24-promote22-main-before-commit-20260913-005114.db`.
The cumulative publishable increment is 274 senses and 273 entries over
online v218, leaving 4,726 senses before the +5,000 release threshold.
D1 and the Worker remain unchanged. The next cohort must use fresh audited
high-value candidates, not replay the rejected rows without evidence repair.

### b11 Mainland daily cohort, 2026-09-16

The first frozen b11 candidate report exposed a deterministic quality-gate
gap: its first 50 rows included `章子怡`, `西藏自治区`, and `鲜卑` even though
the old audit reported zero findings. Production was stopped before any model
call. The shared daily-candidate filter now defers biographical names,
autonomous-region/capital records, and historical people groups. Regression
tests cover all three examples, and the selector applies this filter before
freezing the cohort.

The corrected frozen batch is
`batches/v220-b11-candidate-20260915-163144.json`. It contains 375 Mainland
Simplified Chinese new-headword candidates. Full deterministic inspection
reported zero findings; the first 50 are headed by practical vocabulary such
as `山庄`, `筹委会`, `作秀`, `育儿`, `坐立不安`, `年糕`, and `小学生`.
Audit: `state/v220-b11-candidate-20260915-163144-audit.json`.

Run `v220-simplified-draft-b11` aligned 326 exact source senses. Gemma source
review approved 242, locked reverse evidence retained 38, semantic preview
accepted 36, and generation preflight retained 31. Qwen produced 31 valid
draft senses with 124 review localizations. Dynamic discovery used six
endpoints. Post-draft published-risk remained zero and publishable counts did
not change.

Read-only release validation supported all 31 generated rows. Final Gemma
review accepted 27 and rejected three; only the 27 explicit accepts entered
the controlled replay. Isolated promote dry-run/apply promoted all 27. Fast
audit, published-risk, native export, and full in-memory import passed before
the staged DB atomically replaced the main DB.

Post-commit counts are `48,526 entries / 57,421 senses / 229,684 sense
localizations`; `flagged_senses=0`. Main DB SHA-256 is
`81568B1BABA4BD48AD69E3CA700B4D771214F119F10A703EB5BD4420C8E8C8EF`.
Rollback backup:
`backups/v220-b11-draft31-promote27-main-before-commit-20260916-014226.db`.
The cumulative delta over online v218 is now 300 entries and 301 senses,
leaving 4,699 senses before the +5,000 publication threshold. D1 and the
Worker remain unchanged.

### b12 Mainland daily cohort, 2026-09-16

The frozen batch `batches/v220-b12-candidate-20260915-165406.json`
contains 375 Mainland Simplified Chinese new-headword candidates. The updated
daily-quality filter removed 52 biographical/organization records, 38 explicit
named entities, 30 Taiwan-usage rows, five geopolitical/historical groups,
and other low-value forms before selection. Full deterministic inspection of
the frozen batch reported zero findings.

Run `v220-simplified-draft-b12` aligned 315 source senses, Gemma source review
approved 234, locked reverse evidence retained 33, semantic preview accepted
31, and generation preflight retained 26. Qwen wrote 26 complete draft senses
and 104 review localizations. Post-draft publishable counts were unchanged and
`flagged_senses=0`.

Release validation found deterministic reverse support for all 26 generated
rows. Final Gemma review explicitly accepted 25 and rejected none; the one row
without an acceptance was excluded. Controlled replay, isolated promote
dry-run/apply, fast audit, published-risk, native export, and full in-memory
import all passed. The staged DB then atomically replaced the main DB.

Post-commit counts are `48,551 entries / 57,446 senses / 229,784 sense
localizations`; `flagged_senses=0`. Main DB SHA-256 is
`D3477E927FEF36CBDD585BF6758B427DEB7F14A6D8A24FBE1BA56BD382BB9B5A`.
Rollback backup:
`backups/v220-b12-draft26-promote25-main-before-commit-20260916-020334.db`.
The cumulative delta over online v218 is 325 entries and 326 senses, leaving
4,674 senses before the +5,000 release threshold. D1 and the Worker remain
unchanged.

### b13 Mainland daily cohort, 2026-09-16

The frozen batch `batches/v220-b13-candidate-20260915-170516.json` contains
375 Mainland Simplified Chinese new-headword candidates. Full deterministic
inspection reported zero findings. The remaining high-frequency native gap
classification decreased to 16,834 rows.

Run `v220-simplified-draft-b13` aligned 324 source senses. Gemma source review
approved 239, locked reverse evidence retained 37, semantic preview accepted
30, and generation preflight retained 24. Qwen wrote 24 complete draft senses
and 96 review localizations. Post-draft published-risk remained zero.

Release validation found reverse support for all 24 generated rows and final
Gemma review explicitly accepted 23. The remaining row was excluded because
it did not receive an explicit acceptance. Controlled replay, isolated
promote dry-run/apply, fast audit, published-risk, native export, and full
in-memory import passed before atomic replacement of the main DB.

Post-commit counts are `48,574 entries / 57,469 senses / 229,876 sense
localizations`; `flagged_senses=0`. Main DB SHA-256 is
`CAEED1F75FE743C4FB0E24FC1018A8BD1960618DC1A64BAEAF9F4956AA240E40`.
Rollback backup:
`backups/v220-b13-draft24-promote23-main-before-commit-20260916-021539.db`.
The cumulative delta over online v218 is 348 entries and 349 senses, leaving
4,651 senses before the +5,000 release threshold. D1 and the Worker remain
unchanged.

### b14 scaled Mainland daily cohort, 2026-09-16

The frozen batch `batches/v220-b14-candidate-20260915-171825.json` increased
the candidate window from 375 to 2,000 rows so the guarded pipeline could
produce a useful cohort without weakening any quality gate. It contains 1,276
Mainland Simplified Chinese and 724 Japanese new-headword candidates. Full
deterministic inspection checked all 2,000 rows and reported zero findings.

Run `v220-simplified-draft-b14` retained 1,999 rows after the production
prefilter and aligned 1,752 exact source senses. Gemma source review approved
1,320, locked reverse evidence retained 171, semantic preview accepted 151,
and generation preflight retained 137. Qwen wrote 137 complete draft senses
and 548 review localizations. Post-draft publishable counts were unchanged and
`flagged_senses=0`.

Read-only release validation found deterministic reverse support for 135
generated rows. Final Gemma review explicitly accepted 132 and rejected two;
all other rows stayed outside the controlled replay. Isolated promote
dry-run/apply promoted all 132 accepted rows. Fast audit, published-risk,
native export, and full in-memory import passed before atomic replacement of
the main DB.

Post-commit counts are `48,706 entries / 57,601 senses / 230,404 sense
localizations`; `flagged_senses=0`. Main DB SHA-256 is
`F8BB5622F3F4A1C3F5DEEC47D882032BB44DB573F68D93CBEC7F92E01C420CA9`.
Rollback backup:
`backups/v220-b14-draft137-promote132-main-before-commit-20260916-025205.db`.
The cumulative delta over online v218 is now 480 entries and 481 senses,
leaving 4,519 senses before the +5,000 publication threshold. D1 and the
Worker remain unchanged.

### b15 scaled Mainland daily cohort, 2026-09-17

The frozen batch `batches/v220-b15-candidate-20260916-155635.json` contains
1,984 new-headword candidates: 1,042 Mainland Simplified Chinese and 942
Japanese rows. The native source pool naturally produced 16 fewer rows than
the requested 2,000; no low-value candidates were used to pad the batch. Full
deterministic inspection checked all 1,984 rows and reported zero findings.

Run `v220-simplified-draft-b15` retained 1,981 rows after production
prefiltering and aligned 1,620 exact source senses. Gemma source review
approved 1,154, locked reverse evidence retained 193, semantic preview
accepted 178, and generation preflight retained 168. Qwen returned 168 valid
four-language entries with no JSON or infrastructure failures. Deterministic
reverse evidence supported 167; final Gemma review explicitly accepted 161
and rejected three. The controlled replay selected 84 Japanese and 77 Chinese
entries.

The scheduled runner was interrupted once during Qwen initialization. Its
launch configuration exposed a recovery bug: `ExecutionMode` was passed to
the initial process but omitted from `launch.json`, so a resumed draft run
fell back to `full`. The manager now persists `ExecutionMode`, and the
execution-mode regression test asserts that recovery contract. The resumed
full run made zero automatic database writes; its frozen generation and
review reports were instead replayed deterministically into an isolated DB.

Controlled replay inserted 161 draft senses, the idempotency replay inserted
zero, and isolated promote accepted all 161. Fast audit, published-risk,
native export, full in-memory import, cadence audit, and production gates all
passed before the authoritative DB was replaced atomically.

Post-commit counts are `48,867 entries / 57,762 senses / 231,048 sense
localizations`; `flagged_senses=0`. Main DB SHA-256 is
`ACF53073BC50BE282BED7D03DA4C1DC0679CCDE1C79E8E1AEB5C9AA03C0758FA`.
Rollback backup:
`backups/v220-simplified-draft-b15-main-before-commit-20260917-015103.db`.
The cumulative delta over online v218 is now 641 entries and 642 senses,
leaving 4,358 senses before the +5,000 publication threshold. D1 and the
Worker remain unchanged.

### b10 candidate preparation, 2026-09-13

Frozen batch: `batches/v220-b10-candidate-20260912-153218.json`.
Historical exclusion classification processed all 158,450 rows and identified
17,404 high-frequency gaps pending evidence. Native coverage produced 17,402
raw rows; primary-sense and trusted-source filters preceded final selection.
The requested quota was zh=150, ja=150, en=75, pt-BR=0. Actual selection was
300 new headwords (150 Chinese and 150 Japanese); no eligible English rows
were used to fill the shortfall. Full candidate audit inspected all 300 rows
and reported zero findings.

Audit: `state/v220-b10-candidate-20260912-153218-audit.json`.
No LLM was called, no GPU was loaded, and no product rows were written.
Main DB SHA-256 remained
`146505360FE27294F4460692C67CE9671583A19DC1FFA5F093BC7C5A70053738`.
The next step is draft production over this frozen batch, followed by release
validation and isolated promote. Publishable delta remains +252 senses; D1
and the Worker remain unchanged.

### b16 historical daily-gap recovery cohort, 2026-09-17

The remaining native new-headword and strict additional-sense builders yielded
only three and one candidates respectively, so b16 reclassified the historical
exclusion pool instead of padding the batch with low-value records. The raw
2,000-row recovery pool contained 192 deterministic findings. Applying the
shared Mainland-daily quality selector produced 1,422 clean candidates
(`zh=600`, `ja=567`, `en=255`) with zero candidate-audit findings.

Run `v220-additional-recovery-b16-20260917-021714` aligned 1,246 source senses.
Gemma source review approved 1,089, locked reverse evidence retained 401,
semantic preview accepted 380, and generation preflight retained 336. Qwen
produced 335 valid draft senses in the initial draft-production pass. Release
validation over the frozen generation report counted 336 valid rows,
deterministic reverse evidence supported 334, and final Gemma review explicitly
accepted 327 while rejecting seven. There were no infrastructure or JSON
failures.

This cohort exposed two recovery-contract bugs. First, controlled replay
treated draft-production rows already present in the authoritative DB as
ordinary existing rows and therefore replayed zero. The validator now scopes
and recovers those non-publishable drafts only when the frozen generation
report proves `apply=true`, `publishable=false`, and a positive insert count.
Second, release-validation summaries omitted `input` and
`jmdict_generation_ready`, causing an otherwise valid production gate to fail.
The pipeline now derives both values from the frozen batch and generation-ready
report, with execution-mode and manifest-updater regression coverage.

Controlled replay scoped 327 historical drafts. The final deterministic
promote gate recovered 326 and rejected one semantic drift case
(`semantic_drift_luck_fortune`). Isolated fast audit, published-risk, native
export, full in-memory import, cadence audit, and production gates all passed.
The staged DB then atomically replaced the authoritative DB.

Post-commit counts are `49,169 entries / 58,088 senses / 232,352 sense
localizations`; `flagged_senses=0`. Main DB SHA-256 is
`86D682BC0AA35585CA47641083759091BFCEF6E0C45DD5EA844FC38CDABD3C29`.
Rollback backup:
`backups/v220-additional-recovery-b16-20260917-021714-main-before-commit-20260917-122910.db`.
The cumulative delta over online v218 is now 943 entries and 968 senses,
leaving 4,032 senses before the +5,000 publication threshold. D1 and the Worker
remain unchanged.

### b17 historical daily-gap recovery cohort, 2026-09-18

The next historical recovery build selected 2,000 source senses after excluding
all previously accepted, linked, or retried senses. The Mainland-daily quality
selector removed 394 low-value records, including single characters, names,
non-modern senses, abbreviations, inflected forms, and 87 Portuguese rows that
needed stronger evidence. The frozen batch
`batches/v220-b17-recovery-filtered-20260917-033925.json` contains 1,382
candidates (`zh=600`, `ja=558`, `en=224`); full inspection reported zero
candidate findings. No low-quality Portuguese rows were used to pad the batch.

Run `v220-additional-recovery-b17-20260917-124107` retained all 1,382 rows in
the production prefilter and aligned 1,224 source senses. Gemma source review
approved 1,153, locked reverse evidence retained 311, semantic preview accepted
293, and generation preflight retained 254. Qwen generated and wrote 254
non-publishable draft senses plus 1,016 review localizations with zero
infrastructure or JSON failures. Dynamic source review used six idle endpoints;
`a6000-144` was excluded for a foreign GPU process and `a6000-048` for a missing
Gemma model. Qwen generation later used seven eligible endpoints.

The foreground SSH client disconnected after source review, but the remote
pipeline continued to completion and removed its lock normally. This confirms
that progress must be verified from the remote manifest and checkpoints rather
than inferred from the controlling SSH connection.

Read-only release validation supported all 254 generated rows. Final Gemma
review explicitly accepted 253 and rejected one. Controlled replay recovered
the 253 accepted existing drafts; idempotency replay wrote zero rows. Isolated
promote accepted all 253. Fast audit, published-risk, native export, full
in-memory import, cadence audit, and production gates passed before the staged
DB atomically replaced the authoritative DB.

Post-commit counts are `49,407 entries / 58,341 senses / 233,364 sense
localizations`; `flagged_senses=0`. Main DB SHA-256 is
`40327A04B0A4CC47D1D66A7CD92A1959E92EFA991927081558747FC5858661E4`.
Rollback backup:
`backups/v220-additional-recovery-b17-20260917-124107-main-before-commit-20260918-023337.db`.
The cumulative delta over online v218 is now 1,181 entries and 1,221 senses,
leaving 3,779 senses before the +5,000 publication threshold. D1 and the Worker
remain unchanged.

### b18 historical daily-gap recovery cohort, 2026-09-18

The third recovery build selected 1,356 clean candidates (`zh=600`, `ja=557`,
`en=199`) after the Mainland-daily selector rejected 452 low-value rows. Full
candidate inspection reported zero findings. The frozen production run is
`v220-additional-recovery-b18-20260918-024649`.

The run aligned 1,223 source senses. Gemma source review approved 1,159,
locked reverse evidence retained 259, semantic preview accepted 237, and
generation preflight retained 211. Qwen generated 211 valid non-publishable
draft senses plus 844 review localizations. Read-only release validation
supported 210 generated rows and final Gemma review explicitly accepted 208,
with two final-review rejections and no infrastructure or JSON failures.

Controlled replay recovered the 208 accepted existing drafts and made zero
new draft writes. Isolated promote accepted all 208. Fast audit,
published-risk, native export, full in-memory import, cadence audit, and
production gates passed before the staged DB atomically replaced the
authoritative DB.

Post-commit counts are `49,604 entries / 58,549 senses / 234,196 sense
localizations`; `flagged_senses=0`. Main DB SHA-256 is
`7A686FC1DC8B7F931AC15D8C98950C7574DE6F97662487C36074F323C980B83D`.
Rollback backup:
`backups/v220-additional-recovery-b18-20260918-024649-main-before-commit-20260918-032452.db`.
The cumulative delta over online v218 is now 1,378 entries and 1,429 senses,
leaving 3,571 senses before the +5,000 publication threshold. D1 and the
Worker remain unchanged.

### b19 recovery startup status, 2026-09-22

The next frozen recovery batch is
`batches/v220-b19-recovery-filtered-20260917-183119.json`: 1,330 candidates
(`zh=600`, `ja=551`, `en=179`) and zero full candidate-audit findings. Run
`v220-additional-recovery-b19-20260918-023154` completed production prefilter
and source-sense alignment (1,229 aligned), then stopped before Gemma source
review produced an output. Its manifest still says `running`, but the runner
status reports `Running=false`; no b19 release controller exists.

The original detached SSH launch did not survive the remote session. A
hash-guarded resume attempted the official scheduled-task launcher, which
timed out and removed its reservation lock. The jump host reported no logged-in
interactive user (`query user` returned no users); this launcher uses an
interactive Windows token. `startup.json` records `startup_timeout`, with no
scheduled-task error log or controller output. Do not treat the stale manifest
status as a live process or start another run on top of it. Restore an
interactive `James` session on the jump host, verify the b18 main DB hash
`7A686FC1DC8B7F931AC15D8C98950C7574DE6F97662487C36074F323C980B83D`,
then resume the same b19 run ID through the official `start` action. The
pipeline's completed-stage fingerprints provide the resume boundary.

No b19 draft, promote, D1 push, or Worker deployment has been confirmed.

### b19 password-task recovery, 2026-09-22

The jump-host `James` SSH session could not use CurrentUser DPAPI, but
LocalMachine DPAPI worked. The task credential is now stored only as encrypted
ciphertext under the restricted runner `state/secrets` directory; see
`docs/JUMP_HOST_TASK_CREDENTIAL.md`. An independent password-logon Scheduled
Task launched Node ESM without a desktop session. The revised runner and
manifest hashes matched on the jump host.

The same b19 run ID was resumed with the official `start` action, preserving
the frozen batch and completed-stage fingerprints. Its PowerShell parent,
pipeline Node process, and Gemma source-review child remained alive after SSH
disconnect. The first source-review checkpoint reported 20 reviewed, 20 valid,
17 approved, 3 rejected, zero network failures and zero timeouts. This
supersedes the earlier interactive-session requirement above. No b19 promote,
D1 push, or Worker deployment occurred during this recovery.

### b19 production and controlled commit, 2026-09-23

The resumed run aligned 1,229 of 1,330 frozen candidates. Gemma source review
approved 1,117; independent reverse evidence retained 370; semantic preview
accepted 333; JMdict preflight retained 288. Qwen generated 288 valid
non-publishable draft senses and 1,152 review localizations. Read-only release
validation supported all 288 generated rows; final Gemma review explicitly
accepted 280. No infrastructure or JSON failures were recorded.

Controlled replay scoped the 280 accepted existing drafts; idempotent replay
wrote zero rows. Isolated promote accepted all 280. Fast audit, published-risk,
native export, full in-memory import, cadence audit, and production gates
passed with blocking counts at zero. The first `Commit=true` attempt stopped
without changing the main DB because the earlier `Commit=false` validation
left an isolated DB in place. Re-running with `-ForceValidation` rebuilt only
that isolated copy, repeated all gates, then atomically replaced the main DB.

Post-commit counts are `49,870 entries / 58,829 publishable senses / 235,316
sense localizations`; `flagged_senses=0`. Main DB SHA-256 is
`5EB11A831A11FBB42DAB81F2F36D09582666786029732D9DCA001728D0A8E728`.
Rollback backup:
`backups/v220-additional-recovery-b19-20260918-023154-main-before-commit-20260923-012030.db`.
The cumulative delta over online v218 is 1,644 entries and 1,709 senses,
leaving 3,291 senses before the +5,000 publication threshold. D1 and the
Worker remain unchanged.

### b20 daily recovery candidate and evidence review, 2026-09-23

b19's main attrition was deterministic reverse evidence, not model uptime:
of 1,117 Gemma source approvals, 370 had four-language reverse support,
431 required manual review, and 316 were unsupported. The per-language
reason counts in `04b-source-consensus-reverse-evidence.json` show missing
reverse dictionary evidence especially for Portuguese (681) and Japanese
(240), plus strong-gloss conflicts for Portuguese (154) and Japanese (100).
These are language-level counts, not distinct candidate counts. Improve
source/target evidence acquisition and sense matching; do not treat Qwen and
Gemma agreement as independent dictionary evidence or loosen the gate.

The next frozen recovery pool selected 2,000 rows from the post-b19 main DB.
The Mainland-daily filter retained 1,310 (`zh=600`, `ja=540`, `en=170`) and
rejected 545 low-value or unsuitable rows; full candidate audit found zero
findings. It did not pad the batch with the 87 weak-evidence Portuguese rows.
Of the selected rows, 1,140 are previous source-approved/reverse-evidence
retries and 170 are source-sense-binding retries. The JSON is valid UTF-8;
terminal mojibake during PowerShell inspection was display encoding only.
The batch is `batches/v220-b20-recovery-filtered-20260922-162801.json`.

Run `v220-additional-recovery-b20-20260923-003000` was started via the
password-logon Scheduled Task in `draft-production` mode. Its live process
and manifest were confirmed; production prefilter and source-sense alignment
completed, with Gemma source review running. Do not start another runner on
top of it. Before controlled commit, inspect accepted rows for ordinary
Mainland-daily value in addition to the existing structural audit. No b20
promotion or online publication is confirmed.

### Post-b20 pipeline hardening, 2026-09-23

The simplified pipeline's Gemma source-review invocation now passes
`--require-hint-semantic-alignment true`. When enabled, the reviewer must
select exact first-choice target terms from verified hints, and the validator
requires those terms to be evidence-bound (normally at least two independent
source families; existing narrowly defined OMW/English-anchor exceptions
remain). This targets the b19 pattern where a fluent model-invented form such
as Japanese `ふわふわした` had no reverse dictionary support. It does not
weaken reverse-evidence or release gates.

The reverse-evidence lookup now retains Japanese surface forms while also
querying likely dictionary lemmas for common `-した` and `-して` suru-verb
forms (for example, `ふわふわした` also checks `ふわふわ` and
`ふわふわする`). This only expands lexical lookup recall: anchor matching,
source-family independence, and support thresholds are unchanged. Unit
regressions cover both forms.

The change is local only and applies to the next run after runner sync (b21 or
later). It does not change the already-started b20 process. Syntax checks for
the pipeline and its test passed, and
`node scripts/test-dictionary-v2-pipeline-execution-modes.mjs` passed. Remote
status could not be refreshed in this turn because remote execution was
blocked by the environment approval limit; the last confirmed b20 checkpoint
remains 323 reviewed / 1,218 aligned, 298 approved, 16 rejected, 9 manual,
zero failures. Do not interpret that checkpoint as current completion state.

### b20 completed controlled recovery commit, 2026-09-23

The restricted SSH read problem was the local execution sandbox preventing
access to the Windows Tailscale/SSH resources. Once full local access was
enabled, `ts-win-jump` connected successfully to `James@100.99.99.99`
(`DESKTOP-B2NRVIK`).

Draft production completed for the frozen 1,310-row batch. Qwen generated 305
rows: 304 structurally valid, 1 validation-rejected, with zero infrastructure
or JSON failures. The first final-validation invocation mistakenly required
four-language reverse support and retained only 11. Re-running under the b19
policy (`max_manual_target_langs=1`, `min_supported_target_langs=3`) retained
all 304; this restores the established threshold rather than loosening it.
Final Gemma review accepted 297, rejected 5, and routed 2 to manual review.
Among 304 generated-valid rows, generation-valid was 304/305 (99.67%),
reverse-supported was 304/304, final no-correction acceptance was 297/302
(98.34%), infrastructure failure 0%, JSON failure 0%. All 297 accepted rows
passed isolated promote; deterministic published-risk and full export/import
blocking counters were zero. OpenCC Traditional-to-Simplified comparison found
no differences in the accepted batch's Chinese terms, definitions, or
available examples.

Two official commit attempts initially stopped without replacing the main DB:
the first controlled-replay folder lacked its generation checkpoint, and the
second lacked a combined release summary. The exact checkpoint was copied from
the source b20 run; a provenance-bearing summary was built from the release
summary with `generated_valid` corrected to the generator's source-of-truth
304/305 count. Production gate then passed and the runner's official
`publish-remote-dictionary-controlled-run.ps1 -Commit true -ForceValidation`
revalidated and atomically replaced main. Current main SHA-256 is
`38AC193AD39BCD9AC1C73428A9A2E12EE05DFC5A5D71BDBF574F5AF1D0C91AD0`; isolated
DB SHA matches. Backup
`backups/v220-b20-controlled-replay-manual1-20260923-1040-main-before-commit-20260923-112307.db`
has the exact pre-commit SHA-256
`572ABC4EADDC18D5818EEB94FC14F6EE29DAE8D0D19E608DD87F889A06ED5466`.

Post-commit native export/in-memory import counts are `50,162 entries`,
`336,873 entry forms`, `52,711 pronunciation groups`, `59,126 senses`,
`236,504 sense localizations`, `3,030 examples`, and `11,898 example
localizations`. Blocking counters are zero: count mismatches, bad localization
counts, duplicate sense orders, empty required fields, orphans, source-script
mismatches, mojibake, and HTML artifacts. Non-blocking warnings remain:
1,001 duplicate sense localizations, zero zh terms with kana, and zero Japanese
terms with Latin-only readings. Published-risk reports zero flagged senses.
Post-v218 cumulative progress is +2,006 publishable senses; 2,994 remain before
the +5,000 release threshold. No D1 export/push, Worker cache bump, or deploy
occurred. The separate daily-primary quality hold remains in place.

Post-commit runner manifest handling: the product-DB manifest entry was
updated to match the new main hash. The default full manifest generator could
not run because the runner is missing
`scripts/evaluate-dictionary-v2-simplified-draft-flow.mjs`. Manual verification
found 16 manifest files missing or hash-mismatched; Node syntax, SQLite module,
and user-scope Unsloth key checks passed. Do not regenerate the full manifest or
sync a broad local file set until an exact deployment cohort is reviewed.

### b21 daily-primary candidate diagnostic, 2026-09-23

After full local access was enabled, the jump host was reachable by SSH. A
previously stuck read was not an SSH failure: a read-only PowerShell diagnostic
was loading and serializing the deeply nested b19 reports, growing to about
57 GB resident memory. The exact command was verified before stopping it. Use
Node for large runner JSON and return compact summaries; PowerShell 5 JSON
inspection may fail on duplicate object properties and emit the full report.

The b21 native-daily scan completed with no model request and no product DB
write. It classified 158,450 excluded source entries; 13,781 were retryable or
high-frequency gaps. A rank-50,000 scan returned 2,500 entries; exact source
sense binding retained 2,433, authoritative-source filtering retained 1,489,
and the daily quality filter retained 1,333. The initial daily selector emitted
zero because the quality check compared against already-attempted higher-scoring
senses. The selector now exports `attempted_source_sense`; comparison ignores
attempted, linked, and blocked alternatives. Unit tests still reject a truly
skipped higher-priority unattempted sense.

The corrected cohort contains 90 candidates: 50 Chinese, 25 Japanese, 15
English, and zero Portuguese (no Portuguese rows passed the authoritative
source prefilter; do not pad the quota with rejected FreeDict primary rows).
Manual review of the first 50 fails the daily-value gate: Japanese grammar
fragments/auxiliary forms and Chinese proper/historical/administrative or
specialized entries remain, including `れる`, `せる`, `孙中山`, `军区`, and
`尚书`. Stop before source-review or generation models. Revise headword/sense
quality filters and Portuguese evidence sourcing, build a fresh cohort, then
repeat the top-50 review.

The quality helper and daily sense selector were synced as an exact two-file
cohort with corresponding runner-manifest hashes. The production batch builder
also exposes a shell issue: Node progress on stderr becomes terminating under
`$ErrorActionPreference='Stop'`. A local narrow fix is present, but the runner's
builder differs from the local version; do not replace it or regenerate the
full manifest without reconciling the exact remote file first. The corrected
quality/sense stages were run directly on the existing frozen intermediate
reports. Main DB remains unchanged at SHA-256
`38AC193AD39BCD9AC1C73428A9A2E12EE05DFC5A5D71BDBF574F5AF1D0C91AD0`.

### b21 Qwen source-review and reverse-evidence pilot, 2026-09-23

A 20-row Qwen source-review pilot on six responsive endpoints returned 10
accepted and 10 rejected, with no transport or JSON failures. This is only a
semantic pre-screen, not evidence approval. The accepted 10 were evaluated
read-only against the runner's authoritative 9.3 GB source DB, current product
DB, and supplemental evidence DB. Reverse evidence selected zero: 9 were
unsupported and 1 required manual review. Reasons were eight
`english_anchor_does_not_translate_back_to_source_term`, one
`strong_dictionary_gloss_conflict`, and one
`polysemous_source_term_low_match_ratio`.

A controlled comparison substituted Qwen's reviewed English anchor for the
native gloss as the reverse-lookup query while retaining all reverse-evidence
requirements. It changed the result only to 0 supported, 8 unsupported, and 2
manual-review rows. Do not implement this substitution as a gate relaxation;
the evidence says these candidates still lack exact independent round-trip
support. The daily-native cohort remains blocked from draft generation.

The b19 1,117-to-370 funnel is now confirmed from the original 6.16 MB
`04b-source-consensus-reverse-evidence.json`: 431 manual, 316 unsupported, 370
supported. Portuguese had 681 `no_reverse_dictionary_evidence` and 154 strong
gloss conflicts; Japanese had 240 no-reverse-evidence and 100 conflicts.
Chinese had 179 no-reverse-evidence, 81 conflicts, and 52 polysemous low-match
cases; Japanese had another 103 polysemous low-match cases. These are
language-level checks, not distinct candidate counts. The immediate throughput
constraint is exact target-language dictionary coverage and sense matching,
not available model capacity. Keep the b20 proven draft/review/release path;
improve or select candidates with existing independent round-trip evidence
before scaling another cohort. No DB mutation or D1 operation occurred in this
pilot.

### b21 dual-frequency source-gap qualification (2026-09-23)

The 500-row trusted pool was language-skewed (`zh=279`, `ja=171`, `pt-BR=34`,
`en=16`); 212 rows were tagged common/core and 287 extended. Strict reverse
evidence retained 16 (`pt-BR=13`, `ja=2`, `zh=1`), routed 263 to manual review
for polysemous low match ratio, and rejected 221 as unsupported. This confirms
that frequency-ranked native candidates are not automatically four-language
translation candidates.

Qwen source review approved 8/16. Independent Gemma source review of those
eight, with daily-primary, term-hint alignment, and four-language definition
gates, approved two (`expert`, `nono`) and returned six reject/manual decisions.
The preferred terms agreed on both approved rows. A separate Qwen generation
dry-run on the original eight generated seven valid rows and one invalid row;
strict source-reverse evidence supported all seven valid rows. Gemma final
review accepted three of those seven and rejected four, but none of the
source-consensus rows passed the combined final gate: `expert` was rejected as
unnatural Portuguese usage, while `nono` failed Japanese reading validation.
The controlled consensus builder selected zero rows. No draft, product DB,
promotion, or D1 writes occurred.

The `nono` failure exposed a deterministic reading-index defect: the JMdict
entry for `第九` supplies a replacement-character reading. The generator chose
that invalid direct reading before trying the valid compositional ordinal
reading. Local code now filters malformed/non-kana JMdict readings and supports
compositional `第N` readings; the regression test covers `第九 -> だいきゅう`.
`node --check` for both edited modules, `node scripts/test-japanese-reading-contract.mjs`
(11 assertions), and `npm.cmd run check` pass.

Remote retry is pending the runner integrity gate. The runner manifest currently
pins the old generator SHA `9DD5065C84FA11037C70478DBF1C54DAC500ECA7457C3BDC1100D43AC1C24C6D`.
The helper file exists remotely but is unregistered (remote SHA
`7D5FA454107ADCBF7C038D2A42474B28CE776468F24005A81424566D3749EBA2`). No
dictionary generation/review Node process was running at preflight. Proposed
local hashes are:

- `scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs`:
  `BECBB0E134A44A70B340585A5ECEDDD410C239CDB16A3FCC9C7DE671A1C21E4B`
- `scripts/lib/japanese-reading-contract.mjs`:
  `A6BC2F15577EA93C5F68B565A72073371360DF2D9321CA924751B4DD89661C02`

Both files must be backed up, synchronized, and hash-registered before using
the fixed generator on the runner. After that, regenerate only the locked source-consensus
rows, rerun strict reverse evidence and Gemma final review, then build a fresh
controlled-consensus input. Do not reuse the pre-consensus generation report
for draft replay.

### b21 Qwen context recovery and corrected ordinal dry-run, 2026-09-23

The 20-row extension was first sent to RTX endpoints 11447/11448. Both health
checks succeeded, but their auto-loaded Qwen model had `context_length=1024`;
inputs of 1,033-1,212 tokens were rejected, and other responses were truncated
before complete JSON. This was a context/output-budget issue, not a network
failure. Re-running the same 20 with the unchanged compact review contract on
A6000 endpoints 11442/11444 at 2,048 context and 700 output tokens produced
20 valid decisions: Qwen accepted 13 and rejected 7, with no request/parse
failures. Gemma independently reviewed the 13 accepted rows: zero accepted,
six rejected for semantic/POS or missing-hint issues, and seven manual because
EN/PT-BR/JA or EN/PT-BR/ZH preferred terms lacked locked independent evidence.
Do not use this broad daily-quality subset for generation; all 500 input rows
had `reverse_evidence_prefilter.target_coverage_count=0`.

The valid production path remained the separate reverse-supported source
consensus. Its dual Qwen/Gemma source-review intersection contains `expert`
and `nono`; `expert` remains rejected at final review for unnatural PT-BR.
Using the local deterministic Japanese-reading fix, Qwen generated `nono` in a
no-write dry-run. The output keeps the source lemma `nono`, has four-language
terms/definitions, and resolves Japanese `第九` as `だいきゅう`. Strict reverse
evidence supported all four languages; Gemma final review accepted 1/1 with
confidence 1.0 and no corrections. Controlled-consensus input selected exactly
`nono` and rejected `expert`; all DB write counters remained zero. This is a
single-candidate validation, not yet a draft or product-DB promotion.

The segmented source-review CLI writes each invocation's selected range as its
own report rather than merging previously completed offsets. Keep distinct
output paths per range, or run the whole range in one invocation; do not treat
the last offset's summary as the whole cohort. For a 20-row run on one A6000
the observed throughput was about 20 decisions in under a minute; two idle
A6000s were balanced 9/11. The earlier RTX attempt also proves that `/api/health`
being healthy does not establish sufficient context length for a specific
review payload.

The successful local dry-run does not authorize remote runner mutation. Before
draft-writing to the authoritative runner main DB, back up and synchronize the
exact Japanese-reading helper and generator hashes listed above, register both
in the runner manifest, verify their remote hashes, and replay only the fresh
final-gate `nono` row. Keep it draft-only (`needs_review=1`), then run isolated
fast/published-risk/export audits before any main-DB commit.

### b20 commit and b21 handoff checkpoint (2026-09-23)

The remote b20 controlled replay completed its isolated validation and atomically
committed 297 recovered/publishable senses to the authoritative runner main DB.
The committed run is
`v220-b20-controlled-replay-manual1-20260923-1040`; its rollback copy is
`D:\linguago-runner\backups\v220-b20-controlled-replay-manual1-20260923-1040-main-before-commit-20260923-112307.db`.
The controller reports `main_replaced=true`, `flagged_senses=0`, and post-commit
counts of 50,162 entries, 59,126 senses, and 236,504 sense localizations. The
main DB SHA-256 is
`38AC193AD39BCD9AC1C73428A9A2E12EE05DFC5A5D71BDBF574F5AF1D0C91AD0`.
Against v218's 57,120-sense baseline, cumulative growth is 2,006 senses;
2,994 remain to the +5,000 D1 release threshold. D1 and the Worker were not
changed.

The controlled production gate reported 305 generation-ready rows, 304 valid
generations, 304 strict reverse-supported rows, 297 final no-correction Gemma
acceptances, zero infrastructure/JSON failures, and zero blocking audit findings.
The resulting raw-to-final rate was 22.7%; do not infer that all 1,310 candidates
were model-translated. The manual1 release-validation and controlled-replay
reports carry the same input fingerprint
`8e6dabc33efc185975fae6c1936d90a75664070637f44c6056be61e4e27264ae`.

The b21 experiment did not yield a remotely releasable consensus row. The
reverse-supported eight-row sample generated seven rows; strict final Gemma
accepted `muscular`, `oitavo`, and `pio`, while rejecting `freezer`, `décimo`,
`expert`, and `mode`. However, the independently agreed source-review rows were
`expert` and `nono`; neither was in the final accepted report, so the controlled
consensus builder correctly selected zero. The remote `nono` generation is not
strict-reverse-supported in the old report. A separate local dry-run with the
fixed Japanese ordinal-reading helper passed reverse evidence and Gemma final
review, but it is not a remote draft and has not changed the runner manifest.

No b21 draft, promote, or main-DB write has been made. The next remote action is
to back up, sync, register, and verify only the two previously identified exact
script hashes (generator `BECBB0E1...A1C21E4B`, helper
`A6BC2F15...89661C02`) before replaying `nono` as a draft. Do not interpret
general filesystem access permission as authorization to change the runner
manifest. After the user explicitly authorizes that exact sync, rerun generation,
reverse evidence, and Gemma final review for `nono`, then perform draft-only
replay and isolated audits. Continue using the b20 committed DB as the baseline;
do not publish D1 before the cumulative +5,000 threshold and full release gates.
