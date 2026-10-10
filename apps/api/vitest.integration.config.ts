import { defineConfig } from "vitest/config";

/**
 * Config for `pnpm --filter @opslens/api test:integration` only — the fast
 * DB-less suite (`test`) keeps Vitest's parallel defaults.
 *
 * Every `*.integration.test.ts` file runs against the SAME real Postgres
 * database (the one `migrate:up` set up). There's no per-test transaction
 * rollback and no schema-per-worker isolation — the only thing keeping
 * tests from clobbering each other is that each one owns the whole database
 * and resets it in `beforeEach` via `truncateAll`.
 *
 * That reset only isolates tests *within* a file. Vitest runs separate test
 * files in parallel workers by default, and the integration files each do
 * `TRUNCATE ... CASCADE` then insert overlapping reference rows — both seed
 * an `environments` row named 'production', and `environments.name` is
 * UNIQUE. Run concurrently they race: one file's insert hits
 * `environments_name_key` because the other inserted first, or one file's
 * TRUNCATE deletes rows the other is mid-assertion on. Passes locally,
 * fails intermittently in CI.
 *
 * The fix is to not run them concurrently. `fileParallelism: false` forces
 * `maxWorkers` to 1 (one worker process, one file at a time);
 * `maxConcurrency: 1` keeps tests serial even if a file ever adopts
 * `test.concurrent`, so the in-file `beforeEach` truncate can't race its
 * siblings either. The suite is seven tests and well under a second —
 * serial execution costs nothing. See docs/spec/09-testing.md.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
