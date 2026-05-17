const crypto = require('crypto');
const { EventStreamDecoder } = require('../parser/decoder');
const { getContextWindow } = require('../models');

class StreamTransformer {
  constructor(model, thinkingEnabled = false) {
    this.model = model;
    this.messageId = 'msg_' + crypto.randomUUID().replace(/-/g, '');
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.contextWindow = getContextWindow(model);
    this.thinkingEnabled = thinkingEnabled;
    this.inThinking = false;
    this.thinkingBuffer = '';
    this.thinkingBlockIndex = null;
    this.textBlockIndex = null;
    this.toolBlocks = {};
    this.nextBlockIndex = 0;
    this.hasToolUse = false;
    this.stopReason = null;
    this.messageStarted = false;
    this.decoder = new EventStreamDecoder();
  }

  generateMessageStart() {
    return {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: this.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: this.inputTokens, output_tokens: 1 },
        },
      },
    };
  }

  processChunk(chunk) {
    this.decoder.feed(chunk);
    const events = [];

    for (const decoded of this.decoder.decode()) {
      if (decoded.type === 'event') {
        switch (decoded.eventType) {
          case 'assistantResponseEvent':
            events.push(...this.handleAssistantResponse(decoded.data.content || ''));
            break;
          case 'toolUseEvent':
            events.push(...this.handleToolUse(decoded.data));
            break;
          case 'contextUsageEvent': {
            const pct = decoded.data.contextUsagePercentage || 0;
            this.inputTokens = Math.round(pct * this.contextWindow / 100);
            if (pct >= 100) this.stopReason = 'model_context_window_exceeded';
            break;
          }
        }
      } else if (decoded.type === 'exception') {
        if (decoded.exceptionType === 'ContentLengthExceededException') {
          this.stopReason = 'max_tokens';
        }
      }
    }
    return events;
  }

  handleAssistantResponse(content) {
    if (!content) return [];
    this.outputTokens += Math.ceil(content.length / 4);
    const events = [];

    if (!this.messageStarted) {
      this.messageStarted = true;
      events.push(this.generateMessageStart());
      if (!this.thinkingEnabled) {
        this.textBlockIndex = this.nextBlockIndex++;
        events.push({ event: 'content_block_start', data: { type: 'content_block_start', index: this.textBlockIndex, content_block: { type: 'text', text: '' } } });
      }
    }

    if (this.thinkingEnabled) {
      events.push(...this.processWithThinking(content));
    } else {
      events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: this.textBlockIndex, delta: { type: 'text_delta', text: content } } });
    }
    return events;
  }

  processWithThinking(content) {
    const events = [];
    this.thinkingBuffer += content;

    while (this.thinkingBuffer.length > 0) {
      if (!this.inThinking) {
        const startIdx = this.thinkingBuffer.indexOf('<thinking>');
        if (startIdx === 0) {
          this.inThinking = true;
          this.thinkingBuffer = this.thinkingBuffer.slice(10);
          if (this.thinkingBlockIndex === null) {
            this.thinkingBlockIndex = this.nextBlockIndex++;
            events.push({ event: 'content_block_start', data: { type: 'content_block_start', index: this.thinkingBlockIndex, content_block: { type: 'thinking', thinking: '' } } });
          }
        } else if (startIdx > 0) {
          const textBefore = this.thinkingBuffer.slice(0, startIdx);
          this.thinkingBuffer = this.thinkingBuffer.slice(startIdx);
          events.push(...this.emitText(textBefore));
        } else {
          const endCheck = this.thinkingBuffer.indexOf('</thinking>');
          if (endCheck >= 0) {
            const textBefore = this.thinkingBuffer.slice(0, endCheck);
            this.thinkingBuffer = this.thinkingBuffer.slice(endCheck + 11);
            events.push(...this.emitText(textBefore));
          } else {
            if (!this.thinkingBuffer.startsWith('<')) {
              events.push(...this.emitText(this.thinkingBuffer));
              this.thinkingBuffer = '';
            } else {
              break;
            }
          }
        }
      } else {
        const endIdx = this.thinkingBuffer.indexOf('</thinking>');
        if (endIdx >= 0) {
          const thinkingText = this.thinkingBuffer.slice(0, endIdx);
          this.thinkingBuffer = this.thinkingBuffer.slice(endIdx + 11);
          this.inThinking = false;
          if (thinkingText) {
            events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: this.thinkingBlockIndex, delta: { type: 'thinking_delta', thinking: thinkingText } } });
          }
          events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: this.thinkingBlockIndex } });
        } else {
          const safeLen = Math.max(0, this.thinkingBuffer.length - 11);
          if (safeLen > 0) {
            const chunk = this.thinkingBuffer.slice(0, safeLen);
            this.thinkingBuffer = this.thinkingBuffer.slice(safeLen);
            events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: this.thinkingBlockIndex, delta: { type: 'thinking_delta', thinking: chunk } } });
          }
          break;
        }
      }
    }
    return events;
  }

  emitText(text) {
    if (!text) return [];
    if (this.textBlockIndex === null) {
      this.textBlockIndex = this.nextBlockIndex++;
      return [
        { event: 'content_block_start', data: { type: 'content_block_start', index: this.textBlockIndex, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: this.textBlockIndex, delta: { type: 'text_delta', text } } },
      ];
    }
    return [{ event: 'content_block_delta', data: { type: 'content_block_delta', index: this.textBlockIndex, delta: { type: 'text_delta', text } } }];
  }

  handleToolUse(data) {
    const events = [];
    const { name, toolUseId, input, stop } = data;

    if (!this.toolBlocks[toolUseId]) {
      if (this.textBlockIndex !== null) {
        events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: this.textBlockIndex } });
        this.textBlockIndex = null;
      }
      const idx = this.nextBlockIndex++;
      this.toolBlocks[toolUseId] = { index: idx, inputBuf: '' };
      this.hasToolUse = true;
      events.push({ event: 'content_block_start', data: { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: toolUseId, name } } });
    }

    const block = this.toolBlocks[toolUseId];
    if (input) {
      block.inputBuf += input;
      events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: block.index, delta: { type: 'input_json_delta', partial_json: input } } });
    }

    if (stop) {
      events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: block.index } });
    }
    return events;
  }

  finalize() {
    const events = [];
    if (!this.messageStarted) {
      this.messageStarted = true;
      events.push(this.generateMessageStart());
      this.textBlockIndex = this.nextBlockIndex++;
      events.push({ event: 'content_block_start', data: { type: 'content_block_start', index: this.textBlockIndex, content_block: { type: 'text', text: '' } } });
    }
    if (this.textBlockIndex !== null) {
      events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: this.textBlockIndex } });
    }
    const stopReason = this.stopReason || (this.hasToolUse ? 'tool_use' : 'end_turn');
    events.push({ event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { input_tokens: this.inputTokens, output_tokens: this.outputTokens } } });
    events.push({ event: 'message_stop', data: { type: 'message_stop' } });
    return events;
  }
}

function formatSse(event) {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

module.exports = { StreamTransformer, formatSse };
