const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer({ env = {}, port }) {
  const cwd = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['server.js'], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let ready = false;
  let output = '';

  child.stdout.on('data', (d) => {
    output += d.toString();
    if (output.includes('Server running at')) ready = true;
  });

  child.stderr.on('data', (d) => {
    output += d.toString();
  });

  for (let i = 0; i < 80; i += 1) {
    if (ready) break;
    if (child.exitCode !== null) break;
    await wait(50);
  }

  if (!ready) {
    child.kill('SIGTERM');
    throw new Error(`App server failed to start on port ${port}. Output:\n${output}`);
  }

  return {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      child.kill('SIGTERM');
      await wait(100);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  };
}

async function startMockUpstream(port) {
  const received = { run: null, compare: null };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};

      if (req.method === 'POST' && req.url === '/run') {
        received.run = parsed;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { response: `Echo:${parsed.input}` } }));
        return;
      }

      if (req.method === 'POST' && req.url === '/compare') {
        received.compare = parsed;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ score: 145 }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    received,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => new Promise((resolve) => server.close(resolve))
  };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      s.close((err) => {
        if (err) return reject(err);
        if (!port) return reject(new Error('Could not allocate free port'));
        resolve(port);
      });
    });
    s.on('error', reject);
  });
}

function parseUploadRows(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = lines.map((line) => {
    const delimiter = line.includes('\t') ? '\t' : ',';
    const [input = '', expected = ''] = line.split(delimiter);
    return { input: input.trim(), expected: expected.trim() };
  });

  if (!parsed.length) return parsed;

  const first = parsed[0];
  const isHeader =
    (first.input.toLowerCase() === 'input' || first.input.toLowerCase() === 'prompt') &&
    first.expected.toLowerCase() === 'expected output';

  return isHeader ? parsed.slice(1) : parsed;
}

test('TC-001/002: homepage contains required 8 headers and bottom controls', async () => {
  const appPort = await findFreePort();
  const app = await startServer({ port: appPort });

  try {
    const res = await fetch(`${app.baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();

    const expectedHeaders = [
      'Select',
      'Test ID',
      'Input',
      'Expected Output',
      'Actual Output',
      'Status',
      'Similarity %',
      'Run Time'
    ];

    for (const header of expectedHeaders) {
      assert.match(html, new RegExp(`<th>${header.replace(/[%]/g, '\\$&')}</th>`));
    }

    const expectedButtons = [
      'Load Tests',
      'Start Tests',
      'Stop Ongoing Tests',
      'Compare All',
      'Save Results',
      'Remove Selected'
    ];
    for (const label of expectedButtons) {
      assert.match(html, new RegExp(`>${label}<`));
    }
  } finally {
    await app.stop();
  }
});

test('TC-003/004: API returns validation errors when env is missing', async () => {
  const appPort = await findFreePort();
  const app = await startServer({ port: appPort });

  try {
    const cfgRes = await fetch(`${app.baseUrl}/api/config`);
    assert.equal(cfgRes.status, 200);
    const cfg = await cfgRes.json();
    assert.equal(cfg.hasRunEndpoint, false);
    assert.equal(cfg.hasCompareEndpoint, false);

    const runRes = await fetch(`${app.baseUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hello' })
    });
    assert.equal(runRes.status, 500);
    const runErr = await runRes.json();
    assert.match(runErr.error, /AGENT_RUN_URL/);

    const cmpRes = await fetch(`${app.baseUrl}/api/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected: 'a', actual: 'b' })
    });
    assert.equal(cmpRes.status, 500);
    const cmpErr = await cmpRes.json();
    assert.match(cmpErr.error, /AGENT_COMPARE_URL/);
  } finally {
    await app.stop();
  }
});

test('TC-005/006: run and compare endpoints proxy and normalize responses', async () => {
  const upstreamPort = await findFreePort();
  const appPort = await findFreePort();

  const upstream = await startMockUpstream(upstreamPort);
  const app = await startServer({
    port: appPort,
    env: {
      AGENT_RUN_URL: `${upstream.baseUrl}/run`,
      AGENT_COMPARE_URL: `${upstream.baseUrl}/compare`
    }
  });

  try {
    const runRes = await fetch(`${app.baseUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Prompt A' })
    });
    assert.equal(runRes.status, 200);
    const runData = await runRes.json();
    assert.equal(runData.output, 'Echo:Prompt A');
    assert.deepEqual(upstream.received.run, { input: 'Prompt A' });

    const cmpRes = await fetch(`${app.baseUrl}/api/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected: 'ideal', actual: 'actual' })
    });
    assert.equal(cmpRes.status, 200);
    const cmpData = await cmpRes.json();
    assert.equal(cmpData.score, 100);
    assert.deepEqual(upstream.received.compare, { expected: 'ideal', actual: 'actual' });
  } finally {
    await app.stop();
    await upstream.stop();
  }
});

test('TC-007/008/009/010: client code includes major flow hooks', async () => {
  const appJsPath = path.resolve(__dirname, '..', 'public', 'app.js');
  const appJs = await fs.readFile(appJsPath, 'utf8');

  assert.match(appJs, /const MAX_PARALLEL = 10;/);
  assert.match(appJs, /controller\.abort\(\)/);
  assert.match(appJs, /function applyLoadedRows\(rows\)/);
  assert.match(appJs, /Previous loaded rows replaced/);
  assert.match(appJs, /function exportToXls\(\)/);
  assert.match(appJs, /\.xls`/);
});

test('TC-012: sample-input.xls is valid and parseable for upload', async () => {
  const samplePath = path.resolve(__dirname, '..', 'sample-input.xls');
  const content = await fs.readFile(samplePath, 'utf8');
  const rows = parseUploadRows(content);

  assert.ok(rows.length >= 3, 'sample-input.xls should include at least 3 rows');
  for (const row of rows) {
    assert.ok(row.input.length > 0, 'each sample row must have input text');
    assert.ok(row.expected.length > 0, 'each sample row must have expected output text');
  }
});

test('TC-013: startServer fails cleanly with invalid port configuration', async () => {
  const port = await findFreePort();
  await assert.rejects(
    () =>
      startServer({
        port,
        env: { NODE_OPTIONS: '--definitely-invalid-node-option' }
      }),
    /App server failed to start on port/
  );
});

test('TC-014: mock upstream returns 404 for unknown routes', async () => {
  const upstreamPort = await findFreePort();
  const upstream = await startMockUpstream(upstreamPort);

  try {
    const res = await fetch(`${upstream.baseUrl}/unknown`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Not found');
  } finally {
    await upstream.stop();
  }
});

test('TC-015: parseUploadRows handles empty and non-header CSV input', () => {
  const empty = parseUploadRows('\n   \n');
  assert.deepEqual(empty, []);

  const noHeader = parseUploadRows('prompt a,expected a\nprompt b,expected b');
  assert.equal(noHeader.length, 2);
  assert.deepEqual(noHeader[0], { input: 'prompt a', expected: 'expected a' });
  assert.deepEqual(noHeader[1], { input: 'prompt b', expected: 'expected b' });
});

test('TC-016: parseUploadRows supports tab-delimited input with header removal', () => {
  const tabText = 'Input\tExpected Output\nfoo\tbar\nhello\tworld';
  const rows = parseUploadRows(tabText);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { input: 'foo', expected: 'bar' });
  assert.deepEqual(rows[1], { input: 'hello', expected: 'world' });
});
