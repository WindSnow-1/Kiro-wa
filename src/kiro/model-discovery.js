const crypto = require('crypto');
const { getCredentials, getConfig } = require('../config');
const { refreshToken, isTokenExpired } = require('./refresh');
const { getApiRegion } = require('./endpoint');
const { generateMachineId } = require('./machine-id');
const { setDynamicModels } = require('../models');
const h2 = require('./http2-client');

async function fetchAvailableModels() {
  const creds = getCredentials();
  if (!creds || creds.length === 0) return [];

  const cred = creds[0];
  const cfg = getConfig();

  if (isTokenExpired(cred)) {
    try {
      await refreshToken(cred);
    } catch (e) {
      console.error('[model-discovery] Token 刷新失败:', e.message);
      return [];
    }
  }

  const region = getApiRegion(cred);
  const machineId = generateMachineId(cred, cfg);
  const token = cred.accessToken;
  const profileArn = cred.profileArn;

  const params = new URLSearchParams({ origin: 'AI_EDITOR' });
  if (profileArn) params.set('profileArn', profileArn);

  const url = `https://q.${region}.amazonaws.com/ListAvailableModels?${params}`;

  const headers = {
    'x-amz-user-agent': `aws-sdk-js/1.0.34 KiroIDE-${cfg.kiroVersion}-${machineId}`,
    'user-agent': `aws-sdk-js/1.0.34 ua/2.1 os/${cfg.systemVersion || 'win32#10.0.22631'} lang/js md/nodejs#${cfg.nodeVersion || '22.22.0'} api/codewhispererstreaming#1.0.34 m/E KiroIDE-${cfg.kiroVersion}-${machineId}`,
    'host': `q.${region}.amazonaws.com`,
    'amz-sdk-invocation-id': crypto.randomUUID(),
    'amz-sdk-request': 'attempt=1; max=3',
    'Authorization': `Bearer ${token}`,
    'Connection': 'close',
  };

  try {
    const res = await h2.request(url, { method: 'GET', headers });
    const bodyText = res.body ? (Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body)) : '';
    if (!res.ok) {
      console.error('[model-discovery] ListAvailableModels 失败:', res.status, bodyText);
      return [];
    }

    const data = JSON.parse(bodyText);
    const models = (data.models || []).map(m => ({
      id: m.modelId,
      kiroModel: m.modelId,
      displayName: m.modelName || m.modelId,
      contextWindow: m.tokenLimits?.maxInputTokens || 200000,
      created: Math.floor(Date.now() / 1000),
      aliases: [],
    }));

    setDynamicModels(models);
    return models;
  } catch (e) {
    console.error('[model-discovery] 请求失败:', e.message);
    return [];
  }
}

module.exports = { fetchAvailableModels };
