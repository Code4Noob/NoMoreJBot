## Summary
<!-- What does this PR do? Keep it concise. -->

## Related issue
<!-- Link the issue this closes, e.g. Closes #12 -->

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] CI / tooling / dependencies
- [ ] Documentation

## Changes
<!-- Briefly list the key files/areas changed. -->
- `src/...`

## How it was verified
<!-- How did you test it? e.g. commands run, manual test steps, CI results. -->
- [ ] `tsc --noEmit` (no new errors — known pre-existing `tg.ts` + telegraf `.d.ts` errors are OK)
- [ ] `pnpm build` passes
- [ ] Manual test in Telegram (if applicable)

## Checklist
- [ ] Code builds and typechecks (see above)
- [ ] Added / updated relevant command in `src/bot/commands.ts` (if new command)
- [ ] Synced lockfiles if dependencies changed (`pnpm install --lockfile-only` + `npm install --package-lock-only`)
- [ ] No secrets committed (`.env` etc.)
