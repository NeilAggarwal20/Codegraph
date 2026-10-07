import 'server-only';

import OpenAI from 'openai';
import { wrapOpenAI } from 'langsmith/wrappers/openai';

export const explanationModel = 'gpt-4.1-2025-04-14';

let client: ReturnType<typeof wrapOpenAI> | null = null;

export function getOpenAIClient(): ReturnType<typeof wrapOpenAI> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('AI explanations are not configured. Add OPENAI_API_KEY to .env.local.');
  client ??= wrapOpenAI(new OpenAI({ apiKey }));
  return client;
}

export function isLangSmithTracingConfigured(): boolean {
  return process.env.LANGSMITH_TRACING === 'true' && Boolean(process.env.LANGSMITH_API_KEY);
}
