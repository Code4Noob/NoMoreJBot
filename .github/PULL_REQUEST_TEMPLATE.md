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
- [ ] `bunx tsc --noEmit` (no new errors — known pre-existing `tg.ts` errors are OK)
- [ ] `bun run build` passes
- [ ] Manual test in Telegram (if applicable)

## Checklist
- [ ] Code builds and typechecks (see above)
- [ ] Added / updated relevant command in `src/bot/commands.ts` (if new command)
- [ ] Updated `bun.lock` if dependencies changed (`bun install`)
- [ ] No secrets committed (`.env` etc.)
