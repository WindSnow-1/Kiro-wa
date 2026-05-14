const { getConfig } = require('../config');
const { generateMachineId } = require('./machine-id');
const { getAuthRegion, getApiRegion } = require('./endpoint');
const crypto = require('crypto');

function isTokenExpired(credential) {
  return isTokenExpiringWithin(credential, 5);
}

function isTokenExpiringSoon(credential) {
  return isTokenExpiringWithin(credential, 10);
}

function isTokenExpiringWithin(credential, minutes) {
  if (!credential.expiresAt) return true;
  const expires = new Date(credential.expiresAt);
  return expires <= new Date(Date.now() + minutes * 60 * 1000);
}

function validateRefreshToken(credential) {
  const rt = credential.refreshToken;
  if (!rt) throw new Error('缺少 refreshToken');
  if (rt.length < 100 || rt.endsWith('...') || rt.includes('...')) {
    throw new Error(`refreshToken 已被截断（长度: ${rt.length}）`);
  }
}

async function refreshToken(credential) {
  if (credential.kiroApiKey) throw new Error('API Key 凭据不支持刷新');
  validateRefreshToken(credential);

  const authMethod = credential.authMethod || (credential.clientId && credential.clientSecret ? 'idc' : 'social');

  if (['idc', 'builder-id', 'iam'].includes(authMethod.toLowerCase())) {
    return refreshIdcToken(credential);
  }
  return refreshSocialToken(credential);
}

async function refreshSocialToken(credential) {
  const cfg = getConfig();
  const region = getAuthRegion(credential);
  const url = `https://prod.${region}.auth.desktop.kiro.dev/refreshToken`;
  const machineId = generateMachineId(credential, cfg);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'User-Agent': `KiroIDE-${cfg.kiroVersion}-${machineId}`,
      'Accept-Encoding': 'gzip, compress, deflate, br',
      'host': `prod.${region}.auth.desktop.kiro.dev`,
      'Connection': 'close',
    },
    body: JSON.stringify({ refreshToken: credential.refreshToken }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && body.includes('invalid_grant')) {
      throw new Error(`Social refreshToken 已失效: ${body}`);
    }
    throw new Error(`Social Token 刷新失败: ${res.status} ${body}`);
  }

  const data = await res.json();
  credential.accessToken = data.accessToken || data.access_token;
  if (data.refreshToken || data.refresh_token) credential.refreshToken = data.refreshToken || data.refresh_token;
  if (data.profileArn || data.profile_arn) credential.profileArn = data.profileArn || data.profile_arn;
  if (data.expiresIn || data.expires_in) {
    credential.expiresAt = new Date(Date.now() + (data.expiresIn || data.expires_in) * 1000).toISOString();
  }
  return credential;
}

async function refreshIdcToken(credential) {
  const cfg = getConfig();
  const region = getAuthRegion(credential);
  const url = `https://oidc.${region}.amazonaws.com/token`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-amz-user-agent': 'aws-sdk-js/3.980.0 KiroIDE',
      'user-agent': `aws-sdk-js/3.980.0 ua/2.1 os/${cfg.systemVersion || 'windows'} lang/js md/nodejs#${cfg.nodeVersion || '22.0.0'} api/sso-oidc#3.980.0 m/E KiroIDE`,
      'host': `oidc.${region}.amazonaws.com`,
      'amz-sdk-invocation-id': crypto.randomUUID(),
      'amz-sdk-request': 'attempt=1; max=4',
      'Connection': 'close',
    },
    body: JSON.stringify({
      clientId: credential.clientId,
      clientSecret: credential.clientSecret,
      refreshToken: credential.refreshToken,
      grantType: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && body.includes('invalid_grant')) {
      throw new Error(`IdC refreshToken 已失效: ${body}`);
    }
    throw new Error(`IdC Token 刷新失败: ${res.status} ${body}`);
  }

  const data = await res.json();
  credential.accessToken = data.accessToken || data.access_token;
  if (data.refreshToken || data.refresh_token) credential.refreshToken = data.refreshToken || data.refresh_token;
  if (data.profileArn || data.profile_arn) credential.profileArn = data.profileArn || data.profile_arn;
  if (data.expiresIn || data.expires_in) {
    credential.expiresAt = new Date(Date.now() + (data.expiresIn || data.expires_in) * 1000).toISOString();
  }
  return credential;
}

module.exports = { refreshToken, isTokenExpired, isTokenExpiringSoon, validateRefreshToken };
