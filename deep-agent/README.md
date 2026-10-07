# Deep Agent quickstart

A small research agent built from LangChain's Deep Agents JavaScript quickstart. It uses OpenAI's built-in web search, so no separate search service key is needed.

## Setup

1. Copy `.env.example` to `.env` and add your OpenAI API key.
2. Install the dependencies listed in `package.json` with `pnpm install`.
3. Run a question:

```sh
pnpm start -- "What changed in the latest Node.js release?"
```

The default question is `What is LangGraph?`. `OPENAI_MODEL` defaults to `gpt-5.5`.

LangSmith is pointed at `https://api.smith.langchain.com`. Tracing is off by default so the agent only needs your model-provider key. To enable tracing, set `LANGSMITH_TRACING=true` and add a separate `LANGSMITH_API_KEY` (and optionally `LANGSMITH_PROJECT`) to `.env`.
