const { Router } = require('express');
const { convertRequest } = require('../kiro/converter');
const { callApi } = require('../kiro/provider');
const { StreamTransformer, formatSse } = require('../stream/transformer');
const { mapModel } = require('../models');
const { hasWebSearchTool, handleWebSearchRequest } = require('../kiro/websearch');
const { trackRequest } = require('../usage');
const router = Router();

router.post('/messages', async (req, res) => {
  try {
    const payload = req.body;
    const mapping = mapModel(payload.model);
    if (!mapping) {
      return res.status(400).json({ type: 'error', error: { type: 'invalid_request_error', message: `模型不支持: ${payload.model}` } });
    }

    if (hasWebSearchTool(payload)) {
      return await handleWebSearchRequest(payload, res);
    }

    const { conversationState, thinking } = convertRequest(payload);
    const thinkingEnabled = !!(payload.thinking || thinking);

    const kiroRes = await callApi(conversationState);
    const credIndex = kiroRes._credIndex || 0;

    if (payload.stream === false) {
      return handleNonStream(kiroRes, payload, thinkingEnabled, credIndex, res);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const transformer = new StreamTransformer(payload.model, thinkingEnabled);

    // 像 Rust 版一样：开流前先发 message_start + 初始文本块
    res.write(formatSse(transformer.generateMessageStart()));
    transformer.messageStarted = true;
    if (!thinkingEnabled) {
      transformer.textBlockIndex = transformer.nextBlockIndex++;
      res.write(formatSse({ event: 'content_block_start', data: { type: 'content_block_start', index: transformer.textBlockIndex, content_block: { type: 'text', text: '' } } }));
    }

    const nodeStream = kiroRes.stream || kiroRes.body;

    for await (const chunk of nodeStream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const events = transformer.processChunk(buf);
      for (const event of events) {
        res.write(formatSse(event));
      }
    }

    const finalEvents = transformer.finalize();
    for (const event of finalEvents) {
      res.write(formatSse(event));
    }
    trackRequest(credIndex, payload.model, transformer.inputTokens, transformer.outputTokens);
    res.end();
  } catch (e) {
    console.error('[messages] Error:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ type: 'error', error: { type: 'api_error', message: e.message } });
    } else {
      try {
        if (!res.writableEnded) {
          res.write(formatSse({ event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }));
          res.write(formatSse({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `[proxy error] ${e.message}` } } }));
          res.write(formatSse({ event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } }));
          res.write(formatSse({ event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 0, output_tokens: 0 } } }));
          res.write(formatSse({ event: 'message_stop', data: { type: 'message_stop' } }));
        }
      } catch (_) {}
      res.end();
    }
  }
});

async function handleNonStream(kiroRes, payload, thinkingEnabled, credIndex, res) {
  const transformer = new StreamTransformer(payload.model, thinkingEnabled);
  const chunks = [];

  for await (const chunk of (kiroRes.stream || kiroRes.body)) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(...transformer.processChunk(buf));
  }
  chunks.push(...transformer.finalize());

  const content = [];
  let stopReason = 'end_turn';
  let inputTokens = 0, outputTokens = 0;

  for (const event of chunks) {
    if (event.event === 'content_block_start') {
      const block = event.data.content_block;
      if (block.type === 'text') content.push({ type: 'text', text: '' });
      else if (block.type === 'thinking') content.push({ type: 'thinking', thinking: '' });
      else if (block.type === 'tool_use') content.push({ type: 'tool_use', id: block.id, name: block.name, input: {} });
    } else if (event.event === 'content_block_delta') {
      const delta = event.data.delta;
      const idx = event.data.index;
      const block = content.find((_, i) => i === idx) || content[content.length - 1];
      if (delta.type === 'text_delta' && block) block.text = (block.text || '') + delta.text;
      else if (delta.type === 'thinking_delta' && block) block.thinking = (block.thinking || '') + delta.thinking;
      else if (delta.type === 'input_json_delta' && block) {
        block._inputBuf = (block._inputBuf || '') + delta.partial_json;
      }
    } else if (event.event === 'message_delta') {
      stopReason = event.data.delta.stop_reason;
      inputTokens = event.data.usage.input_tokens;
      outputTokens = event.data.usage.output_tokens;
    }
  }

  for (const block of content) {
    if (block.type === 'tool_use' && block._inputBuf) {
      try { block.input = JSON.parse(block._inputBuf); } catch { block.input = {}; }
      delete block._inputBuf;
    }
  }

  trackRequest(credIndex, payload.model, inputTokens, outputTokens);

  res.json({
    id: transformer.messageId,
    type: 'message',
    role: 'assistant',
    content,
    model: payload.model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
}

module.exports = router;
