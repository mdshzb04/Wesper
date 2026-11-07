# Midnight Signal

Vesper is the Midnight Signal voice assistant. AssemblyAI listens and speaks. OpenAI reasons. Web search runs on the server (Brave if `BRAVE_SEARCH_API_KEY` is set, otherwise DuckDuckGo). Notes are saved only when you ask.

```bash
cp .env.example .env
npm install
npm test
npm start
```

Open http://127.0.0.1:8787. Listen or type. Reload if an older tab is still on the page.
