<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:custom-agent-rules -->

Commit messages should include a short summary of the changes made.
Each message should be concise, ideally under 50 characters for the summary line.
Use the imperative mood in the subject line (e.g., "Fix bug" instead of "Fixed bug" or "Fixes bug").
Provide additional context in the body if necessary, wrapped at 72 characters per line. Try to keep the body under 5 sentences.

Pull request descriptions follow the same spirit: a reviewer should get the point in under a minute.
Lead with one or two sentences on what changed and why, then at most one short bullet list of things the reviewer must look at (behavior changes, migrations, risks).
Say in one line what was verified and what was not. Skip file-by-file inventories; the diff already shows them.
Keep the whole description under roughly 25 lines.

<!-- END:custom-agent-rules -->
