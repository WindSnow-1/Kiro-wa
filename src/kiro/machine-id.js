const crypto = require('crypto');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeMachineId(machineId) {
  const trimmed = (machineId || '').trim();
  if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) return trimmed;
  const noDashes = trimmed.replace(/-/g, '');
  if (noDashes.length === 32 && /^[0-9a-fA-F]+$/.test(noDashes)) return noDashes + noDashes;
  return null;
}

function generateMachineId(credential, config) {
  if (credential.machineId) {
    const n = normalizeMachineId(credential.machineId);
    if (n) return n;
  }
  if (config.machineId) {
    const n = normalizeMachineId(config.machineId);
    if (n) return n;
  }
  if (credential.kiroApiKey) {
    return sha256(`KiroAPIKey/${credential.kiroApiKey}`);
  }
  if (credential.refreshToken) {
    return sha256(`KotlinNativeAPI/${credential.refreshToken}`);
  }
  if (!credential._fallbackMachineId) {
    credential._fallbackMachineId = sha256(`KiroFallback/${crypto.randomUUID()}`);
  }
  return credential._fallbackMachineId;
}

module.exports = { generateMachineId, sha256 };
