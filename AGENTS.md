# AGENTS.md

Work like a careful senior developer. You have permission to inspect files, edit code, and run useful commands, but avoid unnecessary heavy operations.

## General workflow

1. Understand the task before editing.
2. Inspect only the files relevant to the task.
3. Make focused changes instead of broad rewrites.
4. Preserve existing behavior unless the user asked to change it.
5. Prefer small, safe, reviewable edits.
6. After editing, summarize what changed and why.

## Scope control

Do not modify unrelated files just because you notice improvements.

Avoid:

* broad refactors
* renaming many files
* changing architecture without need
* removing features
* changing auth, payment, API, database, or native app logic unless explicitly requested

If a change might affect production behavior, mention it before doing it.

## Command usage

You may run commands when useful, but avoid unnecessary repeated operations.

Allowed when useful:

* reading files
* searching files
* `git diff`
* `npm run lint`
* `npm run typecheck`

Use carefully:

* `npm run build`
* `npm install`
* `npx cap sync`
* full test suites
* Docker commands
* plugin/preflight scripts

Avoid:

* reinstalling dependencies without a reason
* running full builds after tiny UI/text edits
* repeating the same command many times
* generating large cache, coverage, screenshot, video, or build output unless needed

Run `npm install` only if dependencies are missing, broken, or `package.json` was intentionally changed.

Run `npm run build` only when the change affects build behavior, routing, configuration, dependencies, or final production readiness.

## File safety

Before changing important files, understand how they are used.

Be extra careful with:

* environment files
* package files
* lockfiles
* Capacitor config
* payment logic
* auth logic
* database/Supabase logic
* API keys and server-only code
* Android/iOS native files

Do not expose secrets. Never move server-only keys into client-side code.

## UI/UX rules

Keep the existing design language unless asked to redesign it.

For UI work:

* preserve the app’s current color scheme and brand feel
* use existing design tokens/classes where available
* keep mobile layouts excellent
* check desktop responsiveness
* avoid unnecessary animations
* respect reduced motion
* keep touch targets comfortable
* add visible focus states for interactive elements
* avoid layout shift near keyboard/safe areas

Do not make the app look generic.

## Performance rules

Avoid adding heavy libraries unless clearly needed.

Prefer:

* existing components
* CSS/Tailwind utilities
* lightweight local data
* lazy loading for heavy sections
* optimized images/assets

Do not add new dependencies for small UI improvements.

## Git rules

Do not commit, push, create branches, or open PRs unless the user explicitly asks.

Before final response, check `git diff` when possible and summarize changed files.

## Verification

Use the lightest useful verification first.

Preferred order:

1. Reason through the change.
2. Run focused checks if available.
3. Run `npm run typecheck` or `npm run lint` if useful.
4. Run `npm run build` only when it is worth the disk/time cost.

If you skip a check, say why.

## Final response

Always include:

* files changed
* what was fixed or improved
* commands/checks run
* commands/checks skipped and why
* any remaining risks or manual testing needed

Do not claim everything is fixed unless verification actually passed.
