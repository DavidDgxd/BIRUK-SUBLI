/*
 * Client for the FastAPI CLIP microservice (ai-service/main.py).
 *
 *   POST {BASE}/embed/text   form field "text"  -> { "vector": number[512] }
 *   POST {BASE}/embed/image  form field "file"  -> { "vector": number[512] }
 *
 * The service does not translate yet. If it later returns "translated_text" from
 * /embed/text, the results page shows it to the user.
 *
 * Set VITE_AI_SERVICE_URL in web/.env (defaults to http://localhost:8000).
 */

const BASE_URL = (import.meta.env.VITE_AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

export const EMBEDDING_DIM = 512;

/** code: 'ai-unreachable' | 'ai-failed' | 'ai-bad-response' | 'db' */
export class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
  }
}

async function postForEmbedding(path, init, signal) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { method: 'POST', signal, ...init });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new SearchError('ai-unreachable', `Could not reach the AI service at ${BASE_URL}`);
  }

  if (!response.ok) {
    throw new SearchError('ai-failed', `AI service returned ${response.status} for ${path}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new SearchError('ai-bad-response', `AI service sent invalid JSON for ${path}`);
  }

  if (!Array.isArray(body.vector) || body.vector.length !== EMBEDDING_DIM) {
    throw new SearchError(
      'ai-bad-response',
      `Expected a ${EMBEDDING_DIM}-number "vector" from ${path}`,
    );
  }
  return body;
}

export async function embedText(text, signal) {
  const form = new FormData();
  form.append('text', text);
  const body = await postForEmbedding('/embed/text', { body: form }, signal);
  return { embedding: body.vector, translatedText: body.translated_text ?? null };
}

export async function embedImage(file, signal) {
  const form = new FormData();
  form.append('file', file);
  const body = await postForEmbedding('/embed/image', { body: form }, signal);
  return { embedding: body.vector };
}
