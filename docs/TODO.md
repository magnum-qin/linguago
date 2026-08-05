# TODO

This is the working backlog for future Codex sessions.

## High Priority

- Keep monitoring mobile layout stability after UI changes.
- Keep dictionary-first lookup fast and resilient.
- Add tests for Worker dictionary fallback behavior if the project adopts a test runner.
- Document Louis deployment details once the production server path, systemd service, and sync cron are final.

## Dictionary Pipeline

- Read `docs/dictionary-v83-large-batch-runbook.md` before resuming source-gap
  generation. Production is v84 and matches the audited local publishable set.
- Classify the latest Tier B 100-row batch's nine validation rejects and nine
  evidence rejects. Fix only systematic prompt/filter issues, then run a fresh
  100-row validation.
- Do not start the next 500-row batch until raw generation acceptance is at
  least 90%, infrastructure failures are at most 2%, and deterministic promote
  remains at least 80%.
- Continue expanding accepted word entries in batches.
- Keep validating generated entries before importing them.
- Track accepted / needs-review counts per batch.
- For zh source-gap batches, keep the stricter prompt rule that English and Portuguese terms must be translated target-language terms, not copied Chinese source spellings.
- Next zh expansion can scale from 20 to 100 only if dry-run acceptance remains at least 80% and deterministic promote remains clean.
- Monitor `state/batches/<run>.status` files from remote sync batches and use them when checking progress.
- Consider a lightweight admin endpoint or sync log for Louis dictionary imports.

## Frontend UX

- Keep tab switching animated and dimension-stable.
- Keep settings modal above all cards on mobile and desktop.
- Keep the provider badge compact and dimension-stable, including dictionary hit state.
- Consider haptic-like visual feedback for PWA buttons using only safe visual properties.
- Check installed PWA mode on iPhone after any viewport/status-bar changes.
- Check installed PWA cold-start behavior after service worker or manifest changes.
- Add synonym / near-synonym / antonym / related-word sections once relation data is available.
- Add word-form and inflection panels: English lemma/forms, Portuguese conjugation, Japanese dictionary/masu/te forms, and Chinese simplified/traditional variants.
- Upgrade bookmarks into sense-level study cards with review states and Anki-style export.
- Add compact per-sense source and confidence disclosure for dictionary/AI/open-source data provenance.
- Add backend search suggestions and morphological normalization beyond the current local history/saved-word suggestions.

## Backend

- Keep provider routing simple and observable.
- Keep structured error codes for model provider failures current.
- Keep `/api/health` limited to safe booleans/status fields and dictionary stats.
- Consider separating settings storage from translation cache if settings become more complex.

## Documentation

- Keep `docs/CODEX_HANDOFF.md` updated after major architecture changes.
- Keep `docs/DECISIONS.md` updated when a previously debated choice changes.
- Keep README commands current with `package.json`.

## Nice To Have

- Keep the local dictionary-hit fixture current with ResultCard rendering assumptions.
- Add a visual changelog with screenshots for major UI revisions.
- Add CI checks for TypeScript and CSS build after the project is pushed to GitHub.
- Add GitHub Actions deployment only if Cloudflare secrets are configured safely.
