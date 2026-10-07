import { createDeepAgent } from 'deepagents';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY in deep-agent/.env before running this quickstart.');
}

const internetSearch = { type: 'web_search_preview' };

const researchInstructions = `You are a careful research assistant. Use web search to gather current information, then answer clearly and cite the sources you used. If the sources disagree or do not support an answer, say so.`;

const agent = await createDeepAgent({
  model: `openai:${process.env.OPENAI_MODEL ?? 'gpt-5.5'}`,
  tools: [internetSearch],
  systemPrompt: researchInstructions,
});

const question = process.argv.slice(2).join(' ').trim() || 'What is LangGraph?';
const result = await agent.invoke({
  messages: [{ role: 'user', content: question }],
});

console.log(result.messages.at(-1)?.content ?? 'The agent returned no final message.');
