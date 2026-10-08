# V219 Retry Deployment Approval

Target: `100.99.99.99`, `D:\linguago-runner`.

Scope: update only the generator and add its two dependencies, then refresh
only these three runner manifest entries. No database, quality-hold, D1,
Worker or unrelated manifest change is included. The existing targeted
manifest updater does not currently authorize these paths or new entries.

| Path | Expected SHA-256 |
| --- | --- |
| scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs | 242A04524B77BCE43D4279A22F7C6D27814253F4C73AD3A63BDD5536EFA6E292 |
| scripts/lib/source-consensus-binding.mjs | 254D29395C4F762FE9E0296EB4ECD7D60DD75861FB4E2DC09AACC2A15476B78E |
| scripts/lib/dictionary-generation-retry-feedback.mjs | 50CE5F051CFBE4BBBAF1D68F175FC4E5A440016C11EBAACE5BD7847AFF41DA9F |

Preflight: remote generator actual and manifest hash both
`BF0D62E05962F246BF87C876237F20CEEDAFB6E790118C7CCA903FCBEC8F7B86`.
Both dependency paths and manifest entries are absent. No active generator
process was found at inspection. Recheck these preconditions before deployment.

Changes provide compact retry error feedback and reject proposal-only inputs
when apply/publish is requested. Unit tests, syntax check and npm check passed.
After authorization: back up affected files/manifest, verify expected old and
new hashes, apply this exact scoped update, run remote syntax checks, then
run the 18-row structure retry with apply=false and no-promote flags.
Do not count the retry as a new qualification cohort or remove the quality hold.

## Authorized Deployment

User explicitly approved this exact scope. Deployment completed on 2026-09-04:
all three installed hashes match the table, syntax checks passed, and unrelated
manifest entries were verified unchanged. Backup on the runner:
`logs/v219-approved-retry-deploy/backup-20260904-162029`.
The 18-row dry-run uses `logs/v219-native-holdout100r-structure-retry-generation.json`
and its matching checkpoint. No extra files were added to the manifest.

## Follow-up Binding Check (Local Only)

The final consensus reviewer and controlled-consensus input builder now require
SHA-256 binding to the generation and reverse-evidence files. These follow-up
changes are not part of the three-file deployment above and have not been
deployed. Existing review reports lack these fingerprints; do not retrofit them
as if the original review recorded the binding.

`node scripts/test-consensus-input-fingerprints.mjs` passes subprocess tests for
missing and changed fingerprints (review resume and input builder both reject),
and matching fingerprints (empty input builder succeeds). Rejected resume leaves
the prior report unchanged. `npm.cmd run check` passes. This test does not certify
semantic quality or authorize draft insertion, hold removal, or production.

## Authorized Two-File Fingerprint Deployment

Read-only preflight on 2026-09-04 confirmed both remote files match their current
manifest entries and no Node process was returned. Recheck before replacement.

| Path | Current remote SHA-256 | Proposed SHA-256 |
| --- | --- | --- |
| scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs | 24BB4F466FE5241C46D9DED786A84390C78927B39D70E461344DD8897B58A132 | 629448DB85266E26542A276882D24902164DAEDDD159F2A509C60766B4697617 |
| scripts/build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs | 0C6E8A5E99858126578C4B7E438E56B76F43524F6895EA8B209410EACD1C96CB | A65DB4A03327CA2532566F6D5B144211C67ABD05AC141FF2F8D87812B61DCE3A |

Requested scope: back up these two files and the manifest, install these exact
hashes, update only their manifest entries, then independently re-review the
20 previously accepted outputs with new report paths and input fingerprints.
Use only currently idle authorized Gemma endpoints after checking external GPU
processes. Preserve the old reports. No database writes, hold removal, D1 or
Worker deployment is included. The user separately authorized this scope and
the 20-row report-only re-review. It completed on 2026-09-04.

Backup: `logs/v219-fingerprint-deploy/backup-20260904-164324` on the runner.
Both installed hashes match the proposed hashes above; only their two manifest
entries changed. The old reports were preserved. The new combined input retains
the exact generated rows and reverse-evidence rows from the three original
batches (15 + 3 + 2), with unique source entry/sense identities and origin hashes.

Gemma 144/147 were reachable and idle with no external GPU process at launch.
Each reviewed 10 rows: 20 valid, 20 accepted without corrections, zero rejected,
manual or failed. Report: `logs/v219-native-holdout100r-bound20-final-gemma.json`.
Verified input SHA-256 values:
- generation: `1d3fc918af98631f533819acb39119407c3846d2af68ff3cf2ccfec29107b803`
- evidence: `3e784d58477b31559a0a9bded25386d7f7c19fadc603428448d3b4b731289a79`

Post-run checks confirmed the database and quality-hold SHA-256 values unchanged
and no Node processes remaining. No drafts were inserted. These selected 20
re-reviews are not a fresh 100-row qualification and do not change 79/100 source
acceptance or authorize 500-row production.

## Source Qualification Follow-up

### Controlled Replay Preservation Follow-up

The subsequent 20-row no-write replay accepted all rows but normalization
changed some final-reviewed translations using older source-review preferences.
That dry-run is not safe authorization for insertion. No draft was written.

Local fix: controlled consensus replay clones the exact reviewed output and
validates it without generation normalization. Ordinary replay is unchanged.
Invalid reviewed output must be rejected, not repaired after final review.
The focused replay preservation test, consensus fingerprint CLI tests,
generator syntax check and `npm.cmd run check` pass. These tests do not replace
a remote 20-row replay dry-run against the authoritative database.

This generator update was NOT included in the completed two-file authorization.
It was separately authorized and deployed on 2026-09-04 as recorded below.
Authorized scope: back up the generator and
manifest, update only this file and its manifest entry, then repeat the same
20-row controlled replay with `apply=false`, without model calls or DB writes.

- Path: `scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs`
- Previously authorized SHA-256: `242A04524B77BCE43D4279A22F7C6D27814253F4C73AD3A63BDD5536EFA6E292`
- Proposed SHA-256: `3BAEFC719FEFA7D7F776DFDF0888D18AF522BA1DBAEAE4C4157CFE1AC0F58AFC`
- Regression: `scripts/test-controlled-replay-preservation.mjs` (local only).

Require a fresh remote hash check before replacement. No hold removal,
promotion, D1 export or Worker deployment is included.

Local full CLI replay also completed against the existing local product DB
opened read-only (not a fresh isolated database). Report:
`logs/v219-native-holdout100r-bound20-preserved-local-dryrun.json`.
All 20 matched and passed validation with `apply=false`, `dry-run=true` and
`publishable=false`; all write counters and the writes array were empty/zero.
Deep comparison by source entry/sense identity confirmed all 20 outputs were
identical to the controlled final-reviewed inputs, including anchors,
localizations and examples. No model was invoked. The local DB can differ from
the remote authoritative DB; remote validation was subsequently completed below.

#### Completed Authorized Remote Replay

Backup on `100.99.99.99`:
`logs/v219-replay-fix-backup-20260904-232216` (generator, manifest, guard hashes).
Preflight confirmed the previous generator hash and its manifest entry matched,
and no Node process was active. Installed hash matches the proposed SHA-256 above.
Only that one manifest entry changed; all other manifest fields were preserved.

Report: `logs/v219-native-holdout100r-bound20-preserved-remote-dryrun.json`
(remote and local copies). Full CLI replay: 20 matched, 20 accepted, zero
rejected, `apply=false`, `dry-run=true`, `publishable=false`, all write counts
zero and empty writes array. Deep comparison by entry/sense identity confirmed
all 20 output objects exactly match the reviewed controlled input.

Post-run SHA-256 checks confirmed the product DB and quality-hold file unchanged;
no Node process remained. No model call, draft insertion, hold removal, promote,
D1 operation or Worker deployment occurred. The original 100-row source-review
qualification remains 79/100; this replay does not authorize 500-row production.

Local triage of the unchanged `v219-native-holdout100r` cohort found 21
nonaccepted source reviews: 19 have unblocked, unlinked alternate senses and
two have none. The native-only diagnostic builder emitted 33 alternatives
across 18 entries, not a new qualifying cohort. Reports:
`logs/v219-native-holdout100r-rejection-triage.json` and
`logs/v219-native-holdout100r-alternate-diagnostics.json`.

Examples of recoverable selection issues include private/personal versus
without permission for the Chinese entry with source ID 846515, and citrus
juice versus ponzu sauce for Japanese source ID 1430118. Other decisions are
not automatically actionable: the tail-wind rejection retains the same anchor,
and literary or low-value entries remain in the diagnostic output. Therefore
33 alternatives must not be submitted as an approved daily production pool.
No source sense was automatically replaced, no model was called, and the
qualification result remains 79 accepted out of the original 100.
