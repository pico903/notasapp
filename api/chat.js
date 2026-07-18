const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

function parseBody(req) {
  if (!req || !req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  return req.body;
}

function buildPrompt({ question, notes }) {
  const noteList = Array.isArray(notes) && notes.length > 0
    ? notes.map((note) => `- ${note.title || note.titulo || 'Sin título'}: ${note.body || note.contenido || ''}`).join('\n')
    : 'No hay notas disponibles.';

  return `Eres un asistente útil para una app de notas. Responde de forma breve, clara y práctica usando la información disponible.

Notas del usuario:
${noteList}

Pregunta del usuario:
${question || ''}

Respuesta:`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { question, notes } = parseBody(req);
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'La variable de entorno GROQ_API_KEY no está configurada.' });
  }

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Falta la pregunta.' });
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Eres un asistente útil y conciso para una app de notas.'
          },
          {
            role: 'user',
            content: buildPrompt({ question, notes })
          }
        ],
        temperature: 0.7,
        max_tokens: 400
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      const errorMessage = payload?.error?.message || 'Error al contactar con Groq.';
      return res.status(response.status).json({ error: errorMessage });
    }

    const answer = payload?.choices?.[0]?.message?.content?.trim() || 'No pude generar una respuesta.';
    return res.status(200).json({ answer });
  } catch (error) {
    return res.status(502).json({ error: 'No se pudo completar la solicitud a Groq.', details: error.message });
  }
};
