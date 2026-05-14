const { crc32 } = require('./crc');

const PRELUDE_SIZE = 12;
const MIN_MESSAGE_SIZE = 16;
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

const HEADER_TYPE = {
  BOOL_TRUE: 0,
  BOOL_FALSE: 1,
  BYTE: 2,
  SHORT: 3,
  INTEGER: 4,
  LONG: 5,
  BYTE_ARRAY: 6,
  STRING: 7,
  TIMESTAMP: 8,
  UUID: 9,
};

function parseHeaders(buf, headerLength) {
  const headers = {};
  let offset = 0;

  while (offset < headerLength) {
    const nameLen = buf[offset++];
    const name = buf.slice(offset, offset + nameLen).toString('utf-8');
    offset += nameLen;

    const valueType = buf[offset++];

    switch (valueType) {
      case HEADER_TYPE.BOOL_TRUE:
        headers[name] = true; break;
      case HEADER_TYPE.BOOL_FALSE:
        headers[name] = false; break;
      case HEADER_TYPE.BYTE:
        headers[name] = buf.readInt8(offset); offset += 1; break;
      case HEADER_TYPE.SHORT:
        headers[name] = buf.readInt16BE(offset); offset += 2; break;
      case HEADER_TYPE.INTEGER:
        headers[name] = buf.readInt32BE(offset); offset += 4; break;
      case HEADER_TYPE.LONG:
        headers[name] = buf.readBigInt64BE(offset); offset += 8; break;
      case HEADER_TYPE.BYTE_ARRAY: {
        const len = buf.readUInt16BE(offset); offset += 2;
        headers[name] = buf.slice(offset, offset + len); offset += len;
        break;
      }
      case HEADER_TYPE.STRING: {
        const len = buf.readUInt16BE(offset); offset += 2;
        headers[name] = buf.slice(offset, offset + len).toString('utf-8'); offset += len;
        break;
      }
      case HEADER_TYPE.TIMESTAMP:
        headers[name] = buf.readBigInt64BE(offset); offset += 8; break;
      case HEADER_TYPE.UUID:
        headers[name] = buf.slice(offset, offset + 16); offset += 16; break;
    }
  }
  return headers;
}

function parseFrame(buffer) {
  if (buffer.length < PRELUDE_SIZE) return null;

  const totalLength = buffer.readUInt32BE(0);
  const headerLength = buffer.readUInt32BE(4);
  const preludeCrc = buffer.readUInt32BE(8);

  if (totalLength < MIN_MESSAGE_SIZE) throw new Error(`Message too small: ${totalLength}`);
  if (totalLength > MAX_MESSAGE_SIZE) throw new Error(`Message too large: ${totalLength}`);
  if (buffer.length < totalLength) return null;

  const actualPreludeCrc = crc32(buffer.slice(0, 8));
  if (actualPreludeCrc !== preludeCrc) throw new Error(`Prelude CRC mismatch`);

  const messageCrc = buffer.readUInt32BE(totalLength - 4);
  const actualMessageCrc = crc32(buffer.slice(0, totalLength - 4));
  if (actualMessageCrc !== messageCrc) throw new Error(`Message CRC mismatch`);

  const headersStart = PRELUDE_SIZE;
  const headersEnd = headersStart + headerLength;
  const headers = parseHeaders(buffer.slice(headersStart, headersEnd), headerLength);

  const payload = buffer.slice(headersEnd, totalLength - 4);

  return { frame: { headers, payload }, consumed: totalLength };
}

module.exports = { parseFrame, PRELUDE_SIZE };
