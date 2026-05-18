# TODO

This is the working backlog for future Codex sessions.

## High Priority

- Keep monitoring mobile layout stability after UI changes.
- Keep dictionary-first lookup fast and resilient.
- Add tests for Worker dictionary fallback behavior if the project adopts a test runner.
- Document Louis deployment details once the production server path, systemd service, and sync cron are final.

## Dictionary Pipeline

- Continue expanding accepted word entries in batches.
- Keep validating generated entries before importing them.
- Track accepted / needs-review counts per batch.
- Monitor `state/batches/<run>.status` files from remote sync batches and use them when checking progress.
- Consider a lightweight admin endpoint or sync log for Louis dictionary imports.

## Frontend UX

- Keep tab switching animated and dimension-stable.
- Keep settings modal above all cards on mobile and desktop.
- Keep the provider badge compact and dimension-stable, including dictionary hit state.
- Consider haptic-like visual feedback for PWA buttons using only safe visual properties.
- Check installed PWA mode on iPhone after any viewport/status-bar changes.
- Check installed PWA cold-start behavior after service worker or manifest changes.

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

- Add a small local fixture for dictionary-hit frontend rendering.
- Add a visual changelog with screenshots for major UI revisions.
- Add CI checks for TypeScript and CSS build after the project is pushed to GitHub.
- Add GitHub Actions deployment only if Cloudflare secrets are configured safely.
