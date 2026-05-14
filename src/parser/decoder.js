const { parseFrame } = require('./frame');

class EventStreamDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.errorCount = 0;
    this.maxErrors = 5;
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  *decode() {
    while (this.buffer.length >= 12) {
      try {
        const result = parseFrame(this.buffer);
        if (!result) break;

        this.buffer = this.buffer.slice(result.consumed);
        this.errorCount = 0;

        const { headers, payload } = result.frame;
        const messageType = headers[':message-type'] || 'event';
        const eventType = headers[':event-type'] || 'unknown';

        if (messageType === 'event') {
          let data = {};
          if (payload.length > 0) {
            try { data = JSON.parse(payload.toString('utf-8')); } catch {}
          }
          yield { type: 'event', eventType, data };
        } else if (messageType === 'error') {
          yield { type: 'error', errorCode: headers[':error-code'] || 'UnknownError', message: payload.toString('utf-8') };
        } else if (messageType === 'exception') {
          yield { type: 'exception', exceptionType: headers[':exception-type'] || 'UnknownException', message: payload.toString('utf-8') };
        }
      } catch (e) {
        this.errorCount++;
        if (this.errorCount >= this.maxErrors) {
          throw new Error(`Too many decode errors: ${e.message}`);
        }
        this.buffer = this.buffer.slice(1);
      }
    }
  }
}

module.exports = { EventStreamDecoder };
