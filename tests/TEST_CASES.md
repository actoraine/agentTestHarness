# AI Agent Test Harness - Major Test Cases

## TC-001: Page loads with required 8-column table
- Precondition: app server running.
- Steps:
  1. Open `/`.
  2. Inspect table header columns.
- Expected:
  - Columns are exactly: `Select`, `Test ID`, `Input`, `Expected Output`, `Actual Output`, `Status`, `Similarity %`, `Run Time`.

## TC-002: Required bottom controls are present
- Precondition: app server running.
- Steps:
  1. Open `/`.
  2. Inspect footer buttons.
- Expected:
  - Buttons exist: `Load Tests`, `Start Tests`, `Stop Ongoing Tests`, `Compare All`, `Save Results`, `Remove Selected`.

## TC-003: Run API validation when endpoint is missing
- Precondition: app started without `AGENT_RUN_URL`.
- Steps:
  1. Send `POST /api/run` with `{ "input": "hello" }`.
- Expected:
  - HTTP 500 and error describing missing `AGENT_RUN_URL`.

## TC-004: Compare API validation when endpoint is missing
- Precondition: app started without `AGENT_COMPARE_URL`.
- Steps:
  1. Send `POST /api/compare` with `{ "expected": "a", "actual": "b" }`.
- Expected:
  - HTTP 500 and error describing missing `AGENT_COMPARE_URL`.

## TC-005: Start Test path proxies input and returns normalized output
- Precondition: app started with mock `AGENT_RUN_URL`.
- Steps:
  1. Send `POST /api/run` with an input string.
- Expected:
  - Returns HTTP 200 and normalized `output` text.
  - Upstream receives request body with `input`.

## TC-006: Compare path returns normalized/clamped similarity
- Precondition: app started with mock `AGENT_COMPARE_URL`.
- Steps:
  1. Send `POST /api/compare` with expected/actual text.
- Expected:
  - Returns numeric score 0-100.
  - Out-of-range upstream score is clamped.

## TC-007: Editable-grid load strategy (spec coverage)
- Steps:
  1. Manually enter rows in `Input` + `Expected Output`.
  2. Load file A.
  3. Load file B.
- Expected:
  - File A rows append after manual rows.
  - File B rows replace previous loaded rows.
  - Manual rows remain.

## TC-008: Concurrency and stop controls (spec coverage)
- Steps:
  1. Load many tests and click `Start Tests`.
  2. Click `Stop Ongoing Tests` during execution.
- Expected:
  - Runs with up to 10 parallel requests.
  - In-flight calls are aborted; statuses update accordingly.

## TC-009: Compare flow writes similarity scores
- Steps:
  1. Run tests to produce actual outputs.
  2. Click `Compare All`.
- Expected:
  - Calls compare API for completed rows with expected+actual text.
  - Similarity values appear in `Similarity %` column.

## TC-010: Save Results export format
- Steps:
  1. Click `Save Results`.
- Expected:
  - Downloads `.xls` file named `YYYY-MM-DD-HH-MM-SS.xls`.
  - Export contains table headers and row values.

## TC-011: Delete selected rows
- Steps:
  1. Select multiple rows in the first `Select` column.
  2. Click `Remove Selected`.
- Expected:
  - All selected rows are removed.
  - Remaining rows are re-indexed.

## TC-012: Sample upload file validity
- Steps:
  1. Use `sample-input.xls`.
  2. Upload via `Load Tests`.
- Expected:
  - File is accepted.
  - Rows are parsed into `Input` and `Expected Output` columns.
  - At least 3 sample tests are loaded.
