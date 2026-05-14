const { getCredentials, getConfig, saveCredentials } = require('../config');
const { refreshToken, isTokenExpired, isTokenExpiringSoon } = require('./refresh');
const { buildApiUrl, buildApiHeaders, injectProfileArn } = require('./endpoint');
const { EventStreamDecoder } = require('../parser/decoder');
const { trackRequest, markQuotaExhausted } = require('../usage');
const h2 = require('./http2-client');
const path = require('path');

let credentialStates = [];

function initProvider() {
  const creds = getCredentials();
  credentialStates = creds.map((cred, i) => ({
    credential: cred,
    index: i,
    disabled: cred.disabled || false,
    failureCount: 0,
    lastFailure: null,
  }));
}

function getActiveCredentials() {
  return credentialStates.filter(s => !s.disabled);
}

async function getValidToken(state) {
  const cred = state.credential;
  if (cred.kiroApiKey) return cred.kiroApiKey;

  if (isTokenExpired(cred)) {
    console.log(`[provider] 凭据 ${state.index} token 已过期，刷新中...`);
    await refreshToken(cred);
    saveCredentials(process.argv.find((a, i) => process.argv[i - 1] === '--credentials') || require('path').join(__dirname, '../../config/credentials.json'));
  } else if (isTokenExpiringSoon(cred)) {
    refreshToken(cred).catch(e => console.error(`[provider] 后台刷新失败:`, e.message));
  }

  return cred.accessToken;
}

async function callApi(body) {
  const active = getActiveCredentials();
  if (active.length === 0) throw new Error('没有可用的凭据');

  let lastError;
  for (const state of active) {
    try {
      const token = await getValidToken(state);
      const url = buildApiUrl(state.credential);
      const headers = buildApiHeaders(state.credential, token);
      const requestBody = injectProfileArn({ conversationState: body }, state.credential);

      const bodyStr = JSON.stringify(requestBody);

      const res = await h2.requestStream(url, {
        method: 'POST',
        headers,
        body: bodyStr,
      });

      if (!res.ok) {
        const text = typeof res.text === 'function' ? await res.text() : (res.body || '');
        console.log(`[provider] 凭据 ${state.index} 错误: ${res.status} ${text.slice(0, 200)}`);
        if (text.includes('MONTHLY_REQUEST_COUNT')) {
          console.log(`[provider] 凭据 ${state.index} 月度配额用尽，禁用`);
          state.disabled = true;
          markQuotaExhausted(state.index);
          continue;
        }
        if (text.includes('The bearer token included in the request is invalid') || text.includes('INVALID_MODEL_ID')) {
          console.log(`[provider] 凭据 ${state.index} token 失效，强制刷新`);
          try {
            await refreshToken(state.credential);
            saveCredentials(process.argv.find((a, i) => process.argv[i - 1] === '--credentials') || require('path').join(__dirname, '../../config/credentials.json'));
            const newToken = state.credential.accessToken;
            const retryHeaders = buildApiHeaders(state.credential, newToken);
            const retryRes = await h2.requestStream(url, { method: 'POST', headers: retryHeaders, body: bodyStr });
            if (retryRes.ok) {
              state.failureCount = 0;
              return { res: retryRes, credIndex: state.index };
            }
            const retryText = typeof retryRes.text === 'function' ? await retryRes.text() : (retryRes.body || '');
            console.log(`[provider] 凭据 ${state.index} 重试仍失败: ${retryRes.status} ${retryText.slice(0, 200)}`);
          } catch (refreshErr) {
            console.error(`[provider] 凭据 ${state.index} 刷新失败:`, refreshErr.message);
          }
          state.failureCount++;
          continue;
        }
        throw new Error(`Kiro API error: ${res.status} ${text}`);
      }

      state.failureCount = 0;
      return { res, credIndex: state.index };
    } catch (e) {
      lastError = e;
      state.failureCount++;
      state.lastFailure = Date.now();
      console.error(`[provider] 凭据 ${state.index} 失败:`, e.message);
    }
  }

  throw lastError || new Error('所有凭据均失败');
}

function getCredentialStates() { return credentialStates; }

function setCredentialDisabled(index, disabled) {
  if (credentialStates[index]) credentialStates[index].disabled = disabled;
}

function resetCredential(index) {
  if (credentialStates[index]) {
    credentialStates[index].failureCount = 0;
    credentialStates[index].disabled = false;
    credentialStates[index].lastFailure = null;
  }
}

function credentialsPath() {
  return process.argv.find((a, i) => process.argv[i - 1] === '--credentials') || path.join(__dirname, '../../config/credentials.json');
}

function adminError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function cleanString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeCredential(input = {}) {
  const credential = {};
  const stringFields = [
    'refreshToken',
    'profileArn',
    'authMethod',
    'clientId',
    'clientSecret',
    'authRegion',
    'apiRegion',
    'region',
    'machineId',
    'proxyUrl',
    'proxyUsername',
    'proxyPassword',
    'kiroApiKey',
    'endpoint',
  ];

  for (const field of stringFields) {
    const value = cleanString(input[field]);
    if (value) credential[field] = value;
  }

  if (input.priority !== undefined && input.priority !== '') {
    const priority = Number(input.priority);
    credential.priority = Number.isFinite(priority) ? priority : 0;
  }

  if (input.disabled !== undefined) credential.disabled = Boolean(input.disabled);
  if (credential.authMethod === 'apiKey') credential.authMethod = 'api_key';
  if (!credential.authMethod) {
    credential.authMethod = credential.kiroApiKey ? 'api_key' : (credential.clientId && credential.clientSecret ? 'idc' : 'social');
  }
  return credential;
}

function nextCredentialId() {
  const ids = getCredentials().map(c => Number(c.id)).filter(Number.isFinite);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function hasDuplicateCredential(credential) {
  const creds = getCredentials();
  if (credential.kiroApiKey) {
    return creds.some(c => c.kiroApiKey && c.kiroApiKey === credential.kiroApiKey);
  }
  if (credential.refreshToken) {
    return creds.some(c => c.refreshToken && c.refreshToken === credential.refreshToken);
  }
  return false;
}

async function addCredential(input) {
  const credential = normalizeCredential(input);
  const isApiKey = !!credential.kiroApiKey;

  if (isApiKey) {
    credential.authMethod = 'api_key';
  } else {
    if (!credential.refreshToken) throw adminError('缺少 refreshToken');
    if (['idc', 'builder-id', 'iam'].includes(String(credential.authMethod).toLowerCase())) {
      if (!credential.clientId || !credential.clientSecret) {
        throw adminError('IdC 凭证需要 clientId 和 clientSecret');
      }
    }
  }

  if (hasDuplicateCredential(credential)) {
    throw adminError('凭证已存在', 409);
  }

  if (!isApiKey) {
    await refreshToken(credential);
  }

  credential.id = nextCredentialId();
  const creds = getCredentials();
  creds.push(credential);
  const state = {
    credential,
    index: creds.length - 1,
    disabled: credential.disabled || false,
    failureCount: 0,
    lastFailure: null,
  };
  credentialStates.push(state);
  saveCredentials(credentialsPath());
  return state;
}

module.exports = { initProvider, callApi, getCredentialStates, setCredentialDisabled, resetCredential, addCredential };
