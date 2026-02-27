const MAX_PARALLEL = 10;

const tests = [];
const runControllers = new Map();
let stopRequested = false;
let isRunning = false;

const els = {
  fileInput: document.getElementById('fileInput'),
  loadBtn: document.getElementById('loadBtn'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  compareBtn: document.getElementById('compareBtn'),
  saveBtn: document.getElementById('saveBtn'),
  deleteTestsBtn: document.getElementById('deleteTestsBtn'),
  testsBody: document.getElementById('testsBody'),
  statusLine: document.getElementById('statusLine'),
  themeToggle: document.getElementById('themeToggle'),
  overallStatus: document.getElementById('overallStatus'),
  successCount: document.getElementById('successCount'),
  failedCount: document.getElementById('failedCount'),
  ongoingCount: document.getElementById('ongoingCount'),
  avgSimilarity: document.getElementById('avgSimilarity')
};

const statusInfo = {
  na: { label: 'N/A', dotClass: 'dot-na' },
  executing: { label: 'Executing', dotClass: 'dot-executing' },
  completed: { label: 'Completed', dotClass: 'dot-success' },
  failed: { label: 'Failed', dotClass: 'dot-failed' }
};

function setStatusLine(text) {
  els.statusLine.textContent = text;
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function reindexTests() {
  tests.forEach((t, idx) => {
    t.id = idx + 1;
  });
}

function createEmptyManualRow() {
  return {
    id: tests.length + 1,
    input: '',
    expected: '',
    actual: '',
    status: 'na',
    similarity: null,
    runTime: null,
    source: 'manual',
    selected: false
  };
}

function hasRowData(test) {
  return Boolean(test.input.trim() || test.expected.trim() || test.actual.trim());
}

function ensureTrailingBlankManualRow() {
  if (!tests.length) {
    tests.push(createEmptyManualRow());
    reindexTests();
    return;
  }

  const last = tests[tests.length - 1];
  const hasText = last.input.trim() || last.expected.trim();
  if (hasText) {
    tests.push(createEmptyManualRow());
    reindexTests();
  }
}

function editableCell(test, field) {
  const input = document.createElement('textarea');
  input.className = 'grid-input';
  input.rows = 1;
  input.placeholder = field === 'input' ? 'Enter prompt input' : 'Enter expected output';
  input.value = test[field] || '';
  input.addEventListener('input', (event) => {
    test[field] = event.target.value;
    if (test.source === 'loaded') {
      test.source = 'manual';
    }

    const isLastRow = tests[tests.length - 1] === test;
    const hasText = test.input.trim() || test.expected.trim();
    if (isLastRow && hasText) {
      tests.push(createEmptyManualRow());
      reindexTests();
      renderTable();
    }
  });
  return input;
}

function truncateCell(content = '') {
  const wrap = document.createElement('div');
  wrap.className = 'truncate';
  wrap.title = String(content);
  wrap.textContent = String(content);
  return wrap;
}

function statusCell(status) {
  const info = statusInfo[status] || statusInfo.na;
  const wrapper = document.createElement('span');
  wrapper.className = 'status-pill';
  wrapper.title = info.label;

  const dot = document.createElement('span');
  dot.className = `dot ${info.dotClass}`;

  const text = document.createElement('span');
  text.textContent = info.label;

  wrapper.append(dot, text);
  return wrapper;
}

function renderTable() {
  els.testsBody.innerHTML = '';

  for (const test of tests) {
    const tr = document.createElement('tr');

    const selectTd = document.createElement('td');
    selectTd.className = 'delete-cell';
    const selectInput = document.createElement('input');
    selectInput.type = 'checkbox';
    selectInput.className = 'row-select';
    selectInput.title = 'Select this row for deletion';
    selectInput.checked = Boolean(test.selected);
    selectInput.disabled = isRunning || !hasRowData(test);
    selectInput.addEventListener('change', (event) => {
      test.selected = event.target.checked;
      updateDeleteButtonState();
    });
    selectTd.appendChild(selectInput);
    tr.appendChild(selectTd);

    const idTd = document.createElement('td');
    idTd.textContent = String(test.id);
    tr.appendChild(idTd);

    const inputTd = document.createElement('td');
    const inputCell = editableCell(test, 'input');
    inputCell.disabled = isRunning;
    inputTd.appendChild(inputCell);
    tr.appendChild(inputTd);

    const expectedTd = document.createElement('td');
    const expectedCell = editableCell(test, 'expected');
    expectedCell.disabled = isRunning;
    expectedTd.appendChild(expectedCell);
    tr.appendChild(expectedTd);

    const actualTd = document.createElement('td');
    actualTd.appendChild(truncateCell(test.actual));
    tr.appendChild(actualTd);

    const statusTd = document.createElement('td');
    statusTd.appendChild(statusCell(test.status));
    tr.appendChild(statusTd);

    const simTd = document.createElement('td');
    simTd.textContent = Number.isFinite(test.similarity) ? `${test.similarity}%` : '';
    tr.appendChild(simTd);

    const timeTd = document.createElement('td');
    timeTd.textContent = formatTime(test.runTime);
    tr.appendChild(timeTd);

    els.testsBody.appendChild(tr);
  }

  updateDeleteButtonState();
  updateSummaryStats();
}

function updateSummaryStats() {
  const activeRows = tests.filter((t) => hasRowData(t));
  const success = activeRows.filter((t) => t.status === 'completed').length;
  const failed = activeRows.filter((t) => t.status === 'failed').length;
  const ongoing = activeRows.filter((t) => t.status === 'executing').length;
  const scores = activeRows.map((t) => t.similarity).filter((v) => Number.isFinite(v));
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  let overall = 'Ready';
  if (ongoing > 0 || isRunning) {
    overall = 'Executing';
  } else if (stopRequested && activeRows.length > 0) {
    overall = 'Stopped';
  } else if (success + failed > 0) {
    overall = 'Completed';
  }

  els.overallStatus.textContent = overall;
  els.successCount.textContent = String(success);
  els.failedCount.textContent = String(failed);
  els.ongoingCount.textContent = String(ongoing);
  els.avgSimilarity.textContent = `${avg}%`;
}

function updateDeleteButtonState() {
  if (!els.deleteTestsBtn) return;
  const selectedCount = tests.filter((t) => t.selected && hasRowData(t)).length;
  els.deleteTestsBtn.disabled = isRunning || selectedCount === 0;
}

function deleteSelectedTests() {
  if (isRunning) return;
  const selectedCount = tests.filter((t) => t.selected && hasRowData(t)).length;
  if (!selectedCount) return;
  const kept = tests.filter((t) => !(t.selected && hasRowData(t)));
  tests.length = 0;
  tests.push(...kept.map((t) => ({ ...t, selected: false })));
  ensureTrailingBlankManualRow();
  reindexTests();
  renderTable();
  setStatusLine(`Deleted ${selectedCount} selected test(s).`);
}

function parseCsv(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = rows.map((line) => {
    const delimiter = line.includes('\t') ? '\t' : ',';
    const [input = '', expected = ''] = line.split(delimiter);
    return { input: input.trim(), expected: expected.trim() };
  });

  if (!parsed.length) return parsed;

  const first = parsed[0];
  const firstInput = first.input.toLowerCase();
  const firstExpected = first.expected.toLowerCase();
  const looksLikeHeader =
    (firstInput === 'input' || firstInput === 'prompt' || firstInput === 'text input to the agent') &&
    (firstExpected === 'expected' || firstExpected === 'expected output');

  return looksLikeHeader ? parsed.slice(1) : parsed;
}

async function readInputFile(file) {
  const text = await file.text();
  if (file.name.endsWith('.json')) {
    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) throw new Error('JSON must be an array');
    return raw.map((item) => ({ input: item.input || '', expected: item.expected || '' }));
  }
  if (file.name.endsWith('.csv') || file.name.endsWith('.txt') || file.name.endsWith('.xls')) {
    return parseCsv(text);
  }
  throw new Error('Unsupported file type. Use .json, .csv, .txt, or .xls');
}

function applyLoadedRows(rows) {
  const manualRows = tests.filter((t) => t.source === 'manual' && (t.input.trim() || t.expected.trim()));

  tests.length = 0;
  manualRows.forEach((row) => {
    tests.push({
      ...row,
      actual: '',
      status: 'na',
      similarity: null,
      runTime: null,
      source: 'manual',
      selected: false
    });
  });

  rows.forEach((row) => {
    tests.push({
      id: 0,
      input: row.input || '',
      expected: row.expected || '',
      actual: '',
      status: 'na',
      similarity: null,
      runTime: null,
      source: 'loaded',
      selected: false
    });
  });

  ensureTrailingBlankManualRow();
  reindexTests();
  renderTable();
}

async function runSingleTest(test) {
  const controller = new AbortController();
  runControllers.set(test.id, controller);

  test.status = 'executing';
  test.runTime = new Date().toISOString();
  renderTable();

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: test.input }),
      signal: controller.signal
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Run failed');
    }

    const data = await res.json();
    test.actual = data.output || '';
    test.status = 'completed';
    test.runTime = new Date().toISOString();
  } catch (error) {
    if (controller.signal.aborted) {
      test.status = 'failed';
      test.actual = '[aborted]';
    } else {
      test.status = 'failed';
      test.actual = `[error] ${error.message || 'Unknown error'}`;
    }
    test.runTime = new Date().toISOString();
  } finally {
    runControllers.delete(test.id);
    renderTable();
  }
}

async function runWithConcurrency(items, limit, task) {
  const queue = [...items];
  const workers = [];

  for (let i = 0; i < Math.min(limit, queue.length); i += 1) {
    workers.push(
      (async () => {
        while (queue.length && !stopRequested) {
          const item = queue.shift();
          if (item) await task(item);
        }
      })()
    );
  }

  await Promise.all(workers);
}

async function startTests() {
  const runnable = tests.filter((t) => t.input.trim());
  if (!runnable.length) {
    setStatusLine('No test inputs available. Enter data or load a file first.');
    return;
  }

  stopRequested = false;
  setButtonsDuringRun(true);
  setStatusLine(`Executing ${runnable.length} tests with up to ${MAX_PARALLEL} parallel requests...`);

  for (const t of tests) {
    t.actual = '';
    t.similarity = null;
    t.status = 'na';
    t.runTime = null;
  }
  renderTable();

  await runWithConcurrency(runnable, MAX_PARALLEL, runSingleTest);

  setButtonsDuringRun(false);

  const done = tests.filter((t) => t.status === 'completed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  if (stopRequested) {
    setStatusLine(`Stopped. Completed: ${done}, Failed/Aborted: ${failed}`);
  } else {
    setStatusLine(`Execution complete. Completed: ${done}, Failed: ${failed}`);
  }
}

function stopTests() {
  stopRequested = true;
  for (const controller of runControllers.values()) {
    controller.abort();
  }
  runControllers.clear();
  setStatusLine('Stop requested. Aborting running requests...');
}

async function compareSingle(test) {
  if (!test.expected || !test.actual || test.status !== 'completed') return;

  try {
    const res = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected: test.expected, actual: test.actual })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Compare failed');
    }

    const data = await res.json();
    test.similarity = data.score;
  } catch (error) {
    test.similarity = null;
    test.status = 'failed';
    test.actual = `[compare error] ${error.message || 'Unknown error'}`;
  }
}

async function compareTests() {
  const comparable = tests.filter((t) => t.status === 'completed' && t.actual.trim() && t.expected.trim());
  if (!comparable.length) {
    setStatusLine('No completed rows with expected and actual text to compare.');
    return;
  }

  setStatusLine('Comparing expected vs actual outputs...');
  await runWithConcurrency(comparable, MAX_PARALLEL, compareSingle);
  renderTable();
  setStatusLine('Compare completed.');
}

function exportToXls() {
  const rowsForExport = tests.filter((t) => t.input.trim() || t.expected.trim() || t.actual.trim());
  if (!rowsForExport.length) {
    setStatusLine('Nothing to export.');
    return;
  }

  const headers = ['Test ID', 'Input', 'Expected Output', 'Actual Output', 'Status', 'Similarity %', 'Run Time'];
  const rows = rowsForExport.map((t) => [
    t.id,
    t.input,
    t.expected,
    t.actual,
    statusInfo[t.status]?.label || 'N/A',
    Number.isFinite(t.similarity) ? `${t.similarity}%` : '',
    formatTime(t.runTime)
  ]);

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const htmlTable = `
    <table border="1">
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
          .join('')}
      </tbody>
    </table>
  `;

  const blob = new Blob([htmlTable], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const fileName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.xls`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  setStatusLine(`Exported ${fileName}`);
}

function setButtonsDuringRun(running) {
  isRunning = running;
  els.startBtn.disabled = running;
  els.loadBtn.disabled = running;
  els.compareBtn.disabled = running;
  els.deleteTestsBtn.disabled = running;
  renderTable();
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('theme', next);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved;
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
  }
}

els.loadBtn.addEventListener('click', () => els.fileInput.click());

els.fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const data = await readInputFile(file);
    applyLoadedRows(data);
    const manualCount = tests.filter((t) => t.source === 'manual' && (t.input.trim() || t.expected.trim())).length;
    setStatusLine(`Loaded ${data.length} tests from ${file.name}. Manual rows kept: ${manualCount}. Previous loaded rows replaced.`);
  } catch (error) {
    setStatusLine(`Load failed: ${error.message || 'Unknown error'}`);
  } finally {
    event.target.value = '';
  }
});

els.startBtn.addEventListener('click', startTests);
els.stopBtn.addEventListener('click', stopTests);
els.compareBtn.addEventListener('click', compareTests);
els.saveBtn.addEventListener('click', exportToXls);
els.deleteTestsBtn.addEventListener('click', deleteSelectedTests);
els.themeToggle.addEventListener('click', toggleTheme);

initTheme();
ensureTrailingBlankManualRow();
renderTable();

fetch('/api/config')
  .then((res) => res.json())
  .then((cfg) => {
    if (!cfg.hasRunEndpoint || !cfg.hasCompareEndpoint) {
      setStatusLine('Configure AGENT_RUN_URL and AGENT_COMPARE_URL env vars before running live tests.');
    }
  })
  .catch(() => {
    setStatusLine('Could not read server config.');
  });
