import Fastify from 'fastify';

const mockApp = Fastify({ logger: true });

mockApp.get('/v1/models', async (_req, reply) => {
  return reply.send({
    object: 'list',
    data: [
      { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
      { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
      { id: 'claude-3-5-sonnet', object: 'model', owned_by: 'anthropic' },
    ],
  });
});

mockApp.post('/v1/chat/completions', async (req, reply) => {
  const body = (req.body as any) || {};
  const { messages, model = 'gpt-4o', stream = false } = body;
  const lastUserMsg = Array.isArray(messages)
    ? messages.filter((m: any) => m.role === 'user').pop()?.content || 'No prompt'
    : 'No prompt';

  const responseText = `[MockLLM Engine] Received prompt: "${String(lastUserMsg).slice(0, 80)}...". Analysis complete: All operational parameters verified.`;
  const promptTokens = Math.max(12, Math.ceil(JSON.stringify(messages || '').length / 4));
  const completionTokens = Math.max(20, Math.ceil(responseText.length / 4));

  if (stream) {
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    const words = responseText.split(' ');
    let wordIdx = 0;

    const interval = setInterval(() => {
      if (wordIdx < words.length) {
        const chunk = {
          id: 'chatcmpl-mock-' + Date.now(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: { content: (wordIdx === 0 ? '' : ' ') + words[wordIdx] },
              finish_reason: null,
            },
          ],
        };
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        wordIdx++;
      } else {
        clearInterval(interval);
        // Final chunk with usage
        const finalChunk = {
          id: 'chatcmpl-mock-' + Date.now(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        };
        reply.raw.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      }
    }, 20);

    return;
  }

  return reply.code(200).send({
    id: 'chatcmpl-mock-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: responseText,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  });
});

const PORT = Number(process.env.MOCK_PORT) || 8001;
mockApp.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`🤖 Mock LLM Provider running at http://0.0.0.0:${PORT}`);
});
