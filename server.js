const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const MAX_TEXT_LENGTH = Number(process.env.MAX_TEXT_LENGTH || 20000);
const DISALLOWED_AUTH_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
]);

const AGENT_RUN_URL = process.env.AGENT_RUN_URL || '';
const AGENT_COMPARE_URL = process.env.AGENT_COMPARE_URL || '';
const AGENT_AUTH_HEADER = process.env.AGENT_AUTH_HEADER || '';
const AGENT_AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN || '';

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidAuthHeaderName(value) {
  return /^[A-Za-z0-9-]+$/.test(value);
}

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (AGENT_AUTH_HEADER && AGENT_AUTH_TOKEN) {
    const normalized = AGENT_AUTH_HEADER.trim().toLowerCase();
    if (!isValidAuthHeaderName(AGENT_AUTH_HEADER) || DISALLOWED_AUTH_HEADERS.has(normalized)) {
      throw new Error('AGENT_AUTH_HEADER is invalid or disallowed');
    }
    headers[AGENT_AUTH_HEADER] = AGENT_AUTH_TOKEN;
  }
  return headers;
}

async function postJsonWithTimeout(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Upstream request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRunText(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';

  const directText = payload.output || payload.result || payload.response || payload.text || payload.answer;
  if (typeof directText === 'string') return directText;

  if (payload.data && typeof payload.data === 'object') {
    const nested = payload.data.output || payload.data.result || payload.data.response || payload.data.text;
    if (typeof nested === 'string') return nested;
  }

  return JSON.stringify(payload);
}

function normalizeScore(payload) {
  if (typeof payload === 'number') return payload;
  if (!payload || typeof payload !== 'object') return null;

  const score = payload.score ?? payload.similarity ?? payload.percent ?? payload.match;
  if (typeof score === 'number') return score;

  if (payload.data && typeof payload.data === 'object') {
    const nested = payload.data.score ?? payload.data.similarity ?? payload.data.percent;
    if (typeof nested === 'number') return nested;
  }

  return null;
}

app.get('/api/config', (_req, res) => {
  res.json({
    hasRunEndpoint: Boolean(AGENT_RUN_URL),
    hasCompareEndpoint: Boolean(AGENT_COMPARE_URL)
  });
});

app.post('/api/run', async (req, res) => {
  try {
    if (!AGENT_RUN_URL) {
      return res.status(500).json({ error: 'AGENT_RUN_URL is not configured' });
    }
    if (!isValidHttpUrl(AGENT_RUN_URL)) {
      return res.status(500).json({ error: 'AGENT_RUN_URL must be a valid http(s) URL' });
    }

    const input = req.body?.input;
    if (typeof input !== 'string') {
      return res.status(400).json({ error: 'input must be a string' });
    }
    if (input.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `input exceeds max length (${MAX_TEXT_LENGTH})` });
    }

    const upstream = await postJsonWithTimeout(AGENT_RUN_URL, { input });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      return res.status(upstream.status).json({ error: `Run endpoint failed: ${errBody || upstream.statusText}` });
    }

    const data = await upstream.json();
    return res.json({ output: normalizeRunText(data) });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Run request failed' });
  }
});

app.post('/api/compare', async (req, res) => {
  try {
    if (!AGENT_COMPARE_URL) {
      return res.status(500).json({ error: 'AGENT_COMPARE_URL is not configured' });
    }
    if (!isValidHttpUrl(AGENT_COMPARE_URL)) {
      return res.status(500).json({ error: 'AGENT_COMPARE_URL must be a valid http(s) URL' });
    }

    const expected = req.body?.expected;
    const actual = req.body?.actual;

    if (typeof expected !== 'string' || typeof actual !== 'string') {
      return res.status(400).json({ error: 'expected and actual must be strings' });
    }
    if (expected.length > MAX_TEXT_LENGTH || actual.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `expected/actual exceed max length (${MAX_TEXT_LENGTH})` });
    }

    const upstream = await postJsonWithTimeout(AGENT_COMPARE_URL, { expected, actual });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      return res.status(upstream.status).json({ error: `Compare endpoint failed: ${errBody || upstream.statusText}` });
    }

    const data = await upstream.json();
    const score = normalizeScore(data);

    if (typeof score !== 'number') {
      return res.status(500).json({ error: 'Compare endpoint did not return a numeric score' });
    }

    return res.json({ score: Math.min(100, Math.max(0, Math.round(score))) });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Compare request failed' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
