import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';

// POST /api/ai/chat — proxy request body to the Ollama generate endpoint
router.post('/chat', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body;
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Ollama chat error:', text);
      res.status(response.status).json({ error: 'Ollama request failed', details: text });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error('AI chat proxy error:', err);
    res.status(500).json({ error: 'Failed to proxy chat request', message: err.message });
  }
});

// POST /api/ai/generate-invoice — ask Ollama to generate invoice JSON
router.post('/generate-invoice', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { description, model = 'llama3' } = req.body;
    if (!description || typeof description !== 'string') {
      res.status(400).json({ error: 'Missing required field: description' });
      return;
    }

    const prompt = `Generate an invoice JSON for ${description}. Return only a valid JSON object with no markdown formatting, no backticks, and no extra text. The JSON should include fields like clientName, items (array of objects with description, quantity, unitPrice), issueDate, dueDate, and taxRate if applicable.`;

    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Ollama generate invoice error:', text);
      res.status(response.status).json({ error: 'Ollama request failed', details: text });
      return;
    }

    const raw = await response.json() as { response?: string };
    const text = raw.response || '';

    // Strip markdown code blocks if Ollama included them
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('Failed to parse invoice JSON:', jsonStr);
      res.status(422).json({ error: 'Generated response is not valid JSON', raw: text });
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      res.status(422).json({ error: 'Generated JSON is not a valid invoice object', raw: text });
      return;
    }

    const invoice = parsed as Record<string, unknown>;
    res.json({ invoice });
  } catch (err: any) {
    console.error('AI generate invoice error:', err);
    res.status(500).json({ error: 'Failed to generate invoice', message: err.message });
  }
});

export default router;
