# Codex Handoff

## 2026-08-23 v140 native production release

- The v140 controlled production run promoted 286 of 287 final records. The
  single deterministic rejection was `晦气` (`semantic_drift_luck_fortune`),
  so no rejected record entered the product database.
- The authoritative jump-host product DB SHA-256 is
  `BD1C498E3CBD75C8FBB9A3B04DB83F10DD71D5CE0EE472E886E2C18BFC048BD0`.
  Its pre-commit rollback copy is
  `D:\linguago-runner\backups\v140-native-daily-production5000-main-before-commit-20260823-010643.db`.
- The audited D1 export contains `entries=41551`, `senses=47863`,
  `sense_localizations=191452`, `examples=3030`, and
  `example_localizations=11898`. All blocking full-import audit counters are
  zero; `duplicate_sense_localizations=481` remains a non-blocking observation.
- Cloudflare D1 accepted all 25 native SQL chunks and remote counts match the
  manifest. The pre-release Time Travel bookmark is
  `D:\linguago-runner\runs\v140-native-daily-production5000\cloudflare-d1-before-release-bookmark.json`.
- A stratified 24-record Chinese/Japanese sample had complete four-language
  terms and definitions, Chinese/Japanese readings, and English/Portuguese IPA.
  A non-blocking pronunciation-quality follow-up remains for `沸点`: the
  English term `boiling point` currently has IPA only for `boiling`.
- Worker cache `v141-native286-41551` is the cache paired with this D1 release.
  Confirm the deployed Worker version and online regression result in the
  release record before treating v141 as live.

## 2026-08-22 v139 evidence-yield qualification

- The jump-host main DB remains the v138 baseline with SHA-256
  `ACA285F7F27071A2A5C46EB4EC3140AFA9486151CBEBB174B7BD121F7443DACE`,
  `entries=41023`, `senses=47335`, and `sense_localizations=189340`. D1 was not
  changed by v139 qualification.
- Funnel analysis of v137/v138 found 5,248 historical
  `source_sense_alignment:no_eligible_sense` rows. The new default-off native
  fallback only admits the locked current CC-CEDICT/JMdict sense with confidence
  at least 0.9 and no product link; all strict downstream gates remain intact.
- Pre-generation reverse evidence is invalid for this zero-localization lane:
  the first 200-row run aligned 200/200 but selected 0/200. The corrected order
  is Gemma source proposal -> deterministic source reverse evidence -> semantic
  review -> Qwen complete record -> deterministic generated-record reverse
  evidence -> final Gemma no-correction review.
- `v139b-native-fallback-model-first-dry200` ended with 14 final accepts from
  200 raw rows (7%). Qwen generation was 15/15 valid, reverse evidence was
  15/15, final Gemma was 14/15, and database writes were zero. This passes the
  v139 dry-run thresholds and authorizes the 500-row isolated write validation,
  not a main-DB commit or D1 release.
- Use `build-dictionary-v2-native-alignment-retry-cohort.mjs` with prior v139
  cohorts in `--exclude-reports`. Do not restart a deep native scanner merely
  to qualify this repaired historical lane.
- `v139d-native-fallback-write500-prefiltered` completed the independent
  500-row gate. It accepted 42/500 final records (8.4%), with Qwen 42/42 valid,
  generated-record reverse evidence 42/42, final Gemma 42/42, zero network
  failures, and zero automatic main-DB writes. Four Japanese single-character
  source gaps that would always fail the existing semantic validator are now
  rejected by the JMdict generation preflight instead of consuming Qwen calls.
- Isolated controlled replay inserted 42 draft senses and 168 localizations;
  the identical second replay wrote zero rows, and deterministic promotion
  accepted 42/42. Fast audit, published-risk (`flagged_senses=0`), native export,
  and full in-memory import audit all passed. The audited isolated export had
  `entries=41065`, `senses=47377`, and `sense_localizations=189508`.
- The 500-row gate is complete. The remaining historical retry pool contains at
  most 4,548 non-overlapping rows after excluding the 200- and 500-row
  qualification cohorts; use all remaining rows as the first large production
  run rather than padding the batch with a weaker evidence lane.
- The first large run is active on the jump host as
  `v139e-native-fallback-production-remaining4548`, using batch
  `batches\v139-native-fallback-production-remaining.json` (`zh=2697`,
  `ja=1851`). Do not launch a duplicate run. It remains no-main-DB-write until
  final reports pass controlled replay and release audits.
- A detached completion supervisor is active for this run. Its status is
  `runs\v139e-native-fallback-production-remaining4548\production-supervisor.json`;
  it is hosted by Windows scheduled task
  `LinguaGo-v139e-production-supervisor` so it survives SSH disconnects. The
  supervisor waits for a
  successful pipeline manifest and lock release, runs
  `check-dictionary-v2-production-run-gates.mjs`, and only then invokes the
  existing controlled replay/promotion/audit controller against the hash-locked
  v138 main DB. It requires raw-to-final >= 5%, Qwen validity >= 95%, final
  Gemma no-correction acceptance >= 90%, infrastructure/JSON failure <= 2%,
  zero automatic DB writes, and no final accepts without reverse evidence.
- A passing supervisor may atomically update the jump-host main DB and its
  remote runner manifest after isolated replay, idempotence, fast audit,
  published-risk, native export, and full in-memory import all pass. It does
  **not** upload Cloudflare D1 or deploy the Worker. D1 remains a separate,
  explicitly reviewed release decision at the normal accumulated-sense
  threshold. A failed gate or audit leaves the existing main DB unchanged and
  records `status=failed` in the supervisor file.

## 2026-08-20 v124 production release

- v124 is live. Production contains `entries=40793`, `senses=47105`,
  `sense_localizations=188420`, `examples=3030`, and
  `example_localizations=11898`; all blocking audits and published-risk are
  zero.
- Live cache: `v124-remote11-40793`. Worker Version ID:
  `d2ad5c08-4ca8-4c85-8462-ce76d1faeea2`. D1 `published_at`:
  `2026-08-20T08:04:07.407Z`.
- The main product DB SHA-256 is
  `D97F300A4E17E70D0ED06916B15807CC472EE3B5D6C70BD4DD1D9886526D954C`.
  Its rollback copy is
  `D:\linguago-runner\backups\v124-remote-generated-candidate100-main-before-commit-20260820-154026.db`.
- Before D1 import, the release gate captured a Time Travel bookmark in
  `D:\linguago-runner\runs\v124-remote-generated-candidate100\cloudflare-d1-before-release-bookmark.json`.
  The D1 release report in the same run records `ok=true`, `execute=true`, and
  `d1_pushed=true`; all 24 SQL chunks and remote counts matched the manifest.
- Worker source commit `fcd314af03d950bf6555c067ac234b8dbcfb5e5e`
  was staged as an immutable archive with SHA-256
  `FC1EDB31991B567F7511AF27DFB47BDFC3723E3C3E67DDF0CD729243ED79D6B3`.
  `D:\linguago-deploy\last-worker-release.json` records `deployed=true`,
  `online_checks_passed=true`, no rollback attempt, and previous Worker Version
  ID `999818a7-cd16-464c-8b7a-e8048f439b28`.
- General online dictionary regression, focused API regression, and focused
  mobile/desktop render regression all pass. Rendered entries resolve through
  D1 with four language tabs and no horizontal overflow.
- Cloudflare production account is `3ebbb03df81b809142eec47c07ef6801a`;
  production D1 UUID is `ee613260-5c1f-4bb5-8959-c54118174e0e`. The jump host
  requires `NODE_OPTIONS=--dns-result-order=ipv4first`. A prior token for account
  `1fe446be160662c15527a4f536e5901a` made `whoami` pass but returned an empty D1
  list. Always verify expected account and visible D1 before a write.

## 2026-08-20 v124 jump-host migration qualification

- Candidate selection is now reproducible on `ts-win-jump`, not merely model
  execution. The frozen v123 pool and compact attempted-history are installed
  under `D:\linguago-runner\data\candidates` and pinned by size and SHA-256 in
  `config/remote-candidate-sources.json`.
- Local and remote 100-row selectors produced identical selected-content SHA
  `1d58f18c856b1c26d81dc20283e3e9041a85a513495f589c68ad6b66c75e4daf`
  with `zh=57`, `ja=42`, `pt-BR=1`.
- `v124-remote-generated-candidate100` exercised remote candidate creation,
  Scheduled Task orchestration, Gemma review, Qwen generation, reverse evidence,
  and final consensus. The funnel was
  `100 -> 84 -> 16 -> 14 -> 13 -> 12 -> 12 -> 11`; automatic writes were zero.
- Its 11 final accepts passed isolated controlled replay, idempotent replay,
  11/11 deterministic promotion, published-risk (`flagged_senses=0`), native
  export, and full in-memory import audit. Blocking audit counts were all zero.
- The guarded controller committed the 11 accepted senses to the jump-host main
  DB. It now hashes to
  `D97F300A4E17E70D0ED06916B15807CC472EE3B5D6C70BD4DD1D9886526D954C`
  and contains 40,793 entries, 47,105 senses, and 188,420 localizations. The
  rollback DB is
  `D:\linguago-runner\backups\v124-remote-generated-candidate100-main-before-commit-20260820-154026.db`.
  These committed counts were subsequently released to D1 and the Worker as
  described above.
- Important Windows lesson: PowerShell 5.1 JSON readers must use explicit
  UTF-8. `Get-Content` can decode Node-generated Chinese/Japanese JSON through
  the legacy code page and cause false mojibake/parse failures.
- The guarded main-database and release controllers are now operational. Keep
  requiring expected hashes, pre-write backups, isolated validation artifacts,
  post-write audits, Cloudflare account/D1 preflight, and rollback targets.
- `publish-remote-dictionary-controlled-run.ps1` now implements that guarded
  database controller. Its first v124 rehearsal passed with `commit=false`, 11
  inserted/promoted senses, zero risk flags, and `main_replaced=false`. It does
  not yet upload D1 or deploy the Worker.
- `agy` remains optional and read-only. Desktop OAuth was not visible in the
  SSH/Scheduled Task context, so deterministic manifests, checkpoints, and
  audits remain authoritative.
- The initial Cloudflare remote release was blocked by account selection, not
  token parsing or runner code. The installed API token authenticates account
  `1fe446be160662c15527a4f536e5901a`, while production D1 belongs to
  `3ebbb03df81b809142eec47c07ef6801`. `whoami` succeeds but `d1 list` is empty;
  that attempt stopped before bookmark capture or D1 writes. A scoped token for
  the production account fixed the issue; keep
  `NODE_OPTIONS=--dns-result-order=ipv4first` on the jump host.
- `release-remote-dictionary-d1.ps1` now implements the hash-locked D1 gate.
  Its v124 `Execute=false` rehearsal generated 24 native SQL chunks and passed
  full memory-import audit for 40,793 entries/47,105 senses; it reported
  `d1_pushed=false`. Execute mode also requires a committed DB release report,
  valid Cloudflare identity, and a D1 Time Travel bookmark.

## 2026-08-20 v123 production-5000 release

- Input fingerprint:
  `f7171465ec91cc55647ca56c8e82e9511be93c0b78be61789250380274ac4660`.
  The candidate pool contained 5,000 fresh source entries after excluding 5,670
  prior validation entries.
- Frozen funnel: `5000 -> 4388 source-approved -> 832 reverse-supported -> 749
  semantic-approved -> 632 JMdict-ready -> 603 valid generations -> 598
  reverse-supported -> 584 final accepts`. Qwen generation validity was 95.4%,
  reverse support was 99.2%, and final Gemma acceptance was 97.7%. No remote
  stage failed.
- Controlled replay wrote 584 senses and 2,336 localizations; immediate replay
  wrote zero. Isolated and main deterministic promotion accepted 584/584. New
  rows have no examples because this lane currently uses `require_examples=false`.
- Main full audit reports 40,782 entries, 47,094 senses, 188,376 sense
  localizations, 3,030 examples, and 11,898 example localizations. All blocking
  counters and published-risk are zero; 584 senses are `ai_reviewed`.
- Live cache: `v123-production584-40782`. Worker Version ID:
  `76658a80-b529-4dd7-9c02-47b7841fb6ce`. D1 published at
  `2026-08-19T20:59:32.699Z`; remote counts, full online regression, focused API,
  and mobile/desktop render checks pass.
- Recovery artifacts are local-only: the existing v114 remote SQL backup is
  `%TEMP%\linguago-dictionary-before-v114-20260819-122754.sql` (SHA-256
  `591AC0E1CB372924E9D4D81F522FBE1BDFA1AD93672F880496DBBDD7040DC2FC`),
  and the pre-v123 product DB backup is under
  `%TEMP%\linguago-v123-scale500\linguago-v123-before-production5000-20260820-055903.db`
  (SHA-256 `ACFC27CE013A62EDDD383CBF809BDC9832A8C5329C2AC82D11867053FB334F0B`).
- Operational lessons: local sandbox networking can make every endpoint report
  `fetch failed`; rerun with approved network access and the same checkpoint.
  D1 chunk 24 recovered from one 502 through retry. Wrangler 4.107.0 remote
  export still returns OAuth 10000 even though D1 imports and queries work.

## 2026-08-19 v121 Portuguese acquisition and residual hygiene

- The 42 source-supported residuals all lacked a pt-BR target family. Qwen term
  suggestions were used only to discover Dicionario Aberto definitions; they
  were never counted as lexical evidence. Independent Qwen and Gemma review of
  46 definitions initially exported six rows.
- The exporter had a safety defect: it accepted `approved=true` even when a
  reviewer returned nonempty `risk_flags`. This admitted the conceptual
  `心身 -> psicofisico` match. `export-dicionario-aberto-reviewed-evidence.mjs`
  now requires both reviewers to have empty risk flags. The clean export has
  three candidate-bound rows, and a fresh strict prefilter unlocks only
  `claro`; Gemma source review already rejected that sense. The v121 no-write
  run therefore produced zero final accepts and zero database writes.
- FreeDict `eng-por` and `por-eng` both identify Ergane/TravLang upstream and
  count as one independent family. Exact anchor probing matched 0/42 rows.
  Conservative inflection probing found forward entries for 11/42, but several
  are unsafe sense drifts (`glued -> past -> passado`, `cased -> case -> caso`).
  The probe output is diagnostic only and must not be promoted as candidate-
  bound evidence.
- The general production prefilter now sends ordinary English `-ed` and `-ing`
  forms to a dedicated morphology lane even when the source-gap gloss does not
  explicitly say "participle". This removes 21 inflected rows and two
  compositional numbers from the 1,834-row residual. Strict source-supported
  capacity falls from 42 to 27, with zero target-qualified candidates.
- Of those 27 residuals, only `ファミレス` is in the `common` tier; the other
  26 are `extended`. Current capacity is therefore exhausted for the general
  daily-vocabulary lane. Do not spend GPU capacity on these rows or weaken the
  two-family target gate. Rebuild a new high-value pool or acquire a modern,
  independently proven pt-BR lexical source first.

## 2026-08-19 v120 candidate-bound ECDICT production gate

- Node 143 is reserved by another user and must not be scheduled. The v120
  profile uses Gemma reviewers on `11444` (147), `11445` (155), and `11446`
  (224), plus Qwen generators on `11447` (56) and `11448` (47). A status check
  found no active model on 143, so no remote process had to be stopped.
- `export-ecdict-chinese-evidence.mjs` previously marked rows candidate-bound
  while assigning a reusable `ecdict:<word>:<hash>` concept ID. It now binds
  validation-report exports to the exact `candidate:<entry>:<sense>` key,
  records `exact_reciprocal_candidate_bound`, and supports conservative
  semicolon/pipe English anchors. The new regression test is
  `test-ecdict-candidate-bound-evidence.mjs`.
- Candidate-bound rows are strong evidence only when the evidence DB metadata
  is production-publishable, candidate-bound, exact, and the exact source key
  is explicitly listed in `candidate-bound-source-roundtrip-keys`. Generic
  supplemental evidence remains weak. The v120 profile records and forwards
  this allowlist to both prefilter and post-generation reverse validation.
- The corrected residual export matched 1,161/1,287 candidates and expanded the
  strict reverse-prefilter cohort from 12 to 98. The five-node no-write funnel
  was `98 source reviewed -> 66 Gemma approved -> 43 valid Qwen generations ->
  17 reverse supported -> 9 final Gemma accepts`, with zero endpoint failures.
  This is operationally stable but not yet a reason to scale the same residual
  to 500; generation-contract and reverse-evidence yield remain the bottleneck.
- Exact controlled replay was tested in an isolated DB: 9 drafts were inserted,
  the second replay inserted zero, promote dry-run/apply accepted 9/9, and fast
  plus published-risk audits passed. Manual inspection rejected `wacko` because
  `/ˈwækəj/` is not an acceptable English IPA even though the structural
  validator passed it. The publishable replay therefore contains eight rows:
  `苦恼`, `投篮`, `特长`, `定时炸弹`, `盗用`, `割舍`, `bop`, and
  `protege`.
- Before the main write, the DB was backed up to
  `data/processed/backups/linguago-v120-before-candidate-bound-ecdict-20260819-180018.db`;
  source and backup SHA-256 both matched the previous
  `18C3CC3BB1B30B85F85E9E231111A18F7894B410AADCD8EA52322C6BF544055E`.
  Main replay inserted eight drafts, exact retry inserted zero, and restricted
  promotion accepted 8/8. Main now has 41,422 entries, 47,951 total senses,
  46,510 publishable senses, and 191,796 localizations. TypeScript, fast audit,
  and published-risk pass; all blocking counters and `flagged_senses` are zero.
- D1 and Worker remain v114. The eight local additions are below the normal
  5,000-10,000-sense release interval. Before scaling, improve or replace the
  IPA validation that admitted `wacko`, and analyze the 22 generation rejects
  plus 21 reverse-evidence manual reviews instead of lowering the gates.
- Follow-up replay classified the 22 generation rejects: 18 were valid Chinese
  cardinal numbers whose Japanese terms/readings were rejected only because
  JMdict does not enumerate productive numerals. A narrow 1-99 compositional
  Japanese number contract and regression test now raise replayed generation
  validity from `43/65` to `61/65`; the remaining four rejects are one thin
  definition and three genuinely unverified Japanese terms.
- Multi-character pure cardinal numbers are now excluded by the general
  production prefilter as `compositional_number`; single digits remain eligible.
  Replaying the 1,934-row pool excludes 26 such expressions before any remote
  request. The reading contract remains useful for rendering or legacy replay,
  but productive numbers should not consume independent product entries.
- A fresh residual scan excluded all first-batch 98 candidates and inspected
  1,834 remaining rows. After product deduplication, only 42 had source-side
  support and zero had the required two independently supported target
  languages. The runner correctly ended as `capacity_exhausted` without model
  calls or DB writes. Zero-family acquisition gaps are `pt-BR=42`, `ja=28`, and
  `zh=16`; acquire those lexical sources before another GPU production batch.

## 2026-08-19 v118 reviewed-acquisition production decision

- Do not run another broad model benchmark or send the current residual pool
  directly to a 5,000-row generation job. The v118 reviewed-acquisition funnel
  was `9 reverse-prefiltered -> 8 Gemma source-approved -> 6 valid Qwen
  generations -> 2 deterministic reverse-supported -> 1 final no-correction
  Gemma accept`. Model infrastructure is healthy; independent target-language
  lexical coverage is the limiting factor.
- The accepted row, `matador` in the `professional bullfighter` sense, was
  reconstructed through controlled replay. An isolated DB inserted one draft,
  an exact second replay inserted zero rows, and deterministic promotion
  accepted 1/1 while restricted to the same candidate report, reverse-evidence
  report, and final Gemma review.
- The exact replay and promotion were then applied to main after confirming the
  v116 SHA256. Main now has `46,501` publishable senses and `186,004`
  publishable sense localizations. TypeScript, product fast audit, and
  published-risk pass; bad four-language counts, duplicate sense orders,
  orphans, mojibake, HTML artifacts, review-localization leakage, and
  `flagged_senses` are all zero. Post-write SHA256 is
  `158443604B6186F4872E01D81CECBF77D425E902017D119EA77D3DE141995093`.
- The pre-write backup and all v118 reports are under
  `.tmp/v118-isolated-validation`; they are runtime artifacts and must not be
  committed. D1 and Worker remain v114 because the locally accumulated batch
  is still below the 5,000-10,000 release interval.
- Production should now operate as two concurrent queues: generate and review
  only candidates that already meet the independent evidence gate, while a
  separate acquisition queue expands pt-BR, zh, and ja lexical evidence. The
  first two Dicionario Aberto acquisition passes added 12 candidate-bound,
  dual-model-reviewed pt-BR rows. Reviewed supplemental evidence may fill an
  otherwise empty target lane only when it is explicitly allowlisted,
  production-publishable, candidate-bound, and approved by both Qwen and
  Gemma. Generic supplemental rows remain weak.
- A CLI trap found during v118 replay: the supplement writer currently stores
  localization source `unsloth:source-gap-supplement-20260622` regardless of a
  caller's `--source` value. Promotion must therefore use source prefix
  `unsloth:source-gap-supplement`, not a v118-specific prefix, until the writer
  is changed. Report, reverse-evidence, and semantic-review restrictions remain
  mandatory so that the broad prefix cannot scan unrelated historical drafts.

## 2026-08-19 v116 evidence-first controlled production

- v116 changes the stage order to `general hygiene -> source-sense alignment ->
  deterministic reverse-evidence prefilter -> Gemma source review -> Qwen
  generation -> reverse evidence -> final Gemma`. The profile is
  `config/dictionary-v2-production-v116.json`; its reverse-evidence gate is now
  explicitly capped by `reverse-evidence-prefilter-limit=500` for repeatable
  production gates.
- A 19,492-row fresh scan retained 15,459 after general hygiene, aligned 2,563
  exact source senses, and found 555 rows with at least two target languages
  meeting the independent reverse-evidence rule. The completed no-write funnel
  was `555 -> 388 -> 367 -> 206 -> 94`: reverse-qualified input, Gemma source
  approval, valid Qwen generation, deterministic reverse support, and final
  no-correction Gemma acceptance. All remote stages had zero infrastructure
  failures.
- The controlled replay builder selected the same 94 final rows. An isolated
  product DB wrote 94 draft senses; an exact second replay wrote zero rows.
  Deterministic promotion accepted 84 and retained 10 as unpublished drafts
  with `semantic_drift_en_term_gloss_mismatch`. Do not bypass those 10; two are
  proper-place rows and the remaining eight need validator or manual review.
- The isolated DB and then the main product DB both passed TypeScript, fast
  audit, published-risk, native D1 export, and full in-memory import. Blocking
  counters remain zero, including `flagged_senses`, bad four-language counts,
  duplicate sense orders, orphans, mojibake, and HTML artifacts.
- Main DB now has 46,500 publishable senses and 186,000 publishable sense
  localizations. Its post-write SHA256 is
  `DD5DD722923FC532D77F1FE616112D78CCE398DFE89846F286F7666C98A5D580`.
  The pre-write backup and all validation artifacts are under
  `.tmp/v116-isolated-validation`; they are local runtime artifacts and must
  not be committed. D1 and Worker remain on v114 because this 84-sense batch is
  below the 5,000-10,000 release interval.
- A second pass excluded all 555 first-batch reverse-qualified candidates and
  scanned the remaining aligned pool. General hygiene retained 1,934 rows, but
  the same independent evidence gate selected 0: 89 had source-side support,
  none had at least two target languages with qualifying evidence. This proves
  the current supplemental evidence pool is exhausted for v116 strict
  production. Do not spend additional GPU time or lower the evidence minimum;
  add genuinely independent target-language lexical evidence first.
- The simplified runner now treats this condition as a successful
  `capacity_exhausted` terminal result and writes summary/manifest artifacts
  without starting Gemma or Qwen. Earlier code attempted source review with an
  empty report and incorrectly surfaced a pipeline failure.
- `report-dictionary-v2-product-source-gap-evidence-deficits.mjs` now reports
  source-supported rows whose target-language coverage is still below the
  production minimum. For the 89 near-gate rows, the completely missing target
  lanes are `pt-BR=75`, `zh=70`, and `ja=47`. This is the acquisition order;
  these are zero-family target gaps, not model-format failures.
- The residual is long-tail and name-heavy rather than a daily-vocabulary pool.
  Its frequency-rank median is 22,519; only 10/1,934 rows are at rank 5,000 or
  better and 38 are at rank 10,000 or better. Most of those 38 are personal or
  fictional names. Do not spend a new 5,000-row model run on this residual.
- FreeDict package names are not provenance. The local `eng-zho` and `eng-jpn`
  TEI headers explicitly identify automatic WikDict imports from Wiktionary
  through DBnary, so both collapse to the `wiktionary` family. In contrast,
  `eng-por`, `por-eng`, and `eng-fra` identify Ergane/TravLang, while `eng-deu`
  identifies TU Chemnitz Ding. Run
  `npm run dict:v2:audit:freedict-provenance -- --files <tei[,tei]>` before
  crediting a new FreeDict package as independent evidence. Unknown upstreams
  are non-production by default.
- The authoritative local reports are
  `.tmp/v116-isolated-validation/v116-batch02-evidence-deficits.json` and
  `.tmp/v116-isolated-validation/freedict-source-provenance.json`. They are
  runtime artifacts and are not committed. Resume automatic production only
  after a genuinely independent, license-compatible source creates at least
  two target-language hint lanes for fresh high-value candidates.

## 2026-08-19 v115 fresh-500 no-write production gate

- A fresh 500-row cohort was selected from the 60,000-row daily pool after
  excluding the v107-v114 input cohorts and the v115 smoke rows. Its language
  mix was `pt-BR=82 / ja=153 / zh=139 / en=126`.
- The v115 deterministic prefilter retained 430 rows and deferred 70:
  `english_inflected_form=47`, `capitalized_name_like=16`,
  `multi_sense_gloss_dump=4`, and `explicit_proper_name=3`. Deferred rows were
  preserved in the run directory and no database write occurred.
- The complete no-write funnel was
  `500 -> 430 -> 267 -> 217 -> 30 -> 23`: prefilter input, Gemma source-review
  input, Gemma approval, structurally valid Qwen generation, deterministic
  reverse support, and final no-correction Gemma acceptance. Final yield was
  only `4.6%` of the original cohort, so this pool must not be expanded directly
  to 5,000 rows.
- Infrastructure was stable. Gemma source review processed 430 valid responses
  with zero request/parse failures; Qwen generated 252 rows with zero endpoint
  failures or circuit-breaker trips and accepted 217. The active generation
  pool used all six configured endpoints after elastic switching.
- Stage durations were: prefilter `0.07 s`, Gemma source review `1362.02 s`,
  Qwen generation `163.71 s`, reverse validation `1.02 s`, and final Gemma
  `31.15 s`. Source review is the latency bottleneck; reverse evidence is the
  yield bottleneck.
- Reverse validation classified the 217 valid generations as `supported=30`,
  `manual_review=108`, and `unsupported=79`. The dominant losses were missing,
  Wiktionary-only, or conflicting pt-BR/zh/ja reverse evidence. Model agreement
  must not replace this independent lexical gate.
- Run artifacts are local at
  `%TEMP%\linguago-v115-optimized-production500`. Before another large remote
  run, rebuild/rank candidates for predicted independent target-language
  reverse coverage. Do not spend a 5,000-row run on the same residual daily
  pool and do not relax the evidence validator.

## 2026-08-19 v115 production-runner optimization

- The default production profile is now
  `config/dictionary-v2-production-v115.json`. The v106 profile remains as the
  frozen release baseline; v115 keeps its Qwen/Gemma models, evidence policy,
  no-write behavior, controlled replay, and publication gates unchanged.
- `filter-dictionary-v2-production-batch.mjs` adds a deterministic stage zero
  for the daily-general lane. It defers explicit proper names, low-value English
  inflected-form/gloss dumps, multi-sense dumps, and obvious CJK source-script
  mismatches before remote Gemma review. Deferred rows are written to
  `00-production-prefilter-rejected.json`; they are not deleted and may be
  handled by dedicated proper-name, lemma/inflection, or sense-split lanes.
- Retrospective measurements: the v113 strict 3,488-row cohort would defer 307
  rows (8.8%). Seventeen of its 374 final Gemma accepts were in that lower-yield
  deferred lane, so this is prioritization rather than a claim that those terms
  are invalid. The cleaner v114 800-row cohort deferred four rows and none of
  its 78 final accepts.
- Production child processes now set `UNSLOTH_REQUIRE_INSTALLED_MODEL=1` by
  default. `ensureUnslothModel` checks `/api/models/local` before unloading or
  loading, preventing request-time automatic downloads from blocking a live
  batch. Maintenance experiments may explicitly pass
  `--allow-model-download true`; the v115 profile does not.
- Stage records now include `duration_seconds` and output item counts. This
  makes candidate/hour and accepted/hour measurable from the manifest instead
  of inferring throughput from GPU utilization.
- A small-batch scheduling bug was fixed: when work was below the elastic-pool
  threshold, the runner still forwarded variant mappings for inactive elastic
  endpoints. The generation script rejected those unknown endpoints. Variant
  mappings are now filtered to the active endpoint set.
- The 20-row no-write smoke test completed through the optimized profile. Its
  stages were prefilter 0.06 s, Gemma source review 58.17 s, Qwen generation
  33.22 s, reverse evidence 0.15 s, and final Gemma 12.04 s. Resume skipped the
  already completed prefilter and source review after the endpoint-map fix.
  The funnel was `20 -> 12 -> 6 -> 1 -> 1`; this cohort was a compatibility
  test, not a production yield benchmark, and no database write occurred.

## 2026-08-19 model-speed exploration on RTX 4090-224

- Unsloth Studio request-time model switching and missing-model download were
  enabled on `11446` (`rtx4090-224`). The node initially had no active model;
  Gemma 4 31B, Qwen 3.6 35B MTP, and several classifier/translation-support
  checkpoints were already present. Automatic download must remain a setup
  operation, not part of a production request: downloading and loading
  `unsloth/gemma-4-E4B-it-GGUF` `UD-Q4_K_XL` took 398.1 seconds.
- On the same node and the same six-request product-contract benchmark, Gemma
  4 E4B and Gemma 4 31B both returned valid JSON for 6/6 requests and scored
  76/80. E4B median latency was 638 ms preview, 1,808 ms full sentence, and
  2,088 ms full word entry. Gemma 31B measured 3,409 ms, 14,415 ms, and
  17,982 ms respectively. The common structural weakness was missing Japanese
  reading markup; the 31B sample also missed one Japanese explanation check.
- The structural score did not transfer to semantic source review. Replaying
  the 72-row `v101-four-lang-quality100` locked-contract cohort with E4B
  produced 72 valid responses but `0 accept / 0 reject / 72 manual_review`.
  Typical reasons said that the supplied evidence was insufficient, while the
  production 31B review had resolved the cohort as 54 accepts and 18 rejects.
  Do not add E4B as a production source-review gate or use it to reject rows.
- The frozen model split therefore remains correct: Qwen 3.6 35B MTP for full
  entry generation and Gemma 4 31B for independent semantic adjudication.
  Nemotron remains targeted/advisory only; its earlier broad shadow replay
  saved too few downstream calls to justify an always-on stage.
- The next speed work should prioritize candidate hygiene and stage overlap:
  reject proper names, low-value inflections, and deterministic evidence
  mismatches before remote review; then stream accepted chunks into generation
  while later chunks are still under review. Keep model residency for at least
  a stage-sized queue and never trigger downloads from a live task.
- Local benchmark artifacts are intentionally ignored under `logs/`:
  `unsloth-224-gemma4-e4b-product-contract-20260819.json`,
  `unsloth-224-gemma4-31b-product-contract-20260819.json`, and
  `unsloth-224-gemma4-e4b-shadow-source-review-20260819.json`.

## 2026-08-19 v114 production-5012 release

- The accumulated v107-v114 release crossed the frozen deployment interval
  with 5,012 new publishable senses: `968 + 1,062 + 937 + 830 + 498 + 281 +
  360 + 76`. Production now uses cache `v114-production5012-40105`, Worker
  Version ID `5e2abcf9-603f-4514-b5ed-e09feb35d458`, and D1
  `published_at=2026-08-19T03:26:57.444Z`.
- Live `/health`, remote D1, and the export manifest agree exactly:
  `entries=40,105`, `senses=46,416`, `sense_localizations=185,664`,
  `examples=3,030`, and `example_localizations=11,898`. The native package is
  `outputs/d1-v2-product-native-export-v114-production5012`.
- The final production cohorts used the frozen v106 profile and performed no
  automatic database writes. Their remote funnels and deterministic promotions
  were: v110 `5,000 -> 3,798 -> 3,232 -> 943 -> 857 -> 830`; v111
  `3,469 -> 2,418 -> 1,959 -> 571 -> 512 -> 498`; v112
  `3,073 -> 1,416 -> 984 -> 356 -> 297 -> 281`; v113
  `3,488 -> 2,117 -> 1,895 -> 428 -> 374 -> 360`; and v114
  `800 -> 586 -> 503 -> 98 -> 78 -> 76`. The columns after input are Gemma
  source approval, valid Qwen generation, deterministic reverse support,
  no-correction Gemma acceptance, and deterministic promotion.
- Every cohort was replayed into an isolated database before the identical
  controlled replay was applied to main. TypeScript, fast audit,
  published-risk, native export, and full in-memory import all pass. Release
  blockers remain zero: no bad localization counts, duplicate sense orders,
  orphans, mojibake, HTML artifacts, or published-risk flags.
- Main-DB backups immediately before the last two writes are
  `C:\Users\qhz00\AppData\Local\Temp\linguago-before-v113-production-20260819-113827.db`
  (SHA-256 `A4504305B942FED2BF14098674FD5EFBD9863FA98D07BD2386D513BB69E14B44`)
  and
  `C:\Users\qhz00\AppData\Local\Temp\linguago-before-v114-production-20260819-122606.db`
  (SHA-256 `2195D95DAA91296C8E81348F1B506522030CE8564D54C9231A25924053DD20F1`).
  The released product DB SHA-256 is
  `BB5BB8E52AF5BD662B6B3D81315562FDB224EC08A15243D67A2338F9123BD700`.
- The remote pre-release D1 backup is
  `C:\Users\qhz00\AppData\Local\Temp\linguago-dictionary-before-v114-20260819-122754.sql`
  (145,016,009 bytes), SHA-256
  `591AC0E1CB372924E9D4D81F522FBE1BDFA1AD93672F880496DBBDD7040DC2FC`.
- Full online dictionary regression, focused API checks, and Edge-based mobile
  and desktop render checks pass. Core polyphone queries (`中`, `杆`), Chinese,
  Japanese, English, and Portuguese spot checks all resolve through D1 with no
  horizontal overflow.
- Operational lesson: a model's source approval or final acceptance is not
  publication permission. Keep the source-family, reverse-evidence, controlled
  replay, and deterministic promotion gates frozen. The v113 strict pool also
  contained many proper names and inflected forms; filter them before remote
  review rather than weakening validators after generation.

## 2026-08-18 v109 production-937 local promotion

- The frozen v106 production profile completed a fresh 5,000-row v109 cohort:
  `5,000 input -> 3,916 Gemma source approvals -> 3,410 valid Qwen generations
  -> 1,074 reverse-supported -> 972 final no-correction accepts`.
- Controlled replay excluded one proper-like row. Of the remaining 971 rows,
  exact current-state replay matched 968 and deterministically accepted 937;
  31 `en_term_gloss_mismatch` rows and three unmatched rows remain unpublished.
- Isolated validation inserted 936 entries, reused one entry, promoted 937
  senses, and promoted 3,748 four-language localizations. The same counts were
  then reproduced on the main product DB.
- TypeScript, fast audit, published-risk, native export, and full in-memory
  import audit all pass. The local publishable package now has `entries=38,061`,
  `senses=44,371`, and `sense_localizations=177,484`; all blocking counters and
  `flagged_senses` are zero.
- The pre-write backup is
  `C:\Users\qhz00\AppData\Local\Temp\linguago-before-v109-production-20260818-230047.db`,
  SHA-256
  `088AE1E10F7F36A9F0150C4B1622D21329CA8E30A78A97E8904DF32EBF9B6D90`.
- The v107-v109 local increment is 2,967 publishable senses (`968 + 1,062 +
  937`). D1 and Worker therefore remain on v106 until the frozen 5,000-10,000
  sense release interval is reached.

## 2026-08-18 v108 production-1062 local promotion

- The v108 5,000-row run produced `3,568` Gemma source approvals, `3,050`
  valid Qwen generations, `1,197` reverse-supported rows, and `1,083` final
  no-correction accepts.
- Controlled replay excluded five proper-like rows. Exact replay matched 1,076
  and deterministically accepted 1,062; 14 validator rejects and two unmatched
  rows remain unpublished.
- Isolated and main-DB replay/promotion both inserted or reused 1,062 senses and
  4,248 localizations. Fast, published-risk, native export, and full in-memory
  audits passed with every blocking counter at zero.
- The pre-write backup is
  `C:\Users\qhz00\AppData\Local\Temp\linguago-before-v108-production-20260818-001404.db`.

## 2026-08-17 v107 production-968 local promotion

- The frozen v106 profile processed a fresh 5,000-row cohort: `5,000 input ->
  3,790 source approvals -> 3,374 valid generations -> 1,131 reverse-supported
  -> 1,020 final no-correction accepts`.
- Controlled replay excluded five proper-like rows and promoted 968. Forty-three
  `en_term_gloss_mismatch` rows and four unmatched rows remain unpublished.
- Isolated and main-DB fast, published-risk, native export, and full in-memory
  audits passed. The publishable package has `entries=36,062`, `senses=42,372`,
  and `sense_localizations=169,488`; all blockers and `flagged_senses` are zero.
- The pre-write backup is
  `C:\Users\qhz00\AppData\Local\Temp\linguago-before-v107-production-20260817-202330.db`.
- D1 and Worker remain on v106 because this 968-sense increment is below the
  frozen 5,000-10,000-sense deployment interval.

## 2026-08-17 v106 post-release quality pass and v107 start

- A rule-based audit covered all 732 v106 promoted senses, stratified as
  `zh=237`, `ja=82`, `pt-BR=111`, and `en=302`. It found 12 English IPA rows
  containing Cyrillic `є` instead of IPA `ɛ`, plus one Mainland Chinese display
  issue (`回覆` -> `回复`). All 13 were repaired through
  `config/dictionary-overrides/v106-quality-repairs.json`; fast audit and
  published-risk still pass with every blocking counter at zero.
- The pre-repair DB backup is
  `C:\Users\qhz00\AppData\Local\Temp\linguago-product-before-v106-quality-repairs-20260817-162529.db`,
  SHA-256 `8E2C2D594C6F509F0E2BB40FF669A7DB9320A0AFD0FD702BC0FCC697CA5BA7A4`.
- The 72 unpublished residuals are classified in
  `config/dictionary-overrides/v106-residual-dispositions.json`: Mainland and
  pt-BR form retries, proper-name exclusions, low-priority sensitive terms,
  locked-term validator retries, and replay-mapping retries. No residual is
  allowed to bypass replay and promotion validation.
- The qualified production topology and thresholds are frozen in
  `config/dictionary-v2-production-v106.json`. Use
  `npm run dict:v2:production-profile` through
  `scripts/run-dictionary-v2-production-profile.mjs` rather than reconstructing
  the endpoint/model arguments from chat history.
- The original 10k daily cohort had only 1,581 fresh rows after excluding v105
  and v106. The daily-general cohort was safely expanded from the existing
  20k ranked/primary-sense reports, then a fresh 5,000-row v107 cohort was
  selected: `zh=2062`, `ja=1371`, `en=1238`, `pt-BR=329`. The v107 remote
  no-write run is `v107-production5000`; do not replay it until the final report
  and controlled-replay filters pass.

## 2026-08-17 v106 production-732 release

- Production D1 and Worker now use cache `v106-production732-35094`, Worker
  Version ID `c4378e54-747d-4461-87ed-d199a78b8dd3`, and D1
  `published_at=2026-08-17T06:20:05.490Z`.
- Live and export-manifest counts match exactly: `35,094` entries, `41,404`
  publishable senses, `165,616` sense localizations, `3,030` examples, and
  `11,898` example localizations. Static checks, focused API checks, the full
  online dictionary regression, and mobile/desktop render checks all passed.
- The v105 pressure qualification used 2,000 candidates. Its funnel was
  `2,000 -> 1,555 source-approved -> 1,415 valid generations -> 296 reverse
  supported -> 257 final Gemma accepts -> 254 promoted`. It passed checkpoint,
  replay, promotion, fast audit, published-risk, and full export requirements.
- The v106 5,000-candidate run produced `3,604` Gemma source approvals,
  `3,077` valid Qwen generations, `950` reverse-supported records, and `827`
  final Gemma accepts. A deterministic Latin proper-name/brand/geography filter
  removed 23 records before replay. Of the remaining 804, replay wrote 767
  drafts and deterministic promotion published 732; 35 semantic-drift rejects,
  28 replay validation rejects, and 9 unmatched/current-state skips remain
  unpublished for manual handling.
- A critical review-contract bug was fixed: final Gemma review must use
  `--only-supported true`; `--include-supported true` also reviews unsupported
  generated rows. Gemma source review is stable with the full prompt,
  `max_seq_length=3072`, and `max_tokens=900`.
- The pre-release local product backup is
  `C:\Users\qhz00\AppData\Local\Temp\linguago-product-before-v106-20260817-151852.db`
  (338,743,296 bytes), SHA-256
  `611070D3E5AC856D796856EAA7AFA92EA76721DAD8B49981593373DEF2CFC163`.
  The remote D1 SQL backup is
  `C:\Users\qhz00\AppData\Local\Temp\linguago-dictionary-before-v106-20260817-152118.sql`
  (139,743,404 bytes), SHA-256
  `EB3E7B6F2BCDDFAF973F749BEBC23449605036790401EF25FBF8CD61EC248F66`.
- Large reports, databases, backups, and D1 exports must stay under `%TEMP%`
  on C because D is space constrained. `push-dictionary-v2-native-to-d1.ps1`
  now accepts an absolute `-OutDir`; do not reintroduce repo-relative joining.

## 2026-08-17 v100 semantic-evidence release

- Production D1 and Worker now use cache `v100-semantic29-33606`, Worker
  Version ID `42f73122-6acb-4657-b8d8-45bbcd99955f`, and D1
  `published_at=2026-08-16T21:34:23.805Z`.
- Live and manifest counts match: `33,606` entries, `39,916` publishable
  senses, `159,664` sense localizations, `3,030` examples, and `11,898`
  example localizations. Full API, focused API, and mobile/desktop render
  checks passed with no horizontal overflow.
- Full ECDICT and EJDict source files were rebound to all 6,409 v99 daily
  candidates and merged into `.tmp/combined/v99-daily-evidence-v9.db`.
  ECDICT contributed 7,035 candidate-bound rows and EJDict 138 unique rows.
  This raised the strict pool only from 137 to 152; after excluding published
  and previously attempted entries, only 56 strict candidates were fresh.
- The bounded semantic-adjudication lane retained every independent-source and
  reverse-evidence rule while allowing model review to resolve lexical-string
  ambiguity. It produced 85 fresh candidates. The six-node funnel was
  `85 -> 71 Qwen source accepts -> 56 Qwen/Gemma source consensus -> 47 source
  reverse-supported -> 35 semantic accepts -> 33 generated/reverse-supported
  -> 29 final Gemma accepts`. All endpoint pools participated and
  infrastructure failures were zero.
- The 29 accepted records passed isolated replay, repeated replay idempotency,
  deterministic promote, fast audit, published-risk, main replay, native
  export, and full in-memory import. Every blocking audit counter remained
  zero. This is a controlled evidence upgrade, not a 500- or 5,000-row batch.
- The pre-release D1 backup is
  `backups/linguago-dictionary-before-v100-semantic29-20260817-065000.sql`
  (139,636,135 bytes), SHA-256
  `21A9E3A2783F3E7F8B9052B66B92EB699F21D67FDDBCB501C3B3E6E2A3D819D5`.
- The next scale blocker remains genuinely independent lexical evidence.
  Merely marking existing ECDICT/Apertium families strong added only two
  selected rows before the full rebinding. Do not lower the two-family,
  reverse-evidence, or independent Gemma gates to manufacture a 500-row pool.

## 2026-08-17 v99 strict daily-gap release

- Production D1 and Worker now use cache `v99-daily-strict84-33577`, Worker
  Version ID `37af4314-ba32-44a7-93f3-5a26e278a1b3`, and D1
  `published_at=2026-08-16T21:10:11.232Z`.
- Audited/live counts are `33,577` entries, `39,887` publishable senses,
  `159,548` sense localizations, `3,030` examples, and `11,898` example
  localizations. The remote D1 counts match the native export manifest.
- The refreshed daily pool contained `6,409` candidates, but the strict
  independent-evidence prefilter retained only `137`; `562` need manual
  evidence work and `5,710` are unsupported. After fresh-entry exclusion, the
  six-node pipeline reviewed `131` rows and safely published `84`.
- A raw 500-row validation was stopped after its first 20 rows were all
  rejected for missing locked pt-BR/Japanese target terms. Always run the
  strict two-independent-family prefilter before remote review; this was an
  input-evidence failure, not a Qwen/Gemma infrastructure failure.
- The strict run used all three Qwen and all three Gemma endpoints with zero
  infrastructure failures. Isolated replay, repeated replay idempotency,
  deterministic promotion, fast audit, published-risk, native export, and
  full in-memory import all passed before the main DB and D1 were updated.
- The pre-release D1 backup is
  `backups/linguago-dictionary-before-v99-daily-strict84-20260817-061100.sql`
  (139,329,316 bytes), SHA-256
  `6642808E943C90ACAA05DBBCE17ADEAD4DE30DB6E3FC38F2D6EE1501129A557F`.
- Do not call v99 a 5,000-row run. Safe 5,000-row expansion is currently
  evidence-capacity limited. Acquire or bind independent Chinese, Japanese,
  and Portuguese lexical evidence for the manual/unsupported pool rather than
  lowering promotion gates.

## 2026-08-16 v98 daily-first 5,000 release

- Production D1 and Worker now run cache `v98-daily5000-33493`, Worker Version
  ID `fe4ab5e8-2c3b-4dd1-aef4-ff584caa440c`, and D1
  `published_at=2026-08-16T10:03:10.688Z`.
- The release contains `33,493` entries, `39,803` publishable senses,
  `159,212` sense localizations, `3,030` examples, and `11,898` example
  localizations. Remote D1 counts exactly matched the audited manifest.
- The daily-first production run sent exactly 5,000 candidates to Qwen. It
  produced 4,737 structurally valid records (94.74%). Strict independent
  reverse evidence plus Gemma no-correction review retained 1,206 records,
  all of which passed isolated replay, idempotency, deterministic promotion,
  fast audit, published-risk, and full native export/import audit.
- The pre-release remote backup is
  `backups/linguago-dictionary-before-v98-daily5000-20260816-190539.sql`
  (130,564,777 bytes), SHA-256
  `894FF4256C4EC946022179D21C0F48A58C995ADCF586827AE62AAB51C74FC67E`.
- One generated Japanese abbreviation, `じゃが`, put kana in its Chinese
  definition. Promotion correctly rejected it. The controlled-consensus input
  builder now rejects Chinese terms or definitions containing kana before any
  DB write. Do not weaken this language-contract gate.
- Online health, full API regression, focused API regression, four-language
  mobile/desktop render checks, and UI smoke all pass. The browser checks use
  installed Microsoft Edge when Playwright Chromium is unavailable, recognize
  `.custom-tab-btn`, and now fail on provider, expected-text, or overflow errors.

## 2026-08-15 v98 current pipeline is scale-ready

- The current six-node fixed-role regression processed 489 unique upstream
  candidates with three Qwen generation/review workers and three Gemma review
  workers. All endpoints participated and infrastructure failures were zero.
- Funnel: 489 input -> 325 Qwen accepts -> 215 dual source consensus -> 194
  deterministic source supports -> 170 semantic accepts -> 149 generation
  ready -> 147 structurally valid -> 147 reverse supported -> 142 final
  accepts including one bounded repair. Automatic DB writes were zero.
- Current quality rates are 98.7% generation validity, 100% generated-record
  reverse support, and 96.6% final acceptance. The authoritative report is
  `logs/product-source-gap-v98-pressure489-scale-readiness.json`.
- `evaluate-dictionary-v2-remote-scale-readiness.mjs` separates the upstream
  review funnel from actual generation quality. Do not require 80% of raw gaps
  to publish; require at least 80% of evidence-approved valid generations to
  pass final review, while preserving every upstream evidence gate.
- The previous isolated 2,000-row qualification artifacts still exist under
  `.tmp/validation`; that run promoted 1,619/2,000 with all blocking audits at
  zero. The new 489-row run validates the current model contract and scheduler.
- The pipeline may now start large batches. Fresh strict capacity is the next
  limitation: the current 34,216-row aligned report yields 1,523 strict
  candidates, not 5,000. New independent lexical evidence is required to grow
  beyond this batch; do not lower the two-family rule.
- Candidate-bound CedPane/HanDeDict subsets must be merged incrementally. A
  family-wide replacement deletes evidence for earlier candidate IDs.

## 2026-08-15 isolated 502-sense scale gate passed

- The first real scale gate is complete in the isolated database
  `linguago_v2_product_top5000_freedict_filtered_candidate.v97-scale507-audit.db`.
  Exactly 502 distinct source entries/senses were promoted through locked Qwen
  generation, deterministic reverse evidence, and no-correction Gemma review.
  The production product DB was not modified; its SHA-256 remained
  `05183ABFA1E11FAE5DE4A58DCBC4331FBD65BD40B5E1CA5FE4D5A3FC7466A32C`.
- Accepted senses increased from 37,775 to 38,277. The native D1 export contains
  31,803 entries, 38,266 publishable senses, and 153,064 sense localizations.
  Fast audit, published-risk, native export, and in-memory full import audit all
  passed. Blocking counts are zero, including bad four-language counts,
  duplicate sense orders, orphans, mojibake, HTML artifacts, and flagged senses.
- Candidate accounting must use distinct source entries, not only
  `source_entry_id:source_sense_id`. A 507-sense candidate union represented
  only 463 writable entries because 44 later senses belonged to entries already
  drafted by the HanDeDict cohort. Two fresh, entry-exclusive gates added 39
  more entries, producing the verified 502-entry batch.
- `select-dictionary-v2-source-gap-fresh-cohort.mjs` therefore supports
  `--exclude-source-entries true`, which excludes every source entry present in
  prior reports rather than allowing another sense of the same entry.
- `promote-dictionary-v2-product-source-gap-drafts.mjs` permits an entry in
  temporary `needs_review` state when its target sense remains a reviewed draft.
  This is required when independently reviewed sibling senses are promoted in
  separate controlled reports; all report, reverse-evidence, and Gemma gates
  remain mandatory.
- `duplicate_sense_localizations=632` remains a non-blocking warning. Do not
  auto-merge it without checking pronunciation, part of speech, and sense
  provenance.

## 2026-08-15 elastic Qwen/Gemma worker pool

- `run-dictionary-v2-remote-pipeline.mjs` now treats A6000-144 (`11442`) and
  A6000-155 (`11445`) as elastic workers. For a stage with at least 20 items,
  they unload their current Gemma model, load Qwen 3.6 35B MTP
  `UD-Q4_K_XL`, and join the permanent Qwen workers on 11447/11448. They switch
  back to Gemma 4 31B `UD-Q4_K_XL` for independent review alongside 11444.
- Concurrency is derived from the effective endpoint pool instead of being
  fixed at two. Every model stage still uses one shared queue and excludes any
  endpoint that fails prewarm.
- The no-write `v97-handedict-elastic-pool-regression59` run proved actual
  four-node Qwen distribution (`18/14/13/14`) and three-node final Gemma
  distribution (`6/7/7`). It produced 19 final accepts from 20 generated rows,
  with no transport/JSON failures and no database writes.
- Qwen switching cost was asymmetric in that run: about 38 seconds on 144 and
  153 seconds on 155. The runner therefore applies the elastic threshold per
  stage. Small correction queues remain on 11447/11448 and do not trigger a
  second model swap.
- The first regression left 144/155 on Qwen when a rejected repair caused the
  final Gemma stage to be skipped. The runner now restores both elastic nodes
  to Gemma in `finally` and records the cleanup as
  `manifest.stages.restore_elastic_reviewers`.
- Do not infer node participation from one dashboard snapshot. Verify
  `summary.endpoint_counts` and `prewarm_results` in the stage JSON reports.

## 2026-08-14 six-node Nemotron prefilter pilot

- `config/dictionary-v2-llm-topology.json` now defines the intended six-node
  role split: Nemotron 3.5 on `a6000-155` (`11445`) for advisory prefiltering,
  Qwen 3.6 35B MTP on RTX 4090 nodes `224/47/56` for source review and
  generation, and Gemma 4 31B on A6000 nodes `144/147` for final independent
  review.
- The prefilter is deliberately non-authoritative. It is not dictionary
  evidence, cannot publish rows, and cannot reject production candidates until
  a larger replay demonstrates zero false negatives against final consensus.
- Added `select-dictionary-v2-source-gap-candidates-by-review.mjs` so model
  comparisons replay exactly the same candidate IDs. The first attempt sampled
  the raw report head and overlapped the historical Qwen batch on only 6/20;
  do not use that run to compare recall.
- The corrected exact 20-row replay used Nemotron 3.5 Lightning Q4 XL on 155.
  It returned 19/20 valid JSON and passed 18/20. It retained all 4 Qwen-approved
  rows and all 3 final Qwen/Gemma-agreed rows, but only reduced downstream calls
  by 2/20 (10%). One row failed formatting and one was rejected. This is enough
  to keep testing Nemotron in shadow mode, not enough to enable hard filtering.
- `evaluate-dictionary-v2-source-prefilter.mjs` reports overlap explicitly and
  calculates primary/final recall plus theoretical downstream call savings.
  A production gate should require a larger representative replay, zero final
  false negatives, and meaningful call savings before setting
  `may_reject_before_qwen=true`.
- A follow-up 100-row shadow test used an exact Qwen mixed cohort (`79` Qwen
  accepts, `20` Qwen rejects, `1` invalid). Nemotron produced `99/100` valid
  responses, explicitly rejected only `dezassete`, and retained `79/79` Qwen
  accepts plus `65/65` final Gemma accepts. The one invalid response is routed
  fail-open. The explicit reject was correct for this product: `dezassete` is
  pt-PT while Mainland-oriented LinguaGo uses pt-BR `dezessete`.
- Despite zero semantic false negatives, broad Nemotron prefiltering saved only
  `1/100` Qwen calls while adding about 149 seconds of serial model work. Do not
  put it in front of every candidate. Keep 155 available for targeted regional
  variant checks, missing-field completion, risk-lane triage, or Qwen retry;
  the high-throughput default remains three Qwen generators plus two Gemma
  reviewers.
- The topology was therefore changed from broad prefiltering to post-Qwen
  targeted review. `select-dictionary-v2-source-gap-targeted-review.mjs`
  routes only Qwen-invalid, Qwen-manual, pt-BR-reject, regional-risk, or
  missing-field retry rows. Nemotron runs first for speed, but every accepted
  recovery still requires Gemma agreement and the normal deterministic gates.
- On the historical 777-row v94 Qwen review, the router selected 59 rows:
  `qwen_invalid=23`, `qwen_manual_review=13`, and `pt-BR_reject=23`. Nemotron
  completed 59/59 in 81.37 seconds (`54` accepts); dual-node Gemma completed
  59/59 in 179.32 seconds (`55` accepts). They agreed on 52/59 decisions
  (88.1%): 51 joint accepts, one joint reject, and seven disagreements.
- The disagreements demonstrate why Nemotron cannot adjudicate alone. It was
  too permissive on mismatched senses such as `adoptar` (adopt vs borrow),
  `indutivo` (inductive vs tacit), and one `légua` sense. Regional/style cases
  such as `dezassete`, vulgar `conas`, typo-bearing `fresa`, and `enfado` also
  differed. Joint accepts are only recovery candidates; they still need Qwen
  generation, deterministic reverse evidence, and final Gemma consensus.
- The requested first 200-500-row real-new-candidate test could not honestly
  reach 200 rows. After subtracting 17 v95/v96 review reports by exact
  `source_entry_id:source_sense_id`, the current Mainland-first strict pool had
  only 27 genuinely unreviewed candidates (`pt-BR=26`, `ja=1`). Historical
  candidates were not recycled to inflate the test size.
- The 27-row end-to-end no-write run completed cleanly: Qwen source review
  returned 27/27 valid and approved 25; no candidate matched the targeted
  Nemotron route, so 155 correctly received zero calls; independent Gemma
  source review approved 25/25; three-node Qwen generation produced 25/25 valid
  four-language entries with no endpoint failures.
- Deterministic reverse evidence retained 17, put seven into manual review, and
  rejected one. All eight losses were on the Chinese target: three OMW-only,
  three with no reverse dictionary evidence, one low polysemy match ratio, and
  one strong-dictionary gloss conflict. Final Gemma consensus accepted 15/17
  and rejected `substrato` and `monociclo`.
- Effective final yield was 15/27 (55.6%), below the 80% scale gate. No draft,
  product DB, D1, cache, or Worker write was performed. The six-node services
  and routing are stable; the blocker for a 200-500-row production test is now
  candidate capacity and Chinese independent reverse evidence, not inference
  throughput.
- Target-term repair recovered three initially blocked rows without weakening
  evidence. `じょうろ` changed Chinese `水壶` to `喷水壶`, supported by exact
  CC-CEDICT plus government terminology; `substrato` changed Japanese `基層`
  to biochemical `基質`, supported by JMdict; `monociclo` removed a Portuguese
  definition that incorrectly described two wheels. Final Gemma accepted all
  three repairs.
- `matriarcado` was partially corrected from Chinese `母系社会` to `母权制` and
  Japanese `母系制` to `母権制`. The Chinese term gained two-family support,
  but Japanese `母権制` currently has only WikDict evidence, so the row remains
  manual and was not promoted. This is the intended behavior: a model-proposed
  correction does not replace an independent dictionary family.
- The repaired final result is 18/27 (66.7%), with 18/18 final Gemma accepts.
  Six remaining rows lack adequate Chinese reverse evidence and `matriarcado`
  lacks a second Japanese family. The batch still does not meet the 80% scale
  gate, and no database/D1/Worker write occurred.

### Final v97 repair and consensus result

- Repair was extended to every candidate with exact local dictionary support.
  The changes include Mainland-first Chinese target corrections, a JMdict-backed
  Japanese biochemical term, and removal of contradictory or duplicated
  definitions. Model-only suggestions were not treated as evidence.
- The final v5 reverse-evidence report contains `23 supported`, `2 manual`, and
  `0 unsupported`. The two manual rows are `ergonomico` (Chinese evidence is
  OMW-only) and `matriarcado` (its corrected Japanese target is WikDict-only).
- Dual-A6000 Gemma consensus accepted `23/23` supported rows, every one at
  confidence `1.0`. End-to-end eligibility is `23/27` (`85.2%`), exceeding the
  `>=80%` quality gate for this bounded cohort. The authoritative reports are
  `product-source-gap-v97-fresh25-repaired-v5-reverse-evidence.json` and
  `product-source-gap-v97-fresh23-repaired-v5-final-gemma.json` under `logs/`.
- This validates the current review/generation/repair contract, but it is not a
  200-500-row scale cohort. Only 27 genuinely unreviewed rows remained after
  exact history subtraction. Rebuild the independent-evidence candidate pool,
  then run an unseen 100-row gate followed by the 500-row checkpoint/write test.
- No draft, product DB, D1, cache, or Worker write occurred in this v97 test.
- The all-history attempt index was then rebuilt from `4,629` product-prefixed
  JSON reports. It indexed `24,904` source entries and `39,716` entry/sense
  attempts with zero parse failures. Exact subtraction leaves only two rows in
  the existing 1,482-row strict pool (`protrombina`, `embutir`), both pt-BR.
- Evidence-deficit analysis over all 34,216 validations found 2,991 insufficient
  Chinese targets and 1,365 insufficient Japanese targets. The diagnostic
  manual lane contains 921 OMW near-unlock rows, but after historical exclusion
  every fresh zh/ja target has zero existing evidence families (`zh=2,505`,
  `ja=2,640`). There is no fresh one-family cohort left to unlock cheaply.
- Added `select-dictionary-v2-source-gap-evidence-acquisition.mjs` and npm command
  `dict:v2:coverage:select-evidence-acquisition`. The generated top-500 manifest
  is `logs/product-source-gap-v97-evidence-acquisition-top500.json`; it is
  diagnostic only and prioritizes Mainland Chinese acquisition. Do not pass it
  directly to generation or promotion.
- Next: ingest and license-record a genuinely independent Mainland Chinese
  lexical source, intersect it with this manifest, rebuild the combined evidence
  DB and strict prefilter, then require at least 100 unseen rows before resuming
  Qwen/Gemma scale validation. Add Japanese evidence second. LLM agreement is
  not a substitute for either dictionary family.

## 2026-08-10 v90 isolated 500-row scale gate

- The fixed 500-candidate cohort completed real chunked draft writes in
  `.tmp/validation/linguago-v90-scale500.db`. Checkpoint resume finished with
  `482/500` valid drafts (`96.4%`), zero endpoint failures, ten committed
  50-row chunks, 482 unique product senses, 1,928 localizations, and 482 source
  links. The production DB, D1, and Worker were not changed.
- Deterministic reverse evidence supported all 482 valid generations in all
  four languages. Initial independent Gemma 4 31B consensus accepted 349,
  rejected 132, and failed to parse one response.
- Structured correction selected 116 safe field replacements. Qwen regenerated
  98 valid rows; 88 retained strict reverse evidence; Gemma accepted 64. Six of
  those still carried source-review risk flags, so controlled replay wrote only
  58 corrected drafts. The final strict promote cohort was therefore
  `349 + 58 = 407/500` (`81.4%`).
- `promote-dictionary-v2-product-source-gap-drafts.mjs` previously replaced a
  narrow draft `gloss_key` such as `excerpt` with a broad multilingual hint
  list from the source-review report. This caused 101 false
  `broad_gloss_key` rejects. It now retains the narrow draft gloss whenever the
  report gloss is broad; genuinely broad draft glosses remain blocked.
- Both promote dry-runs and applies accepted all 407 strict rows. The isolated
  publishable count rose from 35,476 to 35,883. Fast audit and published-risk
  passed with `flagged_senses=0`, no review localization leakage, no duplicate
  sense order, no orphan, no mojibake, and no HTML artifact.
- Native D1 export plus in-memory import passed at 30,317 entries, 35,883
  senses, and 143,532 sense localizations. Export output is
  `outputs/d1-v2-product-native-export-v90-scale500-validation`; it is a local
  validation artifact and must not be deployed.
- The 2,000-row pressure gate is now blocked by source-qualified candidate
  supply, not model or checkpoint reliability. Re-aligning all 4,930 clean
  rows produced 3,095 unique candidates, but the unchanged two-independent-
  source-family/all-target gate retained only 646.
- An unseen OpenHowNet probe found 655 exact POS-bound rows. Dual Qwen/Gemma
  review of the 291 single-term rows accepted 202 intersections and exported
  188 MIT-backed lexical evidence rows. Re-running strict prefilter still
  retained 646 rows: these additions strengthen Chinese target terms but do
  not provide a second independent source family for the pt-BR/ja source term.
  Do not count reviewer agreement as source evidence and do not relax the
  two-family source gate. The next useful work is additional source-language
  sense evidence or safer WikDict/FreeDict/JMdict source-sense rebinding.

## 2026-08-08 v90 full-rank expansion qualification

- Expanded the read-only coverage scan from the first 100,000 gaps to all
  267,263 ranked gaps at `max-rank=200000`. The unchanged quality filter
  produced 4,930 clean rows (`zh=1164`, `ja=1085`, `pt-BR=2662`, `en=19`).
- Unique-sense alignment retained 421 rows. The unchanged all-target,
  two-independent-family reverse-evidence gate retained 68 rows. After
  subtracting previously reviewed v90 batches, 64 rows remained.
- The first new semantic-risk batch completed source review at `15/20` (75%).
  Rejections exposed mandarin language/fruit, muffin/gem, object/occupation,
  Platonism/realism, and broad botanical-term scope collisions. These patterns
  are now scored by
  `triage-dictionary-v2-product-source-gap-semantic-risk.mjs`.
- The review runner initially produced 2 context-window errors and 13 truncated
  JSON responses with a 1,024-token context and `max_tokens=320`. Resuming only
  failed rows with a 2,048-token context and `max_tokens=500` completed all 20
  without replaying valid rows.
- A second reranked batch produced 12 accepts, 7 semantic rejects, and 1 invalid
  evidence-bound response (`12/20`; at most `13/20` if retried successfully).
  Misspellings, homographs, and overly broad OMW concepts dominate this lower
  frequency tail. The 90% source-review gate therefore failed twice.
- Stop before generation. No draft, product DB, D1, or Worker write occurred.
  The next useful work is stronger candidate/source normalization, not a lower
  acceptance threshold or a larger LLM batch.
- Independent Gemma 4 31B adjudication of the 12 valid Qwen rejects produced
  7 consensus rejects and 5 reviewer disagreements. Disagreements remain
  manual review; model agreement is never counted as dictionary evidence.
  `adjudicate-dictionary-v2-product-source-gap-reviews.mjs` now records this
  boundary reproducibly.
- Retrospective risk scoring moved all 7 consensus rejects above the automatic
  ceiling (`score=8..10`). The final strict tail contained only 12 eligible
  rows and its exploratory Qwen review reached 6 accepts, 5 rejects, and 1
  invalid response. Even a successful retry could reach only `7/12`.
- The expanded strict pool is now exhausted for automatic generation. Improve
  source normalization and sense-level evidence ingestion before another LLM
  qualification run.
- Added
  `audit-dictionary-v2-product-source-gap-parallel-agreement.mjs` as a read-only
  diagnostic between exact WikDict bilingual senses and generated target-term
  hints. Across 64 strict rows it found 22 rows with mismatches. In the 40
  reviewed rows, all 7 Qwen/Gemma consensus rejects had a mismatch, while only
  1 Qwen accept did. A single mismatch is therefore a ranking penalty, not a
  hard block; multiple mismatches are high risk. Near CJK matches remain
  visible and never count as publication evidence.
- Harmonized the prefilter English lexical matcher with the final reverse
  validator: both now support inflection, conservative derivational stems, and
  one-character edit distance for compact terms of at least six characters.
  This recovered only `certificação` and `cambojano` (`68 -> 70` strict
  rows). Parallel agreement found two target-language mismatches in each:
  credential/authentication scope for the former and language/nationality
  scope for the latter. Both stayed above the risk ceiling; no LLM or DB write
  followed.

## 2026-08-08 v90 low-ambiguity second gate

- Added `--max-hints-per-target` and `--max-total-target-hints` to
  `subtract-dictionary-v2-product-source-gap-report.mjs`. The second gate used
  at most two hints per target language and six target hints in total, leaving
  19 candidates from the 77 unreviewed OMW-priority rows.
- Source review correctly rejected `arábico` (part-of-speech mismatch) and
  `apendicectomia` (Japanese scope mismatch). It initially marked `insólito`
  accepted while returning null preferred terms. The reviewer validator now
  requires every accepted row to bind all four preferred terms to supplied
  evidence when `--require-hint-semantic-alignment true`; a strict retry fixed
  `insólito`. Adding `encefalite` produced exactly 18/20 source-qualified rows.
- Qwen generation validated 17/18 (`94.4%`); `incolor` was rejected for the thin
  Portuguese definition `sem cor`. All 17 valid rows passed four-language
  multi-family reverse evidence.
- Gemma no-correction consensus accepted 14/17 initially. Structured retry
  proposed `pendência` and `dezanove`; only `dezanove` retained independent
  reverse support and then passed Gemma. `pendência` became Wiktionary-only in
  Japanese and remained manual. Final verified yield is 15/20 (`75%`) in
  `logs/product-source-gap-v90-omw-priority-low-ambiguity-verified-15.json`.
- The second gate therefore also fails the required 80% final promote-rate
  threshold. Do not write these rows to the product DB or start the 500-row
  stage. The next candidate selector must account for grammatical role and
  concept scope, not only hint count.

## 2026-08-08 v90 OMW-priority gate result

- No product DB, D1, or Worker write was performed in this experiment. The
  product DB remains at 29,909 entries, 35,473 senses, and 141,892 sense
  localizations.
- The strict OMW-priority prefilter produced 97 candidates. A balanced 20-row
  source review accepted 19/20; `luso` was correctly rejected for a
  noun/adjective mismatch.
- Generation originally accepted only 9/19 because source-review
  `definition_contract` values in several target languages were English
  placeholders. The supplement runner now keeps English contracts, keeps
  Chinese/Japanese contracts only when their script and thickness are valid,
  omits ambiguous Portuguese contracts, and permits only explicit structured
  Gemma definition replacements to override that filter. The corrected dry-run
  accepted 19/19.
- Reverse validation now carries all English terms from the same aligned source
  sense in `source_meaning_anchors`. This fixed false negatives such as
  `foment` versus `provoke/stir up`, `deformed` versus `distorted`, and
  `pointer` versus `cursor`, without adding a free-form synonym dictionary.
  All 19 rows then had four-language, multi-family reverse support.
- Independent Gemma 4 31B no-correction consensus accepted only 9/19 initially.
  Structured correction retry safely selected eight rows and recovered five,
  producing a final 14/19 (`73.7%`) no-correction intersection. This is below
  the 80% scale gate, so do not write or promote this batch.
- `build-dictionary-v2-product-source-gap-structured-correction-retry.mjs`
  now rejects no-op replacements. Ambiguous replacements and corrections that
  apply to `all` languages remain manual. Current residuals are `duplicação`,
  `agrário`, `legislar`, `olaria`, and `ポインター`; do not force them through
  deterministic promotion.
- Node 11448 returned one upstream HTTP 500 in the first rerun. Nodes 11444 and
  11447 completed the stable rerun with zero failures. This was an endpoint
  reliability issue, not a JSON or validator failure.

## 2026-08-06 v86d controlled-consensus release

- Production is v86d: Worker `35880184-2258-44af-97e6-b00c08c7e2bf`, cache
  `v86d-sequential-form-lookup-29669`, and D1
  `published_at=2026-08-06T08:33:52.889Z`.
- Online counts are `entries=29669`, `senses=35193`,
  `sense_localizations=140772`, `examples=3030`, and
  `example_localizations=11898`. The audited export is
  `outputs/d1-v2-product-native-export-v86-controlled13`.
- The batch promoted 13/13 controlled rows after strict four-language reverse
  evidence and independent Gemma no-correction review: `biosphere`, `calcite`,
  `osteoporosis`, `catamaran`, `crustacean`, `octane`, `prion`, `monotheism`,
  `ionosphere`, `分度器`, `phenolphthalein`, `nonagon`, and `peritoneu`.
- Product DB SHA256 is
  `4A033CA5A860D906723D60DCC47A5F8C7401635DA9EE4CA1D1A9AD2C87BE1456`.
  The pre-v86 DB backup SHA256 is
  `44E26C50A9470B265C24A0B8F0F80EB155F0CAE531E123E2339744D603F7A63A`.
- One release process was interrupted after schema reset and the first data
  chunk, temporarily leaving D1 with entries but no senses. Replaying the
  audited 18-chunk export restored the database. The push script now retries
  each file and verifies all seven remote table counts against the manifest;
  never report a release complete without this verification.
- Do not use Windows PowerShell 5 `Invoke-RestMethod` with a raw non-ASCII JSON
  string as a Unicode dictionary smoke test: it sent `分度器` as `???` and
  created a false D1-miss diagnosis. Use Node `fetch`, an explicit UTF-8 byte
  body, or Unicode escapes. The final focused check includes
  `ja-protractor-form-lookup` to cover a display form whose canonical key is
  romanized.
- TypeScript, fast/published-risk/full import audits, complete online API,
  focused API, and isolated mobile/desktop render checks pass. All blocking
  audit counts and `flagged_senses` are zero. The duplicate-localization
  warning is 108 and remains non-blocking.

## 2026-08-05 Definition-contract residual gate

- Source-supply diagnostics confirmed that the source DB is already ranked to
  about 200,000 for all four languages; frequency depth is not the blocker.
  Among 3,455 aligned candidates, 2,071 fail with a strong-dictionary gloss
  conflict, but 1,906 of those have only one available strong family. Only 73
  expose two families with incomplete matching.
- A default-off `--strong-supplemental-families` diagnostic was added to the
  reverse-evidence prefilter. Treating the Spanish-pivot Apertium rows as
  strong increased the strict pool only from 18 to 19 (`sombrear`) and is not
  approved for production. Conservative space/hyphen normalization produced
  no final-pool increase. The default policy remains unchanged.
- PanLex Batch 1/8 OntoLex (Zenodo record `6757353`) has now been inventoried.
  `scripts/inventory-panlex-ontolex-zenodo.mjs` inspected 96/101 files by HTTP
  Range and selected six files (about 224 MB) containing English plus at least
  one project language. Five files remain network blind spots. The inventory
  canonicalizes PanLex/BCP tags (`cmn|zho -> zh`, `jpn -> ja`, `por -> pt`);
  the first pass incorrectly reported zero Chinese files because it matched
  only the literal `zh` tag.
- Source-tail audit found no eligible new independent family in the six files:
  sources `11`, `13`, and `15` are Russian/Vietnamese/Finnish Wiktionary and
  collapse into `wiktionary`; `5` (Geonames language codes), `54` (IMF
  Terminology), and `116` (Freelang Brazilian Portuguese-English) carry the
  PanLex `co` license marker and are conservatively excluded. Use
  `scripts/audit-panlex-ontolex-source-metadata.mjs` to reproduce this audit.
  Do not download or import these six files into production evidence merely
  because PanLex aligns their terms.
- The five former network blind spots were subsequently closed by suffix-range
  metadata reads (and a full 628 KB download for source `112`). Sources `106`,
  `107`, and `115` are Freelang; `114` is the Austronesian Basic Vocabulary
  Database; `112` is an Indonesian-English translator. All five carry `co`.
  The final 11-source audit therefore contains three duplicate Wiktionary
  sources and eight conservatively excluded `co` sources, with zero eligible
  new independent families. The final local report is
  `logs/panlex-ontolex-batch1-final-source-family-audit.json` (logs remain
  uncommitted).
- Two exact searches through the official Zenodo records API returned only
  record `6757353`, Batch 1/8. Batch 2-8 are not currently publicly searchable,
  so do not block the dictionary pipeline waiting for them. PanLex Batch 1 is
  exhausted as a practical source-expansion path under current license and
  independence gates.
- The next independent-source feasibility pass also closed two tempting but
  low-yield routes. OmegaWiki has the right concept-based multilingual model
  and historical CC-BY/GFDL licensing, but its old site and dump page are no
  longer reproducibly reachable (untrusted TLS on HTTPS and no HTTP
  connection). Do not add it as a production dependency without a verified,
  checksummed dump from an authoritative archive.
- Concepticon 3.4.0 was downloaded from official Zenodo record `14923561` and
  probed with `scripts/probe-concepticon-source-gap-residuals.mjs`. Excluding
  the unlinked sentinel `Parameter_ID=0` is mandatory; including it creates
  false multilingual alignments between unrelated forms. The clean dataset
  has 210 four-language concepts and 3,001 unique terms in those concepts.
  Against the current 3,455-row residual pool it matched only eight source
  words and zero exact target hints, so it adds no strict candidates. Keep it
  as non-publication concept metadata only.
- Unihan is suitable for independently checking single-character Han readings
  and definitions, not for broad source-gap generation. Only three Chinese
  generation hints in the current residual report are single characters, and
  one is already supported, so its theoretical strict-pool gain is at most two
  rows. KANJIDIC2 belongs to the same EDRDG organizational source as JMdict and
  cannot be counted as a fully independent dictionary family. Tatoeba can
  supply licensed examples but cannot prove a word sense or translation.
- `scripts/export-panlex-evidence.py` now implements that offline boundary. It
  streams CSV/TSV or gzip snapshots, recognizes long and abbreviated PanLex
  table/column names, stages only en/pt-BR/zh/ja expressions, and exports the
  existing supplemental-evidence SQLite schema. Required snapshot tables are
  `langvar|lv`, `expr|ex`, `denotation|dn`, `meaning|mn`, and `source|ap`.
- A reviewed `--family-map` maps each original PanLex source ID to its actual
  evidence family. Unmapped IDs are forced to `panlex-unmapped`, carry
  `production_publishable=false`, and are ignored by both prefilter and final
  reverse validation. The mini fixture regression merged four unmapped rows
  into v3 evidence and retained exactly the same 18 strict candidate keys.
- The v3 Japanese Word2Word evidence refresh increased the final strict pool
  from 17 to 18 rows. The only new sense was pt-BR `ubíquo` (`2368070`).
  Gemma accepted its definition contract at `0.95`, but the hard preferred-term
  gate rejected it because `preferred_terms.en` was null (the model supplied
  `omnipresent` only as a suggestion). Qwen was not called and no draft was
  written. The strict residual pool is therefore exhausted under the current
  independent-evidence and exact-term rules.
- A fresh residual sample confirmed that broad manual-review candidates are
  not a production pool: the bounded run reached 11 approvals among 121 valid
  Gemma reviews, while most rows were semantic rejects or lacked complete
  pt-BR/zh definition contracts. Do not scale this lane by lowering the gate.
- The combined supplemental evidence database already existed at
  `.tmp/combined/openwn-word2word3-apertium-wikidata-v2-evidence.db` but was not
  passed to the first reverse-evidence command. Reverse validation and
  prefilter now auto-detect it; pass `--supplemental-source-db none` only for a
  deliberate baseline comparison.
- The current default is the v3 combined database,
  `.tmp/combined/openwn-word2word3-ja-apertium-wikidata-v3-evidence.db`. It adds
  553,029 top-3 Japanese-English corpus rows. A source-gate experiment raised
  nominal candidates from 17 to 251 but Gemma accepted only 5/20, so it was
  reverted. Japanese Word2Word is target-term/diagnostic evidence only and
  cannot satisfy the source-sense family minimum.
- On the strict 20-row lane, Gemma approved 17, exact preferred-term filtering
  retained 12, and expanded independent evidence retained nine. Qwen wrote
  seven valid drafts across the base and expanded passes; final Gemma consensus
  accepted six. All six were promoted only in
  `data/processed/linguago_v2_product.definition-contract-gate20-20260805.db`.
  The main product DB and production D1 remain unchanged.
- Candidate-review resume now preserves exhausted invalid rows as completed.
  Use `--retry-invalid-on-resume true` only after a meaningful endpoint,
  prompt, model, or parser change; the old behavior repeatedly spent calls on
  the same terminal definition-contract failures.

## 2026-08-03 Final-gate reverse-evidence correction

- Product DB was not written and production D1 v83 was not changed.
- `source_meaning_anchor` is now persisted independently from generated
  `gloss_key`; reverse validation must use the former when available.
- Source-family policy is consistent across prefilter and reverse validation:
  Kaikki plus WikDict is one `wiktionary` family; OMW alone is manual review;
  exact OMW plus another family may satisfy the two-family gate.
- Corrected 34-row diagnostic: source review `34/34`, generation `30/34`, reverse
  support `29/30`, manual `1/30`, unsupported `0/30`. Because generation is
  below 90%, rebuild/rerun the formal 100-row gate before any draft write.
- Four rejected rows were `confessional` (JMdict term failure), `hopscotch` and
  `bunion` (quality-review sense mismatch), and `腹膜` (required pt-BR term
  mismatch). Do not bypass these validators to improve the rate.

### Formal 100-row gate result

- Source review: 94/100 accepted; bounded strict-pool replacements: 8/9.
- Qwen generation after replacement: 88/94 slots (`93.6%`), zero network
  failures. Reverse evidence: 75/88 supported (`85.2%`).
- Independent Gemma consensus: 69/75 accepted (`92%`), zero failed calls.
- End-to-end promotable: 69/100, below the mandatory 80/100 threshold. Do not
  run draft apply, 500-row write validation, or D1 deployment from this batch.
- The ranked source DB currently ends at frequency rank 49,999. The 109-row
  strict all-target independent-family pool is exhausted. The next productive
  step is to extend frequency rankings/candidates or add genuinely independent
  lexical evidence, then rebuild the gate. Lowering validation thresholds is
  not an acceptable workaround.

Read this before making changes.

## Current Production Release

Cloudflare production is dictionary v86, deployed on 2026-08-06 JST:

- Worker version: `35880184-2258-44af-97e6-b00c08c7e2bf`
- Worker cache: `v86d-sequential-form-lookup-29669`
- D1 `published_at`: `2026-08-06T08:33:52.889Z`
- Counts: `entries=29669`, `senses=35193`, `sense_localizations=140772`,
  `examples=3030`, `example_localizations=11898`
- Audited export: `outputs/d1-v2-product-native-export-v86-controlled13`
- Pre-release product DB backup: `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-v85-locale-fixed-20260806-151653.db`
- Backup SHA256: `EEC7D7E9BA43D882526D14B9AC4F17CDEE40FAB805BAB9CF88F192578D7AD781`
- Audited v84 rollback SQL package: `backups/v84-rollback-native-before-v85-20260806-151653`

Post-release health, full API regression, focused API checks, and mobile/desktop
render checks passed. Mobile and desktop use separate browser processes because
sharing one Edge process made the first desktop lookup intermittently return to
the empty input state after all mobile cases had run.

## Project Goal

Maintain an iPhone-installable translation/dictionary PWA with:

- Fast word lookup.
- Four-language results.
- Smooth mobile interactions.
- Stable result and control dimensions.
- Backend-controlled provider/model settings.
- Observable provider/dictionary health without exposing secrets.

## Current Product Behavior

The current UI is Vue/Vuetify:

- Text input and translate/clear controls.
- Theme handling with system/light/dark support.
- Settings overlay for provider/model selection.
- Editable provider-specific model lists from `/api/models`.
- Dictionary stats in settings.
- Provider badge for dictionary/cache/model state.
- Result tabs ordered as EN, PT, Chinese, Japanese.
- Bookmarks/history stored locally.
- PWA shell caching with `/api/*` network-only.

## Core Files

Read these first:

```text
README.md
docs/ARCHITECTURE.md
docs/dictionary-v83-large-batch-runbook.md
src/App.vue
src/components/TranslatorCard.vue
src/components/ResultCard.vue
src/components/SettingsOverlay.vue
src/composables/useTranslation.ts
src/composables/useSettings.ts
src/utils/api.js
worker/index.ts
worker/dictionary.ts
worker/config.ts
public/sw.js
```

Historical docs may mention `public/app.js`, `public/styles.css`, `src/index.ts`, or `npm run style:build`; those are old plain-frontend paths.

## Backend Flow

`worker/index.ts` handles API routes:

- `/api/translate`
- `/api/translate-stream`
- `/api/report-error`
- `/api/models`
- `/api/settings`
- `/api/dictionary/stats`
- `/api/health`
- `/health`

Translation order:

1. Normalize input, target language, provider, and model.
2. Rate-limit by client IP hash.
3. Select provider/model or load backend settings from KV.
4. Check KV translation cache.
5. If word-like, try dictionary lookup through `CompositeDictionaryManager`.
6. If dictionary misses, call the selected provider.
7. Parse and validate structured provider JSON.
8. Normalize the response and cache it.

Provider JSON is validated in the Worker before normalization. Invalid complete responses retry once with a repair prompt.

Supported providers are `auto`, `cloudflare`, `dashscope`, `gemini`, and `deepseek`.

## Dictionary Notes

For current v83 generation commands, failure history, interruption recovery,
and expansion gates, read `docs/dictionary-v83-large-batch-runbook.md`. The
runbook is authoritative for the local-only v83 work; this file keeps the shorter
project-wide status.

Current production dictionary source of truth is Cloudflare D1 v2. The v82
WikDict/OMW source-gap baseline was published with:

- `TRANSLATION_CACHE_VERSION = "v82-source-gap-r2-213"`
- Worker version `0bdb4ca1-cc55-48a3-b555-c15f0d7e38dd`
- `/health` counts: `entries=25060`, `senses=30577`,
  `sense_localizations=122308`, `examples=3030`,
  `example_localizations=11898`
- D1 `published_at`: `2026-07-10T18:28:23.903Z`
- Pre-release backup:
  `backups/linguago-dictionary-before-v82-20260711-032736.sql`
- `wrangler` was upgraded to `4.107.0` because `4.103.0` returned Cloudflare
  D1 import `Authentication error [code: 10000]` on `d1 execute --file`, while
  D1 `--command` and `whoami` were healthy.

`worker/dictionary.ts` still contains multiple adapters:

- Cloudflare D1 dictionary lookup through `env.DB`.
- Louis SQLite API lookup through `DICTIONARY_API_URL` and `DICTIONARY_API_TOKEN`.
- A narrow mock JMDict adapter.

D1 should be treated as the production path unless a task explicitly asks to
revive Louis. Dictionary lookup failures are isolated by
`safeLookupDictionaryFirst` in `worker/index.ts`; D1/Louis errors should fall
through to model translation instead of failing the whole request.

Current source-gap generation uses Unsloth Studio, not Ollama. LLM output must
stay in draft/needs-review rows until deterministic promotion passes. The
latest pt-BR source-gap run completed `270/271` candidates; the remaining
manual item is `ouvintes` linked to singular entry `ouvinte`. The first zh-only
pilot promoted `19/19` generated draft senses after adding stricter prompt rules
that prevent Chinese source terms from being copied into English/Portuguese
terms.

The v83 large-batch preparation is implemented but GPU validation is not yet
complete:

- The current raw report is `logs/product-coverage-gaps-v83-large-raw.json`:
  126,439 ranked source entries scanned, 79,239 gaps found, 50,000 retained.
- Strict Tier B contains 2,970 candidates; Tier C contains 5,000 candidates.
  Tier C is mostly pt-BR because the available source evidence cannot satisfy
  the requested zh/ja/en quotas.
- `supplement-dictionary-v2-product-source-gaps-unsloth.mjs` now supports
  `--chunk-size`, `--checkpoint`, `--resume`, `--max-attempts`, endpoint circuit
  breaking, task rerouting, `--force-reload`, and post-load readiness waiting.
  Draft writes commit once per chunk and checkpoint only after the DB commit.
- Run `npm run check:source-gap-large-batch` to test chunk commits, circuit
  breaking, resume, and duplicate prevention with local fake endpoints.
- A model-side evidence verdict is required for v83 batches so a candidate can
  reject a source gloss that is unrelated to its headword.
- A6000 143/144/147 and RTX 4090-56 were upgraded through Studio's official
  `/api/llama/update` endpoint from llama.cpp prebuilt `b9739` to `b9940`.
- Initial smoke runs failed because Studio kept stale `active_model` state after
  the inference process exited. The next run must start with a single
  `--force-reload true` smoke request; do not start the 500-row batch until the
  four-node total reaches at least 18/20 accepted.
- The long prompt failure was isolated to first-token latency through the relay.
  The new `micro` prompt returns in about 1-3 seconds and is normalized back to
  the full product schema before deterministic validation. Use context 1024,
  speculative mode `off`, A6000 `UD-Q4_K_XL`, and endpoint override
  `11447=UD-IQ4_NL`. Prewarm RTX 4090-56 separately for 60 seconds; its Q4 XL
  profile is too close to the 24 GB VRAM limit. IQ4 passed five isolated requests
  but continued to reset its first request in combined four-node runs, including
  with a one-second endpoint cooldown. The three A6000 nodes were stable. The
  500-row write has not started because the combined run still fails the <=2%
  network failure gate.
- The cached 27B Q4 model on RTX 4090-56 was tested as a fallback and also
  failed the gate: 13/20 accepted, one validation rejection, five evidence
  rejections, one socket reset, and slower successful calls than the 35B micro
  path. Repair/restart the node service, replace 56, or explicitly approve a
  three-A6000 batch before any 500-row draft write.
- After a full Studio restart, 56 became stable with 35B `UD-IQ4_NL` when the
  runner fixed `temperature=0`. The current two-node profile (143 Q4 XL + 56
  IQ4) passed 19/20 with no network or validation failures. The 500-row Tier C
  validation then generated 497 rows, wrote 377 drafts, and deterministically
  promoted 297. Eighty semantic/broad-gloss rejects remain draft. Full export
  audit passed at `outputs/d1-v2-product-native-export-v83-500`; nothing from
  this v83 batch has been pushed to Cloudflare D1. Do not start 2,000 rows until
  the 78.8% promote rate is raised above the 80% gate through candidate cleanup
  or separate semantic review.
- Source-gap semantic review raised the 500-row checkpoint to `303/377`
  promoted (`80.37%`) without allowing broad glosses to bypass splitting.
  The subsequent 2,000-row pressure checkpoint completed with 1,405 accepted
  drafts and 595 rejects; deterministic promote accepted 1,199 (`85.34%`).
  The local product DB now has 32,079 publishable senses and published-risk is
  zero. Full audit passed at
  `outputs/d1-v2-product-native-export-v83-pressure-2000` with 26,562 entries
  and 128,316 localizations. Nothing from v83 has been pushed to D1.
- Do not start 5,000 rows yet. Pressure generation acceptance was only 70.25%
  and 110/2,000 rows were infrastructure rejects. Both endpoint circuits ended
  open; 56 had 32 request failures and materially lower accepted output than 143. Fix endpoint recovery/rerouting and rebuild the candidate pool before
  scaling. Resume now treats `--limit` as a total checkpoint target. If a
  Windows parent process is terminated, verify no child supplement Node process
  remains; use the checkpoint reconcile script against the pre-run baseline if
  concurrent output is suspected.
- The circuit breaker now supports timed half-open recovery and one bounded
  task recovery cycle. `npm run check:source-gap-large-batch` verifies this in
  addition to permanent endpoint rerouting and resume duplicate prevention.
- 143 and 56 were updated from llama.cpp b9940 to b9975 through Studio's official
  API. After the user changed networks, consecutive 10/15-row runs had zero
  infrastructure failures; a corrected retry prompt raised the repeated 15-row
  set to 15/15 accepted.
- A strict Tier B 100-row local draft run then accepted 81 rows. Checkpoint-only
  deterministic promote accepted 78/81 (`96.3%`) and left three semantic-drift
  rows in draft. Full audit passed at
  `outputs/d1-v2-product-native-export-v83-tier-b-100` with `entries=26640`,
  `senses=32157`, and `sense_localizations=128628`; `flagged_senses=0`. Nothing
  from v83 has been pushed to D1. Do not start the next 500 until the 81% raw
  generation acceptance reaches the 90% plan gate.
- A 2026-07-14 follow-up filters broad glosses before LLM use, distinguishes
  malformed model JSON from infrastructure failure, and reroutes exhausted
  format failures once to another endpoint. The latest real run generated 99
  rows, wrote 85 drafts, and promoted 78. Full audit passed at
  `outputs/d1-v2-product-native-export-v83-tier-b-fresh-100` with
  `entries=26718`, `senses=32235`, and `sense_localizations=128940`;
  `flagged_senses=0`. Raw acceptance was 85.9%, so 500-row expansion remains
  blocked. No v83 data has been pushed to D1.
- A post-fix live dry-run later exceeded the 15-minute tool timeout. Its orphan
  Node child was stopped and no DB rows were written. Root cause in the client:
  `fetch failed` incorrectly triggered the 300-second model-load path. It now
  reroutes as an infrastructure failure; only explicit unloaded-model responses
  call the load API. Run a short live smoke test before any further production.
- The required recheck passed on 2026-07-15 after the network changed. Adding
  compact WikDict/OMW source evidence to the micro prompt raised a repeated
  smoke batch from 7/9 to 9/9; a separate fresh dry-run accepted 20/20. The next
  real batch accepted 97/99 drafts and deterministically promoted 93/97, with
  zero infrastructure, JSON, or validator failures. Full audit passed at
  `outputs/d1-v2-product-native-export-v83-evidence-fix-100` with
  `entries=26811`, `senses=32328`, `sense_localizations=129312`, and
  `flagged_senses=0`. The 500-row draft gate is now open, but no v83 data has
  been deployed.
- The following checkpointed 500-row pressure batch also passed. Of 498 rows
  requiring generation, 472 became drafts (`94.8%`) and 449 passed deterministic
  promotion (`95.1%`). Both endpoints completed with zero infrastructure or JSON
  failures. Full in-memory audit passed at
  `outputs/d1-v2-product-native-export-v83-evidence-fix-500` with
  `entries=27260`, `senses=32777`, `sense_localizations=131108`, and
  `flagged_senses=0`. The 500-row gate is complete, but the old strict pool has
  only about 539 unused rows; regenerate coverage gaps before deciding between
  another approximately 500-row batch and the 2,000-row gate. No v83 data has
  been deployed.
- Regeneration against the latest DB yielded 819 strict Tier B candidates, not
  enough for 2,000. A second 500-row report generated 496 rows, accepted 460
  drafts (`92.7%`), and promoted 443 (`96.3%`). Two transient 143 socket errors
  were recovered by rerouting, leaving zero infrastructure rejects. Full audit
  passed at `outputs/d1-v2-product-native-export-v83-post-500-production-500`
  with `entries=27703`, `senses=33220`, `sense_localizations=132880`, and
  `flagged_senses=0`. About 319 strict candidates remain. Finish that pool before
  defining a reviewed Tier C expansion; no v83 data has been deployed.
- The apparent 319-row remainder accepted 302/319 drafts and promoted 294. A
  complete 73,436-gap scan then proved the old 50,000-row report was a moving
  window. Of 1,281 lower-rank two-language first-sense candidates, a smoke passed
  only 13/16 because of three correct source mismatch rejections. Requiring
  three first-sense languages produced 192 rows; smoke passed 16/16, production
  accepted 173/185 drafts, and promote accepted 159/173. Final audit passed at
  `outputs/d1-v2-product-native-export-v83-first-sense-3lang` with
  `entries=28156`, `senses=33673`, `sense_localizations=134692`, and
  `flagged_senses=0`. Freeze the remaining approximately 1,089 two-language
  candidates pending source-evidence review. No v83 data has been deployed.

The v69 A6000 source-gap follow-up used `a6000-143` and `a6000-147`
(`100.99.99.99:11441` and `100.99.99.99:11444`) with Unsloth
`unsloth/Qwen3.6-35B-A3B-MTP-GGUF` / `UD-Q4_K_XL`. The 20-row dry-run accepted
`20/20`; the 100-row draft apply accepted `99/100`; deterministic promote
accepted `94` senses and left `7` source-term mismatches in draft review
(`罷/霸`, `臺/苔`, `赴/敷`, `濟/積`, `扬/洋`, `ouvinte/ouvintes`,
`bisavô/bisavó`).

The v70 source-gap follow-up fixed an over-broad pre-generation skip rule so
Chinese source gaps with English glosses containing `one's` are not treated as
English possessive/demonstrative entries. A 20-row A6000 dry-run accepted all
`17/17` generated rows after three already-complete pt-BR rows were skipped.
The 100-row draft apply accepted `99/100`; deterministic promote accepted all
`99` draft senses.

The v71 source-gap follow-up tightened candidate filtering again: English
capitalized proper-like headwords and zh candidates whose gloss is only a
Latin proper name are filtered out, and the repeated `audible` football-play
residual is blocked for generic batches. The strict v71 filter found no clean
zh candidates; the batch was mostly English high-value gaps. A 20-row A6000
dry-run accepted `19/20` with only `audible` rejected, then the 100-row draft
apply accepted `98/100` after skipping three already-complete rows.
Deterministic promote accepted the `98` new draft senses. Product fast/full
audits and online API/render checks passed after publishing.

The v72 source-gap batch used all four active Unsloth nodes together:
`a6000-143` / `a6000-147` with
`unsloth/Qwen3.6-35B-A3B-MTP-GGUF` `UD-Q4_K_XL`, and `rtx4090-47` /
`rtx4090-56` with the lower-memory 35B MTP variant. The A6000 half accepted
`60/60`; the 4090 half selected `60`, skipped `3` already-linked complete
source gaps, accepted `56`, and rejected `1` transient JSON parse failure
(`touchy`). Deterministic promote accepted `116` new draft senses and `464`
localizations. Product fast audit, published-risk audit, and full D1 native
export audit passed. The export directory is
`outputs/d1-v2-product-native-export-v72-four-node-source-gap-116`, with
`entries=23957`, `senses=29474`, and `sense_localizations=117896`.

The v73 source-gap batch repeated the same four-node split after regenerating
coverage gaps from v72. The strict clean filter produced `137` candidates:
`134` English and `3` pt-BR. A 20-row dry-run accepted `20/20`; the 100-row
apply selected `100`, skipped `3` already-linked complete rows, generated `97`,
accepted `97`, and rejected `0`. Deterministic promote accepted all `97` new
draft senses and `388` localizations, while the seven older source-term
mismatch residual drafts remain in review. Product fast audit, published-risk
audit, and full D1 native export audit passed. The export directory is
`outputs/d1-v2-product-native-export-v73-four-node-source-gap-97`, with
`entries=24054`, `senses=29571`, and `sense_localizations=118284`.

The post-v73 source evidence DB has been expanded with WikDict and Open
Multilingual Wordnet:

- WikDict SQLite pairs are stored in `data/raw/wikdict/` for all 12 directions
  among EN, ZH, JA, and PT.
- OMW tab files are stored in `data/raw/omw/` for `eng`, `cmn`, `jpn`, and
  `por`.
- `scripts/import-dictionary-sources-v2.mjs` supports `wikdict-*` sources and
  `omw-30`.
- `scripts/build-dictionary-v2-canonical.mjs` emits multiple
  `sense_localizations` for translation-evidence sources, so coverage gap can
  see WikDict target translations and OMW synset-aligned lemmas.
- The refreshed coverage reports are
  `logs/product-coverage-gaps-v74-wikdict-omw.json` and
  `logs/product-coverage-gaps-clean-high-value-balanced-v74-wikdict-omw-500.json`.

Treat WikDict and OMW as source evidence, not publishable dictionary content.
They improve gap selection, but LLM generation must still write draft rows and
pass deterministic promote before D1 publication.

The first v74 WikDict/OMW source-gap pass has been published to D1. Important
results:

- Initial broad candidate generation showed that WikDict/OMW improve coverage
  but add noisy homograph evidence, especially pt-BR inflected forms, Japanese
  single-character/stem rows, offensive slang, and Traditional Chinese residuals.
- The filter and Unsloth validator now block known residuals such as
  `seja/are`, `ama/lady`, `acha/battle axe`, `minutos/proceedings`,
  `possa/whitethorn`, `for/for loop`, `pega/magpie`, `听听`, `总会`,
  `出身`, `いま/today`, `思`, `ピーター`, and noisy Japanese single
  character source gaps.
- The successful local v74 batches used all four Unsloth endpoints. The first
  batch wrote `100` generated rows to draft, manually blocked `30` noisy draft
  senses, and promoted `69` clean draft senses. The follow-up promoted another
  `43` clean draft senses after moving `ouvintes`, `bisavó`, Chinese
  source-mismatch residuals, and `parado/stale` to review.
- Current local product fast audit after v74 has `publishable.senses=29750`;
  published-risk remains `flagged_senses=0`.
- A refreshed native product D1 export was pushed and full export audit passed
  with `entries=24233`, `senses=29750`, and
  `sense_localizations=119000`.
- The v75 follow-up used all four Unsloth endpoints on the post-v74 gap report,
  promoted `91` clean source-gap draft senses, and kept `8` source-mismatch or
  low-confidence rows in `needs_review` (`sai/saí`, `mínima`, `tento`,
  `aceite`, `acorda`, `cole`, `promotoria`, `observando`). Product fast audit,
  published-risk audit, full D1 native export audit, online focused API check,
  online dictionary regression, and render focused check passed. The published
  D1 export counts are `entries=24324`, `senses=29841`, and
  `sense_localizations=119364`.
- The v76 follow-up used all four Unsloth endpoints again on the post-v75 gap
  report, accepted `97/100` generated rows, conservatively moved `14`
  semantically risky rows to `needs_review`, and promoted `83` clean source-gap
  draft senses. Product fast audit, published-risk audit, full D1 native export
  audit, online dictionary regression, focused API check, and render focused
  check passed. The published D1 export counts are `entries=24407`,
  `senses=29924`, and `sense_localizations=119696`.
- The v77 follow-up repeated the strict post-v76 filter with all four Unsloth
  endpoints, added `blá`, `coca`, and `colegial` to the residual blocklist,
  accepted `97/100` generated rows, rejected `fax`, `cuzão`, and `quites`,
  conservatively moved `17` risky draft senses to `needs_review`, and promoted
  `78` clean source-gap draft senses. Product fast audit, published-risk audit,
  full D1 native export audit, online dictionary regression, focused API check,
  and render focused check passed. The published D1 export counts are
  `entries=24485`, `senses=30002`, and `sense_localizations=120008`.
- The v78 follow-up continued the strict post-v77 filter with all four Unsloth
  endpoints, added the new rejected/review residuals to the filter, accepted
  `98/100` generated rows in the 100-row apply batch, rejected `rancor` and
  `center`, moved `15` risky or source-term mismatch drafts to `needs_review`,
  and promoted `81` clean source-gap draft senses. Product fast audit,
  published-risk audit, full D1 native export audit, online dictionary
  regression, focused API check, and render focused check passed. The published
  D1 export counts are `entries=24566`, `senses=30083`, and
  `sense_localizations=120332`.
- The v79 follow-up used the strict r7 report, confirmed pt-BR and ja dry-runs
  at `30/30` accepted each, applied `50` pt-BR and `50` ja drafts, and
  deterministically promoted `97` clean source-gap senses. The rejected draft
  was the ja row `しろ` with `gloss_key=Shiloh`, where the model drifted into
  `Battle of Shiloh`; keep it in review. Product fast audit, published-risk
  audit, full D1 native export audit, online dictionary regression, focused API
  check, and render focused check passed. The published D1 export counts are
  `entries=24663`, `senses=30180`, and `sense_localizations=120720`.
- Direct access to `100.99.99.99:11441`, `11444`, `11447`, and `11448` still
  fails from this machine with `Bad access`/timeout, but the lab-win portproxy
  and backend Unsloth services are healthy when tested from lab-win. This points
  to Windows Firewall or Tailscale inbound policy blocking external TCP to those
  ports. A local SSH tunnel through lab-win worked for v79 generation; do not
  add persistent firewall rules without explicit user approval.
- The v80 batch was pushed and deployed. The strict r3 filter produced `423`
  clean candidates. A 30-row dry-run accepted `30/30`, the 100-row draft apply
  accepted `96/100`, and deterministic promote accepted `89` senses while
  leaving `8` source-term mismatch drafts in review. Product fast audit,
  published-risk audit, full native export audit, online dictionary regression,
  focused API check, and render focused check passed. The published export is
  `outputs/d1-v2-product-native-export-v80-r3-89`, with `entries=24752`,
  `senses=30269`, and `sense_localizations=121076`. Wrangler `d1 execute
--file` still failed through Cloudflare's `/import` endpoint with auth code
  `10000`; the D1 data was restored through `scripts/restore-d1-native-via-query.mjs`,
  which batches the same SQL through D1's `/query` endpoint.
- The v81 batch regenerated the post-v80 gap report, which found `595` gaps
  after the first-sense completeness gate. The strict r1 filter left `333`
  clean candidates (`pt-BR=76`, `zh=33`, `ja=224`). The source-gap validator
  was fixed so pt-BR/English same-spelling loanwords are allowed when the word
  appears in English source evidence, rather than being rejected as copied
  source terms. After that fix, the 30-row dry-run accepted `30/30`, the 100-row
  draft apply accepted `99/100`, and deterministic promote accepted `96`
  senses while leaving `10` source-term mismatch drafts in review. The stale
  accepted `aquecedor` draft with reviewed localizations was moved back to
  `needs_review`. Product fast audit, published-risk audit, full native export
  audit, online dictionary regression, focused API check, and render focused
  check passed. The published export is
  `outputs/d1-v2-product-native-export-v81-r1-96`, with `entries=24847`,
  `senses=30364`, and `sense_localizations=121456`. D1 was restored through
  `scripts/restore-d1-native-via-query.mjs`, then Worker cache was bumped to
  `v81-source-gap-r1-96`.
- Next coverage-gap runs should prefer `--strict-zh true` for Chinese source
  gaps and continue small-batch draft/promote review before any D1 publish.

## Frontend Constraints

Preserve these unless explicitly asked to redesign:

- Mobile input focus should not create sudden card jumps.
- Loading-to-result transition should keep result cards stable.
- Buttons should not resize between idle/loading states.
- Do not use `transform: scale()` for button feedback.
- Result tab switching should not make card height jump.
- Provider badge should stay compact and stable.
- Settings overlay must cover the viewport and sit above app content.
- Theme changes should update document theme data and status-bar color promptly.

## Service Worker Rules

- `public/sw.js` owns app-shell behavior.
- `/api/*` must stay network-only.
- Navigations should be network-first with cached index fallback.
- Vite hashed `/assets/*` can be cache-first.
- Bump `CACHE_NAME` when app-shell behavior changes.

## Verification Checklist

```bash
npm run build
npm run check
npm run check:all
npm run check:dictionary-fixture
npm run check:worker-dictionary-fallback
```

Use targeted Playwright scripts after layout or interaction changes:

```bash
node scripts/result-tabs-check.mjs
node scripts/system-theme-check.mjs
node scripts/mobile-translate-height-check.mjs
```

Some scripts were written for the old plain frontend. Confirm a script targets current Vue DOM before treating it as authoritative.

## Common Commands

```bash
npm install
npm run dev
npm run dev:worker
npm run build
npm run check
npm run deploy
```

In PowerShell, `npm` may be blocked by execution policy; use `npm.cmd run <script>`.

## Current Production URL

```text
https://translation-pwa.qhzggzh-linguago.workers.dev
```

## Common Pitfalls

- Do not edit deleted/plain-frontend files mentioned in stale docs.
- Do not expose `DICTIONARY_API_TOKEN` or provider API keys.
- Do not expose secret values through `/api/health`.
- Keep frontend model defaults aligned with backend `/api/models`.
- Do not bypass provider JSON validation.
- Do not let `/api/*` responses be cached by the service worker.
- Review untracked SQL/log/archive/scratch files before committing.

## Latest Local Dictionary Gate (2026-07-15)

- The post-v83 three-language run leaves exactly `1,084` candidates whose first
  sense has exactly two clean languages (`pt-BR=922`, `ja=128`, `zh=32`,
  `en=5`). The filter supports `--max-first-sense-langs` so this pool does not
  include three-language rows.
- A read-only candidate evidence gate exists at
  `scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs`.
  It prewarms unloaded Studio nodes and uses `11441=UD-Q4_K_XL` and
  `11447=UD-IQ4_NL`.
- Its revised prompt matched all 16 previously labelled control outcomes,
  including rejection of `banimento`, `红梅`, and `良子`. A subsequent 20-row
  review was technically healthy but contained 14 old smoke rows; among its six
  new rows, five were approved and `幽怪/appearance` was rejected. Use the
  replacement `product-coverage-gaps-v83-two-lang-evidence-fresh-20.json`
  excluded both prior smoke reports and returned 14/20 evidence approvals with
  no endpoint failure. Chinese passed 0/5, so evidence review remains mandatory.
  Unicode proper-name filtering then removed `Düsseldorf`, leaving 13 approved
  pt-BR/ja rows in `product-source-gap-v83-two-lang-evidence-fresh-20-approved-clean.json`.
  Run a generation dry-run on those 13 before any draft apply. No v83 data is
  deployed.
- The following 13-row generation pilot initially appeared 13/13 but manual
  review exposed copied Japanese pronunciation in EN/PT and one unrelated
  English term. The generator now rejects shared EN/PT pronunciation for
  different translated terms and English term/gloss token drift, with explicit
  retry instructions. Pure-kana source readings are normalized to the headword.
- The corrected pilot accepted 12/13. `ゆき` remained rejected for missing IPA,
  and `quinzena` was held because 15 days is not exactly a 14-day fortnight.
  The other 11 were drafted and deterministically promoted 11/11. Full local
  export audit passes at `outputs/d1-v2-product-native-export-v83-two-lang-evidence-11`
  with `entries=28167`, `senses=33684`, and
  `sense_localizations=134736`. v83 remains local only.
- The latest two-language quality experiment reviewed 100 candidates and
  assembled 85 reviewed/manual-evidence rows. Strict generation accepted 66/85
  with zero endpoint failures, below the 90% production gate, so the main DB was
  not changed. Do not use the earlier 75/85 structural result as quality
  evidence; it contained wrong Japanese readings.
- Chinese dictionary readings now use `pinyin-pro` with `toneSandhi:false`.
  Japanese readings are checked against a 226,730-term JMdict index. Generation
  and QA use the primary English source term as a single-sense anchor.
- `supplement-dictionary-v2-product-source-gaps-unsloth.mjs --replay-report`
  reuses exact accepted dry-run outputs. A separate validation DB replayed 66/66
  into review drafts; audits passed, publishable senses stayed 33,684, and
  `flagged_senses=0`. The production DB and D1 were not changed.
- The next independent 20-row smoke proved that same-model review on two nodes
  is correlated, not consensus. Use
  `scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs`
  after generation. It reverse-checks generated terms against CC-CEDICT,
  Kaikki, JMdict, FreeDict, and WikDict; OMW-only evidence remains manual.
- The reverse gate reduced 12 model-approved rows to 5 independently supported
  rows and 7 manual rows. A database-copy replay and deterministic promote
  accepted those 5/5. Fast, published-risk, and full export audits passed at
  33,689 publishable senses. The main DB and D1 remain unchanged.
- The supplement runner now replaces exact English-term pronunciations from
  ECDICT (`pronunciation_system=ecdict-phonetic`). It replaced 11/12 English
  pronunciations in the replay and fixed the bad model pronunciation for
  `electric guitar`. Portuguese pronunciation is not yet deterministic.
- `promote-dictionary-v2-product-source-gap-drafts.mjs` supports
  `--reverse-evidence`; use it for every weak two-language batch so unrelated
  historical drafts cannot enter the promote scan.
- A second zero-overlap smoke accepted 11/20 at generation and only 6/11 after
  reverse evidence. The two independently validated supported subsets (5+6)
  were replayed into the main local DB after backup. Full local export now has
  `entries=28178`, `senses=33695`, and `sense_localizations=134780`; blockers
  and `flagged_senses` are zero. v83 is still not deployed.
- A reverse-evidence prefilter then selected a fresh balanced 50-row batch.
  Identical 143/56 runs accepted 20 and 19 rows, with seven pass/fail changes;
  network failures remained zero. Post-generation reverse validation supported
  only nine rows. Those nine were promoted locally after all audits passed.
  Current local export counts are `entries=28187`, `senses=33704`, and
  `sense_localizations=134816`. Production D1 remains unchanged; do not expand
  to 500 rows until candidate ranking improves.
- Candidate ranking now uses exactly one unambiguous OMW synset and derives
  target hints from that synset only. A fresh 20-row run on 143/56 accepted
  15/20 at model QA and 14/20 after independent reverse evidence, with no
  endpoint failure. Use `--prompt-mode micro`, not the obsolete
  `--prompt-profile micro`; the obsolete option silently falls back to compact
  mode and omits the required evidence verdict. The 14 supported rows were
  replayed and promoted locally after validation-copy and full-export audits.
  Current local export counts are `entries=28201`, `senses=33718`, and
  `sense_localizations=134872`; blockers and `flagged_senses` are zero. The
  backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-omw-unambiguous-14-20260716-224025.db`.
  Production D1 is still v82 and unchanged.
- Lexical QA and EN/PT pronunciation QA are now separate. The former no longer
  mislabels deterministic `ecdict-phonetic` strings as invalid IPA. Targeted
  retries use `--only-source-entry-ids`. A five-row residual retry produced
  three additional reverse-supported entries (`mirra`, `sinusite`, and
  `ibuprofeno`), promoted locally after validation-copy audits. `néon` and
  `サツマイモ` remain manual Brazilian-Portuguese pronunciation residuals.
  Current local export counts are `entries=28204`, `senses=33721`, and
  `sense_localizations=134884`; blockers and `flagged_senses` remain zero.
  Production D1 remains unchanged.
- The next zero-overlap unambiguous-OMW batch contained 48 pt-BR and 2 ja
  candidates. Generation accepted 39/50 in 201.2 seconds with zero endpoint
  failures; reverse evidence supported 37 and held two for manual review. The
  37 supported rows replayed and promoted locally after validation-copy and
  full-export audits. Current local export counts are `entries=28241`,
  `senses=33758`, and `sense_localizations=135032`, with all blockers and
  `flagged_senses` at zero. Six rejected rows were pronunciation-review JSON
  failures, so that reviewer now defaults to 260 tokens and requests concise
  output. Production D1 remains v82 and unchanged.
- Retrying the 11 model-QA residuals with the 260-token concise pronunciation
  reviewer removed all six prior pronunciation JSON parse failures. Three rows
  (`anil`, `mandioca`, `alfabetizacao`) passed both model QA and independent
  reverse evidence and were promoted locally. Eight rows remain manual; do not
  weaken the pt-BR IPA gate to force them through. Replay now selects exact IDs
  from its approved report, so `--limit` cannot truncate later matching rows.
  The latest local export is
  `outputs/d1-v2-product-native-export-v83-omw-unambiguous-57` with
  `entries=28244`, `senses=33761`, and `sense_localizations=135044`; blockers
  and `flagged_senses` are zero. Production D1 is still v82.
- The final zero-overlap unambiguous-OMW remainder contained 16 rows. The
  143/56 dry-run accepted 15/16 in 65.6 seconds with zero endpoint failures;
  independent reverse evidence supported all 15 accepted rows. They replayed
  and promoted 15/15 after validation-copy audits. `bolota` remains a manual
  pt-BR IPA residual. The high-confidence pool is now exhausted. The latest
  local export is `outputs/d1-v2-product-native-export-v83-omw-unambiguous-72`
  with `entries=28259`, `senses=33776`, and
  `sense_localizations=135104`; all blockers and `flagged_senses` are zero.
  Production D1 remains v82.
- A fresh coverage rebuild proved the strict unambiguous-OMW pool is exhausted:
  833 unseen two-language-first-sense candidates produced zero automatic rows,
  20 manual rows, and 813 unsupported rows. A conservative aligned-first-sense
  Tier B review retained 11 candidates, but generation plus independent reverse
  evidence supported only `apontador`, `おとな`, and `ふし`. All three were
  validation-copy audited and promoted locally. The latest export is
  `outputs/d1-v2-product-native-export-v83-evidence-gated-75` with
  `entries=28262`, `senses=33779`, and `sense_localizations=135116`; blockers
  and `flagged_senses` are zero. Do not expand Tier B unchanged; first fix the
  recurring Chinese reading mismatch and weak anchor issues. Production D1 is
  still v82.
- Tier B follow-up fixes are implemented but have not changed the DB. For
  non-Chinese source rows, Chinese target pinyin is now generated
  deterministically with `pinyin-pro`; a four-row retry removed all
  `zh_reading_mismatch` errors. Candidate evidence review now aggregates
  high-quality same-headword WikDict rows and emits `english_anchor` plus
  mandatory `preferred_terms`. A `yeehaw` pilot correctly produced
  `pt-BR=irra` and `ja=ヒーハー`, then stopped at the English IPA review gate.
  Keep that row and the other pronunciation disputes in manual residuals. Do
  not scale Tier B until EN/PT pronunciation has an authoritative source or a
  conservative conflict-adjudication path. Production D1 remains v82.
- Cross-node IPA repair is now implemented. After lexical QA passes, a rejected
  EN/PT IPA can be repaired once on another endpoint and reviewed again by the
  original endpoint. Only fields already marked `IPA` may change; ECDICT
  deterministic English pronunciation is preserved. A three-row pilot
  recovered `あさ`, and reverse dictionaries supported all four terms. It was
  validation-copy audited, replayed, and promoted locally after backup. The
  latest local export is
  `outputs/d1-v2-product-native-export-v83-evidence-gated-76` with
  `entries=28263`, `senses=33780`, and `sense_localizations=135120`; blockers
  and `flagged_senses` are zero. `determinante`, `かんな`, and `yeehaw` remain
  pronunciation/manual residuals. Production D1 remains v82.
- A zero-overlap Tier B 20-row diagnostic approved 15 source senses, generated
  nine structurally valid rows, and found only three with full reverse
  dictionary support: `tcheca`, `leiloar`, and `fatiar`. Those three were
  promoted locally after validation-copy audits. The main DB now has `28754`
  product entries, `34306` product senses, and `33783` publishable senses.
  Local export `d1-v2-product-native-export-v83-evidence-gated-77` contains
  `28266` entries and `135132` sense localizations. All blockers and risk flags
  remain zero. Production D1 remains v82.
- Pronunciation repair responses may be plain IPA strings or nested objects
  containing `ipa`/`pronunciation`. The supplement script now normalizes both
  forms and no longer permits `[object Object]` to enter review. This fixes the
  response-shape bug, but independent term evidence still controls publish.
- The next Tier B experiment added a target-language evidence prefilter before
  the LLM review. Of 793 unseen zero-overlap candidates, 437 had at least one
  target-language evidence path; the selected 20 pt-BR rows each covered two
  target languages. Compact verified hints, a compact 320-token reviewer
  prompt, valid-only resume, and OpenCC normalization produced 20/20 valid
  evidence reviews after earlier verbose attempts reached only 10/20 and
  15/20. Generation accepted 11/20 and independent reverse evidence supported
  nine. Those nine (`caloria`, `fragata`, `miojo`, `pandemia`,
  `antidepressivo`, `soldador`, `formaldeido`, `batuta`, `eucalipto`) were
  replayed and promoted locally after validation-copy audits. The current main
  DB has 28,763 product entries, 34,315 product senses, and 33,792 publishable
  senses. Full export `d1-v2-product-native-export-v83-evidence-gated-78` has
  28,275 entries and 135,168 sense localizations with zero blockers and zero
  risk flags. Final yield improved from 15% to 45%, but seven generation
  rejects were still pronunciation-review failures. Keep large-scale Tier B
  closed until pt-BR pronunciation has a deterministic source or stronger
  adjudication. Production D1 remains v82.
- The pt-BR pronunciation blocker now has a deterministic Kaikki/Wiktextract
  path. `npm.cmd run dict:v2:build:pt-pronunciations` builds an ignored SQLite
  index from `data/raw/kaikki_Portuguese.jsonl`; it contains 61,976 terms and
  307,336 explicitly Brazilian IPA rows. The generator prefers generic Brazil,
  then named Brazilian regions, skips Portugal-only data, records
  `deterministic:kaikki-pt-BR:<region>`, and does not ask the LLM to re-review a
  deterministic IPA. The source file is 555,521,010 bytes with SHA-256
  `6d92084f2123076078dc203c0126de9bb15a4e41e0cbed9e440fdeb3ffc241cf`.
- A live A/B run on the 11 unpublished next-20 residuals accepted 9/11 and had
  zero pronunciation rejection; the previous policy rejected seven for
  pronunciation. Reverse dictionaries supported seven (`vinagrete`,
  `bacharel`, `cobarde`, `quiabo`, `penteadeira`, `privatizacao`, `puzzle`).
  They were validation-copy audited and promoted locally. Current local export
  `d1-v2-product-native-export-v83-evidence-gated-79` has 28,282 entries,
  33,799 senses, and 135,196 localizations with zero blockers and risk flags.
  Production D1 remains v82.
- CLI warning: reverse validation requires `--source-db/--report`; `--db/--in`
  silently fall back to the default report. Do not trust the legacy fast audit
  for an arbitrary DB; use an isolated export directory plus the unified full
  export audit.
- The next fresh-50 pt-BR experiment approved 44/50 in remote evidence review,
  accepted 36/44 on first generation, and independently supported 28. One
  targeted retry added only `trojan`, for a final safe 29/50. The other retry
  rows exposed repeatable reviewer problems: `quinino` received contradictory
  IPA decisions after repair and `peroxido` returned non-JSON quality review
  twice. Keep both as residuals instead of weakening validation.
- Those 29 rows were replayed/promoted 29/29 in a validation copy and then the
  main local DB. Backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-kaikki-pt-fresh50-supported29-20260718-204127.db`.
  The local-only evidence-gated-80 export has 28,311 entries, 33,828 senses,
  and 135,312 localizations; all blockers and risk flags are zero and the
  duplicate-localization warning remains 98. Production D1 is still v82.
- Do not start a 500/2,000/5,000 run from the current two-target-evidence pool.
  Its end-to-end safe yield was 58%, despite zero endpoint failures. Build the
  next pool with evidence in all three target languages, then rerun a 20-50
  row gate. Also remember that full export audit requires an export-created
  manifest; run the export script first.
- The three-target experiment returned zero candidates, so that suggested gate
  is not viable with the current open-source evidence graph. The prefilter now
  offers `--require-pt-pronunciation true` and `--require-jmdict-hint true`.
  After excluding the preceding 50 rows, these gates retained 86/723 and the
  next evidence review approved 43/50 with no endpoint or JSON failures.
- Full generation on those 43 accepted 38 (88.4%); reverse validation supported
  28, left 7 manual, and rejected 3. Hard-enforcing review `preferred_terms`
  was worse: 33/43 model-valid and the same 28 independently supported. Triage
  can attach those terms only with `--attach-candidate-review true`; keep it
  off for production because reviewer terms may be broad and exact-string
  enforcement rejects valid synonyms.
- The 28 supported rows were validation-copy audited and promoted locally.
  Backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-deterministic-new50-supported28-20260718-205446.db`.
  Local export `d1-v2-product-native-export-v83-evidence-gated-81` has 28,339
  entries, 33,856 senses, and 135,424 localizations with zero blockers/risk;
  warning count remains 98. Production D1 is still v82.
- Large-scale generation remains closed. Nodes and JSON transport are stable,
  but safe end-to-end yield is 56%. The next improvement must target
  deterministic zh/ja term alignment or add reverse dictionary coverage; do
  not lower the final evidence validator.
- The reverse-evidence validator now supports `--input-mode reviewed` and a
  `--supported-report` output. On the latest approved 43-row review it
  prevalidated 37 candidate rows from reviewer preferred terms. Triage can
  preserve compact review data with `--attach-candidate-review true`.
- A soft preferred-term comparison used
  `--enforce-reviewed-preferred-terms false`. Of 37 pre-supported candidates,
  27 were already complete; generation accepted 6/10 remaining rows and final
  reverse evidence supported four: `triturar`, `genealogia`, `desatualizado`,
  and `linguística`. They promoted 4/4 after an
  isolated validation-copy full audit.
- Current local-only export
  `outputs/d1-v2-product-native-export-v83-evidence-gated-82` contains 28,343
  entries, 33,860 senses, and 135,440 localizations. All blockers and
  `flagged_senses` are zero; warning 98 is unchanged. Backup before replay:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-reviewed-soft-supported4-20260718-213746.db`.
- Production D1 is still v82. Do not deploy evidence-gated-82 implicitly and
  do not start 500/2,000/5,000 generation from this pool: final safe yield on
  the truly remaining rows was 4/10.
- `npm run check:source-gap-large-batch` is restored in `package.json` and
  passes chunk commit, resume, circuit open/recovery, malformed JSON reroute,
  and checkpoint promote tests. The fixture disables deterministic lexical
  checks only because it uses fake terms; production validation remains on.
- Freshness is now based on actual generation history, not merely absence from
  the product DB. `dict:v2:coverage:index-source-gap-attempts` scanned 345 v83
  log JSON files and indexed 4,679 unique generated/checkpoint-attempted source
  IDs. Pass its output to `--exclude-source-entry-id-files` when rebuilding a
  pool; review-only and never-generated selections are not excluded.
- Current gap rebuild: 72,789 gaps; strict pool 480 but only three truly fresh;
  relaxed fresh pool 1,440. The strongest relaxed policy (two target languages,
  pt-BR IPA, JMdict hint, and one unambiguous OMW target) produced 107 fresh
  pt-BR candidates.
- First fresh gate: evidence review 17/20 approved with 20 valid JSON and zero
  endpoint failure; reviewed-term evidence 17/17; generation 16/17; final
  reverse evidence 13 supported, one manual, two unsupported. Deterministic
  promote was 13/16 (81.25%).
- Replay now inherits `enforce_reviewed_preferred_terms` from its dry-run report
  unless explicitly overridden. This fixed a false `preferred_term_mismatch_ja`
  rejection for `colcha` and prevents dry-run/replay policy drift.
- Latest local-only evidence-gated-83 export has 28,356 entries, 33,873 senses,
  and 135,492 localizations. Backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v83-fresh-omw1-supported13-20260718-215640.db`.
  All blockers/risk flags are zero; warning 98 is unchanged. Production D1 is
  still v82 and was not deployed.

## 2026-08-02 Formal Production Cycle Handoff

- Chunk05 is the latest fully audited local publishable baseline. Its native
  D1 export contains `29,087` entries, `34,604` senses, and `138,416` sense
  localizations. Full in-memory import audit, published-risk audit, and
  TypeScript checks pass. Production Cloudflare D1 remains v82 and was not
  changed.
- Across chunk01-chunk04, 2,000 candidates produced 374 safely promoted
  senses. Candidate selection must exclude both the source-gap attempt index
  and every prior formal chunk report; otherwise rejected rows reappear.
- The current attempt index has 6,135 source entry IDs. With chunk01-chunk04
  reports excluded, the strict chunk05 pool contains only 85 fresh rows:
  83 pt-BR and 2 ja. There are no remaining strict zh or en rows in this pool.
- Chunk05 used only A6000-143 (`11441`), A6000-147 (`11444`), RTX4090-47
  (`11448`), and RTX4090-56 (`11447`). Use `UD-Q4_K_XL` on the A6000 nodes and
  `UD-IQ4_NL` on the 4090 nodes, one request per endpoint.
- Source review approved 69/85, rejected 14, and retained two bounded failures.
  Four-node generation accepted 44/69 with zero infrastructure failures. All
  44 were initially written as `draft_single_source/needs_review`; independent
  Gemma review later accepted 30 for promotion and rejected 14.
- A6000-155 supplied an independent Gemma 4 31B QAT reviewer. GPU contention
  with a separate DiffusionGemma vLLM process initially reduced it to about
  `2.3 tok/s`; Studio `parallel=1` made status calls appear hung while chat was
  active. That vLLM service was later explicitly stopped, allowing Gemma to
  complete all 44 reviews: 30 accepted and 14 rejected, with zero failures.
- The first 12 and remaining 18 accepts each passed fixed-checkpoint conversion,
  isolated promotion, full export audit, and main promotion. No chunk05 draft
  remains pending review; the 14 rejected rows remain unpublished
  `draft_single_source` audit records. The complete audited export is
  `outputs/d1-v2-product-native-export-v83-production-chunk05-complete-validation`.
- Main and complete validation DB SHA-256 is
  `F653307024E87528CFD59D3CD756ACCC2DAFF7AB438BFCE990F26ACF648417B2`.
  The pre-remaining18 backup is SHA-256 verified and must be retained.
- The pre-main backup copy failed due local disk exhaustion, but no partial
  backup remained and the already audited validation DB is identical to the
  main DB. Future automation must fail closed when backup creation fails and
  check free space before copying the product DB.
- Storage cleanup was explicitly approved after chunk05. It removed 128 old
  product DB copies and 115 rebuildable D1 export directories, freeing about
  56.06 GB. The obsolete initial chunk05 validation DB/export were removed
  after the complete validation replaced them, freeing another 457 MB. Keep
  the current DB, complete chunk05 validation copy, verified remaining18
  backup, chunk01-chunk04 milestone backups, source DBs, v82 export, and the
  chunk04/complete-chunk05 exports.
- The post-chunk05 attempt index has 6,218 source IDs. A fresh strict pool from
  50,000 gaps contains zero rows. Relaxing only first-sense evidence still
  yields zero; reducing total evidence to two languages yields only four
  low-priority rows (`fudge`, `conduíte`, `lambreta`, `話中`). Do not start a
  large run by lowering the gate further. Add independent two-language
  validation or another reliable source first.

### 2026-08-02 Kaikki Japanese/Portuguese evidence expansion

- Official Kaikki English-Wiktionary extracts were downloaded and validated:
  `data/raw/kaikki_Japanese.jsonl` (375,732,478 bytes; 197,819 JSONL rows) and
  `data/raw/kaikki_Portuguese.jsonl` (555,521,023 bytes; 434,036 rows). Both
  scans had zero invalid JSON and zero language mismatches.
- `linguago_v2_full.db` now contains `kaikki-ja` (144,096 entries / 181,707
  senses) and `kaikki-pt` (433,990 / 514,189). Integrity, duplicate-order, and
  bad-row checks passed. The product DB and production D1 were not modified.
- Keep `linguago_v2_full.before-kaikki-ja-pt-20260802.db`; its SHA-256 is
  `B763C27658F3D91057934476728DF97989E1264783615C9B920D46EE8E18A82F`.
- Do not run the canonical builder with its default reset behavior. Kaikki JA/PT
  headwords are Japanese/Portuguese but their glosses are English; treating
  those glosses as source-language localizations would corrupt language labels.
- Coverage-gap discovery has an opt-in `--include-kaikki-raw-evidence true`
  channel. Filtering must separately opt in with
  `--allow-supplemental-two-lang-evidence true`; use
  `--required-evidence-gate kaikki_raw_two_lang` for an isolated pool. Exact
  normalized headword, source language, trusted source key, usable English
  gloss, and a shared meaning token are all required.
- After excluding 6,219 historical source IDs, the new gate found 3,553 eligible
  rows: 3,548 Japanese and 5 Portuguese. A controlled 20-row reviewer input is
  `logs/product-coverage-gaps-v83-kaikki-raw-two-lang-dryrun-20.json` (15 JA / 5
  PT). It has not been sent to an LLM yet.
- The 20-row review was subsequently run across ports 11441/11444/11448/11447.
  All four nodes loaded successfully and returned 20/20 valid accepts with no
  transport or parse failures. A short local command timeout interrupted after
  three rows; `--resume true` correctly reused those rows and completed 20/20.
- The first generation comparison exposed two validator problems. The evidence
  reviewer had invented target-language preferred terms unsupported by Kaikki,
  and the English gloss parser reduced `one's post` to `one`. Kaikki-approved
  reports now bind only the exact source term; English remains a semantic anchor,
  and leading possessive gloss wrappers are removed before token comparison.
- The model-based IPA reviewer produced demonstrably false rejects, including
  treating Portuguese `nh=/ɲ/`, `ç=/s/`, and English `initials /ɪˈnɪʃəlz/` as
  errors. Do not use that reviewer as an authoritative gate for this path;
  deterministic ECDICT/Kaikki pronunciation evidence remains valid.
- After these fixes, the no-write generation dry-run skipped three already-linked
  rows and accepted 12/17 new generations (70.6%). Five rejects remained: two
  Japanese reading/JMdict gates, two quality-review rejects, and one source
  evidence rejection. This is below the expansion threshold, so no draft or
  product rows were written and the batch must not be enlarged yet.
- The five remaining generation rejects were confirmed valid rejections, not
  validator bugs: wrong `最期` reading (`さいき` instead of `さいご`), a Japanese
  phrase absent from JMdict, an `embutido` sense drift from `embedded` to
  `sausage`, a Japanese-to-Chinese same-character false friend for `部署`, and
  the ambiguous physical-pocket treatment of `懐中`.
- Reverse dictionaries fully supported only three of the 12 generated rows.
  Independent Gemma 4 31B review accepted `持ち場` and `訛り`, and correctly
  rejected `主催`: English `sponsorship`/Portuguese `patrocínio` imply funding,
  while Japanese `主催` means hosting or organizing.
- The two final rows passed validation-copy replay, semantic-checkpoint mapping,
  dry-run/apply promotion, fast audit, published-risk audit, native D1 export,
  and full in-memory import audit. They were then promoted to the main local DB
  after a SHA-256-verified backup. Current publishable counts are 29,089 entries,
  34,606 senses, and 138,424 localizations; all blockers and risk flags are zero.
  Production D1 was not changed.
- Backup retained:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki2-20260802.db`,
  SHA-256 `F653307024E87528CFD59D3CD756ACCC2DAFF7AB438BFCE990F26ACF648417B2`.

### Second Kaikki evidence batch (local only, 2026-08-02)

- Rebuilt the attempt index with 6,235 prior source-entry IDs, regenerated the
  gap report against the current main DB, and selected a non-overlapping 20-row
  Japanese batch from the `kaikki_raw_two_lang` gate.
- Four-node Qwen evidence review accepted 20/20. Generation skipped three
  already-linked rows and accepted 14/17, with zero network or JSON failures.
  Reverse evidence reduced those 14 to 5 supported, 8 manual, and 1 unsupported.
- `--include-supported true` means include supported rows in the normal review
  set; it does not mean supported-only. The consensus script now has mutually
  exclusive `--only-supported true`. Do not promote from the earlier mixed
  five-row report.
- Correct supported-only Gemma review accepted `強調`, `感度`, `特性`, `母校`, and
  `童貞`. All five passed isolated replay, promotion, fast and published-risk
  audits, native export, and full in-memory import before exact main-DB replay.
- Current local publishable counts are 29,094 entries, 34,611 senses, and
  138,444 localizations. `flagged_senses=0`; all export blockers are zero. The
  existing 98 duplicate-localization warnings remain non-blocking. Production
  D1 is still v83 and was not changed.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki5-20260802-223852.db`,
  SHA-256 `8A4B75241F3BD7375A75476866B76868F17714EB976A85A33E9AD9C243CBB35A`.
  Current main DB SHA-256 is
  `D0CE78FAF2D752B23A8FF0F153B6F369D5F87018BFD307781E111EFA53D7D004`.

### Third Kaikki evidence batch (local only, 2026-08-02)

- The attempt index previously omitted `skipped_preview` rows. This caused
  source entries already marked `already_linked_complete_source_gap` to occupy
  slots in later batches. The indexer now excludes exactly that skip reason;
  it still does not exclude selected rows that were never attempted.
- The corrected third batch contained 20 new Japanese source entries. Qwen
  evidence review accepted 20/20 and generation accepted 17/20 with zero
  transport or JSON failures. Reverse evidence classified the valid rows as
  8 supported, 5 manual, and 4 unsupported.
- Supported-only Gemma review accepted seven rows: `平方`, `アクセル`, `気圧`,
  `空白`, `痙攣`, `実質`, and `食卓`. It correctly rejected `気球` because the
  Japanese definition called a balloon a fixed-wing `飛行機`.
- All seven passed isolated replay and promotion, fast and published-risk
  audits, native export, and full in-memory import before exact main-DB replay.
  Current local publishable counts are 29,101 entries, 34,618 senses, and
  138,472 localizations. All blockers remain zero; production D1 is unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki7-20260802-225336.db`,
  SHA-256 `D0CE78FAF2D752B23A8FF0F153B6F369D5F87018BFD307781E111EFA53D7D004`.
  Current main DB SHA-256 is
  `4829D1EBF497F312C78A5E4E79E056B0BFCC28E6991AB20DA902A7FEE2B11EAA`.

### Kaikki 100-row pressure batch (local only, 2026-08-02)

- Evidence review produced 96 accepts, 3 justified rejects, and one repeated
  malformed-JSON failure routed to manual review. Generation then accepted
  68/96 (70.8%) with zero infrastructure failures. This is below the 90%
  large-scale generation gate, so do not expand this pool directly to 500.
- Generation rejection leaders were `ja_reading_mismatch=13`, quality-review
  reject/failure=11, and English term/gloss mismatch=4. The next optimization
  should improve candidate/readings alignment rather than weaken validators.
- Reverse evidence classified 31 supported, 25 manual, and 12 unsupported.
  Independent Gemma review accepted 25/31, yielding 25 publishable candidates
  from the original 100-row pool.
- All 25 passed isolated replay/promotion, fast audit, published-risk audit,
  native export, and full in-memory import before exact main-DB replay. Current
  local counts are 29,126 entries, 34,643 senses, and 138,572 localizations;
  all blockers are zero. Production D1 remains unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki25-20260802-230653.db`,
  SHA-256 `4829D1EBF497F312C78A5E4E79E056B0BFCC28E6991AB20DA902A7FEE2B11EAA`.
  Current main DB SHA-256 is
  `89D30D033633155AF409006E9B9DA92549108A0B81437BBF2F8C927276CC3ACD`.

### Deterministic JMdict reading repair (local only, 2026-08-02)

- The supplement pipeline now replaces a generated Japanese reading only when
  an exact JMdict headword lookup has exactly one reading. The localization is
  tagged `reading_source=deterministic:jmdict-unique`. Entries with multiple
  JMdict readings remain under the existing validator; the pipeline must not
  guess among them.
- Replaying the 13 reading-related failures from the 100-row pressure batch
  raised generation validity to 9/13 and reduced `ja_reading_mismatch` from 13
  rows to one (`年月`, which has multiple valid readings). This is a targeted
  repair result, not evidence that the full candidate class has reached the
  90% expansion gate.
- Reverse evidence supported only `近辺` and `登山`; independent Gemma 4 31B
  review accepted both. They passed isolated replay, dry-run/apply promotion,
  fast audit, published-risk audit, native D1 export, and full in-memory import
  before exact main-DB replay.
- Current local publishable counts are 29,128 entries, 34,645 senses, and
  138,580 localizations. All release blockers and `flagged_senses` remain zero;
  the 98 duplicate-localization warnings remain non-blocking. Production D1
  remains v83 and was not changed.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-reading2-20260802-231412.db`,
  SHA-256 `89D30D033633155AF409006E9B9DA92549108A0B81437BBF2F8C927276CC3ACD`.

### Pressure-batch quality and English-anchor retry (local only, 2026-08-02)

- Added `build-dictionary-v2-product-source-gap-retry-report.mjs` so a retry
  report keeps the previous validation errors, QA reason, and generated ZH/JA
  terms/readings. Do not retry from the original candidate report because that
  silently drops the context used by the specialized retry prompt.
- The 15 quality/English-anchor failures regenerated to 9 valid rows with zero
  infrastructure failures. A targeted second pass recovered `書面` and `増大`,
  for 11 structurally valid rows in total. Three remaining rows were confirmed
  semantic/POS mismatches; `私有` returned malformed QA JSON even after a
  cross-node format retry and remains manual review.
- English anchor validation now includes comma/semicolon alternatives from the
  same exact Kaikki evidence gloss. This correctly recognizes `increase` and
  `enlargement` for `増大`; it does not accept model-invented synonyms or the
  separate `nail polish` sense for a `manicure` anchor.
- Quality-review JSON format errors retry once through another endpoint. A
  semantic reject is never retried or overridden. If the alternate endpoint is
  also malformed, the row remains `quality_review_failed`/manual.
- The reverse-evidence CLI uses `--report`, not `--generation`. Unknown options
  are currently ignored, so using `--generation` reads the default report and
  can produce plausible but unrelated counts. Always verify `generation_rows`
  and `generation_report` in the output before continuing.
- Reverse evidence supported only `不平`, `クリプトン`, and `今宵`; Gemma 4 31B
  independently accepted all three. They passed isolated and main-DB replay,
  promotion, fast/risk audits, native export, and full in-memory import.
- Current local publishable counts are 29,131 entries, 34,648 senses, and
  138,592 localizations. All release blockers and `flagged_senses` are zero;
  production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-quality3-20260802-232356.db`,
  SHA-256 `4336D207033508CB9613B540D35752D297592A5BFCC897DFBC0D70B99FBA1139`.

### Kaikki batch 5 quality-gated expansion (local only, 2026-08-02)

- The historical-attempt index now also excludes candidates whose source
  evidence review exhausted retries with `valid=false`. This prevents malformed
  rows such as `飢餓` from reappearing in every regenerated pool.
- The coverage filter now rejects capitalized `Name (Location)` glosses for
  Katakana headwords. This removes obvious proper-place rows such as Kabul
  without weakening normal Japanese common-noun coverage.
- The clean 100-row Japanese batch had no historical overlap, mojibake, or HTML
  artifacts. Source evidence review approved 94/100 with zero model failures.
  Four-language generation accepted 86/94 (91.5%) with zero infrastructure
  failures across the four Qwen endpoints. This is the first large candidate
  batch to pass the 90% generation-validity gate.
- Passing generation validation is not sufficient for publication. Reverse
  dictionary evidence supported 22/86 generated rows, and independent Gemma 4
  31B review accepted 21/22. The rejected `引き渡し` remains unpublished.
- The 21 consensus rows passed isolated replay, semantic review, deterministic
  promotion, fast audit, published-risk audit, native export, and full
  in-memory import before exact main-DB replay. Current local publishable counts
  are 29,152 entries, 34,669 senses, and 138,676 localizations. All release
  blockers and `flagged_senses` are zero; the existing 98 duplicate-localization
  warnings remain non-blocking. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch5-20260802-234007.db`,
  SHA-256 `45F531B2748D0438772F1FB8D74559BA94F05FA785F70450D20EEBDA403BE9BC`.
  Current main DB SHA-256 is
  `0F854E838DA1E644B9FEC35DF367AD8AACA1221D5F7F7B221065A8E8D71046E7`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch5-main`. This is a local
  validation artifact only and must not be pushed to D1 without a separate
  release decision.

### Kaikki batch 6 500-row validation (local only, 2026-08-03)

- A fresh attempt index scanned 830 log files with zero parse failures and
  excluded 6,494 historical source entries. The clean pool contained 500
  non-overlapping Japanese Kaikki candidates.
- Source evidence review approved 469/500 and rejected 31, with zero format or
  infrastructure failures. Initial four-language generation accepted 420/469
  (89.55%). A single context-preserving retry of the 49 rejects recovered 26;
  the merged unique result was 446/469 (95.1%). The remaining 23 were not
  retried again.
- Added `merge-dictionary-v2-product-source-gap-generation-reports.mjs`. It
  merges generation attempts by `source_entry_id`, lets a later valid result
  replace a failure, and never lets a failed retry replace an earlier valid
  result. Use this before reverse-evidence validation when a batch has a
  specialized retry report.
- Reverse dictionaries supported 111/446, sent 185 to manual review, and
  rejected 150. Independent Gemma 4 31B accepted 100/111 and rejected 11 with
  zero failures. Only those 100 consensus rows were eligible for replay.
- The 100 rows passed byte-identical isolated DB replay, semantic mapping,
  promote dry-run/apply, published-risk audit, native export, fast audit, and
  full in-memory import before exact main-DB replay. Current local publishable
  counts are 29,252 entries, 34,769 senses, and 139,076 localizations. All
  blockers and `flagged_senses` are zero; the 98 duplicate-localization
  warnings remain non-blocking. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch6-20260803-001532.db`,
  SHA-256 `0F854E838DA1E644B9FEC35DF367AD8AACA1221D5F7F7B221065A8E8D71046E7`.
  Current main DB SHA-256 is
  `0C41825E58ECA62625B98E12E8E45248309E2C5CDC2A5C0AA7C700C0CDA6C429`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch6-main`. It is local
  only. Do not push it to D1 without a separate release decision.

### Kaikki batch 7 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 850 files with zero parse failures and
  excluded 6,995 historical source entries. The clean pool contained 500 new
  Japanese Kaikki candidates in frequency ranks 16,410-19,861.
- Source evidence review approved 476/500 and rejected 24. Four-language Qwen
  generation accepted 428/476 on the first pass (89.9%). One contextual retry
  on the 48 rejects recovered 22, producing 450/476 unique valid generations
  (94.5%). The remaining 26 stay rejected/manual and were not retried again.
- Endpoint `100.99.99.99:11448` timed out twice and correctly opened its circuit
  breaker. The scheduler reassigned pending work, so no candidate was lost.
  Retry work used only `11441`, `11444`, and `11447`. Do not restore a tripped
  endpoint inside the same batch without a fresh smoke test.
- Reverse dictionaries supported 93/450, routed 212 to manual review, and
  rejected 145. Independent Gemma 4 31B accepted 77/93 and rejected 16 with
  zero model or infrastructure failures. Only the 77 consensus rows were
  eligible for replay.
- The 77 rows passed byte-identical isolated replay, semantic review, promote
  dry-run/apply, published-risk audit, fast audit, native export, and full
  in-memory import before exact main-DB replay. Current local publishable counts
  are 29,329 entries, 34,846 senses, and 139,384 sense localizations. The main
  DB also contains non-publishable historical draft/review rows, so fast-audit
  raw table counts (30,102/35,654/142,608) must not be reported as release
  counts. All blockers and `flagged_senses` are zero; the 98 duplicate-
  localization warnings remain non-blocking. Production D1 remains v83 and
  unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch7-20260803-004639.db`,
  SHA-256 `0C41825E58ECA62625B98E12E8E45248309E2C5CDC2A5C0AA7C700C0CDA6C429`.
  Current main DB SHA-256 is
  `5593F541B94D5186B3AD0F0473F4C0BA166A3B8B86C84C8525081FEED0EF2F81`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch7-main`. It is local
  only. Do not push it to D1 without a separate release decision.

### Kaikki batch 8 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 870 files, found 186 generation reports
  and ten checkpoints, and excluded 7,494 historical source IDs with zero parse
  failures. The clean pool contains 500 new Japanese Kaikki candidates in
  frequency ranks 20,265-23,040; another 2,292 Japanese rows remain eligible
  under the same evidence gate.
- Endpoint `11448` still returned model status/listing but timed out on a short
  inference after 120 seconds. It was excluded before the batch. Source review
  and generation used `11441`, `11444`, and `11447`; all three completed with
  zero infrastructure failures.
- Source review initially produced 432 approvals, 49 semantic rejects, and 19
  malformed/truncated JSON results. One bounded retry with a 420-token output
  limit recovered 16 valid decisions. Final review totals were 434 approved,
  63 rejected, and three failed/manual.
- Four-language generation accepted 396/434 (91.24%), meeting the 90% gate
  without a relaxed retry. Reverse dictionaries supported 88, routed 188 to
  manual review, and rejected 120. Independent Gemma 4 31B accepted 82/88 and
  rejected six with zero failures.
- Only the 82 independent-consensus rows were replayed. They passed a byte-
  identical isolated DB copy, semantic mapping, promote dry-run/apply,
  published-risk audit, fast audit, native export, and full in-memory import,
  followed by exact main-DB replay and the same final audits.
- Current local publishable counts are 29,411 entries, 34,928 senses, and
  139,712 sense localizations. All release blockers and `flagged_senses` are
  zero; the 98 duplicate-localization warnings remain non-blocking. Production
  D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch8-20260803-011625.db`,
  SHA-256 `5593F541B94D5186B3AD0F0473F4C0BA166A3B8B86C84C8525081FEED0EF2F81`.
  Current main DB SHA-256 is
  `5BFDF170A84F27058E54EE97219164872C12F56752F48AC0E035F94660C7BF20`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch8-main`. It is local
  only. Do not push it to D1 without a separate release decision.
- CLI notes: `--lang-targets` uses `lang=count` pairs, not `lang:count`; omit
  `--source-langs` to mean all languages because the literal value `all` is
  invalid. PowerShell 5.1 does not support `Set-Content -Encoding utf8NoBOM`;
  use `UTF8` for ignored runtime logs or a Node writer when exact UTF-8 without
  BOM is required.

### Kaikki batch 9 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 887 files, found 189 generation reports
  and ten checkpoints, and excluded 7,994 historical source IDs with zero parse
  failures. The clean pool contained 500 new Japanese candidates in frequency
  ranks 23,651-27,519; 1,798 Japanese rows were eligible before selecting this
  batch.
- Source review initially approved 400, rejected 86, and returned 14 invalid
  results. One bounded retry recovered six decisions, leaving final totals of
  402 approved, 90 rejected, and eight failed/manual. Four-language generation
  accepted 370/402 (92.04%) with zero infrastructure failures.
- Qwen generation used only `11441`, `11444`, and `11447`; each endpoint had
  zero failed calls. Endpoint `11448` remains excluded after the earlier
  inference timeout and must pass a fresh smoke test before rejoining a batch.
- Reverse dictionaries supported 85/370, routed 178 to manual review, and
  rejected 107. Independent Gemma 4 31B accepted 71/85 and rejected 14 with
  zero failures. Only those 71 independent-consensus rows were replayed.
- The 71 rows passed byte-identical isolated replay, semantic mapping, promote
  dry-run/apply, published-risk audit, fast audit, native export, and full
  in-memory import before exact main-DB replay. Current local publishable counts
  are 29,482 entries, 34,999 senses, and 139,996 sense localizations. All
  release blockers and `flagged_senses` are zero; the 98 duplicate-localization
  warnings remain non-blocking. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch9-20260803-014019.db`,
  SHA-256 `5BFDF170A84F27058E54EE97219164872C12F56752F48AC0E035F94660C7BF20`.
  Current main DB SHA-256 is
  `F958BA9F5101F2571FF358C1D1CD5471888211BA82A9232E1E652C6B80E926C7`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch9-main`. It is local
  only. Do not push it to D1 without a separate release decision.

### Kaikki batch 10 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 904 files, found 192 generation reports
  and ten checkpoints, and excluded 8,494 historical source IDs with zero parse
  failures. The clean pool contained 492 Japanese and eight Portuguese
  candidates; 1,313 rows remained eligible before selecting this batch.
- Source evidence review was fully structured: 500/500 valid, 479 approved, 21
  rejected, and zero failures. The first four-language generation pass accepted
  425/479 (88.73%), below the 90% gate, so the pipeline correctly stopped before
  reverse evidence or database writes.
- Failure analysis found the quality-review LLM incorrectly rejecting readings
  already validated by deterministic JMdict/pinyin evidence, including
  `突風=とっぷう`. The supplement script now labels locked reading evidence and
  ignores a reviewer rejection only when every cited error concerns a reading
  with `deterministic:*` provenance. Term, definition, sense, and unknown-reading
  errors remain blocking. An eight-row mixed regression retained real semantic
  rejects such as `paraquedismo`, `privativo`, and `比べ物`.
- Only the 54 failed rows were retried after the fix; 31 recovered. Merging by
  source ID produced 456/479 unique valid generations (95.20%), 23 rejects, and
  zero infrastructure rejects. Reverse dictionaries supported 97, routed 239
  to manual review, and rejected 120. Independent Gemma 4 31B accepted 84/97
  and rejected 13 with zero failures.
- Only those 84 consensus rows were replayed. They passed byte-identical
  isolated replay, semantic mapping, promote dry-run/apply, published-risk,
  fast audit, native export, and full in-memory import before exact main-DB
  replay. Current local publishable counts are 29,566 entries, 35,083 senses,
  and 140,332 sense localizations. All release blockers and `flagged_senses`
  are zero; the 98 duplicate-localization warnings remain non-blocking.
  Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch10-20260803-022012.db`,
  SHA-256 `F958BA9F5101F2571FF358C1D1CD5471888211BA82A9232E1E652C6B80E926C7`.
  Current main DB SHA-256 is
  `8BE56BAE972A5A3F17B33FF1651E3437F905D18810488F165D5B4009F9FBC83A`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch10-main`. It is local
  only. Do not push it to D1 without a separate release decision.

### Kaikki batch 11 500-row validation (local only, 2026-08-03)

- The refreshed attempt index scanned 925 files, found 199 generation reports
  and ten checkpoints, and indexed 8,994 historical source IDs with zero parse
  failures. The clean pool selected 499 Japanese and one Portuguese candidate;
  826 rows were eligible before selecting this batch.
- Source evidence review returned 500/500 structured results: 471 approved and
  29 rejected. Four-language generation accepted 433/471 (91.93%), above the
  90% gate, with zero infrastructure failures across `11441`, `11444`, and
  `11447`.
- Eighteen generation rows used the narrow deterministic-reading review
  override. This did not make them publishable: all accepted rows still passed
  the same reverse-dictionary and independent-model gates. Reverse evidence
  supported 87/433, routed 228 to manual review, and rejected 118. Independent
  Gemma 4 31B accepted 72/87 and rejected 15 with zero failures.
- Only those 72 consensus rows were replayed. They passed isolated semantic
  mapping, promote dry-run/apply, published-risk, native export, and full
  in-memory import before exact main-DB replay. Current local publishable counts
  are 29,638 entries, 35,155 senses, and 140,620 sense localizations. All
  release blockers and `flagged_senses` are zero; the 98 duplicate-localization
  warnings remain non-blocking. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch11-20260803-032044.db`,
  SHA-256 `8BE56BAE972A5A3F17B33FF1651E3437F905D18810488F165D5B4009F9FBC83A`.
  Current main DB SHA-256 is
  `62DE39B7F15CBFF2D6345E17722A9994E75D8646FF24ADF127379666541DF146`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch11-main`. It is local
  only. Do not push it to D1 without a separate release decision. Before the
  next rebuild, approximately 326 rows remained outside this batch under the
  current strict eligibility gate, so batch 12 will likely be smaller than 500.

### Kaikki batch 12 strict-pool closeout (local only, 2026-08-03)

- Refreshing the attempt index scanned 942 files, found 202 generation reports
  and ten checkpoints, and excluded 9,494 historical source IDs with zero parse
  failures. The rebuilt strict pool contained 334 rows: 333 Japanese and one
  Portuguese candidate.
- Source review was fully structured: 334/334 valid, 311 approved, 23 rejected,
  and zero failures. Four-language generation accepted 282/311 (90.68%), above
  the 90% gate, with zero infrastructure failures on `11441`, `11444`, and
  `11447`.
- Reverse dictionaries supported 40/282, routed 151 to manual review, and
  rejected 91. Independent Gemma 4 31B accepted 36/40 and rejected four with
  zero failures. Only the 36 consensus rows were replayed.
- The 36 rows passed byte-identical isolated replay, semantic mapping,
  deterministic promotion, published-risk, native export, and full in-memory
  import before exact main-DB replay. Current local publishable counts are
  29,674 entries, 35,191 senses, and 140,764 sense localizations. All release
  blockers and `flagged_senses` are zero; the 98 duplicate-localization groups
  remain a non-blocking warning. Production D1 remains v83 and unchanged.
- Main-DB backup:
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-kaikki-batch12-20260803-113928.db`,
  SHA-256 `62DE39B7F15CBFF2D6345E17722A9994E75D8646FF24ADF127379666541DF146`.
  Current main DB SHA-256 is
  `D03805370FA848EF72A94C8AB694046E370D5FE3F93E77550A6F98A94B7FEA36`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-kaikki-batch12-main`. It remains
  local only and must not be pushed without a separate release decision.
- A post-batch rebuild found only `帰省` and `異音`. Both passed source review
  and generation, but reverse evidence classified one as unsupported and one
  as manual review. Neither was written to the DB. Treat the current Kaikki raw
  two-language strict pool as exhausted; the next batch needs a new evidence
  tier or additional source data, not relaxed promotion gates.

### Canonical Tier C pilot after Kaikki closeout (local only, 2026-08-03)

- A complete rank-200,000 coverage scan found 440 canonical candidates with at
  least three entry-level languages but exactly two first-sense languages: 399
  pt-BR, 31 ja, and ten zh. A balanced pilot selected `zh=8`, `ja=6`, and
  `pt-BR=6`.
- Source review returned 20/20 structured decisions but approved only nine and
  rejected eleven. The candidate class is therefore much noisier than the
  exhausted Kaikki strict pool.
- Hard-enforcing reviewer preferred terms accepted only 1/9 generations. Seven
  of eight rejects were brittle `preferred_term_mismatch` checks involving
  synonyms, Traditional Chinese forms, or source variants. Re-running without
  that string constraint, while retaining quality review, deterministic
  readings/pronunciations, reverse evidence, and independent consensus,
  accepted 6/9.
- Reverse evidence supported three of the six. Independent Gemma accepted
  `neurocirurgia` and `やみ` and rejected `しごと`. Only the two consensus rows
  were replayed. They passed isolated and main semantic mapping, deterministic
  promotion, published-risk, and full in-memory export audits.
- Current local publishable counts are 29,676 entries, 35,193 senses, and
  140,772 sense localizations. `flagged_senses=0` and all release blockers are
  zero. The pre-pilot backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-canonical-tier-c-pilot-20260803-120855.db`
  with SHA-256
  `D03805370FA848EF72A94C8AB694046E370D5FE3F93E77550A6F98A94B7FEA36`.
  Current main DB SHA-256 is
  `BEF68E7DE37CDE8197153F39CBEE08CCE68310001717D2A4F0382ECB82B0CC7A`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-pilot-main`.
  Production remains v83 and unchanged. Do not scale the remaining 440-row
  class: its end-to-end pilot yield was only 2/20. First improve deterministic
  sense alignment and preferred-term normalization, then repeat a new 20-row
  pilot.

### Canonical Tier C preferred-term contract fix (local only, 2026-08-03)

- `review-dictionary-v2-product-source-gap-candidates-unsloth.mjs` now writes
  `preferred_term_policy=source_only_exact`. Only the source-language headword
  is a hard `preferred_terms` constraint. Target-language reviewer proposals
  are preserved as `suggested_terms`; reverse evidence and independent Gemma,
  rather than string equality, decide whether they are publishable.
- Replaying the same nine source-approved candidates against the pre-pilot DB
  improved generation validity from 1/9 to 8/9. There were no target-language
  `preferred_term_mismatch` false rejects.
- Reverse evidence supported four rows. Gemma accepted `neurocirurgia`, `やみ`,
  and `しごと`, and rejected `くるま`. Because the first two accepted rows were
  already published by the prior pilot, the exclusion-aware consensus replay
  wrote only `しごと`.
- `しごと` passed isolated semantic conversion, deterministic promotion,
  published-risk, and full in-memory export audits before exact main-DB replay.
  Final local counts are 29,677 entries, 35,194 senses, and 140,776 sense
  localizations. All release blockers and `flagged_senses` are zero; the 98
  duplicate-localization groups remain a non-blocking warning.
- The immediate pre-replay backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-source-only-contract-20260803-121733.db`
  with SHA-256
  `BEF68E7DE37CDE8197153F39CBEE08CCE68310001717D2A4F0382ECB82B0CC7A`.
  Current main DB SHA-256 is
  `DBAD5079655725902B65118D7ED1CF516BDEB19FE5EA5C79E3EAB3423592EB9F`.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-source-only-main`.
  Production D1 remains v83 and unchanged. Do not scale Tier C yet: source
  review still approved only 9/20. Implement deterministic candidate-sense
  alignment and run a new balanced 20-row pilot first.

### Deterministic candidate-sense alignment (local only, 2026-08-03)

- Added `scripts/align-dictionary-v2-product-source-gap-candidate-senses.mjs`
  and npm command `dict:v2:coverage:align-source-gap-senses`.
- The aligner inspects all clean senses for each candidate. A publishable
  candidate must have an exact source-language term and a unique best sense by
  clean language count, then confidence. Parallel bilingual senses are never
  merged merely because their entry covers several languages.
- Regression on the previous 20 rows selected only three. Two rows had an
  already complete aligned sense, and fifteen were ambiguous parallel-sense
  entries. On the full 440-row pool, 184 aligned, 119 were already complete,
  and 137 were ambiguous. The aligned set contains 182 pt-BR and two ja rows.
- Re-filtering for exactly three clean languages, while excluding the earlier
  review report, produced
  `logs/product-coverage-gaps-v83-post-kaikki-canonical-tier-c-sense-aligned-pilot20.json`:
  19 pt-BR rows and one ja row. There are no safe zh rows under this policy;
  do not force language balance by relaxing sense identity.
- `review-dictionary-v2-product-source-gap-candidates-unsloth.mjs` now accepts
  `--require-sense-alignment true`. With the flag, the new pilot passes prompt
  construction and the old 20-row first-sense report is rejected. The filter's
  exclusion reader also now recognizes `approved` and `reviews` arrays, so a
  source-review report excludes every reviewed ID rather than only top-level
  IDs.
- The Unsloth key is persisted locally in ignored `.env.local` as
  `UNSLOTH_API_KEY`. Load it into the process at runtime. `.gitignore` covers
  the file, `git check-ignore` confirms the rule, and reports do not contain
  the key.
- Remote source review on `11441` and `11447` completed 20/20 without network or
  JSON failures: 13 accepted and seven rejected. Generation accepted 9/13;
  reverse dictionaries supported three; independent Gemma 4 31B on `11445`
  accepted all three. The final rows were `exploradora`, `eletrodomésticos`,
  and `preventivo`.
- Isolated replay exposed a selection-order bug in
  `promote-dictionary-v2-product-source-gap-drafts.mjs`: SQL applied `LIMIT`
  before filtering by semantic-review sense IDs, so unrelated historical drafts
  were inspected. The script now expands the query when semantic review is
  present, filters to approved sense IDs, and only then applies the requested
  limit. The corrected isolated dry-run accepted exactly 3/3.
- All three passed isolated and main replay, deterministic promotion,
  published-risk, native export, and full in-memory audit. The pre-main backup
  is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-sense-aligned-pilot-20260803-132119.db`
  with SHA-256
  `DBAD5079655725902B65118D7ED1CF516BDEB19FE5EA5C79E3EAB3423592EB9F`.
  The current main DB has 29,680 entries, 35,197 senses, and 140,788 sense
  localizations; SHA-256 is
  `39D4E3D543B677D0E9087C6BBF68B5981C704DFAE62C152DE4B56F8ABF6F3B99`.
  `flagged_senses=0` and all release blockers are zero.
- Full audited export:
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-sense-aligned-main`.
  Production remains v83 and unchanged. End-to-end yield was only 3/20, so do
  not scale this Tier C pool yet.
- A follow-up prefiltered pilot used the aligned report directly with
  `validate-dictionary-v2-product-source-gap-reverse-evidence.mjs --input-mode
  aligned`. The 184-row aligned pool produced 44 supported, 125 manual, and 15
  unsupported rows before any LLM generation. From the first 20 supported
  rows, source review accepted 18; one previously reviewed row was subtracted,
  leaving 17 new generation inputs. Generation validated 12/17, reverse
  evidence retained eight, and independent Gemma 4 31B accepted all eight.
- The promoted rows are `valquíria`, `legalização`, `cantonês`, `troglodita`,
  `hipnotismo`, `coalhada`, `cesárea`, and `darwinismo`. They passed exact
  isolated replay and the same main-DB replay with 8/8 deterministic promotion.
  The pre-main backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-prefiltered-tier-c-pilot-20260803-133320.db`;
  its SHA-256 is
  `39D4E3D543B677D0E9087C6BBF68B5981C704DFAE62C152DE4B56F8ABF6F3B99`.
- Current local main counts are 29,688 entries, 35,205 senses, and 140,820
  sense localizations. SHA-256 is
  `170691083350484ED7C589C3306BF52859F20AD478528191DD29EA7DC82902C8`.
  `flagged_senses=0`; all release blockers are zero; the existing 98 duplicate
  localization warning groups remain non-blocking. The audited export is
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-prefiltered-main`.
  Production D1 remains v83 and was not changed.
- This prefilter improved source approval from 13/20 to 18/20 and final yield
  from 3/20 to 8/20. Do not jump directly to an unbounded run: first classify
  the five generation validation rejects, rebuild product-aware exclusions,
  and run a bounded 100-row test.
- Reject classification is complete. `tesouraria`, `dissuadir`, and
  `prussiano` were rejected by semantic quality review for Japanese sense or
  term errors. `centésima` and `escoliose` produced plausible rows but failed
  `ja_term_not_in_jmdict`; handle these through canonical-form/variant lookup,
  not by globally disabling JMdict validation.
- The JMdict fix is intentionally exact. `側弯症` and `脊柱側弯症` map to the
  canonical JMdict `彎` forms for reading lookup; `百分の一` has one verified
  compositional reading. A two-row remote retest proved `escoliose` now passes.
  `centésima` reached semantic review and was correctly rejected for ordinal vs
  fractional sense mismatch, demonstrating that the semantic gate remains
  active.
- Only 24 unused rows remained in the 44-row strong prefilter pool. Historical
  review subtraction removed four, leaving 20 genuinely new rows. Source review
  approved all 24 before deduplication; generation validated 15/20; reverse
  evidence supported seven; Gemma consensus accepted six and rejected `siso`.
  The promoted rows are `subsidiária`, `vidraça`, `fotogênico`, `estribo`,
  `taquigrafia`, and `escarlatina`.
- The byte-identical pre-main backup is
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-prefiltered-tier-c-remaining20-20260803-162243.db`
  with SHA-256
  `170691083350484ED7C589C3306BF52859F20AD478528191DD29EA7DC82902C8`.
  Current local counts are 29,694 entries, 35,211 senses, and 140,844
  localizations; SHA-256 is
  `90A25DE7E8E0F3875936740C4419F1A82728111D3C53EC2A26F59B65943AC1E9`.
  The full audited export is
  `outputs/d1-v2-product-native-export-v83-canonical-tier-c-prefiltered-remaining20-main`.
  All blockers and risk flags are zero; production D1 remains v83.
- The strong prefiltered Tier C pool is now exhausted. Do not fabricate a
  100-row batch from the 125 manual rows. Rebuild a larger sense-aligned pool
  with product-aware source-link exclusions, then apply the same reverse
  evidence threshold before another bounded run.
- The larger rebuild scanned ranked entries through 500,000 and produced
  70,175 raw gaps. Strict canonical filtering retained 758; product-aware
  alignment retained 503. `align-dictionary-v2-product-source-gap-candidate-senses.mjs`
  now removes accepted-product-linked source senses before choosing a unique
  best sense. This is sense-level exclusion, not whole-entry exclusion.
- The first expanded reverse pass selected 377 rows. A balanced 100-row review
  (`en=4, pt-BR=46, zh=20, ja=30`) accepted only 66; generation validated
  42/66, and final reverse evidence supported only four. There were no network
  or JSON failures. The problem is source semantics, especially WikDict
  homographs and weak Chinese/Japanese headwords. Nothing was written.
- `validate-dictionary-v2-product-source-gap-reverse-evidence.mjs` now supports
  `--require-source-reverse-evidence true`. It also groups both directions of
  WikDict into one evidence family, so `wikdict-zh-en + wikdict-en-zh` no longer
  counts as two independent sources. The strict pool contained 13 rows, with
  11 new after excluding the reviewed 100.
- The strict 11-row experiment had source review 11/11 and merged generation
  10/11, but final four-language reverse evidence supported only
  `desenvolvedor`; five were unsupported and four manual. Gemma 4 31B reviewed
  all ten and accepted eight, but only `desenvolvedor` was in the safe
  intersection of deterministic support and independent-model acceptance.
  That singleton was replayed to `draft_single_source`, passed promote dry-run,
  and was promoted. Never use the broader eight-row model-consensus report for
  automatic promotion.
- The JMdict reading validator now accepts productive suffixes `化`, `患者`,
  and `可能な` only when the exact base exists in JMdict. Remote retest proved
  `瘢痕化` and `心気症患者` valid; independent semantic review still rejected
  `認識可能な`, so the rule does not bypass semantic quality checks.
- Current publishable export is 29,696 entries, 35,213 senses, and 140,852
  localizations. The current product DB SHA-256 is
  `14B895D68FBA1F1F2E98E7245F0452B97C34A77B6A758A4EC302BBAA4D201462`.
  The pre-promotion backup is
  `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-desenvolvedor-20260803.db`.
  Production remains v83; this one-row local update was not deployed. The next
  viable scale improvement is better
  independent Chinese/Japanese lexical evidence or model-assisted candidate
  repair before generation, not a wider frequency window.
- A bounded derivational matcher now recognizes English morphological pairs
  such as authenticate/authentication, deactivate/deactivation,
  menstruate/menstruation, and mitochondrial/mitochondrion. Revalidation moved
  `autenticar`, `menstruar`, and `mitocondrial` from false `unsupported` results
  to `manual_review`, but no additional row became fully supported. Keep those
  rows in residual review until the missing target-language evidence exists.
- Treat Kaikki and WikDict as one `wiktionary` evidence family. `kaikki-ja` is
  now usable as strong reverse evidence, but cannot independently corroborate
  WikDict. With JMdict plus this family, CC-CEDICT Chinese evidence, and Gemma
  acceptance, `autenticar` passed the strict intersection and was promoted.
  Its pre-promotion backup is
  `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-autenticar-20260803.db`.

## 2026-08-03 final large-scale gate

- The historical retrospective inspected all 9,087 accepted
  `source_gap_unsloth` senses under legacy and current evidence-family rules.
  Collapsing Kaikki and WikDict into one `wiktionary` family identified exactly
  111 formerly supported senses that now require manual review. All 111 were
  resolved by the generic publication-block tool and removed from publishing.
- The byte-identical backup is
  `data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.before-evidence-family-regression-blocks-20260803.db`
  with SHA-256
  `14B895D68FBA1F1F2E98E7245F0452B97C34A77B6A758A4EC302BBAA4D201462`.
  The current DB SHA-256 is
  `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`.
- Full isolated export/import audit passes with 29,586 entries, 35,102 senses,
  and 140,408 localizations. All blockers and `flagged_senses` are zero; the 98
  duplicate-localization groups remain a non-blocking warning. Production D1
  remains v83 and was not changed.
- The first 100-row rebuild exposed two discovery bugs rather than true source
  exhaustion. The prefilter did not count a unique aligned OMW synset as an
  independent family, and filtering before sense alignment discarded useful
  later senses. The corrected sense-first flow aligned 20,103 raw gaps,
  retained 9,285 clean rows, and found 2,280 rows supported by at least two
  independent families.
- A balanced `zh=30, ja=30, pt-BR=25, en=15` gate produced 91/100 valid source
  approvals with no transport or JSON failures. Qwen generation accepted 78/91
  initially; one bounded retry of the eight non-semantic rejects recovered two,
  for 80/91 (87.9%). Five semantic quality rejects were correctly preserved.
  Because generation remained below the required 90%, deterministic reverse
  validation, Gemma consensus, and the 500/2,000/5,000 stages were not run.
- A second fresh 100-row test required deterministic JMdict target terms and
  Portuguese pronunciation before review. Source review passed 92/100 and
  generation passed 84/92 (91.3%) with zero infrastructure failures. The next
  deterministic reverse gate failed at 22/84 (26.2%): Portuguese generated
  targets were usually supported only by the Wiktionary family. No Gemma call
  or database write followed.
- Requiring at least two same-synset OMW target languages plus JMdict and
  Portuguese pronunciation leaves 183 candidates, all English-source; 163 are
  fresh after subtracting both reviewed 100-row batches. This is useful for an
  English-lane test but cannot qualify balanced four-language production.
  Scaling remains blocked on independent reverse evidence for non-English
  source lanes, not on network stability or JSON formatting.

### Wordfreq-expanded final 100-row gate (local only, 2026-08-03)

- `scripts/export-wordfreq-lists.py` exported wordfreq 3.1.1 ranked lists from
  an isolated environment on a6000-143. `rank-dictionary-v2-frequency.mjs`
  then filled only NULL ranks, preserving the existing FrequencyWords ranks.
  The pre-update rank backup is
  `logs/linguago-v2-frequency-ranks-before-wordfreq-expansion-20260803.json`.
- The expanded source DB contains 134,584 ranked English entries, 102,173
  Chinese, 69,452 Japanese, and 36,175 Portuguese. The sense-first pipeline
  produced 268,101 raw gaps, 56,515 aligned rows, 30,543 clean rows, 238 strict
  cross-family candidates, and 144 candidates fresh against prior reviews.
- The first 100 source reviews passed at 91/100. Blindly binding the first term
  from any two-family hint reduced generation from 79/91 to 70/91 and exposed
  homograph errors such as `疾步=fasting` and `口香糖=gingiva`. Do not restore
  that policy. A target term is now binding only when independent lexical
  evidence and the source reviewer select the same normalized form; the exact
  source-language term remains binding.
- A third source review approved 90/100. Merging two earlier valid runs and one
  bounded ten-row retry produced 81/90 valid generations (90.0%). The merge
  tool now accepts `--allowed-report`, so stale valid rows cannot bypass the
  latest source-review whitelist.
- Deterministic reverse evidence supported 76/81, routed three to manual
  review, and rejected two. The remaining 44 fresh rows were used only as a
  bounded replacement pool: 41 source-approved, 34 generation-valid, and 32
  reverse-supported.
- Independent Gemma 4 31B consensus accepted 70/75 valid original reviews and
  27/32 replacement reviews, for 97/107 (90.7%) no-correction acceptance and
  97 final safe candidates per the original 100-row gate. One repeatedly
  malformed `polygyny` review remains failed/manual and was not accepted.
- The final 100-row gate therefore passes. No draft or product row was written,
  and production D1 remains v83. Before the 500-row write/resume gate, rebuild
  a new strict candidate pool; all 144 rows in this fresh pool have now been
  reviewed, so they must not be recycled as a nominal 500-row batch.

### Wordfreq 500-row checkpoint gate, part 1 (local only, 2026-08-03)

- Rebuilding the v83 attempt index scanned 1,152 reports, found 257 generation
  reports and ten checkpoints, and excluded 10,896 genuinely attempted source
  IDs with zero parse failures. A target-two-language prefilter retained 1,468
  candidates; historical subtraction left 1,057 fresh rows.
- The 500-row review input is intentionally evidence-limited rather than
  nominally balanced: `en=231`, `ja=150`, `pt-BR=106`, `zh=13`. It contains no
  duplicate source IDs, ends at frequency rank 50,035, and preserves the source
  two-family, Portuguese pronunciation, and JMdict requirements. Do not claim
  the planned 30/30/25/15 mix when the strict Chinese lane has only 13 rows.
- Source review passed: 474/500 approved, 26 rejected, zero manual/failed rows,
  and zero endpoint failures. A byte-identical validation DB was created from
  main SHA-256 `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`.
- The first 100 approved rows were written in two 50-row transactions using
  `product-source-gap-v83-wordfreq200k-scale500-generation.checkpoint.json`.
  Checkpoint and DB reconciliation is exact: 83 accepted source IDs map to 83
  draft entries/senses and 332 four-language localizations, all with
  `needs_review=1`; untracked rows are zero and SQLite integrity is `ok`.
- Generation was only 83/100, below the 90% gate, so the remaining 374 rows were
  not resumed. There were no transport failures. Of 17 rejects, 15 came from
  the same-family Qwen quality reviewer, one was malformed review JSON, and one
  failed JMdict lookup.
- Several Qwen review rejects are demonstrably unreliable (`はちどり` was
  called a dragonfly, `臭化物` was called a nonstandard bromide term, and
  `消印` was denied as a postmark). Do not globally auto-accept them. The next
  change should route disputes about independently bound target terms past the
  same-model veto into deterministic reverse evidence plus independent Gemma
  consensus. Unbound semantic mismatches remain blocking.
- Validation published-risk remains `flagged_senses=0`; the main product DB is
  unchanged and production D1 remains v83.

### Wordfreq 500-row checkpoint gate, bounded retry result (local only, 2026-08-03)

- The supplement CLI now has an opt-in
  `--defer-evidence-bound-quality-rejects true` mode. It defers only same-model
  objections to a non-source term or reading that was already bound by
  reviewed independent lexical evidence. Structural errors, source-term drift,
  missing fields, definitions, IPA, and unbound terms remain blocking. The
  default is `false`.
- Retrying only the original 17 failures recovered nine rows. The merged first
  100 report therefore contains 92 generation-valid rows and eight rejects,
  with no endpoint failures. The isolated validation DB contains 92 draft
  entries/senses and 368 review localizations; none are publishable.
- Deterministic four-language reverse validation supported only 51/92 rows,
  routed 37 to manual review, and rejected four. Relative to the original batch,
  the maximum safe yield before Gemma is therefore 51/100, far below the 80/100
  promote gate.
- The 41 non-supported rows are primarily a source-coverage problem: 14
  Portuguese and 14 Chinese terms have Wiktionary-family-only evidence; seven
  Chinese terms have no reverse evidence; four rows have strong-gloss conflicts;
  four terms have OMW-only evidence; and the remaining cases are no-evidence or
  low-match/polysemy cases. Japanese and English are not the bottleneck.
- Do not send this batch to Gemma and do not resume the remaining 374 reviewed
  candidates. Gemma consensus is not an independent dictionary source and
  cannot repair the missing Portuguese/Chinese lexical evidence. Rebuild the
  pool only after adding independent pt-BR/zh reverse coverage or deterministic
  candidate-specific target-term evidence that passes the unchanged reverse
  gate.
- Main product DB SHA-256 remains
  `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`;
  production D1 remains v83.

### New Open WordNet coverage probe (local only, 2026-08-03)

- `kaikki-pt` is already supported by the source importer, but it must not be
  counted as an independent family: Kaikki and WikDict are both Wiktionary
  derivatives. Adding it to reverse validation would not fix the 14 Portuguese
  `wiktionary_only_evidence` residuals.
- The historical PanLex API hostname currently fails DNS resolution. Do not
  add it as a runtime or batch dependency. PanLex remains a possible offline
  source only if individual source-group provenance is retained; treating the
  whole aggregation as one independent dictionary is unsafe.
- An isolated `wn` 1.1.0 probe downloaded `own-pt:1.0.0`, `omw-cmn:2.0`, and
  their `omw-en:2.0` dependency under `.tmp/wn-data`. The reproducible probe is
  `scripts/probe-open-wordnet-source-gap-residuals.py`; it is diagnostic only.
- Of 45 non-supported pt-BR/zh localizations, the newer wordnets contained ten
  exact target terms and only seven had a directly matching English lemma:
  pt-BR 3/18 and zh 4/27. Examples include `hidratação -> hydration`,
  `interdisciplinar -> interdisciplinary`, and `摄食过度 -> bulimia`.
  Conflicting rows such as `ligadura` remain blocked.
- This coverage gain is too small to rescue the target-two-language 100-row
  gate. Do not resume generation. A viable next pool still needs substantially
  broader independent pt-BR/English and zh/English lexical evidence with
  source-level provenance.

### Final 500-row validation status (local only, 2026-08-03)

- The 500k frequency scan and repaired target-language counter produced 395
  strict all-target/two-family candidates. The old counter excluded English and
  accidentally made `min-target-langs=3` impossible for zh/ja/pt-BR sources.
- A fresh strict batch yielded 230 source-approved, 213 generation-valid, 177
  deterministic-supported, and 165 final Gemma-accepted unique rows after one
  bounded correction pass. Qwen endpoint failures were zero.
- Prior deterministic-supported generation was intersected with the repaired
  all-target pool before reuse. It added 176 unique Gemma-accepted rows. A fresh
  all-target-hint batch added another 82. Together with the earlier 97-row gate,
  the verified union is 520 unique source entry IDs with no overlap.
- A romanized group-key collision attached `気筒` to the existing `祈とう`
  entry because both normalized to `kitou`. The writer now verifies the actual
  headword/language and uses a source-ID-suffixed key on collision. Keep this
  check enabled for all CJK production writes.
- The isolated strict DB promoted 165 rows and passed fast audit, published-risk,
  native export, and full in-memory import audit with every blocker at zero.
  The main DB hash remains
  `9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`;
  production D1 remains v83.
- The composite 500 quality/checkpoint gate is complete. The 2,000-row pressure
  gate is not ready because the remaining broad all-target-hint pool achieved
  only 91/184 (49.5%) deterministic support. Add independent pt-BR and zh
  reverse evidence before spending more Qwen/Gemma compute on that lane.

### Current 2,000-row readiness after evidence expansion (2026-08-03)

Production-safe supplemental families have now been tested and kept separate:
Open WordNet (`omw`), word2word top-3 (`corpus_word2word`), Apertium Spanish
pivots (`apertium`), and exact Wikidata labels (`wikidata`). MUSE is
non-commercial research data and is excluded. PanLex is not a live dependency.

The combined strict pool contains 1,324 fresh candidates. Adding the completed
520 unique safe rows gives 1,844 strict rows. The remaining 156 rows needed for
a 2,000-row sustained infrastructure test must come from a separate
target-two-language tier and carry `no-promote`; they cannot be included in the
publishable quality denominator. Production D1 and the main product DB remain
unchanged. Main DB SHA-256 remains
`9C262653535DCA91892CBE777511A3C9781EA1AFE6EE821955BD9B77CC90C625`.

Use `scripts/export-wikidata-generation-evidence.mjs` with
`--search-mode sparql --import-all-labels true --sparql-aliases false`.
Action API alias lookup and SPARQL aliases are too slow for bulk prefiltering.
Merge evidence with `scripts/merge-supplemental-evidence-dbs.mjs`, then rerun
the unchanged family-aware prefilter. Never count the three Apertium pair repos
as separate evidence families.

### Latest large-scale gate status (2026-08-03)

The pipeline is still before the 500-row write gate. Sense-exact subtraction
leaves 1,576 fresh all-target-independent candidates, but two formal 100-row
attempts failed Gemma's >=90% no-correction gate: 66/80 and 64/90. Qwen source
review, generation, deterministic reverse evidence, and all four Qwen endpoints
passed their respective thresholds. Do not write these rows to the main DB.
Use exact `entry:sense` keys, `--require-hint-semantic-alignment true`,
`--enforce-generation-hint-terms true`, and entry-unique selection. Main DB and
production D1 remain unchanged.

### Bounded correction diagnostic (local only, 2026-08-03)

- Consensus retry/replay/draft-conversion scripts now use exact
  `source_entry_id:source_sense_id` keys. The original report replayed 64
  accepted reviews to exactly 64 generated senses.
- Retrying the 26 Gemma rejects produced 25 valid Qwen records with zero
  endpoint failures and 25/25 deterministic reverse support. Gemma accepted
  only 11/25 on re-review; residuals were seven scope mismatches, three wrong
  term/sense mappings, three definition errors, and one POS mismatch.
- The locked generation hint can itself be wrong, so enforcing it while asking
  Qwen to apply Gemma's correction is contradictory. Treat this lane as
  diagnostic only and do not write its rows.
- Next: Gemma pre-review exact proposed terms, part of speech, and definition
  scope before Qwen generation, then run a fresh unseen 100-sense gate. Keep
  the final Gemma no-correction threshold at >=90%; do not start the 500-row
  write gate until it passes.

### Current large-scale validation continuation (2026-08-04)

- The new unseen gate100 passed: Qwen valid `92/100`, deterministic supported
  `92/100`, final Gemma no-correction `83/92` (`90.22%`), and promote eligible
  `83/100`. The old failed gate100 status above is historical, not current.
- `align-dictionary-v2-product-source-gap-candidate-senses.mjs` now deduplicates
  after alignment by exact `source_entry_id:first_sense_id`. This removed 563
  duplicate aligned rows from a 1,239-row expansion.
- Use Gemma context length 2,048 for strict pre-review. The 676-unique-sense run
  finished `676/676` valid, `545` approved, and zero system failures, but only
  195 survived the independent all-target reverse-evidence gate.
- The next resumable input has 853 aligned-new-only senses. Report:
  `logs/product-source-gap-v83-gemma-precheck-expanded853.json`; progress is
  52 complete unique rows. Resume with the same report and `--resume true`.
- Do not run two writers against the same report. A terminated tool session can
  leave its child `node` process alive; inspect process and report first.
- Main product DB and production D1 remain unchanged.

### 2026-08-05 large-scale readiness decision

- The 2,000-row checkpoint pressure run is complete. It used 1,368 exact strict
  candidates plus 632 `promote_allowed=false` infrastructure rows. All 2,000
  completed; endpoint network failures were zero and no-promote rows wrote no
  drafts.
- The earlier 1,844 strict count was an entry-level sum with 476 overlaps. Do
  not reuse it; the exact strict union is 1,368.
- Broad strict and generation-hint-only pools failed semantic review even when
  their deterministic rate was repaired. They are not production inputs.
- Production may proceed in 5,000-row batches only from candidates that pass:
  Gemma exact-sense preferred-term pre-review, all-target independent reverse
  evidence before generation, Qwen generation, deterministic revalidation, and
  final independent Gemma no-correction review.
- Quality evidence: unseen gate100 passed 92/100 generation-valid, 92/100
  deterministic-supported, 83/92 final no-correction consensus, and 83/100
  promote eligibility. The composite 500 quality/checkpoint gate and isolated
  full export/import audit also passed.
- Node allocation is currently 155 for Gemma review and 147/47/56 for Qwen.
  Do not use 143; its project model was unloaded and VRAM was confirmed at 0 MB.
- `scripts/lock-dictionary-v2-product-source-gap-evidence-terms.mjs` is a
  diagnostic/replay utility. Its output requires locked-term enrichment and is
  not directly promotable.

### Definition-contract regression and current network blocker (2026-08-05)

- Evidence pre-review can now require a four-language `definition_contract`.
  The compact Qwen prompt carries that contract and forbids broadening,
  narrowing, or changing the sense, domain, participant, or grammatical role.
- On the 14 exact rows rejected by the preceding fresh gate, Gemma returned 14
  valid reviews, 13 pre-approvals, and 13 complete contracts. Preferred-term
  filtering retained 10 rows; all-target independent reverse evidence retained
  7. This improves candidate selection, but final quality is not yet measured.
- Qwen generation is currently blocked by the active network/runtime path.
  Requests to 147/47/56 through both local SSH forwards and fixed
  `100.99.99.99:11444/11447/11448` proxies reset after about 19 seconds. Direct
  `/v1/models`, `/api/health`, and `/v1/status` calls succeed. Single-node,
  single-concurrency, MTP-off, 3,072-context, and streaming variants still
  reproduce the reset. Only one of seven rows completed and was written as a
  draft in an isolated regression DB; nothing was promoted.
- All three Qwen status responses report `llama_cpp_prebuilt_stale=true` while
  the 35B Vision GGUF is loaded. This may contribute, but the matching SSH
  banner timeout means the network path must also be treated as a blocker. Do
  not classify these rows as model rejects or include this run in a quality
  denominator.
- Resume only after a structured request remains connected for more than 20
  seconds. Use a fresh checkpoint and an isolated DB. Production D1 and the
  main product DB remain unchanged.

#### Resolution and audited result

- The blocker above was resolved with Studio's official `POST
  /api/llama/update`. Nodes 147, 47, and 56 now use llama.cpp prebuilt `b10265`
  and report `stale=false` after reload.
- Use `UD-Q4_K_XL` on A6000-147 and `UD-IQ4_NL` on RTX4090-47/56. Keep context
  3,072, speculative mode off, and one request per endpoint for this compact
  definition-contract profile. Post-update structured smoke requests passed in
  3.15 seconds on 147, 2.38 seconds on 47, and 2.32 seconds on 56 with no
  infrastructure failures.
- The seven independently supported regression candidates generated 7/7 valid
  drafts and passed deterministic reverse evidence 7/7. Independent Gemma
  accepted five with no corrections and rejected `黄土色` and `microeconomia`.
  Only those five were promoted in the isolated DB.
- The isolated full native export/import audit passed with 29,591 entries,
  35,107 senses, and 140,428 sense localizations. All blockers and
  `flagged_senses` are zero; the non-blocking duplicate-localization warning
  remains 98. The main DB and production D1 are still unchanged.
- `export-dictionary-v2-product-source-gap-checkpoint-drafts.mjs` reconstructs
  the exact written generation rows from one or more checkpoints so final
  evidence and consensus review never depend on a second model generation.

### 2026-08-05 controlled-consensus regression

- Added `build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs`.
  The lane keeps independent preferred terms separate from nonbinding model
  suggestions and requires Qwen generation plus independent Gemma consensus.
- Funnel: 17 preselected -> 16 source-approved -> 8 hint-exact -> 7 valid Qwen
  -> 3 deterministic-supported -> 3 Gemma no-correction accepts. Final rows:
  `binómio`, `supersimetria`, and `南回帰線`.
- Fixed replay so it honors `promote_allowed=false`. Controlled draft writing
  now requires an explicit flag and validated consensus provenance; direct
  publishing is forbidden.
- The isolated three-row draft/promote regression passed fast audit and
  published-risk with zero blockers.
- Subsequent human review excluded `binómio` because the `pt-BR` field used a
  European Portuguese spelling/pronunciation, and excluded `南回帰線` because
  the Portuguese proper name needs capitalization repair. This demonstrates
  that no-correction model consensus does not replace locale/style review.
- Only `supersimetria` is now present in the main DB as one
  accepted sense with four complete `needs_review=0` localizations. The main
  promote accepted 1/1 after its dry-run. Fast audit, published-risk, native
  export, and full in-memory import audit pass. Export counts are 29,587
  entries, 35,103 senses, and 140,412 localizations. Main DB SHA256 is
  `EEC7D7E9BA43D882526D14B9AC4F17CDEE40FAB805BAB9CF88F192578D7AD781`.
  This audited set is now deployed as production v84. Online API, focused API,
  and mobile/desktop render checks pass.
## 2026-08-07 v87 formal gate and scale-500 continuation

- The fresh formal 100-candidate gate now passes without lowering any release
  threshold. The merged results are `90/100` generation-valid, `88/100`
  deterministic-supported, and `82/100` final Gemma-accepted. Gemma accepted
  `82/88` evidence-supported rows (`93.2%`), above the required 90% consensus
  rate. The final replay is
  `logs/product-source-gap-v87-formal100-final-gated-replay.json`.
- A fresh isolated copy at
  `.tmp/v87-formal100-controlled-validation-20260807.db` received 81 draft
  rows. One row (`cranium`) was rejected before writing because its Japanese
  term and reading disagreed. Promote dry-run then found one real mojibake
  draft: `映写機` had reading `えいしゃ���`. It was excluded from promote and
  repaired to `えいしゃき` while remaining `needs_review=1`. The other 80
  rows promoted cleanly in the isolated DB.
- The isolated DB passes product fast audit, published-risk
  (`flagged_senses=0`), native export, and full in-memory import audit. Export
  counts are `entries=29741`, `senses=35273`, and
  `sense_localizations=141092`; every blocking integrity count is zero. The
  duplicate-localization count is a non-blocking warning (`116`).
- The production DB was not changed. Its SHA-256 remained
  `4A033CA5A860D906723D60DCC47A5F8C7401635DA9EE4CA1D1A9AD2C87BE1456`.

Scale-500 candidate preparation:

- The remaining independent round-trip pool contains only 323 candidates with
  one exact hint per target language after excluding formal100. A separate
  multi-hint pool was therefore routed through Gemma exact-sense/preferred-term
  review rather than weakening the deterministic gate.
- Gemma completed 280 multi-hint reviews: 182 approved, 98 rejected, and zero
  failed calls. The strict pool reached 212 valid reviews with 178 approvals
  before the remote path began failing. Merging the 360 approvals and applying
  exact preferred-term binding retained 298 generation inputs in
  `logs/product-source-gap-v87-scale500-generation-input.json`; 62 model
  suggestions absent from the original independent hints were blocked.
- The scale-500 isolated DB is
  `.tmp/v87-scale500-checkpoint-validation-20260807.db`. It is a byte-identical
  copy of the production DB and has not received a successful draft chunk yet.
  Resume generation only with a fresh/verified checkpoint and never point the
  command at the production DB.

Current infrastructure blocker:

- After the first 250 successful Gemma calls, every long inference request
  through `100.99.99.99:1144x` began resetting at `18.98-19.00s` with
  `ECONNRESET`. This reproduces on Gemma (143 and 155) and Qwen (56), with
  compact, micro, ultra, minimal, streaming, and non-streaming requests.
  Short `/api/health`, `/v1/models`, and `/v1/status` calls continue to pass.
- Tailscale is direct to `lab-win` at about 16 ms, not DERP. SSH to the jump
  host and ProxyJump both time out. Rebuilding only the 11447 mapping through
  dashboard `/api/portproxy/delete` and `/api/portproxy/add` did not remove the
  19-second reset. Treat these as infrastructure failures, not model rejects.
- Unsloth 155 llama.cpp was updated through official `POST /api/llama/update`
  from `b10194` to `b10297`; it reports `stale=false`, so an outdated runtime is
  no longer the cause. The remaining fix must be made in the Windows jump-host
  forwarding/firewall path or by restoring an SSH/direct tunnel.
- `review-dictionary-v2-product-source-gap-candidates-unsloth.mjs` now supports
  opt-in `--stream true` and reconstructs OpenAI SSE deltas before applying the
  unchanged JSON validator. Default behavior remains non-streaming. Streaming
  cannot fix the present incident because the reset occurs before the first
  response byte.

## 2026-08-07 v87 scale-298 readiness result

The earlier 19-second reset was request-size dependent, not a model OOM. Short
native Studio requests to `/api/inference/chat/completions` worked while larger
request bodies through the Windows forwarding path reset. The production-safe
workaround is `--prompt-mode nano-per-language`, native SSE streaming, and one
language per request. Do not return to the older compact whole-record prompt on
the current forwarding path.

The final 20-row gate passed without relaxing validators: 20/20 generation
valid, 20/20 deterministic reverse-evidence supported, and 18/20 independent
Gemma no-correction accepts. Important fixes were:

- definitions must not equal the translated term and have language-specific
  minimum information content;
- all-katakana Japanese terms use the term itself as deterministic reading;
- the candidate `definition_contract` is included when informative;
- Gemma receives up to 220 definition characters, not a 96-character fragment;
- the per-language reviewer must not label the source language as `L`, because
  Gemma confused it with the localization language;
- `--recheck-rejected true` preserves accepted reviews and reruns only rejected
  or failed rows after a reviewer-prompt fix.

The scale run used 298 candidates. Generation produced 294 structurally valid
rows (98.7%); deterministic reverse evidence supported 292. The corrected
Gemma pass accepted 267/292 (91.4%) with zero failed calls. The final controlled
replay is `logs/product-source-gap-v87-scale500-final-gated267-replay.json`.

Checkpoint behavior is now suitable for dry generation as well as writes. It
stores complete generated items after each chunk, keys candidates by
`source_entry_id:source_sense_id`, supports endpoint migration on resume, and
reconstructs the complete report. During the real run, 56 and then 47 failed;
their circuit breakers opened, 147 continued, and an intentional interruption
resumed from 200/298 without duplicate senses. Streaming body reads now have an
explicit total timeout.

The isolated DB received all 267 controlled drafts. Deterministic promote
accepted 240/242 unique draft senses; two broad glosses remained draft. Fast
audit and published-risk passed (`flagged_senses=0`). Native export and full
memory import passed at 29,869 entries, 35,433 senses, and 141,732 sense
localizations, with all blocking integrity counts zero. Production DB and D1
were not modified.

This proves the pipeline is ready for 5,000-candidate production chunks. Keep
the same frozen prompt, validators, independent evidence policy, Qwen/Gemma
family separation, chunk checkpoints, and isolated-first promotion. Do not
publish every generation chunk; publish only after the configured 5,000-10,000
accepted-sense release boundary and a full audit.
## 2026-08-08 v87 scale-298 main merge and fresh-pool rebuild

- The previously isolated v87 scale-298 result was replayed into the local main
  product DB only after creating
  `backups/linguago-v86-before-v87-scale298-promote-20260808.db`. The backup and
  pre-write DB SHA-256 were both
  `4A033CA5A860D906723D60DCC47A5F8C7401635DA9EE4CA1D1A9AD2C87BE1456`.
- Replay inserted 242 draft senses and reused 25 existing senses. Deterministic
  promote accepted 240 and left two `broad_gloss_key` rows as review drafts.
  The audited publishable export now contains 29,869 entries, 35,433 senses,
  and 141,732 localizations. TypeScript, fast audit, published-risk, native
  export, and full in-memory import all pass; `flagged_senses=0`.
- A v83-v87 attempt index now records 18,930 unique source-entry/sense attempts.
  Rebuilding rank-200,000 coverage produced 267,369 gaps. Quality filtering and
  history subtraction retained 471 rows; independent two-family/two-target
  reverse evidence retained only 104 (`ja=19`, `pt-BR=85`). Do not pad this
  pool to claim a nominal 5,000-row production batch.
- Real source-review prompts through the Windows forwarding path reset the
  socket around 800-1,000 prompt characters, while 400-600 characters and tiny
  multilingual requests succeed. Node now records the nested fetch cause; the
  observed failure is `read ECONNRESET`. `prompt-mode=nano` keeps the first
  sample at 543 characters/560 UTF-8 bytes while preserving exact-sense, POS,
  preferred-term, and definition-contract fields.
- The 147/56 nano review smoke completed 20/20 valid calls with zero network or
  JSON failures, but accepted only 7/20. Most rejects were genuine POS,
  broad/narrow, homograph, or pt-PT/pt-BR mismatches. This fresh pool therefore
  fails the candidate-quality expansion gate. No new generation, draft write,
  D1 export, or deployment followed this review.

## 2026-08-08 v87 post-promote gated-27 main merge

- The fresh pool was rebuilt with conservative pt-BR filtering. Explicit
  pt-PT forms such as `utilizador`, `multimédia`, `óptimo`, `acção`, and
  `facto` are excluded before model review. The independent-source pool fell
  from 104 to 98 candidates (`ja=19`, `pt-BR=79`).
- Per-language Qwen source review produced 38 approvals from 98 candidates.
  Qwen generation returned 36 structurally valid rows; source-required reverse
  evidence retained 30; independent Gemma 4 31B review accepted 27. Model
  agreement was never counted as a dictionary source.
- The 27-row replay was first written and promoted in
  `.tmp/v87-postpromote-gated27-validation-20260808.db`. TypeScript, fast
  audit, published-risk, native export, and full in-memory import all passed.
- Before the main write, the product DB was backed up as
  `backups/linguago-v87-before-postpromote-gated27-20260808.db`; backup and
  pre-write SHA-256 were both
  `C5E1D93CEBAA722422CCADC94D6DD79AF96FE5ED8FD954B13441682B78CB07C8`.
  Main replay and deterministic promote accepted 27/27.
- The current local publishable export contains 29,896 entries, 35,460 senses,
  and 141,840 sense localizations. All blocking integrity checks are zero and
  `flagged_senses=0`. `duplicate_sense_localizations=116` remains a
  non-blocking warning. D1 and the Worker were not changed in this stage.

## 2026-08-08 v88 rank-100k candidate expansion

- Expanding the raw coverage window from 50,000 to 100,000 proved that the
  previous strict-pool shortage was partly a truncation effect. The clean pool
  grew from 464 to 1,123 rows before sense alignment. The all-history attempt
  index now contains 25,355 unique source-entry/sense attempts with zero JSON
  parse failures.
- Six deterministic pt-BR exclusions were added before model review:
  `eletrónica`, `champô`, `polémico`, `falhanço`, `assembly`, and `escale`.
  These are pt-PT forms or unsuitable pt-BR headword candidates; ambiguous
  genuine lexemes still go to semantic review rather than a blanket suffix
  rule.
- Unique sense alignment retained 617 rows and rejected 500 ambiguous best
  senses. The unchanged two-independent-family/two-target prefilter retained
  66 (`ja=9`, `pt-BR=57`). Qwen source review was infrastructure-clean at
  66/66 valid and retained 23. Qwen generation accepted 22/23; source-required
  reverse evidence retained 18; Gemma 4 31B no-correction consensus retained
  15.
- The controlled 15-row replay was written only to the reused isolated
  validation DB. Promote dry-run accepted 14 and blocked `demandar` as a broad
  over-merged gloss. No promote apply or main-DB write followed.
- Human inspection remains mandatory even after Qwen plus Gemma agreement.
  Hold `causalidade`, `contagiar`, `boicotar`, `はし`, and `ワイシャツ` for
  term/POS/register correction: examples include verb-to-noun drift, a less
  natural Japanese equivalent, and non-mainland Chinese preferred terms.
  Model consensus is a review layer, not proof that all four preferred terms
  are suitable for production.

## 2026-08-08 v88 inspected gated-9 main merge

- Manual term-matrix inspection reduced the 15-row consensus set to nine
  production candidates. The six held for manual correction are `demandar`,
  `causalidade`, `contagiar`, `boicotar`, `はし`, and `ワイシャツ`; their
  issues include source POS drift, broad noun-like translations for verbs,
  non-mainland Chinese preferred terms, and overly broad Japanese/English
  equivalents.
- The controlled-input builder now accepts
  `--exclude-source-entry-ids`, records those exclusions in its selection
  policy, and classifies them as `manual_exclusion`. This makes the inspected
  subset reproducible instead of relying on an edited report.
- The final nine rows were replayed into the isolated validation DB first.
  Draft write, deterministic promote dry-run, and promote apply all accepted
  9/9. Fast audit, published-risk, native export, and full in-memory import
  audit passed with all blocking counts at zero.
- Before the main write, the product DB was backed up as
  `backups/linguago-v88-before-gated9-promote-20260808.db`. The backup and
  pre-write SHA-256 were
  `3DD64E28221E91F856E2CD188B7EB8252FA50762E49643401997622CF808D3D4`.
  Main replay and deterministic promote then accepted 9/9.
- The current local publishable export contains 29,905 entries, 35,469 senses,
  and 141,876 sense localizations. Full memory-import audit, sample lookups,
  fast audit, and published-risk pass; `flagged_senses=0`, and all blocking
  integrity counts are zero. The current main DB SHA-256 is
  `5A43338B81941415B52EA21D7C07A45120E5B38E780190C3063C55DAAC7AD4D9`.
- D1 and the Worker were not changed. The six manual exclusions remain
  unpublished and should be repaired or replaced with stronger source
  evidence before reconsideration.

## 2026-08-08 v89 target-evidence recovery and gated-2 main merge

- The all-history attempt index must use the broad filename prefix
  `product-source-gap`, not only versioned `product-source-gap-vNN` prefixes.
  The corrected v89 index scanned 2,271 reports and contains 25,421 unique
  source entry/sense attempts with zero parse failures.
- Rebuilding the rank-200,000/100,000 window produced 1,051 clean rows; unique
  sense alignment retained 551. The first independent-source prefilter
  selected zero rows because 23 source-supported candidates did not have two
  target languages with strong reverse evidence.
- Prefilter diagnostics exposed an over-strict boundary: a target such as
  Japanese `基質` had an exact JMdict `substrate` match and the same OMW lexical
  match, but unrelated JMdict senses made its ratio 1/3, just below 0.34. The
  validator now accepts an exact strong-dictionary match plus an OMW lexical
  match as two independent source families; the global 0.34 threshold was not
  lowered. This recovered 11 pt-BR candidates.
- Qwen source review was valid for 11/11 and accepted four. Qwen generation was
  valid for 4/4 with zero endpoint failures; deterministic four-language
  reverse evidence supported 4/4; independent Gemma 4 31B no-correction review
  accepted 4/4 at confidence 1.0.
- Promote dry-run rejected `incorrer` and `emular` as `broad_gloss_key`; they
  remain manual split work. The inspected final subset contains `veemente` and
  `coeficiente`. Both passed clean isolated write, promote dry-run/apply, fast
  audit, published-risk, native export, and full in-memory import before main
  merge.
- The pre-write backup is
  `backups/linguago-v89-before-gated2-promote-20260808.db`, SHA-256
  `5A43338B81941415B52EA21D7C07A45120E5B38E780190C3063C55DAAC7AD4D9`.
  The post-write main DB SHA-256 is
  `2D968DAB2C5F3C758C78AFC052248C766B4B878A5B27E35146D13DE098E0103C`.
- The current local publishable package contains 29,907 entries, 35,471 senses,
  and 141,884 sense localizations. All release blockers and
  `flagged_senses` are zero. D1 and the Worker were not changed.

### v89 follow-up: controlled gloss precedence

- The `broad_gloss_key` rejection for `incorrer` and `emular` exposed a
  promotion-field bug rather than proving that each row required a sense
  split. Their controlled generations had concise anchors (`incur`,
  `emulate`), but the promoter replaced them with multilingual source
  summaries from the report's `selected` rows.
- `loadReportGlosses` now prefers `generated[].output.gloss_key` for valid
  controlled replay rows and falls back to the source report gloss for
  ordinary reports. The evidence threshold and broad-gloss validator remain
  unchanged. Repeating the isolated promote dry-run accepts all four rows.
- `incorrer` and `emular` are still not in the main DB. Human inspection found
  a contradictory Japanese definition for `incorrer` (it included benefits
  despite the negative `incur` sense) and unnatural Japanese grammar for
  `emular`. Because the earlier Gemma review accepted both, require a new
  targeted definition review and new no-correction consensus; do not fabricate
  corrections from the old report.

### v89 follow-up: corrected `incorrer` promotion

- A fresh full-definition Gemma review rejected the old `incorrer` row and
  required Japanese `受ける` to become `招く`, with a definition limited to
  an unwelcome consequence. The correction was used only as a constraint for
  a new Qwen generation; the old accepted output was not edited in place.
- The regenerated row passed deterministic four-language reverse evidence and
  a new Gemma full-definition review with `decision=accept`, confidence `1.0`,
  and no correction. An isolated draft/write/promote cycle then passed fast,
  published-risk, native export, and full in-memory import audits.
- The same controlled replay was written to the main DB as draft and promoted
  `1/1`. The local publishable package now contains 29,908 entries, 35,472
  senses, and 141,888 sense localizations. All release blockers remain zero,
  including `flagged_senses=0`.
- The pre-write backup is
  `backups/linguago-v89-before-incorrer-corrected-promote-20260808.db`, SHA-256
  `2D968DAB2C5F3C758C78AFC052248C766B4B878A5B27E35146D13DE098E0103C`.
  The resulting main DB SHA-256 is
  `C62D9D738406E0948251D08F4F9C10B6C976B8FB0BD4334E198C4C54CF655F55`.
- At this checkpoint `emular` remained unpublished for targeted
  Japanese-definition cleanup. The follow-up below resolves it. D1 and the
  Worker were not changed.

### v89 follow-up: corrected `emular` promotion and language-focused review

- The general full consensus prompt checked semantic agreement but twice
  missed malformed Japanese grammar. The consensus tool now accepts
  `--language-focus <en|pt-BR|zh|ja>` and explicitly proofreads the selected
  localization for grammar, particles, syntax, and native dictionary style.
- With `--language-focus ja`, Gemma rejected the original definition because
  it lacked a valid predicate/particle structure. A first structured retry
  fixed the grammar but introduced a circular definition using `倣う` to
  define `倣う`; the same focused gate rejected it again.
- A second structured retry generated the Japanese definition
  `他の人や物の行動や性質などを模倣し、それに合わせようとすること。`.
  It passed deterministic four-language reverse evidence and a fresh Gemma
  review with `decision=accept`, confidence `1.0`, and no corrections.
- Isolated and main draft/promote runs both accepted `1/1`. Fast,
  published-risk, native export, and full in-memory import audits passed. The
  local publishable package now contains 29,909 entries, 35,473 senses, and
  141,892 sense localizations; all release blockers and `flagged_senses` are
  zero.
- The pre-write backup is
  `backups/linguago-v89-before-emular-corrected-v2-promote-20260808.db`, SHA-256
  `C62D9D738406E0948251D08F4F9C10B6C976B8FB0BD4334E198C4C54CF655F55`.
  The resulting main DB SHA-256 is
  `12DD08241B4ED705ED8CF1DCB97E9A292B312469035507D8A5F82F4714E7B325`.
  D1 and the Worker remain unchanged.

### v89 residual source-review audit

- The seven remaining source-review rejects all lacked a bindable Chinese
  target term. Five had only OMW support. `metástase` added only one-direction
  Word2Word evidence, which is still insufficient.
- `oclusão` had OMW plus reciprocal Word2Word evidence for Chinese `梗塞`, but
  enabling `corpus_word2word` globally polluted the Portuguese source evidence
  with unrelated corpus pairs and reduced its lexical match ratio to `0.2`.
  The prefilter now supports
  `--strong-supplemental-families-by-lang zh:corpus_word2word`, so a weak family
  can be promoted only for one explicitly named language.
- Even with that scoped option, `梗塞` was not emitted as a generation hint:
  CC-CEDICT/Kaikki expose competing obstruction and infarction senses, so the
  target-term ambiguity gate rejected automatic binding. This is expected and
  must not be bypassed. All seven rows remain residual/manual; rebuild the next
  coverage-gap pool instead of lowering the term evidence threshold.

### 2026-08-08 v90 strict-pool exhaustion

- Rebuilt the historical attempt index with prefix `product-source-gap` after
  the v89 corrections: 2,353 files, 516 generation reports, 52 checkpoints,
  19,370 unique source entries, and zero JSON parse failures.
- The current main DB produced 267,263 ranked gaps. The 100,000-row scan became
  1,040 clean candidates and 540 uniquely aligned senses. Strict reverse
  evidence found 12 source-supported rows but **zero** rows with at least two
  target-language hints, so no v90 LLM batch was started.
- The 12 residuals expose only source-language plus English terms. Ten are
  Portuguese forms; the other two are Japanese `過伸展` and Chinese `平方英里`.
  They need new independent target-language dictionary evidence before
  generation. The dominant rejection reasons were 374 strong-dictionary gloss
  conflicts and 133 rows with no strong reverse evidence.
- This is evidence-pool exhaustion, not an Unsloth capacity failure. Do not
  send these rows to Qwen with invented target terms. The next expansion must
  import or validate additional licensed multilingual evidence, then rerun the
  same v90 filter/alignment/prefilter sequence.

### 2026-08-08 supplemental-license enforcement

- MUSE is not a production evidence source. Its four local source records are
  licensed `CC BY-NC 4.0` and explicitly carry
  `production_publishable=false`; they may be used only for internal research.
- The reverse-evidence prefilter and final validator now read
  `evidence_sources.metadata_json` and license metadata. They automatically
  exclude source keys marked
  non-publishable, families whose members are all non-publishable, and
  non-commercial `BY-NC` data. `panlex-unmapped` remains blocked explicitly.
- A regression run against
  `.tmp/muse/openwn-muse-research-evidence.db` blocked all four MUSE source
  keys and retained `selected_rows=0`. Do not merge MUSE into the production
  combined evidence DB or promote it through `--strong-supplemental-families`.
- MUSE exposed research-only lexical matches for some v90 anchors, but this
  does not resolve the licensed independent-dictionary evidence shortage.
  Continue source acquisition rather than lowering the v90 gate.

### 2026-08-08 Wikidata Lexeme sense feasibility probe

- `scripts/probe-wikidata-lexeme-sense-evidence.mjs` queries the official
  Wikidata Query Service without writing SQLite. It requires an English Lexeme
  sense and a target Lexeme sense to share the exact `P5137` concept item, and
  requires the same Wikidata lexical-category item before counting a target.
- The probe uses the existing `wikidata` family and CC0 structured data; it is
  not a new independent family. It is a higher-precision extension of the
  existing item-label evidence experiment.
- On the 12 v90 source-supported residuals, 11 had no shared target Lexeme
  sense. `rectangular` shared `Q209` with Portuguese/Japanese noun lexemes, but
  the English lexeme is an adjective (`Q34698`) and the targets are nouns
  (`Q1084`). The category gate rejected this concept-level false alignment.
- Final result: zero rows with any compatible non-source target, zero with two
  targets, and no evidence DB import. Wikidata Lexeme does not reopen v90.

### 2026-08-08 v90 high-frequency manual residual queue

- The 134 manual-review rows were dominated by 133 cases with no strong
  reverse-dictionary evidence. A frequency-balanced 20-row queue was selected
  at `zh=7`, `ja=7`, `pt-BR=6`; all 20 are genuinely absent from the product
  DB by exact source-sense link, headword, and localization-term checks.
- `select-dictionary-v2-product-source-gap-manual-review.mjs` now joins rows by
  exact `source_entry_id:source_sense_id` rather than entry ID alone and emits
  both the evidence record and an empty human-review template.
- `annotate-dictionary-v2-product-source-gap-manual-review.mjs` performs the
  read-only product lookup and classifies existing links before any manual
  repair is planned.
- The unresolved 20 senses are persisted in
  `config/dictionary-overrides/source-gap-manual-residuals-v90.json`. The
  coverage filter accepts `--exclude-source-sense-key-files` so future pools
  skip only those exact senses, not every sense under the same source entry.
- The exclusion regression reports `excluded_source_entry_ids=0`,
  `excluded_source_sense_keys=20`, and exactly 20
  `excluded_source_sense_key` rejects. No LLM, draft write, product mutation,
  D1 export, or deployment occurred.

### 2026-08-08 first locale form alias

- Product tables do not store entry forms. `v2_entry_forms` is synthesized by
  `export-dictionary-v2-product-native-d1-sql.mjs`, so spelling variants must
  be added at export time rather than inserted as unsupported product senses.
- The exporter now loads
  `config/dictionary-overrides/product-entry-form-aliases.json` and fails if a
  configured target is absent from the publishable export or its entry ID,
  headword, or primary language no longer matches.
- The first approved alias is European Portuguese `electrónica` to the
  existing pt-BR `eletrônica` entry `23336` (`electronics`). Full native export
  and in-memory import passed; both spellings returned the same entry and all
  blocking audit counts remained zero.
- A later semantic audit found that `activos` can safely map to the existing
  pt-BR `bens` entry `30466` (`assets`), so it is now a reviewed
  `locale_inflected_form` alias. `ativos` already resolves through an accepted
  localization and was not duplicated. `poluentes` remains an exact
  sense-level manual residual because its Kaikki form record is adjectival but
  the OMW four-language concept is nominal.
- The temporary alias export was deleted after verification, releasing
  123,529,464 bytes. Product DB, D1, and Worker were not changed.

### 2026-08-08 targeted source-sense probe

- Added `scripts/build-dictionary-v2-product-targeted-source-sense-candidates.mjs`
  and `config/dictionary-overrides/source-gap-targeted-canonical-senses-v90.json`
  for exact merged entry/sense candidates omitted by ranked coverage scans.
- The builder is read-only and rejects identity drift, missing source links,
  and terms already represented in product data. Reviewed form evidence is
  metadata only and cannot bypass the reverse-evidence gate.
- The first target, noun `poluente`, built successfully as source candidate
  `2080404:2080404` but the normal prefilter rejected it as
  `strong_dictionary_gloss_conflict`. WikDict supplies the noun anchor
  `pollutant`; Kaikki's `poluentes` source record is explicitly adjectival,
  while the OMW four-language concept is nominal. Do not bridge this mismatch
  and do not send it to an LLM.
- The controlled `activos` alias passed native export plus full in-memory lookup
  audit. Product DB, remote D1, and Worker remain unchanged.

### 2026-08-08 exact WikDict lexentry alignment

`build-dictionary-v2-product-wikdict-lexentry-candidates.mjs` resolves a merged
v2 sense through `sense_source_links` before reading WikDict metadata. Never
query `source_senses.id` with a coverage-report sense ID directly: reports
store merged `senses.id`, not raw source-sense IDs.

The builder accepts only WikDict rows with `is_good=1`, `score>=20`, and an
exact shared `lexentry`. Multiple language pairs under that lexentry remain a
single `wiktionary` evidence family. Output metadata therefore sets
`one_source_family_only=true`, `independent_validation_required=true`, and
`publication_evidence=false`; every row must still pass the normal strict
reverse-evidence prefilter.

The latest v90 funnels were:

- 421 uniquely aligned rows -> 90 exact groups covering all target languages
  -> 4 strict independent-evidence rows;
- allowing two lexentry target languages produced 151 rows -> 8 strict rows ->
  7 rows at semantic risk <=4;
- 1,434 formerly `ambiguous_best_sense` rows -> 283 all-target exact groups ->
  2 strict rows;
- allowing two lexentry targets in the ambiguous pool produced 481 rows -> 6
  strict rows -> 6 rows at semantic risk <=4.

This fixes sense-selection ambiguity but does not solve the independent-source
shortage. The low-risk tail remains below the 20-row source-review gate, so no
LLM generation followed. High-quality parallel mismatches remain important:
`pictograma`, `trema`, and `rúcula` show scope conflicts, while `arquétipo` has
the narrower Japanese `元型` versus `原型` distinction. Product DB, D1, and
Worker were not changed.
## 2026-08-08 v90 exact-WikDict and Wikidata validation

- Added `build-dictionary-v2-product-wikdict-lexentry-candidates.mjs`. It aligns
  merged product senses to raw WikDict rows by the exact shared `lexentry` and
  keeps Kaikki plus WikDict in one `wiktionary` family. Exact agreement across
  several WikDict language pairs is useful alignment evidence, but never counts
  as several independent publication sources.
- Candidate-specific exact Wikidata labels (CC0, labels only, no aliases) raised
  the strict two-target funnel to 50 rows. Risk triage retained 47 fresh rows.
  Source review ran two 20-row samples: the first accepted 17/20; the second
  accepted 19/20 with `cérvix` rejected because the model requested a Japanese
  term outside the evidence-bound allow-list. Combined source-review acceptance
  was exactly 36/40 (90%).
- The first 20 approved rows generated 19/20 structurally valid outputs. The
  only structural failure was `hipertexto` with `ja_reading_mismatch`.
  Deterministic reverse evidence retained 17/20; the two remaining rows lacked
  sufficient independent Chinese evidence.
- Gemma 4 31B `nano` review initially accepted only 12/17 and incorrectly called
  several concise definitions truncated. Rechecking only the five failed rows
  with the full prompt accepted four. The final independent no-correction result
  was 16/17. `polidez` remained correctly rejected because Japanese `丁寧` is an
  adjectival term while the source noun requires `丁寧さ`.
- The controlled 16-row replay wrote only to
  `.tmp/v90-wikdict-lexentry-wikidata-controlled16-validation.db`. Promote first
  flagged `neurônio` because generated gloss `nerve cell` did not token-overlap
  English term `neuron`; converting the already independent Gemma consensus to
  the supported semantic-review format resolved this synonym case without
  weakening the deterministic rule. Promote then passed 16/16.
- Isolated fast audit, published-risk, native export, and full memory import all
  pass. Export counts are 29,925 entries, 35,489 senses, and 141,956 sense
  localizations; all release blockers and `flagged_senses` are zero. Native full
  audit requires an existing export manifest: run
  `export-dictionary-v2-product-native-d1-sql.mjs` before
  `audit-dictionary-v2-product-export.mjs --mode full`.
- The main product DB was not modified. Its SHA-256 remains
  `12DD08241B4ED705ED8CF1DCB97E9A292B312469035507D8A5F82F4714E7B325`.
  D1 and the Worker were not changed.

### v90 remaining reviewed pool and combined isolation

- The remaining 16 source-approved candidates generated 16/16 valid outputs on
  147/56 at one request per endpoint. Deterministic reverse evidence retained
  15; `tanatologia` remained manual because Chinese `死亡学` had only the
  Wiktionary family. Full-prompt Gemma review accepted 13/15.
- Gemma correctly rejected `monismo` for a missing Portuguese preposition and
  `mesoderma` for unnatural Portuguese/Japanese definitions. These rows were
  not corrected or promoted. The accepted spelling variant `mesoderme` remained
  a separate evidence-aligned candidate.
- Across both reviewed batches the measured funnel is 36 source-approved -> 35
  structurally valid -> 32 deterministic-supported -> 29 independent Gemma
  no-correction accepts. Rates are 97.2%, 88.9%, 90.6% of supported rows, and
  80.6% end-to-end respectively.
- The two controlled replays were merged by exact
  `source_entry_id:source_sense_id` and tested together in
  `.tmp/v90-wikdict-lexentry-wikidata-controlled29-validation.db`. Draft write,
  checkpoint construction, promote dry-run/apply, fast audit, published-risk,
  native export, and full memory import all pass for 29/29.
- The combined isolated export has 29,938 entries, 35,502 senses, and 142,008
  sense localizations. All release blockers and `flagged_senses` are zero. The
  seven remaining rows in the original 47-row pool were excluded by the
  semantic-risk selector, not accidentally skipped.

### v90 min-one-target expansion failure boundary

- Lowering only the WikDict lexentry intake from two known target languages to
  one increased the exact candidate pool from 632 to 932. Candidate-scoped
  exact Wikidata labels expanded the strict all-target evidence result to 70;
  semantic-risk triage retained 55. A refreshed attempt index covering 2,481
  reports and 25,537 entry/sense attempts removed 40 historical rows, leaving
  15 genuinely fresh candidates.
- Qwen source review accepted 12/15. It correctly rejected `moleiro` for
  Chinese/Japanese sense mismatch, misspelled `halibute`, and `impugnar` for a
  Chinese sports-sense mismatch. Generation produced 10/12 structurally valid
  rows; `ortiga` failed Japanese reading alignment and `incolor` had a thin
  Portuguese definition. All ten valid rows passed deterministic evidence.
- Independent full-prompt Gemma accepted only 3/10. Rejections exposed a
  systemic quality loss: POS drift (`isento`), wrong Chinese term (`manjerona`),
  malformed or calqued Japanese/Chinese definitions, and a factual geological
  class error for `pleistoceno`. Therefore the whole min-one-target experiment
  is blocked from draft/promote, including its three nominal accepts. Do not use
  this route to pad the formal 100-row gate.
- Reaching 100 formal rows now requires additional independent lexical evidence
  or a separately validated correction lane. It must not be achieved by
  weakening target-language coverage, source-family independence, or Gemma
  no-correction consensus.

### v90 evidence-acquisition priority after min-one failure

- Run `dict:v2:coverage:report-evidence-deficits` against the two underlying
  reverse-evidence reports, not their wrapper prefilter reports. The wrapper
  contains `selected/rejected`; the diagnostic consumes `validations`.
- The combined 932-row diagnostic contains 70 supported and 862 rejected rows.
  The dominant blocker is still semantic conflict (`633`), not model capacity.
  For actionable target evidence, there are 99 missing target checks: `zh=69`,
  `ja=27`, and `pt-BR=3`. Of these, 72 have zero observed evidence families and
  27 have one.
- The report now emits `evidence_acquisition_priority`, including zero-family,
  one-family, and round-trip deficits. This run ranks `zh=245`, `ja=98`, and
  `pt-BR=6`. Acquire a traceable commercial-compatible Chinese-English family
  first, then Japanese-English. More Portuguese aggregation is low priority.
- PanLex publishes its snapshots under CC0, but PanLex is an aggregator with
  source-level provenance. The project must continue mapping each PanLex source
  back to its underlying family; PanLex itself is not an independent vote.
  `panlex-unmapped` remains blocked even when the aggregate snapshot is usable.
- The official PanLex source registry distinguishes explicit open permissions
  from copyright-only or unknown source records. Do not infer an independent
  production family solely from the aggregate license. Preserve original
  source ID, provenance, and a reviewed family map.
- OMW is already represented in the evidence database. Updating its English
  release can improve gloss quality, but cannot create a second independent
  Chinese or Japanese family. OmegaWiki remains blocked until an authoritative,
  checksummed dump and license record are reproducibly available.
- The product DB was not modified by this diagnostic. No draft, promote, D1,
  Worker, or deployment action followed.

### v90 OpenHowNet licensed reviewed evidence

- The official THUNLP archive remains available at
  `https://thunlp.oss-cn-qingdao.aliyuncs.com/OpenHowNet/resources.zip`.
  The checked artifact is 74,698,239 bytes, last modified 2021-09-20, with
  SHA-256 `DAAA31E2627E099E03CE15371F472C6F9EC5B3AAC71A4E5E2AB5C4F4F38C44D4`.
- The archive contains 237,974 pickle-serialized senses. The research exporter
  retained 216,329 useful Chinese-English sense pairs, representing 117,264
  normalized Chinese terms and 118,423 English anchors. SQLite integrity passed.
- `export-openhownet-research-evidence.py` requires the pinned archive hash
  before deserializing the pickle. Publication status is controlled by
  `config/dictionary-sources/openhownet-license.json`; missing or incomplete
  provenance fails closed to research-only.
- The official download page places the core data and API in the same OpenHowNet
  download area and states that OpenHowNet uses MIT. The official repository
  identifies itself as containing both core data and API and asks users of data
  or API to cite the project papers. Preserve those citations and the official
  URLs recorded in the license provenance file.
- The exact-anchor research probe matched 42/69 current Chinese target deficits
  (60.9%). Twenty-seven matches expose one Chinese term; 15 expose multiple
  terms and require POS/sememe/sense disambiguation. This is strong feasibility
  evidence, not a publication gate or permission to call Qwen.
- The exporter now preserves English POS, Chinese POS, and the sememe definition
  in `openhownet_sense_metadata`. The probe infers expected POS from the source
  sense when available and otherwise from an unambiguous OMW synset suffix.
  Both OpenHowNet language sides must match that POS for an exact binding.
- POS binding retained 32/42 matches and rejected ten conflicts. Twenty-one
  retained rows have one exact-POS Chinese term; eleven still have several.
  The 21-row queue is emitted as `research_candidates` with status
  `license_blocked_semantic_review`. It is not a generation input.
- A unique POS-bound term is still not automatically correct. For example,
  `categorize -> 分类` and `corolla -> 花冠` are specific, while
  `circumflex -> 符号` is too broad. Sememe/manual semantic review remains
  mandatory even after the license boundary is cleared.
- Reproduce the probe with
  `dict:v2:coverage:probe-openhownet-research`. It is hard-coded to report
  `publication_evidence=false` and `generation_allowed=false` while source
  metadata remains non-publishable.
- The 2026-08-08 independent semantic review used Qwen 3.6 35B MTP on 11444
  and Gemma 4 31B QAT on 11445. Both produced valid JSON for all 21 rows.
  Qwen had 13 high-confidence accepts; Gemma had 15. Dual adjudication retained
  13 high-confidence agreements, found one disagreement (`cureta -> 刮器`),
  and blocked seven other rows. These agreements remain
  `license_blocked_dual_model_accept` because that immutable report predates
  the verified license record. Reuse the decisions only through the reviewed
  evidence exporter; do not edit the historical report in place.
- Reproduce each independent review with
  `dict:v2:coverage:review-openhownet-research` and combine them with
  `dict:v2:coverage:adjudicate-openhownet-research`. Load
  `UNSLOTH_API_KEY` from `.env.local` into the process environment; never pass
  or persist the token in reports. The reviewer supports `--resume true` and
  fingerprints its 21-row input.
- Re-exporting with the verified license record created
  `.tmp/openhownet/openhownet-mit-evidence.db` with 216,329 paired senses and
  SQLite integrity `ok`. Never merge this full database into production because
  exact English anchors alone can still choose broad or mismatched lemmas.
- `dict:v2:coverage:export-openhownet-reviewed` intersects the immutable probe,
  Qwen/Gemma consensus, and MIT evidence DB. It produced an isolated
  13-candidate/13-concept database at
  `.tmp/openhownet/openhownet-reviewed-evidence.db`. Count it as one independent
  `openhownet` family in the next coverage rebuild; it does not bypass the
  normal multi-family, deterministic, or Gemma gates.
- To avoid another 595 MB combined-DB copy,
  `dict:v2:coverage:append-supplemental-evidence` transactionally appended the
  13-row reviewed subset to the current v90 combined evidence DB. Integrity
  remained `ok`; a metadata conflict would have aborted the append.
- Re-running both strict min-one candidate pools increased supported rows from
  70 to 73. The three genuinely new rows are Portuguese `maremoto`, `isômero`,
  and `eucarionte`; all three were absent from the refreshed attempt index.
- Formal Qwen source review accepted 3/3, structured generation produced 3/3
  valid rows with no DB writes, deterministic reverse evidence supported all
  four languages for 3/3, and independent Gemma 4 31B consensus accepted 3/3
  at confidence 1.0 without correction. The next action is isolated-copy
  draft/promote and full audit, not a write to the main product DB.
- The 2026-08-10 isolated-copy human gate promoted only `maremoto` (sense
  37668) and `isomero` (stored as `is\u00f4mero`, sense 37666). `eucarionte`
  (sense 37667) stayed `draft_single_source`; all four localizations retain
  `needs_review=1` because the generated English and Portuguese definitions
  were too broad and omitted the defining membrane-bound nucleus. Qwen,
  deterministic reverse evidence, and Gemma consensus had all passed, so this
  is the reference case for why semantic specificity still needs a human gate.
- The human-gated native export and full in-memory import audit passed with
  29,911 entries, 35,475 senses, and 141,900 sense localizations. Localization
  counts, duplicate sense orders, orphans, mojibake, HTML artifacts, and
  published risk were all zero. Treat `eucarionte` as an expected absence from
  publishable lookup samples until a targeted repair passes the same gates.
- The main product DB SHA-256 remained
  `12DD08241B4ED705ED8CF1DCB97E9A292B312469035507D8A5F82F4714E7B325`.
  No main-DB write, D1 update, Worker change, or deployment followed.
- A targeted 2026-08-10 repair then replaced the four-language definition
  contract for `eucarionte` without patching SQLite directly. The reproducible
  constraint is in
  `config/dictionary-quality-repairs/eucarionte-definition.json`; build its
  generation input with `dict:v2:coverage:build-definition-repair`.
- Fresh Qwen generation preserved the required membrane-bound nucleus and
  membrane-bound organelles in all four definitions. Deterministic reverse
  evidence supported 4/4 languages with source-language reverse evidence
  required, and independent Gemma accepted 1/1 at confidence 1.0 with no
  corrections.
- Isolated replay reused entry 37064 and sense 37667 rather than inserting a
  duplicate. Promote accepted 1/1, cleared four review flags, and raised the
  isolated publishable count to 35,476 senses. The full native export/import
  audit passed with 29,912 entries and 141,904 sense localizations; all
  blocking counters and sample failures were zero.
- The promoter now accepts successful `writes[]` from a draft-apply report as
  checkpoint items. Previously it recognized only `items{}`, so a reused draft
  produced `checkpoint_sense_ids=0` and was silently skipped during promote.
  Keep this compatibility path for controlled replay and resume workflows.
- This repaired row still exists only in the isolated validation database.
  The main DB hash is unchanged, and no D1 or Worker release has occurred.
- Main product DB, D1, and Worker remained unchanged.

### v90 OpenHowNet three-row main-DB promotion

- The later 2026-08-10 controlled main-DB replay supersedes the final two
  isolation-only statements above. Before writing, the exact previous database
  was copied to
  `backups/linguago-v90-before-openhownet-3-promote-20260810.db`; its SHA-256 is
  `12DD08241B4ED705ED8CF1DCB97E9A292B312469035507D8A5F82F4714E7B325`.
- `maremoto`, `isomero` (stored as `is\u00f4mero`), and `eucarionte` were replayed
  as drafts. The repaired `eucarionte` replay reused sense 37667 and replaced
  its four draft localizations before any promotion.
- Promotion was intentionally split by review provenance. The original batch
  promoted senses 37666 and 37668 while explicitly excluding 37667. The
  repaired checkpoint, reverse-evidence report, and new Gemma review then
  promoted 37667 separately. Results were 2/2 and 1/1, with 12 localizations
  promoted and no rejected rows.
- Main product DB fast audit, published-risk audit, native export, and full
  in-memory import audit all passed. The current local package contains 29,912
  entries, 35,476 senses, and 141,904 sense localizations. All blocking
  counters are zero, `flagged_senses=0`, and lookup samples for `maremoto`,
  `is\u00f4mero`, and `eucarionte` pass.
- The new main DB SHA-256 is
  `6C40303FAEA55A3CBE00CD45430A314B3EADB813093149B1C28593F099EEAA77`.
  Export artifacts are under
  `outputs/d1-v2-product-native-export-v90-openhownet-main`. This has not been
  pushed to Cloudflare D1, and no Worker deployment or cache bump has occurred.

### v90 OpenHowNet production release

- The later 2026-08-10 release supersedes the final local-only sentence above.
  Production D1 now contains 29,912 entries, 35,476 senses, 141,904 sense
  localizations, 3,030 examples, and 11,898 example localizations. Health reports
  `published_at=2026-08-10T08:06:06.996Z`.
- The pre-release remote D1 backup is
  `backups/linguago-dictionary-before-v90-openhownet-20260810.sql`, size
  124,007,767 bytes, SHA-256
  `3B92328B5EA067D6C3C2B6D108AF81FC204EEE0608254E32F068DB0FE4379CE1`.
- Worker cache version is `v90-openhownet-3-29912`. Deployed Worker Version ID:
  `dc83a972-1a3b-4402-ba43-87fc9f97f80c`.
- Remote D1 verification matched the export manifest after upload. The complete
  online dictionary regression, focused API check, and focused Playwright
  render check passed. Mobile and desktop renders for `maremoto`, `is\u00f4mero`,
  and `eucarionte` used the dictionary provider and had no horizontal overflow.
- The focused online check now pins the v90 counts and includes the three new
  Portuguese entries so a later release cannot silently lose them.

### v90 large-scale gate: reviewed OpenHowNet expansion

- Two aligned coverage reports contained 540 and 421 rows but only 75 overlaps,
  for 886 unique candidate senses. The OpenHowNet probe now accepts multiple
  reports, deduplicates by `source_entry_id:first_sense_id`, and can exclude an
  earlier probe so model review is not repeated.
- A new isolated OpenHowNet review pass found 86 exact POS-bound rows. Qwen and
  Gemma independently agreed on 38/57 unique-term rows and 20/29 finite-choice
  rows. The 58 accepted candidates exported to 59 MIT-provenance evidence rows;
  the combined evidence DB now has 131 OpenHowNet rows and passes SQLite
  integrity checking. All subsets still use one `openhownet` source family.
- Strict reverse prefiltering of the 886-row union selected 180 rows using two
  independent source families, three target languages, and two-family existing
  localization round trips. Source review accepted 64/100 in the older slice
  and 61/80 in the unseen slice. Network failures were zero. The low raw rate is
  caused by real homograph, POS, and broad/narrow mismatches, so source review is
  now an explicit candidate-selection stage rather than a reason to weaken the
  evidence gate.
- The merged 125 source-reviewed candidates supplied a fixed 100-row generation
  gate. Qwen produced 98 structurally valid entries, with zero endpoint failures;
  deterministic reverse evidence supported all 98 valid rows in all four
  languages. Initial Gemma no-correction consensus accepted 57. Safe structured
  correction cycles added 19, then 3, then 2 unique accepts, reaching 81/100.
  This passes the required 80% final promote-quality gate without writing drafts.
- Two validator lessons are now encoded in scripts. Retry prompts must never
  include raw parser errors because models may judge that text as lexical input.
  Also, semicolons are ambiguous in a term/reading replacement but valid inside
  a complete definition; the structured-correction validator now distinguishes
  those fields.
- The generation and publication mechanics are therefore validated for scale,
  but the current strict candidate pool is not large enough for the planned
  500-row write/resume gate. Do not claim 5,000-row production readiness until
  at least 500 source-reviewed candidates exist and that real draft checkpoint,
  resume, promote, and audit run is completed. Production remains v90 and no
  database writes or deployments were made by this gate.
## 2026-08-10 all-eligible scale-pool checkpoint

- The source-sense aligner now supports `--expand-all-eligible true`. It
  produced 24,898 unique senses and 3,527 rows after the current strict reverse
  evidence gate.
- A fresh entry-unique 100-row source review reached Qwen 55/100, Gemma 56/100,
  and dual acceptance 44/100. This is not ready for generation. Semantic/POS
  drift, not endpoint capacity, is the blocker; no product DB, D1, or Worker
  write occurred.
- The Dicionario Aberto definition probe can restrict work with
  `--validation-report` and `--validation-decisions`. A manual-review-only
  100-row dual-model pilot yielded 75 reviewed definitions but zero net strict
  candidates because Dicionario Aberto alone did not provide the required
  second independent source family. Do not run the remaining 259 rows under
  the same evidence configuration.

## 2026-08-11 v90 isolated 2,000-row scale qualification

The final v3 pressure cohort passed the large-batch quality gate in an isolated
database. Production v90, remote D1, and the Worker were not modified.

- The manifest contains exactly 2,000 semantic groups. Candidate deduplication
  must use candidate/sense identity, not only `source_entry_id`; entry-only
  merging previously discarded distinct senses.
- Qwen generated all 2,000 checkpoint items across ports 11444, 11447, and
  11448: 1,898 were structurally accepted, 102 rejected, and infrastructure
  failures were zero. The checkpoint audit found 1,898 unique draft senses,
  7,592 localizations, zero duplicate senses, and zero bad localization counts.
- Deterministic reverse evidence supported 1,868 rows. Initial independent
  Gemma consensus accepted 1,376 unchanged. One bounded correction cycle added
  243 rows after fresh generation, reverse evidence, and no-correction Gemma
  acceptance.
- The final controlled cohort promoted 1,619/2,000 senses (80.95%). Promotion
  used an exact checkpoint assembled from 1,376 base writes and 243 correction
  replay writes; dry-run scanned and accepted all 1,619 before apply.
- Fast audit and published-risk passed. The isolated database has 37,095
  publishable senses, exactly 1,619 above v90, with `flagged_senses=0` and all
  structural/content blockers at zero.
- Native export produced 30,929 entries, 37,095 senses, 148,380 sense
  localizations, 3,030 examples, and 11,898 example localizations in 19 chunks.
  Full in-memory import matched the manifest exactly; duplicate orders,
  orphans, mojibake, HTML artifacts, and bad localization counts were all zero.

The frozen scale path is: source review, candidate-key deduplication,
checkpointed draft generation, deterministic reverse evidence, independent
no-correction consensus, bounded correction with fresh review, exact checkpoint
promotion, fast/published-risk audits, then native export and full import audit.
A risk flag may pass only when review explicitly resolves an alternative,
polysemy, or register distinction. Unresolved scope, POS, homograph, and
preferred-term conflicts remain blocked.

Operational lessons:

- Reconstruct the complete generation report from checkpoint writes after a
  resumed/chunked run; the final process report may cover only one segment.
- Merge reports by candidate identity so multiple senses under one entry remain.
- Draft apply reports store successful rows in `writes[]`, including reused
  drafts; promotion checkpoint builders must consume them.
- Inspect command lines before stopping stale Node clients. Never terminate all
  Node processes because unrelated work can share the executable.
- Preferred-term failures are normally evidence-contract failures, not token
  truncation; extra output tokens do not justify relaxing term alignment.

Authoritative artifacts are local under
`.tmp/validation/linguago-v90-pressure2000-v3.db` and
`.tmp/validation/v90-pressure2000-v3-export`. They remain untracked. This gate
proves that the pipeline mechanics can scale, but it is not a production
release and does not by itself prove that 5,000 fresh high-quality candidates
exist.

### 2026-08-11 5,000-row candidate-capacity check

- The strict prefilter contains only 3,527 candidates. Of these, 3,025 had
  already entered source review and the validated v3 manifest consumed 2,000
  approved semantic groups. There is not a fresh 5,000-row strict pool.
- Expanding to the broader 24,898-sense aligned report leaves 21,873 unreviewed
  senses and 9,998 unique entries, but those rows have not passed the strict
  independent-evidence prefilter.
- A first broad-pool run used an incompatible micro/evidence-bound prompt and
  was stopped after 271 reviews with zero approvals. A corrected compact-prompt,
  entry-balanced 20-row gate also produced zero approvals: nine valid semantic
  rejects and eleven evidence-bound preferred-term failures.
- Therefore do not launch a 5,000-row generation from the broad pool. The
  infrastructure is scale-qualified; candidate supply is not. Acquire or align
  more independent lexical evidence, rebuild the strict prefilter, and require a
  fresh source-review gate before attempting 5,000 drafts.

### 2026-08-11 ECDICT and Japanese WordNet evidence expansion

- Recomputing the old evidence pool with the current prefilter code produced
  `3,016` strict candidates. Use this number as the A/B baseline; the older
  `3,527` report came from earlier prefilter behavior and is not directly
  comparable.
- The official ECDICT repository is MIT licensed. The checked-in CSV is UTF-8,
  although Windows PowerShell `Get-Content` may display it as mojibake. Verify
  bytes with Node `TextDecoder('utf-8')` before treating the file as corrupt.
- `export-ecdict-chinese-evidence.mjs` binds exact, minimum-two-character
  Chinese terms from ECDICT's translation field to the English anchors in the
  OpenHowNet deficit probe. OpenHowNet is candidate discovery only; exported
  evidence is attributed solely to ECDICT.
- ECDICT added `239` lexical evidence rows and raised the same-code strict pool
  from `3,016` to `3,098`. Adding the candidate-bound, bidirectionally unique
  Japanese WordNet subset raised it to `3,105`, a total net gain of `89` with
  no relaxed quality gate.
- A fresh 20-row OpenHowNet dual-model diagnostic was structurally clean:
  Qwen approved `5/20`, Gemma approved `11/20`, and strict consensus accepted
  `5/20`. The downloaded OpenHowNet archive still lacks a separately verified
  data license, so these reviews remain diagnostic and must not be exported as
  production evidence.
- The reproducible expanded artifacts are
  `.tmp/combined/v90-production5000-ecdict-zh-japanese-wordnet-biunique-evidence.db`,
  `logs/product-coverage-gaps-v90-production5000-expanded-strict-prefilter.json`,
  and its matching `-evidence.json` report. The pool is still `1,895` short of
  5,000, so production generation remains blocked on evidence supply rather
  than GPU capacity.

### 2026-08-11 full ECDICT Chinese extraction gate

- `export-ecdict-chinese-evidence.mjs --validation-report` now extracts
  conservative 2-12 character Chinese segments for every English anchor in the
  current validation report. It removes POS and domain labels, but extracted
  terms still require the unchanged reverse-dictionary and independent-family
  checks before selection.
- The full scan covered `19,684` distinct anchors, matched `10,215` candidates,
  and exported `19,720` ECDICT evidence rows. Combining it with the safe
  Japanese WordNet subset raised the current-code strict pool from `3,016` to
  `3,420`, a net gain of `404` candidates (`215` entry-unique).
- An unfiltered entry-unique 20-row review reached only `14/20` dual consensus.
  Real ambiguous cases included `abstenção`, `harmônico`, and `rotatividade`.
  Do not review or generate from the unfiltered 404-row delta.
- The reusable low-risk filter requires the zh generation hint to include the
  `ecdict` family and requires exactly one bound English term and one bound
  Chinese term. It retains `165` entry-unique candidates.
- Compact whole-object prompts produced malformed or evidence-incomplete JSON.
  The optional OpenAI-compatible `response_format=json_object` did not fix the
  problem and caused one 120-second timeout on this Unsloth backend. Keep it
  disabled by default.
- `nano-per-language` produced valid JSON for `20/20` Qwen and `20/20` Gemma
  reviews. Qwen approved `20/20`, Gemma approved `19/20`, and strict dual-model
  consensus accepted `19/20` (95%). This clears the bounded source-review gate
  for the remaining low-risk ECDICT subset, not for the full 404-row delta.
- Key reports are
  `logs/product-coverage-gaps-v90-production5000-ecdict-extracted-low-risk-entry-unique.json`
  and `logs/product-source-gap-v90-production5000-ecdict-low-risk20-consensus.json`.
  No draft, product DB, D1, or Worker write occurred.

### 2026-08-12 ECDICT second-tier exhaustion check

- The original entry-unique ECDICT delta had 215 rows. The 165-row low-risk
  cohort was already fully reviewed and later yielded the v91 release, so it
  must be excluded before looking for another batch.
- The 50 untouched rows are fresh and unlinked, but they are mostly low-frequency
  Portuguese entries. Requiring ECDICT in the Chinese hint and at most two hints
  per target leaves 24 rows.
- The semantic-risk triage now treats distinct target hints as a real ambiguity,
  while collapsing Traditional/Simplified Chinese equivalents and the English
  `centre`/`center` spelling pair. This reduces the second-tier pool to nine
  rows at risk score 4 or lower; only `paleontologia` and `baricentro` score 0.
- Do not send this residual to a 20-row model gate or lower the 18/20 threshold.
  The ECDICT lane is exhausted for automatic expansion until another independent,
  sense-bound source resolves the remaining alternatives.
- `subtract-dictionary-v2-product-source-gap-report.mjs` supports repeatable
  family constraints through `--require-hint-family lang:family`, for example
  `--require-hint-family zh:ecdict`. Runtime reports remain under `logs/` and
  are not committed.

### 2026-08-12 Dicionario Aberto fresh-evidence qualification

- The latest v93 evidence DB already contains all three historical reviewed
  Dicionario Aberto subsets (75, 78, and 75 rows). Replaying those reports does
  not create a new pool.
- `select-dicionario-aberto-definition-review-candidates.mjs` now builds fresh,
  research-only review cohorts from exact Portuguese headwords. It excludes
  current product entries, the complete historical attempt index, previously
  reviewed source entries, unusable cross-reference definitions, unknown POS,
  and non-single English anchors. Exclusion must be source-entry-wide, not only
  by candidate key; alternate senses of an already reviewed entry must not
  re-enter later cohorts.
- The reviewed-evidence exporter now marks its metadata with
  `reviewed_subset=true`, exact-headword scope, and POS binding. The prefilter
  still accepts such source-side round-trip evidence only through an explicit
  source-key allowlist.
- The first 20-row review was run before target-side deterministic filtering.
  Qwen accepted 18 and Gemma 20, but the resulting 18-row subset passed the
  full strict prefilter at 0/18: 2 source-gloss conflicts, 11 localization
  round-trip failures, 4 insufficient target-evidence failures, and 1 named
  anchor rejection. Do not reuse this cohort as publication evidence.
- Correct order is: structural selection -> target-side deterministic gate
  with one existing source family -> Dicionario Aberto dual-model definition
  review -> reviewed subset export -> strict two-family prefilter. Applying
  the corrected order found 20 candidates. Qwen accepted 16 and Gemma 19;
  strict intersection was 16/20, below the required 18/20.
- Expanding the definition-order choice to at most 12 did not weaken target
  evidence rules. After excluding every source entry from both review attempts,
  only 15 untouched target-qualified candidates remain. Do not run them as a
  20-row gate or lower the threshold. No product DB, D1, or Worker write occurred.
- Runtime reports and temporary evidence DBs remain under `logs/` and `.tmp/`.
  The next expansion needs at least five additional entry-unique candidates
  with complete target evidence, or another independent sense-bound source.

### 2026-08-12 Dicionario Aberto multi-anchor boundary

- Allowing multi-term English anchors is research-only and must be explicitly
  enabled with `--allow-multi-english-anchor true`. The default selector still
  requires a single English anchor. The expanded structural pool contained
  1,651 entry-unique rows; 124 passed the existing target-evidence diagnostic.
- None of the 110 rows added beyond the single-anchor pool produced a unique
  four-language Wikidata concept lock. Across the complete 124-row supported
  set, only `corola` locked to `Q1840192`, and it was already one of the 15
  single-anchor candidates. Multi-term surface agreement therefore adds zero
  safe candidates and must not be used to pad the required 20-row gate.
- The five manual single-anchor rows (`oficioso`, `gloriosamente`,
  `concatenação`, `refracção`, and `assombrosamente`) have no strong reverse
  dictionary evidence at all. They are not threshold-edge rows and cannot be
  rescued by treating Dicionário Aberto as its own second source family.
- Unique-QID locking previously queried the large evidence table once per
  anchor and took longer than five minutes for 1,651 rows. The prefilter now
  loads the approximately 1,406 Wikidata rows into an in-memory index once.
  The same 124-row lock pass completes in about 9.4 seconds and the full
  1,651-row diagnostic in about 30.1 seconds, without changing lock semantics.
- Current capacity remains 15 fresh candidates. Do not call Qwen/Gemma or
  write drafts until at least five additional candidates are supplied by a
  genuinely independent, sense-bound source.

### 2026-08-12 Dicionario Aberto target-evidence expansion gate

- Re-exporting EJDict against all 735 fresh Dicionário Aberto candidates found
  148 exact English/Japanese intersections, but all were already present in
  the v93 combined evidence DB. The merge added zero rows, so EJDict is
  exhausted for this cohort.
- A new OpenHowNet diagnostic used only candidate rows not present in any prior
  OpenHowNet review. Of 656 untouched rows, 126 had one POS-bound OpenHowNet
  Chinese term. Requiring an existing Chinese evidence deficit and exact term
  equality with the candidate's Chinese generation hint reduced this to six:
  `racionalismo`, `embriologia`, `climatologia`, `mineralogia`, `cóclea`, and
  `olivina`.
- `probe-openhownet-source-gap-deficits.mjs` implements this default-off gate
  as `--require-exact-zh-hint-intersection true`. The report records the gate
  and now reports the filtered research/selection candidate counts. It does
  not permit generation or publication by itself.
- Qwen 35B MTP and Gemma 4 31B accepted all six OpenHowNet bindings. Exporting
  their strict consensus added six reviewed OpenHowNet rows and raised the
  target-qualified Dicionário Aberto pool from 15 to 21.
- The subsequent Dicionário Aberto definition review did not pass the release
  gate. Qwen approved 19/21 and Gemma 18/21, but requiring both approval and a
  shared supporting definition order retained only 17/21. `albina` is a
  mineral in the supplied definition, `vagueza` is a historical painting term,
  and `calejado` does not match the modern sexual sense of `horny`. For
  `cóclea`, Qwen selected the historical `Caracol` definition while Gemma
  selected a mixed `Canal auditivo / Parafuso de Archimedes` definition; the
  order intersection is empty and must remain blocked.
- OpenHowNet multiple-term candidates add no fallback capacity: none of their
  terms intersects the existing Chinese generation hints for the outstanding
  Chinese evidence deficits. Do not ask a model to select from this unrelated
  term set.
- No translation generation, draft insertion, product DB write, D1 update, or
  Worker deployment followed this failed 17/21 gate. The next expansion needs
  another independent target dictionary or a new non-overlapping source-gap
  lane; do not lower the 18/20 threshold.

### 2026-08-11 ECDICT low-risk generation and isolated promotion

- Reviewing the remaining low-risk cohort produced `144/165` strict Qwen/Gemma
  source-review accepts. Qwen generation wrote `135/144` valid drafts to the
  isolated `.tmp/validation/linguago-v90-ecdict144.db`; production v90 was not
  modified.
- Deterministic reverse evidence supported `132/135` valid drafts. Independent
  Gemma no-correction review accepted `120/132`, rejected 5, and left 7 as
  manual residual because their responses omitted decision/confidence fields.
- Do not use `nano` with 20-character definition snippets: Gemma correctly
  rejects them as truncated. The reviewer now sends up to 220 characters plus
  term and pronunciation, and normalizes both compact and full A/R/M decision
  forms.
- On the 155 llama.cpp backend, concurrency 2 can leave requests queued after
  the client stops. Use concurrency 1. If this happens, POST `/v1/unload`, wait
  for an empty status, reload the exact model/variant, and resume the report.
- Promotion dry-run and apply selected exactly 120 rows. The isolated fast
  audit passed with `publishable_senses=35596`; published-risk remained
  `flagged_senses=0`, and localization counts, sense order, orphan, mojibake,
  and HTML checks were all zero.
- Primary reports end in `dual-approved144-generation-full.json`,
  `dual-approved144-reverse-evidence.json`, `final-gemma-v2.json`, and
  `dual-approved144-promote-apply.json`. This is an isolated qualification,
  not a D1 or Worker release.

### 2026-08-11 v91 ECDICT 120 production release

- The 135 validated generation outputs were deterministically replayed into the
  main product DB as drafts. Reverse evidence plus final Gemma consensus then
  promoted exactly 120; 15 remain non-publishable residuals.
- The pre-write DB backup is
  `backups/linguago-v90-before-ecdict120-promote-20260811-170001.db`, SHA-256
  `6C40303FAEA55A3CBE00CD45430A314B3EADB813093149B1C28593F099EEAA77`.
- The v91 native package is
  `outputs/d1-v2-product-native-export-v91-ecdict120`. Full memory import and
  remote count verification passed at `entries=30032`, `senses=35596`,
  `sense_localizations=142384`, `examples=3030`, and
  `example_localizations=11898`. D1 `published_at` is
  `2026-08-11T08:02:52.212Z`.
- Wrangler remote export failed with OAuth error 10000. The exact current v90
  rollback package `outputs/d1-v2-product-native-export-v90-openhownet-main`
  was therefore re-audited against the pre-release online counts and passed a
  full memory import. Its manifest SHA-256 is
  `A53DFF2018A962149076253F893DF4EB5F332CFFE63919EA934B89BFF0310FEA`.
- Worker cache is `v91-ecdict120-30032`; deployed Worker Version ID is
  `999818a7-cd16-464c-8b7a-e8048f439b28`.
- Complete online regression, focused API, and mobile/desktop Edge rendering
  passed. `comercialização` resolves through D1 with four-language data and
  IPA, and no tested viewport has horizontal overflow.

### 2026-08-11 v92 pressure cohort production release

- Replayed the previously isolated v90 pressure-2,000 qualification cohort on
  a fresh v91 clone. Current validators accepted 1,610/1,619 rows; nine rows
  were rejected for Japanese reading mismatches and were not written.
- Legacy controlled reports store consensus provenance in top-level
  `selection_policy`, while newer reports may store it per candidate. Replay
  accepts the legacy form only when the report requires independent
  no-correction consensus, disables automatic promotion, and every candidate
  still matches an accepted `source_entry_id + source_sense_id` in the named
  Gemma consensus report.
- Promotion dry-run accepted 1,610/1,610. Duplicate triage then found 48 exact
  same-reading four-language duplicate pairs entirely inside this checkpoint.
  Their source links were merged and duplicate senses removed. Eight otherwise
  exact pairs with reading differences were deliberately retained.
- Net production increase is 1,007 entries, 1,562 senses, and 6,248 sense
  localizations. Final D1 counts are `entries=31039`, `senses=37158`,
  `sense_localizations=148632`, `examples=3030`, and
  `example_localizations=11898`.
- Fast audit, published-risk, native export, full in-memory import, remote D1
  count verification, online API regression, focused API, and mobile/desktop
  render checks all passed. Blocking counters remain zero and
  `flagged_senses=0`. Duplicate localization warnings are 381; the retained
  cases are reading-distinct, manual-review, or likely-keep.
- Pre-release backup is
  `backups/linguago-v91-before-pressure1562-20260811-173518.db`, SHA-256
  `01E073923BF9E12E49E82449B72CD8A364CE662C62DE63D224D36FB86CEEC30C`.
  The post-release product DB SHA-256 is
  `34E57DA3CD2FC403DC1211BA694D99D958E9777074D739033D91D160AB0E1ABC`.
- Native package is `outputs/d1-v2-product-native-export-v92-pressure1562`;
  manifest SHA-256 is
  `152B176163DC1D008F19FB78D726DA0B0B69E2F22892BE195B152BC27C9059B9`.
  D1 `published_at=2026-08-11T08:35:33.797Z`.
- Worker cache is `v92-pressure1562-31039`; deployed Worker Version ID is
  `24626b8f-5f31-4a01-ab42-c3c9709b699a`.

### 2026-08-11 v93 strict fresh-candidate production release

- Rebuilt the v92 coverage-gap pool under the frozen independent-family policy.
  Of 1,692 strict rows, the historical-attempt index left 197 genuinely fresh
  rows and 158 unique-entry candidates after the 20-row gate.
- Qwen source review, independent Gemma review, deterministic four-language
  reverse evidence, and Gemma no-correction review produced 115 publishable
  senses. Three rows were deliberately excluded: `ampicilina` and `perfídia`
  failed semantic validation, while a second `liberalismo` sense overlapped an
  earlier accepted sense.
- Replay into the main DB promoted 14/14 gate rows and 101/101 remaining rows.
  The promote validator must receive the dual-approved source report as
  `--report`; passing the controlled generation report loses the original
  source gloss and causes false generic-gloss semantic-drift failures.
- The pre-write backup is
  `backups/linguago-v92-before-strict-fresh115-20260811-211837.db`; its SHA-256
  matches the pre-write product DB.
- The production native package is
  `outputs/d1-v2-product-native-export-v93-strict-fresh115`. Full memory import
  passed at `entries=31056`, `senses=37273`,
  `sense_localizations=149092`, `examples=3030`, and
  `example_localizations=11898`; all blocking counters and published-risk are
  zero. Duplicate-localization warnings are 384 and remain non-blocking.
- D1 `published_at=2026-08-11T12:22:19.638Z`. Worker cache is
  `v93-strict-fresh115-31056`; deployed Worker Version ID is
  `5161673d-b817-4b1e-82b1-484d676c2974`. Online focused API and mobile/desktop
  render checks passed with no horizontal overflow.
- Gemma `nano` final-review prompts can omit `decision` even with a larger token
  limit. Retry only those rows once with `prompt-mode=full`; do not interpret a
  truncated response as acceptance.

### 2026-08-11 post-v93 strict residual batch (local only)

- Re-aligning the v93 product DB reduced the strict pool from 1,692 to 1,579.
  After rebuilding the historical-attempt index, only 39 fresh unique-entry
  rows remained: 36 pt-BR and 3 ja.
- Four-node Qwen source review approved 30/39 at confidence 0.9. Independent
  Gemma review approved 14, and dual adjudication retained those 14.
- Generation skipped four rows already represented by complete source-gap
  drafts. Of the ten new generations, nine passed structure and all nine passed
  deterministic reverse evidence in every language. Final Gemma no-correction
  review accepted eight and rejected `internacionalismo`.
- The exact final8 replay and checkpoint-scoped promote passed 8/8 in an
  isolated v93 clone and again in the main local DB. Fast audit and
  published-risk pass at `publishable_senses=37281` and `flagged_senses=0`.
- Backup before the local write is
  `backups/linguago-v93-before-strict-fresh8-20260811-222229.db`. This batch is
  intentionally not deployed by itself; production remains v93 with 37,273
  senses until more audited rows are accumulated.

- Entry-level exclusion confirms the current strict fresh pool is exhausted.
  `report-dictionary-v2-product-source-gap-manual-evidence-capacity.mjs`
  identifies 1,221 diagnostic near-unlock rows among 3,956 manual candidates.
  This report is not publication evidence; the next implementation target is
  sense-specific source-side lexical overlap, starting with 462 Chinese rows.

### 2026-08-11 v93 Chinese near-unlock source-side pilot

- Node code-point inspection confirmed all `462` Chinese near-unlock
  headwords are valid UTF-8. Mojibake shown by PowerShell `Get-Content` is a
  console decoding issue, not report corruption.
- Rechecking CC-CEDICT and the already-reviewed OpenHowNet subset found zero
  new exact headword matches. This is expected because these evidence sources
  were already part of the strict prefilter that created the near-unlock set.
- `report-dictionary-v2-product-source-gap-zh-source-overlap.mjs` performs the
  correct Chinese source-side lookup: exact Chinese headword, deterministic
  English-anchor overlap, then OpenHowNet Chinese/English POS binding. Against
  the complete MIT OpenHowNet DB it found `198/462` headword matches,
  `124/462` anchor overlaps, and `104` unique POS-compatible research rows.
- The 20-row dual-model pilot was structurally stable: Qwen 35B produced
  `20/20` valid reviews and approved 15; Gemma 4 31B produced `20/20` valid
  reviews and approved 19. Strict consensus accepted only `14/20`, with six
  disagreements. Nothing was generated, promoted, or published.
- Exact English strings can still be too broad: `take` for `夺去`, `paper` for
  `学术论文`, and `reflect` for `映出` caused model disagreement. Do not expand
  the 104-row pool yet. Add a sense-specificity gate and require a fresh
  consensus result of at least `18/20` before draft generation.
- `probe-openhownet-source-gap-deficits.mjs` now accepts `near_unlock` input
  plus `--lang` and `--limit`. Its English-anchor-to-Chinese-target direction
  is not the right diagnostic for Chinese source rows; use the source-overlap
  script for that case.

### 2026-08-11 v93 Chinese specificity gate and reviewed evidence

- The source-overlap report now includes matching and complete OpenHowNet gloss
  lists. The review prompt applies bidirectional equivalence and explicitly
  rejects generic English hypernyms when the Chinese lemma is more specific.
- A fresh, non-overlapping 20-row gate passed the required threshold: Qwen
  approved `20/20`, Gemma approved `18/20`, and strict consensus retained
  `18/20`. The two disagreements (`landscape`/`风景画` and `安全门`/`emergency
  exit`) demonstrate the intended scope protection.
- Re-reviewing all `104` POS-compatible rows under the same prompt produced
  `104/104` structurally valid reviews from both models. Qwen approved 98,
  Gemma approved 94, and strict consensus retained 92. Twelve rows remain
  blocked; no model disagreement was converted into evidence.
- `export-openhownet-reviewed-evidence.mjs` can now bind reviewed
  `matching_concepts`, which is required when a semicolon-delimited anchor
  matches one exact OpenHowNet concept rather than the whole anchor string.
  The exported subset has 92 reviewed candidates and 115 lexical concepts.
- `prefilter-dictionary-v2-product-source-gap-reverse-evidence.mjs` adds the
  default-off `--allow-reviewed-supplemental-source-roundtrip true` gate. It
  accepts supplemental source-side round-trip only when source metadata is
  publishable, has `reviewed_subset=true`, and records independent dual-model
  semantic review. Raw OpenHowNet can never activate this path.
- With the option disabled, the extended DB still selects the original 1,579
  strict rows. The initial unrestricted diagnostic selected 1,679 rows, but it
  also trusted older, less-specific reviewed subsets and admitted broad anchors
  such as `steel` for `合金钢`. That result is superseded and must not be used.
- The gate now also requires an explicit
  `--reviewed-supplemental-source-keys` allowlist. Allowing only
  `openhownet-official-2021-reviewed-e633a6d65e32` selects 1,645 rows: 1,579
  baseline rows plus 66 Chinese senses. After historical-attempt and duplicate
  exclusion, 63 fresh Chinese entries remain.

### 2026-08-11 v93 Chinese reviewed-source production pilot

- A fresh 20-row Qwen generation dry-run returned 18 structurally valid rows
  with zero API failures. Two genuine reading errors were rejected:
  `看门狗` was emitted as `kàn mén gǒu` instead of `kān mén gǒu`, and `时装店`
  was emitted as `shíshāngdiàn` instead of `shí zhuāng diàn`.
- Replay exposed an additional Japanese reading containing U+FFFD for `贫困线`.
  Both the generation validator and the independent reverse-evidence validator
  now reject mojibake and HTML artifacts themselves. Do not rely on a previous
  report's `valid=true` flag across validation-version changes.
- The database was restored from its pre-write backup and replayed. Seventeen
  clean rows were written as `draft_single_source/needs_review`; fast audit and
  published-risk passed without changing publishable counts.
- Deterministic reverse evidence supported all 17 clean rows. Independent
  Gemma 4 31B no-correction review accepted only 9 and rejected 8 semantic or
  term-specificity errors. The accepted words are `个人所得税`, `保释金`,
  `呼吸困难`, `补助金`, `适用性`, `毛细管`, `舱室`, `老战士`, and `搅拌器`.
- Those 9 passed promote dry-run and apply. The audited local export now has
  31,065 entries, 37,290 senses, and 149,160 sense localizations. Full in-memory
  import, fast audit, TypeScript checks, and published-risk all pass; blockers
  remain zero. D1 and Worker are still on v93 and have not been updated from
  this local increment.
- This pilot's final consensus yield is 9/20. It validates the conservative
  pipeline but does not qualify the remaining 43-entry delta for automatic
  bulk generation. Continue in bounded cohorts and preserve the Gemma gate.

### 2026-08-12 v93 Chinese reviewed-source cohort 2

- Rebuilding the historical attempt index and excluding by source entry, not
  only entry/sense pair, produced the expected 43 untouched entries. Entry-level
  exclusion is required because another sense of an already attempted entry can
  otherwise re-enter a later cohort.
- Initial Qwen generation accepted 15/20. All five rejects paired a kana-only
  Japanese term with a different kana reading. One explicit model retry fixed
  0/5, confirming that prompt repetition is not a reliable repair.
- `supplement-dictionary-v2-product-source-gaps-unsloth.mjs` now deterministically
  sets a kana-only Japanese term's reading to the term itself. Replaying all 20
  original outputs under the current validator accepted 20/20 without another
  model call. This is normalization, not a relaxed reading check.
- All 20 were written as drafts and passed fast/risk audit. Reverse evidence
  supported 20/20, while independent Gemma accepted 12 and rejected 8. Only the
  12 no-correction agreements were promoted.
- The complete local export now contains 31,077 entries, 37,302 senses, and
  149,208 sense localizations. Full in-memory audit has zero orphans, duplicate
  sense orders, mojibake, HTML artifacts, and published-risk flags. D1 remains
  on the previous v93 release; this increment is local only.
- There are 23 untouched entries left in this reviewed OpenHowNet delta. Keep
  them in bounded cohorts because cohort 2's final consensus yield was 12/20.

### 2026-08-12 v93 Chinese reviewed-source completion

- Cohort 3 processed 20 untouched entries. Qwen passed 16/20; the four rejected
  rows had Chinese reading mismatches and were not forced into draft. Reverse
  evidence supported all 16 clean drafts, and Gemma accepted 9 without
  corrections.
- The final cohort processed the remaining three entries. Qwen and reverse
  evidence passed 3/3; Gemma accepted `败血病` and `链反应` and rejected
  `裁判权`. Only the two agreements were promoted.
- The complete 63-entry delta is exhausted. Its final funnel is 63 candidates,
  56 clean drafts, and 32 independent no-correction promotions. Twenty-four
  Gemma-rejected rows remain unpublished drafts; seven generation-invalid rows
  were never written. Do not retry this pool as fresh work.
- The final audited local export contains 31,088 entries, 37,313 senses, and
  149,252 sense localizations. Full import has zero orphans, duplicate sense
  orders, mojibake, HTML artifacts, and published-risk flags. The non-blocking
  duplicate-localization warning remains 390.
- This 32/63 final promotion yield confirms that reviewed OpenHowNet source-side
  support is useful but not sufficient for bulk translation. A new production
  batch requires a fresh independent-evidence pool and a new bounded gate. The
  online D1/Worker remains on v93; this 32-sense increment is local only.

### 2026-08-12 v93 fresh all-language source-review gates

- Rebuilding the complete historical-attempt index left 307 genuinely
  unattempted strict entries: 280 pt-BR, 24 Japanese, and 3 Chinese. These rows
  are candidates only; none was written to the product database.
- Four non-overlapping Qwen 35B source-review gates failed the required 18/20
  threshold. The approved counts were 12/20 for the unfiltered pool, 12/20
  after single-hint filtering, 10/20 after semantic-risk-zero triage, and 8/20
  when requiring four clean localizations on the first sense.
- The failures are semantic evidence defects, not API or JSON instability.
  Typical errors include river bank versus financial bank, trajectory versus
  ballistic trajectory, biological decay versus nuclear decay, and noun versus
  process mismatches.
- `first_sense_clean_localization_lang_count=4` is not proof that all four
  localizations express one concept. The fusion source can still attach an
  incorrect parallel bilingual sense to that source sense. Treat this field as
  a completeness diagnostic only.
- `subtract-dictionary-v2-product-source-gap-report.mjs` now supports
  `--min-first-sense-langs`, but this option must not be used as publication
  evidence. It is useful only for cohort analysis followed by strict review.
- Do not proceed to Gemma consensus, generation, draft insertion, or D1 release
  from this residual pool. The next data-quality change must bind target terms
  to an exact lexentry or concept identifier from a genuinely independent
  source, then pass a fresh non-overlapping 18/20 source-review gate.

### 2026-08-12 v93 exact-lexentry residual boundary

- Expanding exact shared WikDict lexentry alignment over the 23,057-row aligned
  gap report produced 1,824 all-target rows. After the old historical-attempt
  index, 317 appeared fresh. A single-hint diagnostic cohort reached Qwen
  19/20 and independent Gemma 19/19, showing that exact lexentry plus one term
  per target is a useful semantic-alignment signal.
- That diagnostic cohort was intentionally generated only with `apply=false`.
  Generation accepted 16/19. `bioma` and `sinodo` exposed Japanese terms not
  present in JMdict, while `panetone` omitted the source-evidence verdict. No
  draft or publishable row was written.
- The diagnostic ordering was incomplete: exact WikDict lexentry alignment is
  one Wiktionary family and must be followed by the normal strict independent
  reverse-evidence prefilter before source review or generation. Do not reuse
  the 19-row dry-run as a production cohort.
- Re-running in the correct order used all-target independent evidence,
  localization round trip, and `--require-jmdict-hint true`. This reduced 506
  unique exact-lexentry candidates to 155 strict candidates. A refreshed
  all-history index scanned 2,875 reports with zero parse failures and recorded
  20,981 source entries / 28,112 entry-sense attempts.

### 2026-08-12 v93 Wikidata QID and alias boundary

- `prefilter-dictionary-v2-product-source-gap-reverse-evidence.mjs` now has an
  opt-in `--lock-hints-to-unique-wikidata-concept true` gate. It narrows terms
  only when exactly one Wikidata QID covers every candidate language and the
  intersection with each existing hint list contains exactly one term. The QID
  and locked terms are retained in the report; ambiguous or incomplete QIDs do
  not change the hints.
- Expanding exact-label Wikidata evidence locked 80 of 166 strict candidates,
  but after history and current-product exclusions only 15 real gaps remained.
  Adding exact Wikidata alias matches increased strict candidates to 171 and
  real unlinked single-hint candidates to 19 (13 fresh, 6 evidence-upgrade
  revalidations). This is evidence expansion, not a weaker source-family gate.
- `select-dictionary-v2-product-source-gap-evidence-upgrade-revalidation.mjs`
  builds an auditable bounded cohort. It prioritizes fresh rows, excludes all
  historical `review_reject` rows, requires a unique QID for historical
  revalidation, and excludes senses already linked to accepted or draft product
  rows. Always pass the current product DB with `--product-db`.
- A first 20-row diagnostic accidentally included 19 already-complete product
  senses; generation correctly skipped them. This is why product-link exclusion
  belongs before model review, not only inside the generation script.
- The corrected 19-row real-gap cohort passed Qwen at 18/19, but independent
  Gemma accepted only 15/18. `excrecao` had a Chinese waste-noun versus
  excretion-process mismatch. `dobragem` and `arsenio` exposed pt-PT headwords
  incorrectly treated as pt-BR (`dublagem` and `arsenico` are the expected
  Brazilian forms). No generation or database write followed this failed gate.
- Current conclusion: exact WikDict lexentry plus unique Wikidata QID is useful,
  but the remaining tail still needs a pt-PT/pt-BR source-language correction
  layer and stricter target POS/process alignment before another scale pilot.
- After entry-level history exclusion and single-hint filtering, only three
  genuinely fresh rows remain: `glicogenio`, `dobragem`, and
  `radiotelescopio`. This is below the 20-row gate, so the exact-lexentry lane
  is exhausted. Acquire or align another independent concept-ID source before
  any further generation.

### 2026-08-12 v93 locale-gated Wikidata alias pilot

- The revalidation selector now requires a Kaikki Portuguese pronunciation
  database and an explicitly Brazilian pronunciation for pt-BR candidates.
  `arsenio` is filtered as pt-PT, while `dobragem|dubbing` and
  `excrecao|excretion` remain explicit semantic residuals. This gate reduced
  the 19 real unlinked candidates to 13 eligible rows.
- Qwen/Gemma adjudication approved 12/13 rows; `radiotelescopio` remained
  rejected. Generation initially accepted all 12, but the first manual output
  inspection found Traditional Chinese target terms that the old validator did
  not reject. The database was restored from
  `backups/linguago-v93-before-wikidata-alias-qid-dual12-20260812-151533.db`
  before publication.
- Source-gap generation now converts non-source Chinese terms and all Chinese
  definitions to Simplified Chinese before computing deterministic pinyin.
  Promote validation independently rejects non-Simplified Chinese definitions,
  and rejects non-Simplified Chinese terms when Chinese is not the source
  language. A Chinese source headword remains unchanged to preserve exact
  source lookup and source-term alignment.
- Promote can now use `--restrict-to-report true`. Always use it for bounded
  cohorts so a changed database sort order cannot select older drafts. The
  report must contain source sense IDs; the generated audit records the
  restriction and whitelist size.
- Replaying the corrected cohort created and promoted eight genuinely missing
  senses. `tanatologia` was already complete, and three other rows were stopped
  by existing-equivalent-sense checks instead of creating duplicates. The
  resulting local product database has 37,321 publishable senses.
- TypeScript, fast audit, published-risk, and full native export/in-memory
  import all pass. All blocking counts remain zero, including flagged senses,
  bad localization counts, duplicate sense orders, orphans, mojibake, and HTML
  artifacts. Production D1 remains v93; this eight-sense increment is local
  only.

### 2026-08-12 v93 post-pilot evidence capacity

- Rebuilding the complete `product-source-gap` attempt index scanned 2,907
  reports with zero parse failures and recorded 20,985 source entries / 28,116
  entry-sense attempts. Do not use version-only filename prefixes; they omit
  older unversioned attempt reports.
- The evidence-upgrade selector now treats the current history index as
  authoritative. A row present in an old fresh snapshot is no longer fresh if
  it has any current history, and any historical `review_reject` always wins.
  This fixed `radiotelescopio`, which an old fresh report had incorrectly
  allowed to bypass two later review rejections.
- The exact WikDict/Wikidata alias lane has only four revalidation candidates
  left and no genuinely fresh candidates. It is below the 20-row gate and is
  exhausted for production expansion.
- Evidence-deficit analysis over 506 exact-lexentry candidates found Chinese
  as the dominant missing independent target: 72 insufficient-evidence rows
  plus 24 failed Chinese round trips. Japanese is second (15 plus 13), while
  Portuguese has only one round-trip deficit.
- A new OpenHowNet probe supports automatic exclusion of historical review
  keys from a directory. Directory exclusion reads only top-level `reviews`;
  explicit `--exclude-probes` remains the only way to exclude probe/candidate
  arrays. This distinction prevents a probe from excluding itself.
- After historical review exclusion, OpenHowNet produced 17 unique-term and
  seven multi-term candidates. A bounded gate used all 17 unique terms and the
  first three selection candidates. Qwen had 19/20 structurally valid reviews;
  Gemma had 20/20. Strict dual-model consensus retained only 15/20 (75%), below
  the required 18/20.
- The five blocked rows were semantic, not infrastructure failures:
  `ideograma` (symbol versus writing-system scope), `consanguinidade`
  (terminology scope), `comensalismo` (specific biological relation versus
  broad coexistence), `pederastia` (practice versus person/object), and
  `surata` (conflicting source meaning). No reviewed evidence was exported, no
  translation generation ran, and the product database was not modified by
  this failed gate.

### 2026-08-12 v93 ECDICT exact target-hint gate

- The 24-row ECDICT second-tier residual is not a clean translation batch. Many
  rows combine multiple historical English, Chinese, or Japanese hints. A new
  read-only gate, `gate-ecdict-source-gap-hint-intersections.mjs`, requires
  every exact ECDICT English anchor to support the same single existing Chinese
  generation hint before a candidate can enter model review.
- Chinese extraction uses complete token boundaries. It must not truncate an
  alphanumeric term such as `凝血因子II` into the false exact match `凝血因子`.
  This boundary bug was caught and fixed during the first dry report.
- Of the nine previously low semantic-risk rows, only `paleontologia -> 古生物学`
  and `baricentro -> 质心` qualify. Across all 24 residual rows, nine qualify;
  the other seven are adjective-form resolutions such as `cubic -> 立方体的`
  and still need the normal dual-model review.
- Historical-attempt filtering reduces the nine exact intersections to seven
  reviewable rows: four fresh and three evidence-upgrade revalidations.
  `obstrutivo` and `baricentro` remain blocked by historical model review
  rejects and must never be reintroduced merely because ECDICT intersects.
- Seven rows are below the 20-row remote-review gate. No model call, reviewed
  evidence export, generation, product database write, D1 update, or Worker
  deployment followed. The next safe action is to add at least 11 independently
  bound Japanese or other target-evidence candidates, then run one bounded
  dual-model review over the combined cohort.

### 2026-08-12 v93 JMdict reading-alias evidence boundary

- The canonical JMdict import indexes the first written form but does not index
  every `<reb>` as a source-entry alias. This made common kana entries appear
  to have only Wiktionary-family source support.
- `probe-jmdict-reading-source-gap-conflicts.mjs` streams the original compressed
  JMdict XML and requires an exact reading, applicable reading/sense
  restrictions, an exact semicolon-split English gloss, and one unique JMdict
  entry. It found 58/129 exact source-side bindings and exported 84 candidate-
  bound evidence rows when `--evidence-out` was explicitly supplied.
- Re-running the complete strict prefilter raised source-supported rows only
  from 171 to 172. All 58 Japanese rows still failed later target-language,
  round-trip, or ambiguity gates; none became publishable. The only newly
  supported row was `climatologia`, unlocked by the prior reviewed
  OpenHowNet/Dicionário Aberto evidence, not by JMdict.
- This is a useful importer/evidence fix but not additional translation-batch
  capacity. Do not count 58 source bindings as 58 generation candidates.

### 2026-08-12 v93 independent-evidence final gate

- `gate-ejdict-source-gap-hint-intersections.mjs` now provides a read-only
  EJDict lane. It requires every exact English anchor to intersect the same
  single Japanese generation hint and excludes historical review rejects.
- A 20-row cohort was assembled from exact ECDICT intersections, previously
  dual-reviewed Dicionario Aberto/OpenHowNet rows, exact EJDict locks, one fresh
  strict candidate, and four unique-Wikidata revalidations. The initial Qwen
  run used `max_tokens=420`; 17 responses were truncated. Retrying only invalid
  rows with `max_tokens=800` and `max_seq_length=1536` produced 20 valid reviews.
  Treat this as an output-budget failure, not a model-quality or network failure.
- Qwen rejected three genuine term/sense mismatches. Replacements were
  `modulacao -> 変調`, `racionalismo -> 合理主義`, and the aligned OMW sense
  `goiva -> 圆凿`. A PowerShell-built temporary report initially encoded the
  last Chinese generation hint as `??`; the source localization itself was
  correct. Always inspect generated JSON as UTF-8 before blaming the model.
- The replacement cohort passed Qwen 20/20. Independent Gemma 4 31B accepted
  19/20; `cubico` remained reviewer disagreement and was excluded. Generation
  dry-run then accepted 18/19 with zero network or JSON failures. The remaining
  failure, `alternadamente`, repeated the Japanese term as its definition and
  failed `thin_definition_ja`.
- Post-generation reverse evidence is still mandatory. It retained only 10/18:
  `unilateralmente`, `paleontologia`, `atalaia`, `taxonomia`, `embriologia`,
  `condimento`, `climatologia`, `mineralogia`, `corola`, and `racionalismo`.
  The other eight are drafts/manual review, even though both models agreed.
- An isolated validation DB promoted those 10 rows. Fast audit, published-risk,
  native D1 export, and full in-memory import all passed. The same fixed replay,
  main-DB-specific sense checkpoint, and reverse-evidence checkpoint were then
  applied to the main product DB. Before the write, the backup
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v93-final10-20260812-232846.db`
  was created and matched SHA-256
  `D84E80BD03FD59D6445F0F10613011DE1BDD7FEBD6569010BE8B6B59FA214E66`.
- The main export at `outputs/d1-v93-final10-main` has 31,106 entries, 37,331
  senses, and 149,324 localizations. All blocking integrity fields and
  `flagged_senses` are zero. Ten senses are newly publishable; eight additional
  rows remain unpublished drafts.
- The complete accumulated local delta was released as v94. Remote D1 was
  backed up to
  `backups/linguago-dictionary-before-v93-final10-20260812-233445.sql`
  (130,356,807 bytes, SHA-256
  `E0D9057EC93F3D6F21FCC023B5531F2862CCA999F5519BE49FF7F36BD8BB163F`).
  The 19-chunk push verified remote counts against the manifest.
- Production D1 now has 31,106 entries, 37,331 senses, 149,324 localizations,
  3,030 examples, and 11,898 example localizations; `published_at` is
  `2026-08-12T14:29:23.239Z`. Worker cache is
  `v94-evidence-final58-31106`; deployed Worker Version ID is
  `03b6efac-2fc0-4b25-b5e6-8fa3a18b6fc9`.
- Online dictionary regression, updated focused counts, all ten newly promoted
  term checks, and mobile/desktop render checks passed. No horizontal overflow
  was detected.

### Unsloth key loading for new Codex tasks

- `.env.local` is the durable local source for `UNSLOTH_API_KEY`; it remains
  ignored and must never be committed, logged, or copied into reports.
- Core Unsloth scripts import `scripts/lib/load-local-env.mjs` before reading
  `process.env`. The loader reads `.env.local` automatically and preserves an
  explicitly supplied process variable as the higher-priority override.
- A new Codex process may report `$env:UNSLOTH_API_KEY` as missing because it
  did not inherit a later Windows environment update. That does not prove the
  project key is unavailable. Verify through the shared loader without
  printing the value:

```powershell
node -e "import('./scripts/lib/load-local-env.mjs').then(() => console.log(process.env.UNSLOTH_API_KEY ? 'UNSLOTH_API_KEY=loaded' : 'UNSLOTH_API_KEY=missing'))"
```

- Do not pass the token on the command line. Commands and process listings can
  expose command-line arguments.

### 2026-08-13 v94 large-batch 500-row write gate

- The current frozen lane rebuilt coverage through rank 500,000, aligned exact
  source senses, applied strict independent-source prefiltering, and subtracted
  the accumulated attempt history by `source_entry_id:source_sense_id`. This
  produced 777 fresh senses; Qwen source review approved 519.
- The 500-row generation gate completed with 464 valid outputs (92.8%), zero
  endpoint failures, and zero JSON/infrastructure failures. Post-generation
  reverse dictionaries supported 454 rows (90.8% of the original cohort).
- Independent Gemma 4 31B review on endpoint 11445 initially returned 30
  incomplete `{"corrections":[]}` objects. These were not treated as implicit
  accepts. Retrying only invalid rows with the full prompt, 320 output tokens,
  and context 2048 produced 454/454 valid reviews: 400 no-correction accepts
  and 54 semantic rejects. The final promote-eligible rate is exactly 400/500
  (80.0%).
- Replay previously indexed candidates only by `source_entry_id`. That is
  unsafe when one entry contributes multiple source senses. Replay and
  controlled-consensus validation now index exact
  `source_entry_id:source_sense_id`; the fixed dry-run matched 400/400 rows.
- A pre-write backup was created as
  `linguago_v2_product_top5000_freedict_filtered_candidate.before-v94-fresh500-draft-20260813-015211.db`.
  The 400 consensus rows were written as drafts and then promoted only with
  both the reverse-evidence and independent Gemma reports. Fast audit and
  published-risk audit passed; publishable senses increased from 37,331 to
  37,731 and `flagged_senses` remains zero.
- Windows PowerShell 5 `Get-Content | ConvertFrom-Json` corrupted this large
  UTF-8 multilingual report and then failed parsing. Use Node `fs.readFileSync`
  with `utf8` for candidate/report processing. This was a shell decoding
  failure; the JSON source was valid.
- These 400 rows are local only. Production D1 and Worker remain v94 until the
  full export/import audit and the next explicit release batch.
## Dictionary v95 evidence status (2026-08-13)

- Local publishable senses: `37,742`; production was not redeployed in this
  phase and remains on the v94 baseline.
- Current all-history index: `39,591` exact source entry/sense attempts.
- Strict pool after full JMdict term/reading extraction: `1,281`; after current
  history subtraction: `1` fresh row (`giroscópio`).
- Full Japanese near-unlock scan: `189/459` candidate-bound JMdict matches,
  but only three additional strict rows because all target languages still
  require independent round-trip evidence.
- Exact-headword capacity was zero for the 364-row Chinese CC-CEDICT bucket and
  the 310-row Portuguese FreeDict bucket. This is data coverage, not a parser
  or Unsloth failure.
- Do not start another 5,000-row LLM run from this pool and do not weaken the
  evidence gate. Add a genuinely independent source or a reviewed semantic
  alignment layer first.

New diagnostic artifacts are written under `logs/` and `.tmp/` and remain
untracked. The durable extractors are
`scripts/probe-jmdict-reading-source-gap-conflicts.mjs` and
`scripts/probe-cc-cedict-source-gap-conflicts.mjs`.

### v95 morphology bridge and next target-term lane

- Node 155 was explicitly excluded. Only already-loaded Qwen 35B MTP services
  on 147, 56, and 47 were used; 143 was healthy but had no active model and was
  left untouched.
- UniMorph Portuguese mapped 21/310 near-unlock forms to lemmas; eight lemmas
  existed in FreeDict. Qwen accepted two rows, while deterministic no-risk,
  unique-analysis, past-participle adjudication accepted one.
- The one reviewed evidence row did not grow the strict pool because Chinese
  and Japanese target terms still failed independent reverse checks.
- Latest evidence deficits contain 3,198 Chinese and 1,347 Japanese target
  failures. The actionable one-family subset is `zh=511`, `ja=226`.
- Next implementation: a target-term repair dry-run over 20 high-frequency
  candidates. Models may propose alternatives, but only CC-CEDICT/JMdict exact
  reverse matches can update generation hints. LLM agreement is not evidence.

### v95 target-term repair dry-run result

- The 20-row repair dry-run used only nodes 147, 56, and 47. Node 155 was not
  contacted; node 143 was healthy but remained unloaded and untouched.
- Qwen returned structurally valid suggestions for all 20 candidates. The
  deterministic validator accepted 12 candidate-bound replacement terms after
  enforcing target-language script and limiting new production evidence to
  strong dictionary families. OMW and corpus Word2Word observations remain
  supporting context and cannot unlock a candidate by themselves.
- The strict pool increased only from 1,281 to 1,282. The newly unlocked row
  was Portuguese `caracterizacao`, whose invalid Japanese target `制立` was
  repaired to `描写` with independent JMdict and Wiktionary support.
- Rebuilding against the exact all-history attempt index removed that repaired
  row because it had already been attempted. The fresh pool therefore remains
  one row, Portuguese `giroscopio` (`2063727:2532624`). Do not spend a remote
  generation batch on this single row.
- The next safe capacity step is to run the deterministic target-term repair
  selector over a materially larger portion of the 737 one-family deficits,
  validate every proposed term against current local dictionaries, and then
  rebuild/subtract history again. Expansion is justified only if that produces
  a useful fresh cohort; suggestion validity alone is not a scale signal.

#### 100-row target-term capacity check

- A balanced `zh=50 / ja=50` cohort was run on nodes 147, 56, and 47 only.
  Node 155 was excluded. All 100 responses parsed and no endpoint failed.
- The initial lightweight dictionary validation accepted 39 candidates and 41
  terms. Tightening it to require two strong reverse families for the same
  proposed term reduced this to 29 candidates and 31 terms. This remains a
  precheck, not a publishability decision: the authoritative prefilter also
  applies polysemy/conflict ratios and accepted only one repair.
- Applying all 39 repairs to an isolated report still left the strict pool at
  1,282. After exact history subtraction, the fresh pool remained one row,
  `giroscopio`. No product DB, D1, or Worker state changed.
- Stop expanding this repair lane with LLM calls. Many repaired candidates
  still fail another target language's independent-evidence gate. The next
  capacity work must identify multi-target deficit intersections or add an
  independent dictionary family with relevant Chinese/Japanese coverage.
- Added `report-dictionary-v2-product-target-deficit-intersections.mjs`. The
  3,637 insufficient-target candidates split into 577 single one-family gaps,
  19 multiple one-family gaps, 164 mixed one/zero-family gaps, and 2,877
  zero-family-only gaps. A focused 20-row single-gap replay reused existing
  model output and still unlocked only `caracterizacao`; main-prefilter replay
  is therefore mandatory after every lightweight term validation.

#### A6000-155 Gemma reviewer recovery

- Node 155 became available again. Unsloth Studio `2026.7.2` / Studio
  `v0.1.481-beta` was healthy and initially had no loaded model.
- Loaded `unsloth/gemma-4-31B-it-qat-GGUF`, variant `UD-Q4_K_XL`, with context
  2,048 and speculative decoding disabled. Cold load completed in about 140
  seconds.
- Added `review-dictionary-v2-product-target-terms-unsloth.mjs`. A three-row
  smoke test and the full 29-candidate precheck completed without transport,
  parse, or schema errors. Gemma accepted all 29 candidates (31 terms), with
  confidence 0.90-1.00.
- This unanimous result is a reviewer calibration warning, not evidence that
  all rows are publishable. The model judged translation naturalness, while
  the authoritative prefilter additionally enforces exact reverse-source
  direction, polysemy/conflict ratios, and independent target evidence. It
  still accepted only `caracterizacao -> 描写`. Never promote from this Gemma
  report alone and never count model agreement as a dictionary family.

#### ConceptNet zero-family target-term discovery

- The live ConceptNet API returned HTTP 502, so the official 5.7 assertions
  snapshot was downloaded to
  `data/raw/conceptnet/conceptnet-assertions-5.7.0.csv.gz` (497,963,447 bytes).
  Keep this raw file local and untracked. ConceptNet is CC BY-SA 4.0 and is an
  aggregator: every usable edge must retain its dataset/source URIs.
- `probe-conceptnet-source-gap-zero-family.mjs` streams the gzip file and only
  considers exact English-anchor `/r/Synonym` edges to Chinese or Japanese.
  It scanned 34,074,917 assertions, matched 7,698 rows covering 2,055
  candidates, and found no new independent source family. The matched
  provenance was JMdict, Wiktionary, WordNet, or DBpedia; `/s/process/*` is
  processing metadata and must not be counted as a family.
- ConceptNet is therefore discovery-only. The 7,698 rows produced 2,260
  candidate/language suggestions (5,650 terms). Local exact dictionary checks
  retained 328 pairs (561 terms), and the authoritative prefilter increased
  the strict pool from 1,281 to 1,331. Exact history subtraction left 23 fresh
  candidates.
- The bounded 20-row gate produced 16 Qwen source-review accepts. Independent
  Gemma source review accepted all 16. Qwen generation produced 13 valid
  structures; deterministic reverse dictionaries supported 11, marked one
  manual, and rejected one. Final Gemma no-correction review accepted all 11
  supported rows. The effective yield is 11/20 (55%), below the bulk threshold.
- No draft, product DB, D1, or Worker write occurred. Do not expand this lane
  directly. Use it to recover target terms, then require existing independent
  dictionaries to prove them. The next capacity improvement still requires a
  genuinely independent Chinese/Japanese lexical source or a reviewed subset
  with a compatible redistributable license.

#### NAER and Japan MOJ independent government terminology pilot

- Added two genuinely independent, redistributable evidence families. Taiwan
  NAER terminology uses Open Government Data License 1.0; the Japan Ministry
  of Justice Standard Legal Terms Dictionary uses Public Data License 1.0.
  These sources are domain terminology, not general dictionaries, so exact
  English-anchor matches still require semantic review and reverse evidence.
- `select-naer-government-terminology-datasets.mjs` selected 141 bilingual NAER
  CSV datasets from Taiwan's official open-data catalog. The resumable download
  completed 141/141 files (120,349,230 bytes). Keep the raw catalog and files in
  `data/raw/government-lexicons/` local and untracked.
- `probe-government-lexicons-zero-family.mjs` matched 1,369 of the 2,877
  zero-family candidate/target pairs (`zh=1,360`, `ja=9`). The exported
  candidate-bound evidence contained 4,065 lexical rows. Adding the two strong
  supplemental families raised the frozen strict pool from 1,281 to 1,682,
  with 213 candidates fresh after historical-attempt subtraction.
- The first entry-unique 20-row source review only reached 11/20 strict
  Qwen/Gemma agreement. This exposed English-anchor polysemy and part-of-speech
  mismatches such as `quarterly -> 季刊`; no generation or database write was
  allowed from that cohort.
- A second unseen pool contained 35 unique entries. The first Qwen run failed
  35/35 because all three already-loaded servers had `max_seq_length=1024`;
  prewarm correctly reported `skipped`, so the requested larger context was not
  applied. Force-reloading 147/47/56 at context 2,048 fixed the infrastructure
  issue and produced 35/35 valid reviews. Qwen accepted 28, Gemma accepted 25,
  and strict source-review agreement retained 25.
- The first 20 agreed rows then ran as a no-write generation gate. One existing
  complete source-gap row was skipped and Qwen generated 19/19 valid structures
  with zero endpoint failures. Deterministic reverse evidence retained 14,
  marked four manual, and rejected one. Final Gemma no-correction consensus
  accepted 12/14. Effective yield is 12/20 (60%), below the bulk threshold.
- No draft, product DB, D1, cache, or Worker write occurred. Continue by using
  the 213-row pool as a pre-review reservoir: run Qwen and Gemma source review
  first, then generate only strict agreements. Do not treat all NAER exact
  English matches as safe, and do not count multiple NAER datasets as multiple
  independent source families.

##### Mainland Chinese terminology precedence correction

- Chinese product localizations target Mainland usage. The first NAER probe
  incorrectly offered Mainland and Taiwan terms together, even though Mainland
  terms were listed first. That allowed the model to select a Taiwan term and
  made the 213-row fresh report ineligible for further use.
- The government lexicon probe now applies a hard anchor-level rule: if any
  official `中国大陆译名` exists for an English anchor, only Mainland terms are
  exported. Taiwan terms are used only when every matched record lacks a
  Mainland term, and that fallback is converted to Simplified Chinese. Repair
  reports preserve `term_regions=mainland|taiwan_fallback`.
- Rebuilding under this policy kept all 1,369 candidate/target matches but
  reduced unique offered terms from 4,008 to 2,290. There are 440 Mainland
  matches and 920 Taiwan-fallback matches. The strict pool fell from 1,682 to
  1,482; exact history subtraction fell from 213 to 86 fresh rows. This is an
  intentional quality reduction, not lost processing capacity.
- The earlier 35-row reviews and 12/20 final gate are diagnostic only because
  they were selected from the mixed-region report. Do not write or promote
  them. Continue from
  `product-source-gap-v95-naer141-moj-mainland-first-current-fresh.json`, with
  Mainland rows scheduled before Taiwan fallback rows.

##### Mainland-first bounded production cohort

- The corrected fresh pool had only 18 entry-unique rows explicitly backed by
  Mainland NAER terms. Qwen and independent Gemma both accepted the same 16
  and rejected `octeto` and `especiação`; there were no reviewer disagreements
  or transport failures.
- One of the 16 was already a complete source-gap entry. Qwen generated 15/15
  remaining rows successfully on 147/47/56, and deterministic reverse evidence
  supported all four languages for 15/15 using the Mainland-first evidence DB.
  Final Gemma no-correction consensus accepted 12 and rejected `substrato`,
  `riboflavina`, and `etnocentrismo`.
- All 12 final-consensus rows were written as
  `draft_single_source/needs_review`. Promote dry-run accepted 10 but retained
  `protoplasma` and `asparagina` as drafts because their broad source glosses
  triggered `semantic_drift_en_term_gloss_mismatch`. Do not override that
  deterministic block merely because Gemma accepted the generated definition.
- Promoted Mainland terms are `前列腺素`, `甲状腺素`, `偶极`, `白炽`, `发箍`,
  `翅果`, `幽门`, `扁形动物`, `单糖`, and `体腔`, attached respectively to
  `prostaglandina`, `tiroxina`, `dipolo`, `incandescência`, `testeira`,
  `sâmara`, `piloro`, `platelminto`, `monossacarídeo`, and `celoma`.
- Fast audit, published-risk, native export, and full in-memory import pass.
  Export counts are 31,451 entries, 37,752 senses, and 151,008 sense
  localizations; all blocking audit counters are zero. D1 and Worker were not
  changed. The first full-audit command failed only because it was run before
  creating the export manifest; always run product native export before full
  export audit.

##### Taiwan fallback bounded cohort under Mainland output policy

- After excluding the 18 already reviewed Mainland entries, no additional
  entry-unique `term_region=mainland` candidates remained. The next bounded
  cohort therefore used 19 rows whose NAER records had no Mainland China term.
  Taiwan terms remained discovery hints only and were Simplified before review.
- Qwen had 18 valid source reviews, 14 accepts, four rejects, and one repeated
  JSON failure (`ergonômico`) moved to manual review. Gemma accepted 14 and
  rejected five. Strict agreement retained 14; `oxidar`, `trimestralmente`,
  `sinonímia`, and `osteopatia` were consensus rejects.
- One agreed row was already complete. Qwen generated 13/13 remaining rows and
  deterministic reverse evidence supported all four languages for 13/13.
  Final Gemma review with `language-focus=zh` accepted nine and rejected
  `monociclo`, `matriarcado`, `míldio`, and `alheamento` for Chinese term or
  sense suitability.
- The nine final rows passed controlled draft write and promote dry-run, then
  were promoted. They are `subtítulo`, `engradado`, `empena`, `fenobarbital`,
  `じょうろ`, `bursa`, `bioterrorismo`, `catalepsia`, and `tanoeiro`. Their
  Chinese output is Simplified and independently reverse-supported; the Taiwan
  term was never accepted as publication evidence by itself.
- Together with the prior Mainland cohort, v95 local now has 19 new publishable
  senses. Full export/import audit passes at 31,460 entries, 37,761 senses, and
  151,044 sense localizations with all blocking counters zero. Export is local
  at `outputs/d1-v2-product-native-export-v95-mainland19`; D1 and Worker remain
  unchanged.

## Dictionary v96 recommended five-node topology test (2026-08-13)

- The production LLM topology is now recorded in
  `config/dictionary-v2-llm-topology.json`. RTX4090-224/47/56 run
  `Qwen3.6-35B-A3B-MTP-GGUF / UD-IQ4_NL` for generation, while A6000-144/147
  run `gemma-4-31B-it-qat-GGUF / UD-Q4_K_XL` for independent review. Every
  node uses one parallel slot, context 2,048, and q8_0 KV cache.
- The measured 40-row contract throughput was 119.54 accepted entries/minute
  for this topology versus 81.34/minute for Qwen on the two A6000 nodes and
  Gemma on the three RTX4090 nodes. Both produced 40/40 structurally valid
  rows. Gemma on RTX4090-56 terminated at context 4,096 with the default KV
  cache, but loaded fully on GPU at context 2,048 with q8_0 KV. Never interpret
  a successful `/v1/load` alone as proof; require `cpu_fallback_reason=null`
  and `n_cpu_moe=0` from `/v1/status`.
- `review-dictionary-v2-product-source-gap-consensus-unsloth.mjs` now accepts
  `--endpoints` and `--endpoint-gguf-variants`, prewarms both Gemma nodes, uses
  a dynamic worker pool, and records the endpoint used for every review. The
  old single `--endpoint` interface remains supported.
- The next fresh 20-row source-review test excluded the prior Mainland-18 and
  Taiwan-fallback-19 cohorts. Qwen returned 17 valid reviews and approved four;
  Gemma approved three of those four. Qwen generated all three agreed rows,
  deterministic reverse evidence supported all four languages for 3/3, and
  final dual-A6000 Gemma consensus accepted 3/3 with confidence 1.0.
- The three rows (`giroscópio`, `anastomose`, and `criptorquidia`) were written
  as controlled drafts and promoted locally after a successful dry-run. A
  missing no-checkpoint source-to-product sense mapping in the promote script
  was fixed by resolving `product_sense_source_links` directly from the product
  DB. This prevents valid consensus reports from silently scanning zero rows.
- Fast audit, published-risk audit, native export, and full in-memory import
  audit pass. Current local export counts are 31,463 entries, 37,764 senses,
  and 151,056 sense localizations. All blocking counters are zero. The export
  is `outputs/d1-v2-product-native-export-v96-topology3`; D1 and Worker were not
  changed.
## 2026-08-14: AGROVOC evidence integration

- Added `scripts/export-agrovoc-evidence.mjs` and
  `npm run dict:v2:coverage:export-agrovoc`.
- Input probe:
  `logs/product-source-gap-v97-agrovoc-top3000-probe.json`.
- Generated local evidence DB:
  `.tmp/agrovoc/agrovoc-v97-evidence.db` with 235 candidates and 349 rows
  (`zh=307`, `ja=42`). The exporter applies simplified-Chinese normalization,
  CJK-script checks, a conservative scientific-name filter, report hashing,
  and candidate/concept provenance.
- Merged evidence DB:
  `.tmp/combined/v97-naer141-moj-agrovoc-mainland-first-evidence.db`.
- Strict outputs:
  `logs/product-coverage-gaps-v97-agrovoc-mainland-first-strict.json` and
  `logs/product-coverage-gaps-v97-agrovoc-mainland-first-strict-evidence.json`.
- Strict supported count changed `1482 -> 1485`; after excluding the complete
  historical attempt index, only `削皮` is a new candidate. AGROVOC therefore
  remains a narrow domain supplement and does not unlock general large-scale
  production by itself.
- No product DB, D1, or Worker deployment was changed in this step.
- A full follow-up probe used
  `logs/product-source-gap-v97-evidence-acquisition-all.json` and queried all
  5,145 eligible zero-family targets. Output:
  `logs/product-source-gap-v97-agrovoc-all-probe.json` with 324 matched
  candidates (`zh=230`, `ja=206`).
- The filtered full DB
  `.tmp/agrovoc/agrovoc-v97-all-evidence.db` contains 581 rows (`zh=307`,
  `ja=274`) across 322 accepted candidates. One non-CJK Japanese label and one
  Chinese label without Han were rejected.
- The full strict rerun selected 1,486 rows. Compared with the pre-AGROVOC
  baseline, only `木屑` and `削皮` are fresh; the two added Portuguese
  `hipertireoidismo` senses are historical. Together with the already-fresh
  `protrombina` and `embutir`, current capacity is only four rows. Stop
  expanding AGROVOC and acquire a general modern Chinese/Japanese independent
  lexical source next.

## 2026-08-14: PanLex source feasibility audit

- Added `scripts/report-panlex-source-feasibility.mjs` and
  `npm run dict:v2:coverage:report-panlex-sources`.
- The script reads the official PanLex source registry, selects `cmn-eng`,
  `eng-cmn`, `jpn-eng`, and `eng-jpn`, and maps known derivatives back to
  existing source families. It never treats PanLex aggregation as an
  independent dictionary family.
- Current official infrastructure limitation: `api.panlex.org` did not resolve,
  the historical CSV snapshot URL redirected to the home page, and the source
  registry HTTP response was truncated at about 1 MiB after 4,877 rows. The
  output explicitly records `truncated_source_list=true`.
- Output `logs/product-source-gap-v97-panlex-source-feasibility.json` found 12
  relevant sources with at least 1,000 denotations: seven rejected for
  restricted/unresolved redistribution, one collapsed to the existing Japan
  MOJ family, one kanji-validation-only source, and three specialist sources.
  General license-and-provenance review capacity is zero.
- Do not download or merge a PanLex aggregate until a reproducible snapshot and
  reviewed source-family map exist. The existing PanLex offline importer keeps
  unmapped sources non-publishable by design.

## 2026-08-14: AGROVOC fresh-candidate dual review

- Exact subtraction against the complete source-gap attempt history left four
  fresh strict candidates: `木屑`, `削皮`, `protrombina`, and `embutir`.
- Qwen source review accepted `木屑`, `protrombina`, and `embutir` at confidence
  `0.95`, and rejected `削皮` at confidence `0.95`. The rejected row must not be
  generated or promoted without new independent lexical evidence.
- Independent Gemma review accepted all three Qwen-approved rows, with
  confidence `0.98`, `0.98`, and `0.95`. The local intersection report is
  `logs/product-source-gap-v97-agrovoc-fresh3-source-consensus.json` and contains
  exactly three candidates with no disagreements.
- This stage produced reports only. It did not generate complete entries, write
  drafts, modify the product DB, export D1, or deploy the Worker. The next safe
  stage is Qwen four-language generation for only these three agreed rows,
  followed by deterministic reverse evidence and final Gemma no-correction
  consensus before any draft write.
- A subsequent generation `--select-only` pass against the current product DB
  selected only `木屑`. `protrombina` and `embutir` were skipped with
  `already_complete_source_gap`, so they must not be regenerated. Node UTF-8
  inspection confirmed `木屑` is stored as `U+6728 U+5C51`; the mojibake seen in
  PowerShell output is terminal rendering, not JSON corruption.

## 2026-08-14: Wikidata Lexeme and NorthEuraLex feasibility

- The official Wikidata Lexeme entity dump was downloaded and verified at
  `601,695,805` bytes. The two-pass local exporter scanned `1,550,647` lexemes,
  but produced zero target evidence for the current 5,145-row acquisition
  manifest. Lexeme translation and item statements are too sparse for this
  long-tail cohort. Ordinary Wikidata item labels are not dictionary evidence.
- NorthEuraLex CLDF was downloaded from the official Lexibank repository. Its
  `Value` column is the orthographic form; `Form` is IPA and must never be used
  as the headword. The dataset contains 1,016 concepts, of which 1,010 have all
  four project languages, but only one current residual source term matched and
  it did not pass English-anchor alignment.
- `export-northeuralex-evidence.mjs` now exports global concept-bound lexical
  evidence instead of only candidate-bound intersections. The default export
  contains 3,140 rows (`en=1,031`, `zh=1,015`, `ja=1,094`) and normalizes
  Mandarin to Simplified Chinese. Generic Portuguese is excluded by default;
  enable it only with `--include-generic-portuguese true`, and never describe
  those rows as specifically pt-BR evidence.
- The merged evidence database is
  `.tmp/combined/v97-naer141-moj-agrovoc-northeuralex-mainland-first-evidence.db`.
  SQLite integrity passed with 2,571,311 rows and exactly 3,140 NorthEuraLex
  rows.
- Replaying the unchanged strict two-independent-family gate selected 1,486
  rows, exactly the same candidate keys as the pre-NorthEuraLex run
  (`added=0`, `removed=0`). NorthEuraLex is valid independent concept evidence,
  but it does not unlock the current residual pool. Do not run a new bulk LLM
  batch from this result and do not weaken the evidence gate.
- A separate global Wikidata Lexeme coverage report scanned all 1,550,647
  lexemes and found 33,242 `P5137` concepts involving at least one project
  language. Only 280 had all four languages. Of those, only four contained an
  explicit `pt-br` lemma; the other Portuguese lemmas were generic `pt` and are
  not Brazilian publication evidence. A conservative unique-term filter left
  26 concepts, only one with explicit pt-BR.
- Exact comparison with the current product DB found 232/280 four-language
  concepts already covered in all four languages and 48 partially covered;
  zero were entirely new. Samples also exposed overly broad item binding, such
  as the information concept collecting unrelated one-character Chinese
  lexemes. Therefore Wikidata Lexeme is not a source-first bulk candidate lane.
  The repeatable report is
  `scripts/report-wikidata-lexeme-multilingual-coverage.mjs`.
- Product DB, D1, cache, and Worker were unchanged. The only currently agreed
  row still requiring generation is `木屑`; sending it to a Qwen endpoint needs
  explicit authorization for that endpoint because the existing authorization
  covered independent Gemma review only.

## 2026-08-14: strict retry-capacity gate

- The strict 1,486-row source-gap report was reconciled against the complete
  attempt history and current product source links. Treating every historical
  attempt as permanently exhausted was incorrect: network/parse failures,
  unresolved checkpoints, and generated-but-unpublished rows may be retried,
  but explicit semantic rejects, existing drafts, and published links may not.
- `scripts/report-dictionary-v2-product-source-gap-retry-capacity.mjs` produces
  `logs/product-source-gap-v97-retry-capacity.json`. Current counts are 501
  retryable rows, 228 with one unambiguous term in all four languages, and 205
  production-eligible senses after pt-BR locale evidence and known-residual
  filters. Those 205 senses represent only 150 unique source entries.
- The production gate now explicitly requires every target term to be bound by
  an OMW synset, a reviewed English source anchor, or at least two independent
  lexical evidence families. All current 205 rows still pass; this addition is
  a regression guard, not a relaxed rule.
- A language-balanced, entry-unique pilot contains 19 rows: `pt-BR=12`,
  `ja=5`, `zh=2`. Local inspection exposed why model review remains necessary:
  `lexico -> 字汇` violates Mainland-first terminology when `词汇` exists, and
  `チョウジ -> 蒜瓣` likely crosses the spice/garlic senses of English `clove`.
- The source-review prompts now require neutral Mainland Chinese and permit a
  Taiwan-only term only when no established Mainland equivalent exists. They
  still require accepted preferred terms to match supplied evidence exactly;
  the model cannot silently invent a replacement and bypass provenance.
- `npm run check` and syntax checks for the modified retry/source-review scripts
  pass. No product DB, D1, cache, or Worker state changed.
- Remote review of the 19-row pilot is pending explicit authorization to send
  those candidates and local evidence to Qwen endpoints `11447` and `11448`.
  After Qwen, only approved rows go to the already-loaded Gemma endpoint
  `11444`; then intersect both reviews before any generation.
- A follow-up audit found that the historical attempt index used one generic
  `review_reject` label for both source-sense rejection and final rejection of
  a generated payload. That incorrectly treated a bad JSON/definition attempt
  as proof that the lexical candidate itself was invalid. The index now emits
  `source_review_reject`, `generation_quality_reject`, and
  `other_review_reject`, with the exact contributing files per label.
- Rebuilding all 4,658 `product*.json` reports reduced true permanent semantic
  rejects from 950 to 663. Production retry capacity rose to 280 senses / 203
  unique entries. A separate review-only pool contains 711 senses / 483 unique
  entries; rows with multiple target hints require `nano-per-language` term
  selection and deterministic reverse validation before generation.
- Comparing all 88 historical source-review reports against current evidence
  found 38 senses / 34 unique entries whose evidence changed enough to permit
  dual-model revalidation. Historical rejects remain blocked by default; this
  lane only reopens review and never publication.
- `scripts/assemble-dictionary-v2-source-gap-scale-review-pool.mjs` now builds
  explicit lane-balanced validation cohorts. The current 500-entry cohort has
  `production=197`, `multi_hint=280`, `evidence_upgrade=23`, with 500 unique
  entries. Its source-language distribution is `pt-BR=450`, `ja=44`, `zh=6`;
  every output still requires all four localizations, but this distribution is
  not evidence of broad Chinese-source coverage.
- The first v97 layered-pool pilot completed the full no-write funnel. Qwen
  source review approved 18/20; the locked same-proposal Gemma source review
  retained 16/20. Two already-complete entries were skipped, so Qwen generated
  14 payloads and 13 passed structural validation. The rejected payload was
  `denominação`: its locked Japanese term `名目` had both a wrong generated
  reading and a semantic-scope risk, so it was not repaired merely to increase
  acceptance.
- Strict post-generation reverse evidence retained 11/13. `おやすみ` remained
  manual because its Japanese support came only from the Wiktionary family;
  `ちなみに` was rejected because the locked Chinese term conflicted with
  CC-CEDICT. Final Gemma no-correction consensus accepted 8/11 and rejected
  `funcionalidade`, `documental`, and `descentralização` for target sense or
  grammatical-category mismatches. The resulting end-to-end yield is 8/20,
  below the scale gate; no draft, product DB, D1, cache, or Worker write was
  performed.
- Source review with `--require-definition-contract true` now validates that
  Chinese contracts contain Han text, Japanese contracts contain kana, and
  contracts are not empty, identical to the term, or trivially thin. The
  strict prompt also forbids copying English glosses into other languages and
  calls out adjective/noun, quality/feature, and dispersion/decentralization
  mistakes. Re-run a fresh 20-row cohort before attempting 100 rows.
- The second v97 20-row cohort used the stricter source-review contract. Qwen
  returned 20/20 valid reviews and accepted 16; locked same-proposal Gemma
  returned 16/16 valid and accepted 14. The two models had exact preferred-term
  agreement on all 14 accepted rows. Three were already complete in the local
  product DB, leaving 11 generation targets.
- Qwen generated all 11 targets successfully on ports 11447/11448 with zero
  network or validation failures and no database writes. Strict reverse
  evidence supported 10/11. `fundamentalismo` remains manual because its
  Chinese term has only OMW-family support. The ten supported rows still need
  final Gemma no-correction review before any draft apply or promote decision.
- Final Gemma no-correction review accepted 7/10 and rejected `bolchevique`
  (English leakage in the Japanese definition), `extremismo` (Japanese term
  too narrow), and `fisiológico` (Chinese term referred to the academic field
  rather than the adjective). No database write followed.
- This exposed a control-flow bug: `nano-per-language` assembled four language
  reviews and returned `valid=true` without passing the combined object through
  the shared `validateReview()` contract. Consequently,
  `--require-definition-contract true` was ineffective on that prompt mode;
  empty and non-native definitions could pass. The nano prompt now explicitly
  requests a native-language definition, and the assembled object must pass
  the shared definition language/thickness checks before it is accepted. Any
  scale result produced before this fix is diagnostic only and cannot satisfy
  the 100-row gate.
- The shared definition-contract rules now live in
  `scripts/lib/source-review-contract.mjs`, with regression coverage in
  `scripts/test-source-review-contract.mjs`. Historical nano report audit found
  1,571 approvals across 36 affected reports that do not satisfy the new
  complete-definition contract. This does not automatically invalidate rows
  that later passed reverse evidence and final Gemma review, but those source
  reviews cannot be reused as current scale-gate evidence.
- Source-gap `select-only` now supports `--eligible-report`, which writes the
  complete product-eligibility-filtered candidate objects for downstream
  source review. The next fresh cohort prefiltered 30 rows, skipped three
  already-complete product senses, and fixed 20 genuine gaps under fingerprint
  `d4a1a98a00b012d77eff462a83c2c63dbb99a533cc6b3785a8e2e5468d518d3a`.
- A self-contained remote dry-run pipeline is installed on the Tailscale jump
  host at `D:\linguago-runner`; see `docs/dictionary-remote-runner.md`. The host
  uses Node 24.16.0 and the lockfile dependencies, including a verified
  `better-sqlite3` binary. The full source DB, product DB copy, supplemental
  evidence DB, JMdict, and Portuguese pronunciation DB all match their local
  SHA-256 hashes. Local relay ports 11447, 11448, and 11444 are healthy.
- `scripts/run-dictionary-v2-remote-pipeline.mjs` runs the seven-stage
  Qwen/Gemma/evidence funnel with per-stage logs, output hashes, input
  fingerprint validation, and resume. It defaults to no database writes.
  `scripts/manage-remote-dictionary-runner.ps1` provides background
  start/status/stop and now an operator-attached `run` action. Windows OpenSSH
  cleaned up the original detached `Start-Process` when the session closed;
  the foreground action is the verified mode for long runs.
- The remote user-level `UNSLOTH_API_KEY` is now persisted and the fixed
  v97-20c no-write dry-run completed. Its funnel was `20 -> 15 -> 15 -> 15 ->
  15 -> 14 -> 5` (Qwen source approval, Gemma source approval, exact source
  consensus, valid generation, reverse evidence, final Gemma acceptance).
  Both Qwen endpoints had zero generation failures and all 15 payloads were
  structurally valid, but final acceptance was only 5/20. The nine final
  rejects exposed real generation defects: non-native Portuguese definitions,
  part-of-speech mismatch, and Chinese/Japanese concept-type mismatches such as
  genus versus plant, instrument versus procedure, chemical group versus
  material, and related but different colour terms. Do not expand to 100 rows
  until the full-generation contract addresses these classes and a fresh
  20-row cohort meets the gate. No product DB, D1, cache, or Worker write was
  performed.
- The fresh v97-20d run completed with the stronger native-definition and
  concept-type prompt. Its no-write funnel was `20 -> 14 -> 12 -> 12 -> 11 ->
  6 -> 3`. The new deterministic language check correctly rejected one
  Portuguese definition written in English. Infrastructure remained clean,
  but five of the eleven structurally valid rows failed reverse evidence
  because the Chinese term had only Wiktionary-family support or no reverse
  dictionary evidence. This showed that `reverse_evidence_prefilter` target
  coverage counted available hints, not publishable exact-term support.
- Reverse validation now supports `--input-mode hints`. Replaying the exact
  four-language generation hints for the 500-row scale pool produced 418 fully
  supported candidates, 23 manual-review candidates, and 59 unsupported
  candidates before any LLM call. The remote pipeline now repeats the same
  reverse-evidence gate on the exact Qwen/Gemma preferred-term consensus before
  full generation. The next 20e cohort is selected only from the 418 supported
  rows and is still a no-write validation batch.
# v97 30-to-20 production gate (2026-08-14)

- The scale gate must separate source-review input from the generation target.
  Reviewing exactly 20 raw candidates produced unstable final denominators because
  legitimate semantic/POS rejects occurred before generation. The validated design
  oversamples 30 evidence-complete candidates, runs Qwen source review, locked-term
  Gemma review, and exact reverse evidence, then generates at most 20 entries.
- Run `v97-30h-to-20-production-gate` reviewed 30, obtained 23 dual-model source
  consensus candidates, generated 20, deterministically validated 19, accepted 15
  in the initial final Gemma pass, and accepted 2 more after evidence-gated repair.
  Final safe yield was `17/20` (85%) with zero automatic database writes.
- Chinese reverse evidence now treats OpenCC-equivalent Simplified and Traditional
  forms as the same spelling evidence while retaining Simplified Chinese in product
  output. This fixed false manual-review results such as `相對主義/相对主义` without
  weakening semantic evidence requirements.
- Gemma source review uses `locked-contract`: preferred terms are immutable and
  Gemma writes aligned native-language definition contracts. This avoided the old
  failure where Gemma copied terms into `definition_contract`.
- Fresh cohort selection now excludes source-linked accepted/draft senses and
  complete product senses matched by source-gap group key plus gloss key. Always
  run generation `--select-only true` before remote inference as a second eligibility
  check.
- The remote runner safely skips empty final/repair consensus stages instead of
  failing with `No non-supported generated candidates found`.

## 2026-08-14: v97 100-row sustained gate and controlled draft write

- Run `v97-150i-downstream-contract-v2` reused the already completed 150-row
  Qwen/Gemma source review and replayed only the downstream contract. Qwen
  generated 93 structurally valid entries, final Gemma accepted 77 without
  correction, and the structured-repair path added 5 more. The final safe yield
  was `82/100`, so the sustained no-write gate passed the required 80% threshold.
- The definition contract is now applied deterministically after generation.
  Final consensus also treats source-backed deterministic readings and
  pronunciations as authoritative instead of rejecting them from model memory.
- The 77 initial and 5 repaired entries were rebuilt with
  `build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs`. A
  controlled replay requires matching Qwen generation, deterministic reverse
  evidence, and independent Gemma no-correction acceptance before any write.
- Before writing, the product DB was backed up as
  `data/processed/backups/linguago-v97-before-controlled-draft-20260814-161205.db`.
  The source and backup SHA-256 were both
  `D9E67D1D7E03520EDABC8738CFE1DEDB8FAA6B0C2D7F5E7C1E6AF785F3D11A82`.
- The controlled replay inserted 82 `draft_single_source` senses, 328 review
  localizations, and 82 source links. It did not write accepted/publishable data.
  Repeating both replay commands matched zero pending rows and wrote zero new
  records, confirming idempotent resume behavior.
- Post-write `npm run check`, product fast audit, and published-risk audit all
  passed. `flagged_senses=0`, `bad_sense_localization_counts=0`,
  `duplicate_sense_orders=0`, all orphan counts are zero, and accepted sense
  count remained unchanged.
- Reassembling all current retry lanes at sense level produced 749 candidates.
  Deterministic hint reverse evidence supported 636; after excluding existing
  accepted/draft source links, 511 fresh candidates remain (`pt-BR=472`,
  `ja=37`, `zh=2`). This supports a 500-candidate validation batch, but does not
  imply 500 accepted drafts. The current pool remains strongly Portuguese-heavy;
  broad Chinese/Japanese scaling still requires additional independent source
  coverage rather than lowering evidence gates.

## 2026-08-14: v97 500-candidate dynamic three-reviewer gate

- A 500-candidate fresh cohort was selected from the 749-sense scale pool. Its
  source distribution was `pt-BR=463`, `ja=35`, `zh=2`; use this run to validate
  throughput and the production contract, not language-balanced coverage.
- The first run exposed a remote orchestration bug. Closing a foreground SSH
  cell did not necessarily terminate the jump-host Node child, and a second
  resume could race the first process while both wrote the same report. The
  manager now writes a foreground PID controller, stops the complete process
  tree with `taskkill /T`, and passes `--resume true` to source review,
  generation, final review, and repair stages. Never trust the contaminated
  `v97-scale-review500j-production-gate` final report as a quality denominator.
- Review capacity is now stage-dynamic. A6000-144 (`11442`) and A6000-155
  (`11445`) are elastic Unsloth Studio nodes and switch to the requested Gemma
  model; A6000-147 (`11444`) remains the stable Gemma worker. The topology uses
  all three with one worker per endpoint. Studio model switching must replace
  the current model process, not launch a second standalone llama/vLLM server.
- Clean replay `v97-scale-review500j-dynamic3-clean` reused the immutable source
  review reports and regenerated all downstream reports under a new run ID.
  The source funnel was 500 input -> 409 Qwen approved -> 312 Gemma approved ->
  309 reverse-supported. Qwen produced 293 valid entries. Final Gemma accepted
  243, and structured repair added 11, for `254/293 = 86.7%` safe generation
  yield and zero database writes.
- Final review work was distributed across all elastic reviewers:
  `11442=83`, `11444=96`, `11445=111`, plus three failed requests. Repair review
  distributed `4/5/5`. The complete downstream replay took about 12.2 minutes.
- The 243 initial and 11 repaired no-correction results were then rebuilt as
  controlled-consensus replay reports. Dry-run accepted all `254/254`. After a
  second backup
  (`data/processed/backups/linguago-v97-before-scale500-drafts-20260814-174950.db`,
  SHA-256 `C57175E6CD5B584D73116EB28B270DD1FA1B1151308E21DCF269238C3689D62B`),
  the replay inserted 254 `draft_single_source` senses and 1,016 review
  localizations. A repeated apply wrote zero rows. Product fast audit and
  published-risk passed with publishable senses unchanged at 37,764 and
  `flagged_senses=0`.
- This is stage-level parallelism with dynamic model assignment. Whole-batch
  source review still precedes generation. A future streaming pipeline may
  overlap Qwen and Gemma chunks, but it must retain report fingerprints,
  per-chunk locks, and immutable stage inputs; do not trade auditability for
  overlap until the 2,000-row stress gate is complete.

## 2026-08-14: post-500 capacity and CFDICT pivot feasibility

- Recomputing strict retry capacity after the 82-row and 254-row controlled
  draft writes leaves only 114 production rows (94 unique source entries) and
  391 multi-hint review rows. This is not enough for a 2,000-row stress gate.
- The 114-row no-write run `v97-after-scale500-production114` completed with
  healthy transport: Qwen source review approved 78, Gemma source review
  approved 56 with zero Gemma transport/parse failures, and exact consensus
  reverse evidence retained 39. Generation selected 24 after excluding 15
  already-complete source-gap groups, produced 17 structurally valid entries,
  and final Gemma accepted zero. Repair also accepted zero. The final rejects
  were substantive target-term/POS/reading errors, including carmine versus
  magenta, matriarchy versus matrilineality, and noun/adjective mismatches.
  Do not write these reports to draft or weaken the final reviewer.
- Repeated source entry IDs in the run are distinct source senses. The input
  has 114 unique `source_entry_id:first_sense_id` keys, so do not collapse them
  as duplicates merely because the entry ID and headword repeat.
- FreeDict `eng-zho` and `eng-jpn` version `2025.11.23` explicitly state that
  they are automatic WikDict imports based on Wiktionary through DBnary. They
  remain the `wiktionary` family and cannot add an independent vote.
- CFDICT was independently verified from its data header: version 2018-11-12,
  about 50,705 Chinese-French translations, CC BY-SA 3.0, maintained by Chine
  Informations. FreeDict `eng-fra` 0.1.6 is GPL 2.0-or-later and originated
  from Ergane/TravLang, not Wiktionary. The scripts
  `probe-cfdict-freedict-source-gap-evidence.mjs` and
  `export-cfdict-freedict-pivot-evidence.mjs` implement an exact normalized
  English -> French -> Simplified Chinese pivot with preserved provenance.
- The broad probe matched 5,135 candidates but retained only 53 possible
  second-family candidates after excluding zero-family and known conflict
  lanes. The authoritative full prefilter, with the exact baseline policy
  including global strong family `wikidata`, increased strict capacity only
  from 1,486 to 1,490. The four new senses belong to only two Portuguese bird
  entries, `sabiá` and `tordo`, aligned to `thrush -> 鸫`. CFDICT is valid
  supplemental evidence but does not solve scale capacity.
- Keep the 2,000-row gate blocked until another genuinely independent Chinese
  and Japanese lexical source is integrated. Tatoeba or generic parallel
  sentence co-occurrence remains example evidence, not word-sense publication
  evidence.

## 2026-08-14: elastic three-node review scheduler hardening

- Live topology status confirmed A6000-144 (`11442`), A6000-147 (`11444`), and
  A6000-155 (`11445`) were all reachable, had Gemma 4 31B installed and loaded,
  used context 2048, and reported `n_cpu_moe=0` with no CPU fallback.
- The apparent single-node review was an orchestration/observability problem.
  Candidate review now builds workers only from successfully prewarmed
  endpoints, and both review scripts report per-endpoint completed counts.
- A 9-item final-review smoke test used all three nodes (`11442=2`, `11444=3`,
  `11445=3`; one persistent invalid-JSON item). This proves 144 and 155 are
  active workers rather than merely listed endpoints.
- Elastic switching is implemented by `scripts/lib/unsloth-elastic-model.mjs`.
  On 155, a real Gemma -> Nemotron -> Gemma round trip used explicit unload,
  readiness waits, and load; each transition took about 6-8 seconds and ended
  with no CPU fallback. Reusing an already-correct model does not unload it.
- Transport and invalid-JSON failures now rotate through every healthy node.
  If every reviewer still fails, the candidate becomes `manual_review` with an
  endpoint-attempt trace. It cannot be accepted, but it no longer stops the
  rest of a large batch. The persistent `warthog` sample demonstrated why this
  fail-closed queue behavior is necessary: all three Gemma nodes entered the
  same malformed Portuguese correction loop even with a larger token budget.

## 2026-08-15: semantic-preview and JMdict generation gates

- The earlier 534-row path produced 189 structurally valid generations but
  only 146 final safe accepts (`77.25%`). Final rejects were dominated by target
  term scope and by Japanese terms whose requested reading was absent from, or
  ambiguous in, JMdict. Field-only retries did not improve unique yield.
- The remote runner now builds a four-language semantic preview from locked
  source-review terms and definitions, asks Gemma for an independent full
  contract review before generation, and then runs a deterministic JMdict
  generation preflight. The preflight permits kana-only Japanese terms or an
  exact JMdict spelling with one unique reading. Ambiguous/not-found terms go
  to manual review instead of being generated with a guessed reading.
- The integrated 152-row production gate retained 65 semantic candidates and
  48 JMdict-ready candidates. Seven were already complete; Qwen generated
  `41/41` valid entries and Gemma accepted `36/41` (`87.8%`). Network and JSON
  failures were zero and automatic database writes were zero.
- The wider 534-row replay retained 183 semantic candidates and 150
  JMdict-ready candidates. After 17 existing rows were skipped, Qwen generated
  `133/133` valid entries. Gemma accepted 122 directly and two safe structured
  repairs, for `124/133` (`93.2%`).
- The full 1,690-row strict-pool stress run survived four local SSH wait-window
  expirations by resuming the same manifest and per-stage reports. Source
  review retained 1,179 Qwen and 889 Gemma approvals; exact reverse evidence
  retained 826. Semantic preview accepted 718 and JMdict preflight retained
  643. Existing links skipped 388, so Qwen attempted 255 new generations and
  validated `254/255` (`99.6%`). Final Gemma accepted 230 directly and seven
  safe repairs, for `237/254` (`93.3%`). Every model stage reported zero
  infrastructure/parse failures and the run wrote no database rows.
- Controlled replay was tested on fresh product-DB copies. The accepted package
  wrote 237 draft senses and 948 review localizations; repeated replay wrote
  zero rows. The required order is initial replay -> initial deterministic
  promote -> repair replay -> repair deterministic promote. With that order,
  all `237/237` promoted on the copy. Publishable senses increased from 37,764
  to 38,001 and `flagged_senses=0`; fast audit reported zero missing four-lang
  localizations, duplicate sense orders, orphans, mojibake, and HTML artifacts.
- The production DB hash remained unchanged. The frozen path is quality-stable
  at 1,690 input rows, but the current strict pool supplies only 255 genuinely
  new generation attempts. The remaining blocker for a 500-new-sense write
  gate is fresh independent lexical evidence, not model transport or JSON.
## Qwen3.8 27B evaluation on A6000-155 (2026-08-15)

- Model: `unsloth/Qwen3.8-27B-GGUF`; tested variants:
  `UD-Q4_K_XL` and `UD-Q8_K_XL` on endpoint `11445`.
- Do not load this vision GGUF with the Studio default `n_parallel=4` on 155.
  The first load included the 0.9 GB `mmproj`, reached an 87.8 GB service
  memory peak, and was killed by `systemd-oomd`. The stable text-workflow load
  uses `max_seq_length=2048`, `n_parallel=1`, `cache_type_kv=q8_0`,
  `speculative_type=off`, and full GPU offload.
- Under the real product JSON contract, both variants scored `114/120` across
  three repeats (`38/40` per repeat) with `9/9` valid JSON responses. Both
  repeatedly missed the required Japanese `{kanji|reading}` annotation in the
  full sentence and word tasks; quantization did not change this behavior.
- Q4 median latency was 3.314 s preview, 16.860 s full sentence, and 21.831 s
  full word entry, using 17,932 MiB in `llama-server`. Q8 was slower at 4.471 s,
  24.524 s, and 33.457 s, using 29,974 MiB. Q8 offered no contract-quality gain.
- A 20-row real source-gap review with Q4 produced 20/20 structurally valid
  reviews and zero API/JSON failures. Under the current strict evidence and
  definition gates it approved 2, rejected 16, and sent 2 to manual review.
  This proves API compatibility but not a quality or throughput advantage over
  the current Qwen3.6 generation plus Gemma final-review topology.
- Operational decision: do not replace the production generator or final
  reviewer with Qwen3.8 yet. Q4 may be kept as an experimental fallback or used
  for targeted semantic comparison after adding an explicit Japanese-reading
  repair/retry. Do not schedule Q8 for dictionary production on A6000.
- Reports are local runtime artifacts under `logs/qwen38-27b-*` and remain
  uncommitted. After the evaluation, 155 was restored to
  `unsloth/gemma-4-31B-it-qat-GGUF / UD-Q4_K_XL`, context 2048, parallel 1,
  Q8 KV cache, speculative decoding off, and no CPU fallback.

## v98 CedPane independent Chinese evidence (2026-08-15)

- CedPane `PD-English-Definitions.tsv` is public-domain/PDDL data and is kept
  under `.tmp/cedpane`; the names-focused main file is not used for the common
  source-gap queue.
- The production probe requires exact simplified-Chinese term equality and
  bidirectional English content-token coverage of at least 0.67. The earlier
  smaller-set overlap rule was unsafe because `Maltese` could satisfy
  `Maltese dog`.
- The corrected probe matched 141/600 near-unlock Chinese targets and exported
  99 unique terms. The repaired candidate-bound export contains 151 evidence
  rows. The pre-binding isolated strict pool had 1,989 rows after
  fixing proper-name detection for lowercase connectors such as `and`.
- New source review remained structurally stable: Qwen approved 17/20 in the
  second fresh cohort and 4/5 in the remaining unseen tail, with zero JSON or
  transport failures. The corrected aggregate is 21/25 (84%), below the 90%
  expansion gate. No product DB, D1, cache, or Worker write followed.
- Target repair suggestions must send `enable_thinking=false`; the old helper
  exhausted its short response budget and returned no JSON. Gemma then returned
  valid suggestions, but deterministic two-family validation retained only
  `あたら -> 呜呼` and `entonação -> 语调` from the first rejected cohort.
- Next action: improve sense/POS-bound target selection or acquire another
  independent open lexical source. Do not rerun the same entries or lower the
  evidence threshold to reach a nominal batch size.
- `npm.cmd run check:source-gap-lexical-contract` now protects the two repaired
  failure modes: one-sided phrase overlap and proper names containing lowercase
  connectors. The CedPane probe was rerun after sharing this contract and kept
  the corrected `141/600` result.
- A later audit found that the CedPane exporter put candidate IDs only in the
  provenance table. Since the prefilter binds on `lexical_evidence.concept_id`,
  this allowed evidence to cross aligned senses. The exporter now emits only
  `candidate:<entry>:<sense>` concept IDs and aborts on any unbound row.
- Rebuilding with `.tmp/combined/v98-cedpane-mainland-evidence-v3.db` reduced
  the strict pool from 1,989 to 1,966 and removed 23 leaked candidates,
  including `lantejoula`. No unreviewed candidate-bound CedPane rows remain.
- A fresh strict-v4 general sample produced 20/20 valid Qwen reviews but only
  8 accepts, 10 rejects, and 2 manual reviews. The remaining pool is not ready
  for direct generation; English-anchor polysemy, pt-PT regional terms, and
  grammatical-form mismatches still require semantic source review.
- Gemma source review retained 6/8 Qwen accepts. Qwen full-record generation
  then passed 6/6, and deterministic reverse evidence supported all six, but
  final Gemma no-correction review retained only four. It rejected
  `prevalência` for mixed general/medical/dominance senses and `automação` for
  automation-versus-mechanization drift. The complete fresh funnel is
  `20 -> 8 -> 6 -> 6 -> 4`; no product DB rows were written.

## v98 shared-concept lexical regression (2026-08-15)

- `scripts/select-dictionary-v2-source-gap-shared-concept.mjs` selected 506
  strict candidates sharing a locked OMW or Wikidata concept. After complete
  history exclusion only `キロリットル` and `いかめしい` were unseen, so this
  selector is not a new large-scale pool.
- `キロリットル` passed source review and deterministic reverse evidence in
  the first run, but final Gemma correctly rejected Portuguese `metro cubico`:
  it is an equivalent volume, not the lexical translation `quilolitro`.
- The prefilter now builds reverse target indexes for Portuguese, Japanese,
  and Chinese, expands every component of a semicolon-delimited English
  anchor, and ranks exact earlier anchor matches before broader co-synset
  alternatives.
- With the corrected hint, `quilolitro` is preferred, but it currently has
  only one independent family (Wiktionary). The candidate is therefore
  rejected before LLM generation by
  `insufficient_independent_target_evidence`. This is the intended behavior.
- Operational rule: shared concepts improve recall but never replace lexical
  equivalence or the independent-family publication gate. Kaikki and WikDict
  remain one Wiktionary family. No product DB, D1, cache, or Worker write was
  made during this validation.

## v98 Dicionario target evidence and mainland unit repair (2026-08-15)

- Added `scripts/probe-dicionario-aberto-target-terms.mjs`. It extracts the
  first preferred Portuguese target hint from a rejected source-gap candidate,
  binds it to the original entry/sense, and finds exact headword plus POS-bound
  definitions in Dicionario Aberto XML.
- For `キロリットル`, the source definition is `Medida de mil litros.` Qwen
  approved it at 0.95 and Gemma at 1.0. The resulting supplemental evidence is
  bound to `candidate:2703418:2703418` and adds the independent
  `dicionario-aberto` family beside Wiktionary for `quilolitro`.
- Fixed the old Dicionario exporter so all future reviewed definitions use
  `candidate:<entry>:<sense>`. The prefilter treats the legacy
  `dicionario-aberto-definition:<entry>:<sense>` format as bound during the
  migration period; it must not be considered global evidence.
- The first full replay was rejected by Gemma because Chinese `立方米` is only
  numerically equivalent. Reverse target selection now includes WikDict
  Chinese, canonicalizes UK/US `litre/liter` and `metre/meter` variants, and
  prefers mainland `千升` over `公秉`, `千公升`, `竏`, and `千竔`.
- The corrected lock `kiloliter / quilolitro / 千升 / キロリットル` passed the
  complete dry-run pipeline with final Gemma confidence 1.0. Qwen generation
  took 1.72 seconds and produced complete four-language localizations with IPA
  or readings. Automatic database writes remained zero.
- `run-dictionary-v2-remote-pipeline.mjs` now loads `.env.local` through the
  shared loader and skips structured correction when a batch has no generated
  rows, avoiding the old empty-consensus failure.
### 2026-08-15 v98 mainland Chinese hint ranking

- Fixed Chinese reverse-gloss selection so source insertion order no longer
  truncates common mainland terms before ranking.
- Ranking order is lexical anchor, narrow mainland form preference, product DB
  frequency rank (including simplified/traditional variants), then evidence
  family count.
- Full v13 prefilter: 1,966 input, 1,475 supported/selected, 491 unsupported.
- `敏い / clever` now uses `聪明`, `机灵` instead of `㑇` and is supported.
- The 11-row Dicionario Aberto target batch produced no direct unlock: its
  remaining blockers are Chinese independent-source deficits.
- Frequency caching reduced the full rerun from 149.6s to 27.0s.
- Candidate-bound audit: 1,398 rows, 1,966 validations, zero violations.
- This stage performed no product DB write and no D1 deployment.

## v98 pressure-489 controlled production write (2026-08-15)

- The current strict mainland-oriented pool supplied 489 fresh candidates. The
  frozen remote pipeline retained 325 Qwen source approvals, 215 dual-model
  source approvals, 194 source-reverse-supported rows, 170 semantic-preview
  approvals, and 149 JMdict-ready generation candidates.
- Qwen generated 147/148 structurally valid records. Deterministic reverse
  evidence supported all 147. Final Gemma accepted 141 without correction; a
  separately regenerated, revalidated, and re-reviewed repair added one. The
  final package is therefore 142 records, with zero infrastructure failures.
- Controlled replay was first tested against
  `.tmp/validation/linguago-v98-pressure489-write-audit.db`. Base replay wrote
  141 draft senses and a repeated replay wrote zero rows. After base promote,
  the repair replay wrote one draft. The exact 142-sense checkpoint promoted
  142/142 after separate reverse-evidence and Gemma semantic mappings.
- The same sequence was then applied to the main product DB only after the
  source/copy hash matched. The pre-write backup is
  `data/processed/backups/linguago-v98-before-pressure489-accepted142-20260815-200655.db`;
  SHA-256 is
  `BF6D12E4C366E76070A9FDAC896486366E2BAB07519259E66DF8BCF387F3AF9D`.
- Main-DB delta is 139 accepted entries, 142 accepted senses, and 568 accepted
  localizations. The native publishable export now contains 31,686 entries,
  37,996 senses, and 151,984 sense localizations.
- `npm run check`, fast audit, published-risk, native export, and full in-memory
  import all pass. `flagged_senses`, bad localization counts, duplicate sense
  orders, orphans, mojibake, HTML artifacts, and import mismatches are zero.
  Duplicate localization groups remain an observational warning.
- D1 and Worker were not updated. The current strict expanded pool is about
  1,523 candidates, so the model/write pipeline is scale-qualified but there
  is not yet a defensible 5,000-candidate evidence-qualified production pool.

## v98 remaining strict-pool production run (2026-08-15)

- Re-selecting from the 1,523-row strict pool after the pressure-489 write left
  only 445 fresh, entry-unique candidates: 82 Japanese, 360 Portuguese, and
  three Chinese. This is the current evidence-qualified capacity, not a
  500-row batch.
- Run `v98-mainland-production445-v18` used three Qwen endpoints and three
  Gemma endpoints with fixed model roles and no elastic model switching. All
  remote stages completed with zero infrastructure or JSON failures.
- The measured funnel was 445 input -> 242 Qwen source approvals -> 128
  Qwen/Gemma source consensus -> 100 source-reverse-supported -> 70 semantic
  preview accepts -> 40 JMdict-ready -> 36 valid complete generations -> 30
  final Gemma accepts. Two structured repairs were attempted; neither produced
  an additional final acceptance.
- The 30 accepted records replayed and promoted 30/30 in an isolated copy, then
  passed fast audit, published-risk, native export, and full memory import.
  The same exact replay was applied to the main DB after backup.
- Pre-write backup:
  `data/processed/backups/linguago-v98-before-production445-accepted30-20260815-203757.db`.
  SHA-256:
  `6D22645143FBA1EC125D097815A4F235D37B83DAF54DB957018F56D9A40B46FD`.
- Current main publishable export contains 31,716 entries, 38,026 senses, and
  152,104 sense localizations. All blocking audit fields and
  `flagged_senses` are zero. D1 and Worker remain unchanged.
- Do not rerun the rejected 415 rows unchanged. The dominant losses are source
  semantic/POS disagreement and non-unique or absent JMdict readings. Add
  candidate-bound independent evidence or deterministic Japanese reading
  alignment, rebuild the attempt index, and select only materially upgraded
  rows for the next model run.

## v98 kana-normalized JMdict recovery (2026-08-15)

- `report-dictionary-v2-remote-run-rejection-triage.mjs` partitions a completed
  run by first exit stage. Production445 closes as `30 accepted + 415 remaining
  = 445`.
- JMdict preflight now treats hiragana and katakana spellings of the same
  reading as equivalent. It does not collapse genuinely different readings
  such as `運命: うんめい/さだめ`.
- This unlocked nine rows: Qwen generation and deterministic reverse evidence
  passed 9/9, and Gemma accepted seven without correction. `雄鳥` was rejected;
  `missô` remains manual review.
- The seven rows passed isolated replay/promotion before exact main-DB replay.
  Backup: `data/processed/backups/linguago-v98-before-kana7-20260815.db`.
- Native publishable counts are now 31,723 entries, 38,033 senses, and 152,132
  localizations. All blocking audits and `flagged_senses` are zero. D1 and
  Worker remain unchanged.

## v98 JMdict priority-reading recovery (2026-08-15)

- After kana normalization, 21 reading-blocked candidates remained. JMdict
  `re_pri` tags safely identified a single common reading for nine of them;
  examples include `子牛=こうし`, `運命=うんめい`, and `微風=そよかぜ`.
- Qwen produced seven structurally valid rows. `仕合せ` and `微風` supplied
  model readings that did not match the locked JMdict readings, so deterministic
  validation rejected them. This is expected behavior; priority selection does
  not permit model overrides.
- Reverse evidence supported all seven valid rows. Gemma accepted six without
  correction and rejected `famigerado`. The six passed isolated replay and
  audit before main replay. Backup:
  `data/processed/backups/linguago-v98-before-priority6-20260815.db`.
- Native publishable counts are 31,729 entries, 38,039 senses, and 152,156
  localizations. Full export/import and all blocking audits pass with
  `flagged_senses=0`. Twelve preflight reading rows remain: nine genuine
  ambiguities and three terms absent from JMdict. D1 and Worker were not changed.

## v98 locked-reading normalization fix (2026-08-15)

- The generator previously validated `generation_contract.ja_reading` but did
  not apply it before validation unless the term had one globally unique JMdict
  reading. `applyGenerationContractReading` now writes the locked reading only
  when the generated Japanese term exactly matches the locked term.
- The targeted retry proved the fix: `仕合せ` and `微風` both passed reading
  validation on their first attempt. Reverse evidence supported both. Gemma
  accepted `微風` and rejected `仕合せ` on semantic/part-of-speech grounds.
- `微風` passed isolated replay/promotion and was then added to the main DB.
  Backup: `data/processed/backups/linguago-v98-before-priority-reading1-20260815.db`.
- Native publishable counts are 31,730 entries, 38,040 senses, and 152,160
  localizations. Full export/import and all blocking audits pass with
  `flagged_senses=0`. D1 and Worker remain unchanged.

## v98 Kaikki sense-bound Japanese reading recovery (2026-08-15)

- `resolve-dictionary-v2-source-gap-kaikki-ja-readings.mjs` resolves a reading
  only when the written Japanese term is exact, the English anchor occurs in
  the same Kaikki entry, and the matched entry has one canonical ruby reading.
  Ruby is preferred over `sounds.other`, so `たいようけん` and the phonetic
  spelling `たいよーけん` are not treated as separate lexical readings.
- Four of the twelve residual rows were safely unlocked:
  `木屑=きくず`, `織工=しょっこう`, `落葉松=からまつ`, and
  `太陽圏=たいようけん`. Eight remain unresolved because they are absent
  from the exact Kaikki pool or retain multiple readings for the same sense.
- The generator may bypass the JMdict existence check only for the explicit
  `deterministic:kaikki-exact-term-anchor-sense` contract, and only when both
  generated term and reading exactly match it. Model-provided source labels do
  not receive this privilege.
- Qwen generated all four rows. Reverse evidence supported three;
  `heliosfera` stayed in manual review because its Chinese and Japanese reverse
  evidence came only from the Wiktionary family. Gemma accepted the remaining
  three without correction.
- `木屑`, `tecelã`, and `落葉松` passed isolated replay/promotion before exact
  main-DB replay. Backup:
  `data/processed/backups/linguago-v98-before-kaikki-ja3-20260815.db`.
- Native publishable counts are now 31,733 entries, 38,043 senses, and 152,172
  localizations. TypeScript, fast audit, published-risk, native export, and
  full in-memory import all pass with every blocker and `flagged_senses` at
  zero. D1 and Worker remain unchanged.

## v98 Japan MOJ legal-reading recovery (2026-08-15)

- `resolve-dictionary-v2-source-gap-japan-moj-ja-readings.mjs` uses the
  Japanese Ministry of Justice legal terminology CSV only for an exact official
  Japanese stem plus `する`. The English anchor must match exactly or through
  the explicit `-ate` to `-ation` derivation handled by the resolver.
- This unlocked one residual: `expropriar -> 収用する[しゅうようする]`.
  Qwen generation, four-language reverse evidence, and independent Gemma
  no-correction review all passed. The row then passed isolated replay and
  promotion before the exact main-DB replay.
- WaDoku was useful for diagnosing the remaining readings, but it was not used
  as publishable evidence because its license compatibility has not been
  cleared for this product. Do not bypass this boundary in later recovery work.
- Backup: `data/processed/backups/linguago-v98-before-japan-moj1-20260815.db`.
  Native publishable counts are now 31,734 entries, 38,044 senses, and 152,176
  localizations. TypeScript, fast audit, published-risk, native export, and
  full in-memory import pass with all blockers and `flagged_senses` at zero.
  Seven Japanese-reading residuals remain. D1 and Worker remain unchanged.

## v98 NDLSH Japanese reading recovery (2026-08-15)

- `resolve-dictionary-v2-source-gap-ndla-ja-readings.mjs` reads the official
  National Diet Library Subject Headings (NDLSH) TSV. Production evidence is
  restricted to exact preferred headings or exact bracketed synonyms with a
  matching English authority term. A narrow `preferred heading + 学` derivation
  is allowed only when an authority source title contains the complete derived
  Japanese term. The asphalt/bitumen equivalence is an explicit resolver rule,
  not a general synonym expansion.
- The source is identified as `deterministic:ndla-subject-heading`. Preserve the
  NDLA authority URI, LCSH identifier, source title, input SHA-256, and the
  attribution policy in the generated contract. Any reuse or publication must
  state that the data was obtained from Web NDL Authorities, as required by the
  official terms at `https://id.ndl.go.jp/information/use/`.
- Seven reading residuals were evaluated. Three obtained locked readings:
  `内分泌学=ないぶんぴがく`, `公孫樹=こうそんじゅ`, and
  `瀝青=れきせい`. `endocrinologia` was not promoted because its Chinese
  reverse evidence remained Wiktionary-family only. `公孫樹` and `瀝青`
  passed Qwen generation, deterministic reverse evidence, independent Gemma
  no-correction review, isolated replay/promotion, and exact main-DB replay.
- Main-DB backup:
  `data/processed/backups/linguago-v98-before-ndla2-20260815.db`.
  Native publishable counts are now 31,736 entries, 38,046 senses, and 152,184
  localizations. TypeScript, script syntax, fast audit, published-risk audit,
  native export, and full in-memory import all pass. All blocking fields and
  `flagged_senses` are zero. D1 and Worker remain unchanged.
- Remaining reading work is `catabolismo`, `耳朶`, `filiforme`, and `雌蕊`;
  `endocrinologia` remains a separate manual semantic-evidence review. Do not
  infer readings for these rows from model agreement alone.

## v98 Japanese public-institution reading recovery (2026-08-15)

- `config/dictionary-overrides/japan-official-reading-evidence-v98.json` is a
  candidate-bound evidence registry, not a general dictionary. Every row locks
  the source entry/sense ID, source word, English anchor, Japanese written form,
  primary reading, variants, authority URL, and exact match rule.
- `resolve-dictionary-v2-source-gap-japan-official-ja-readings.mjs` rejects a
  row unless all of those fields match. The generator trusts the resulting
  `deterministic:japan-official-reading-evidence` contract only on exact
  generated Japanese term/reading equality.
- Official evidence resolved all four remaining reading rows:
  - JICA: `catabolismo -> 異化作用[いかさよう]`.
  - MHLW ICD index: `耳朶[みみたぶ]`, retaining `じだ` as an attested variant.
  - Ministry of the Environment: `糸状[しじょう]`, retaining `いとじょう` as
    a source/JMdict variant.
  - NARO: `雌蕊[めしべ]`, retaining the official variant `しずい`.
- Qwen generation, four-language deterministic reverse evidence, and
  independent Gemma no-correction review passed 4/4. The exact replay passed
  isolated draft write/promotion and all audits before main-DB replay.
- ECDICT phonetic values are no longer copied as bare display text. The runner
  preserves `ecdict-phonetic` as the source system while normalizing stress,
  length marks, whitespace, and `/.../` display boundaries. It does not relabel
  ECDICT notation as standard IPA.
- Main-DB backup:
  `data/processed/backups/linguago-v98-before-japan-official4-20260815-224853.db`.
  Native publishable counts are 31,740 entries, 38,050 senses, and 152,200
  localizations. TypeScript, syntax, fast audit, published-risk, native export,
  and full in-memory import pass with all blockers and `flagged_senses` at zero.
  D1 and Worker remain unchanged.
- The Japanese-reading residual queue is now empty. The initial
  `endocrinologia` review used the older
  `openwn-word2word3-ja-apertium-wikidata-v3-evidence.db` and therefore saw only
  Wiktionary-family Chinese evidence. Revalidation against
  `.tmp/combined/v98-mainland-evidence-v8.db` found independent ECDICT mainland
  Chinese evidence for `endocrinology -> 内分泌学`; all four languages then
  passed reverse evidence and Gemma accepted the unchanged generation with
  confidence 1.
- `endocrinologia` passed isolated write/promotion before exact main replay.
  Backup:
  `data/processed/backups/linguago-v98-before-endocrinologia-20260815-225225.db`.
  Its ECDICT English display phonetic was then normalized from the legacy
  `/.endәukri'nɒlәdʒi/` notation to `/ˌendəukriˈnɒlədʒi/`, while retaining
  `pronunciation_system=ecdict-phonetic` rather than claiming standard IPA.
  The exact pre-correction backup is
  `data/processed/backups/linguago-v98-before-endocrinologia-phonetic-20260815-225543.db`.
  Final native publishable counts are 31,741 entries, 38,051 senses, and
  152,204 localizations. All blocking audits and `flagged_senses` remain zero.
  When revalidating an old report, always record the supplemental evidence DB;
  evidence-family conclusions are not portable across evidence DB versions.

## v98 daily-vocabulary scale gate (2026-08-15)

- Daily/common vocabulary is now selected before broad source-gap expansion.
  `rank-dictionary-v2-product-daily-coverage-gaps.mjs` cross-checks two frequency
  lists per language, and `select-dictionary-v2-product-daily-primary-senses.mjs`
  binds each entry to the primary CC-CEDICT or JMdict sense instead of trusting
  the first merged sense.
- `select-dictionary-v2-product-daily-scale-cohort.mjs` is the final cohort gate.
  It removes entries already queryable through a published localization,
  excludes numeric/proper/specialized topics, deduplicates equivalent concepts
  across source languages, balances zh/ja quotas, and never marks a row
  publishable.
- Daily-first scale generation is verified as of 2026-08-16. Always run
  `filter-dictionary-v2-source-gap-jmdict-generation-preflight.mjs` after Qwen
  source review and before complete-entry generation. The measured valid rate
  was 93.53% with the corrected preflight versus 85.80% without it. The
  corrected gate allows `suggested_terms.ja` only with an exact, unique-reading
  JMdict match; this is a generation constraint, not publication evidence.
  Large dry-runs now persist checkpoints and can resume without duplicate model
  calls.
- Important failed approaches:
  - taking the first 50,000 merged gaps starved Chinese candidates because the
    report was ordered by localization count;
  - requiring all four target languages to have two independent dictionary
    families before generation reduced a real gap batch to zero;
  - relying on the model to reject names or duplicate concepts allowed rows such
    as Puerto Rico, Chechnya, and duplicate wheat concepts through;
  - OpenCC did not normalize the variant `擡`, so the generator now applies a
    narrow mainland variant normalization after OpenCC;
  - definition contracts produced before final Gemma review must use
    `deterministic:reviewed-definition-contract`, not claim a Gemma lock.
- The corrected 20-row gate achieved 19/20 Qwen source accepts, 19/19 valid
  generations, and 18/20 final Gemma accepts after one bounded correction pass.
- The deduplicated 100-row gate achieved 94/100 Qwen source accepts, 91/94 valid
  generations, 76 first-pass Gemma accepts, and 12 additional fresh Gemma
  accepts after one bounded structured-correction pass: 88/100 final accepts.
  Qwen endpoints 11447/11448 had zero network failures. Gemma endpoint 11444 had
  zero failed reviews; one row returned manual review and remains unpublished.
- Deterministic reverse evidence is recorded separately from model consensus.
  Missing Portuguese reverse-dictionary coverage does not become independent
  evidence merely because Qwen and Gemma agree. Such rows may be retained as
  reviewed drafts with lower confidence, while automatic promotion remains
  limited to the configured evidence policy.
- All reports are under `runs/v98-daily-high-value-v1/`. This phase was dry-run
  only: the product DB, D1, and Worker were not changed. The next safe action is
  isolated draft replay of the accepted cohort, audit, then main draft write;
  do not jump directly to publishable or D1 deployment.

### 2026-08-16 thousand-row daily gate and expansion

- The 1,000-row `core/common` daily cohort completed Qwen generation with
  `942/1000` valid entries and no infrastructure failures. Gemma independently
  reviewed all 942 valid rows: 764 accept, 172 reject, 6 manual, 0 failed.
- The strict generation + reverse-evidence + Gemma intersection contains 357
  rows. A fresh isolated DB accepted all 357 on draft replay and promotion.
  Exact second replay wrote zero entries, senses, localizations, and links.
- Isolated fast audit, published-risk, native export, and full memory-import
  audit passed. The export contains 32,098 entries, 38,408 senses, and 153,632
  localizations. This is validation evidence only; the main DB, D1, and Worker
  were not modified by this gate.
- Fresh baseline comparison is required. Both the current main export and the
  isolated post-batch export report 478 duplicate-localization warnings, so the
  strict batch added zero. Do not compare against an older output directory or
  stale manifest.
- Scale expansion then consumed the remaining 717 cleaned `extended` daily
  rows (`ja=710`, `zh=7`). Qwen generated 692 valid entries (`96.5%`) in 36
  checkpoint chunks, with 25 validation rejects and zero endpoint failures.
  Reports are `108-daily-scale-expansion-remaining.json`,
  `109-daily-scale-expansion717.json`, and its checkpoint under
  `runs/v98-daily-high-value-v1/`.
- The expanded 717-row output is not automatically publishable because these
  rows have deterministic Japanese reading contracts but weak target-language
  dictionary coverage. Run reverse evidence and independent Gemma review before
  building another controlled replay. Generation success is not publication
  evidence.
## 2026-08-19 v117 reviewed target-evidence acquisition

- The v116 residual pool was not sent into another blind 5,000-item model run.
  Its 1,934 aligned candidates contained 89 source-supported senses but zero
  candidates with two target-language lanes. The remaining pool is long-tail;
  only 38 rows rank at or above 10,000 and many are names or specialist forms.
- A Portuguese target-acquisition pilot used Qwen only to propose terms and
  Dicionario Aberto definitions as the independent lexical source. The probe
  originally emitted 33 rows with empty `english_anchor` values; this was a
  binding bug, not terminal mojibake. `probe-dicionario-aberto-target-terms.mjs`
  now preserves the suggestion report's anchor and refuses empty-anchor review
  rows.
- Of 33 repaired definition candidates, Qwen approved 7 and Gemma approved 16
  at confidence 0.90. Exact definition-order intersection exported 7
  candidate-bound `dicionario-aberto` evidence rows. They were merged into the
  local runtime DB `.tmp/combined/v116-dicionario-acquisition-evidence-v11.db`.
- The reverse prefilter previously required an existing strong base-dictionary
  match before considering supplemental evidence, making a reviewed source
  unable to fill a genuinely empty lane. It now permits only an explicitly
  allowlisted source key that is production-publishable, candidate-bound, and
  independently Qwen/Gemma reviewed. Generic supplemental rows remain weak.
  The generated-output validator applies the same rule, preventing prefilter
  and post-generation policy drift.
- This evidence unlocked four prefilter candidates: `半身`, `slain`,
  `reassuring`, and `unwilling`. The v117 controlled no-write run then produced:
  source review 4, Gemma source accepts 3, valid Qwen generations 2, reverse
  supported 0, final accepts 0, and automatic DB writes 0. `半身` had only the
  Wiktionary family for Chinese; `reassuring` had no Chinese reverse evidence.
  These are evidence-capacity failures, not model or network failures.
- `run-dictionary-v2-remote-pipeline.mjs` now skips final Gemma cleanly when the
  supported replay report is empty. The earlier behavior called the reviewer
  with zero targets and incorrectly failed the run. Resume now completes with
  `capacity` represented by zero final accepts and no DB writes.
- A 47-row Chinese target-term pilot generated 47/47 valid Qwen suggestions.
  Deterministic validation against CC-CEDICT and the supplemental evidence DB
  accepted only `matador -> 斗牛士` (`cc-cedict` + `wiktionary`). That repair did
  not yet create a fully qualified candidate because another target lane is
  still missing. Do not count Qwen suggestions as evidence or lower the
  two-family gate to increase yield.
- Current product DB remains unchanged by v117. Fast audit passes with
  `publishable_senses=46500`, zero bad localization counts, duplicate sense
  orders, orphans, mojibake, and HTML artifacts. Published-risk reports
  `flagged_senses=0`.
- Production decision: keep Qwen as the generator and Gemma as the final
  reviewer; stop broad model benchmarking. Run evidence-qualified candidates
  continuously while expanding independent Mainland Chinese and Japanese
  lexical coverage in parallel. Keep reviewer models resident on dedicated
  nodes when possible; per-request model switching is useful for recovery and
  small batches but repeated Qwen/Gemma swaps add cold-start latency.

## 2026-08-19 v122 complete-entry and example pilot

- The current production D1/Worker remains v114. The v122 pilot modified only
  C-drive temporary copies and did not write the main product DB or deploy.
- Exact source-consensus selection produced 90 candidates. Qwen generated
  90/90 structurally valid four-language entries with a Simplified-Chinese
  source example and EN/PT-BR/ZH/JA example localizations. There were zero
  network, JSON, or schema failures.
- Independent Gemma review accepted 67 first-pass entries. One bounded,
  structured correction pass recovered 17 more, yielding 84/90 no-correction
  final consensuses (93.3%). A semantic duplicate preflight then excluded
  `重返`, which already had the same EN/ZH/JA term and definition in the product
  DB. The final isolated replay contains 83 new senses (92.2% of the original
  cohort).
- These 83 senses are `ai_reviewed`, not `verified`. Qwen/Gemma agreement is not
  independent dictionary evidence. Each promoted row records Gemma as
  `review_model` and the evidence labels `gemma-independent-review`,
  `locked-local-dictionary-evidence`, and `qwen-generation`.
- Isolated DB counts after promotion are 41,504 entries, 48,034 senses, 192,128
  localizations, 3,113 examples, and 12,230 example localizations. All 83 new
  examples use `source_lang=zh`, have four localized sentences, and pass the
  Simplified-Chinese check.
- Fast audit, published-risk, full native D1 export, in-memory import, and file
  import pass. Publishable D1 counts are 40,281 entries, 46,593 senses, 186,372
  localizations, 3,113 examples, and 12,230 example localizations. Blocking
  counts remain zero and `duplicate_sense_localizations=663`, exactly matching
  the baseline warning count.
- `check:worker-dictionary-verification` bundles the real Worker adapter and
  queries the exported D1 through a SQLite-backed D1 facade. It verifies that
  an `ai_reviewed` sense returns the review model, evidence-family array, and a
  complete four-language example.
- Always run
  `dict:v2:coverage:filter-existing-semantic-duplicates` after final consensus
  and before draft replay. Against the unfiltered 84-row v122 report it excludes
  exactly `重返` and retains 83 rows. Do not replace this with a manual source-ID
  exclusion in scale batches.
- D: was full during this pilot. Runtime reports, isolated databases, and D1
  exports were placed under `%TEMP%` on C:. Do not delete `.tmp`, `logs`,
  `outputs`, databases, or backups without an explicit disk-cleanup decision.
- Scale decision: this pilot clears the quality threshold for a fresh
  500-candidate isolated validation. It does not yet authorize a 5,000-row main
  DB write. The required progression is 500 isolated candidates, then a 2,000
  candidate checkpoint/resume pressure run, then frozen 5,000-row production.

## 2026-08-20 jump-host migration validation

- The current v123 product DB and required evidence assets are installed at
  `D:\linguago-runner` on `100.99.99.99`. The verifier reports matching hashes,
  Node `v24.16.0`, `better-sqlite3=ok`, `UnslothKey=set`, and healthy ports
  11444-11448. Product DB SHA-256 is
  `BBE5BBAC54A7D14113D9198783CCBCEA31978104804676EA39570F09D4D9F569`.
- Remote background execution uses the fixed Scheduled Task
  `Linguago Remote Dictionary Pipeline` plus a host-wide lock. Do not restore
  the old detached `Start-Process` implementation; Windows OpenSSH tears down
  that child when the session closes.
- No-write migration runs of 20 and 100 candidates completed, including resume,
  empty-funnel checkpointing, an actual Qwen generation call, concurrent-start
  rejection, and lock cleanup. The 100-row run made zero DB writes; its only
  generated row was correctly blocked by the Japanese single-character
  semantic-mismatch validator.
- `agy` 1.1.13 is installed, but unattended `--print` currently requires a
  one-time interactive Google OAuth login. After login it may be invoked by
  `watch-remote-dictionary-runner.ps1 -UseAgy` only as a read-only diagnostic
  layer. Never delegate model switching, process control, SQLite writes,
  promotion, D1 export, or deployment to the agent.
- A positive-path follow-up, `v123-migration-known-good20`, reproduced its local
  result exactly: two candidates passed the complete remote funnel. An isolated
  DB then inserted two drafts, produced zero writes on exact replay, promoted
  2/2, and passed fast, published-risk, native export, and full memory-import
  audits. The main remote DB and D1 were not modified.
- `validate-remote-dictionary-controlled-replay.ps1` now makes that write-path
  test repeatable and rejects the main product DB as a validation target.
- The remote manager's Boolean parameters use explicit string parsing. This is
  required because `[bool]` command-line parameters rejected `false` and `0`
  when invoked through SSH.
- Local development and command issuance now form the control plane; jump-host
  production, DB release, D1 publication, and Worker deployment form the
  execution plane. `scripts/invoke-dictionary-control.ps1` exposes only named
  actions and does not accept arbitrary remote commands.
- Worker source is transferred as a SHA-256-pinned `git archive` of a full
  commit into `D:\linguago-deploy\releases\<commit>`. The remote release gate
  verifies the commit, archive hash, and cache version before any build or
  deployment. A dry-run of HEAD `72194cd3...` passed only with its committed
  cache `v114-production5012-40105`; the uncommitted v123 cache was correctly
  rejected.
- `deploy-remote-worker-release.ps1 -Execute true` records the current Worker
  version before deploy and automatically rolls back if any online dictionary
  regression fails. It has not been executed because the jump-host OAuth token
  is expired and no non-interactive `CLOUDFLARE_API_TOKEN` is currently set.
