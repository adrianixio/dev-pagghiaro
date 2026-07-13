# Dark mode palette refinement

## Goal
Improve the dark mode colors so the interface feels richer and clearer while preserving the existing rustic/country identity.

## Files
- `frontend/tailwind.config.js`
- `frontend/src/styles.css`
- `frontend/src/app/components/terminal/terminal.component.ts`

## Planned changes
1. Refine the dark side of the `rustic` scale in `frontend/tailwind.config.js` to increase depth and separation between background, surfaces, and borders while keeping the warm earthy character.
2. Keep light mode unchanged unless a shared token requires a safe paired tweak.
3. Update global dark variants in `frontend/src/styles.css` only where the revised palette benefits shared primitives such as cards, secondary buttons, inputs, and scrollbar.
4. Align the terminal dark theme in `frontend/src/app/components/terminal/terminal.component.ts` with the new palette so it no longer feels detached from the rest of the UI.
5. Avoid broad template churn unless an existing component clearly needs a targeted class adjustment after the palette update.

## Verification
- Run `lsp_diagnostics` on `frontend/tailwind.config.js`, `frontend/src/styles.css`, and `frontend/src/app/components/terminal/terminal.component.ts`; success means zero new errors on all changed files.
- Run `bun run build:frontend` from the repo root; success means exit code 0 and a completed Angular build.
- Run a concrete UI QA flow with Playwright or a browser: start the frontend with `bun run dev:frontend`, open the app, toggle dark mode from the sidebar, confirm shared primitives (`.btn-secondary`, `.card`, `.input-field`, scrollbar`) feel distinct and readable, open the configuration modal to inspect form controls, and open a terminal pane to confirm the terminal background/foreground and ANSI accents remain legible. Then toggle back to light mode and confirm no obvious regression in shared surfaces.
- Inspect the final diff to confirm the work stays limited to dark mode color quality and does not drift into layout, copy, or behavior changes.
