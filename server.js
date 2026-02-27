const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const AGENT_RUN_URL = process.env.AGENT_RUN_URL || '';
const AGENT_COMPARE_URL = process.env.AGENT_COMPARE_URL || '';
const AGENT_AUTH_HEADER = process.env.AGENT_AUTH_HEADER || '';
const AGENT_AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN || '';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (AGENT_AUTH_HEADER && AGENT_AUTH_TOKEN) {
    headers[AGENT_AUTH_HEADER] = AGENT_AUTH_TOKEN;
  }
  return headers;
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

    const input = req.body?.input;
    if (typeof input !== 'string') {
      return res.status(400).json({ error: 'input must be a string' });
    }

    const upstream = await fetch(AGENT_RUN_URL, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ input })
    });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      return res.status(upstream.status).json({ error: `Run endpoint failed: ${errBody || upstream.statusText}` });
    }

    const data = await upstream.json();
    return res.json({ output: normalizeRunText(data), raw: data });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Run request failed' });
  }
});

app.post('/api/compare', async (req, res) => {
  try {
    if (!AGENT_COMPARE_URL) {
      return res.status(500).json({ error: 'AGENT_COMPARE_URL is not configured' });
    }

    const expected = req.body?.expected;
    const actual = req.body?.actual;

    if (typeof expected !== 'string' || typeof actual !== 'string') {
      return res.status(400).json({ error: 'expected and actual must be strings' });
    }

    const upstream = await fetch(AGENT_COMPARE_URL, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ expected, actual })
    });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      return res.status(upstream.status).json({ error: `Compare endpoint failed: ${errBody || upstream.statusText}` });
    }

    const data = await upstream.json();
    const score = normalizeScore(data);

    if (typeof score !== 'number') {
      return res.status(500).json({ error: 'Compare endpoint did not return a numeric score', raw: data });
    }

    return res.json({ score: Math.min(100, Math.max(0, Math.round(score))), raw: data });
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
