const { crc32 } = require('crc');

function crc32Buf(buffer) {
  return crc32(buffer) >>> 0;
}

module.exports = { crc32: crc32Buf };
