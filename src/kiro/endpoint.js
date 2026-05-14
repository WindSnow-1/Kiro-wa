const crypto = require('crypto');
const { generateMachineId } = require('./machine-id');
const { getConfig } = require('../config');

function getApiRegion(credential) {
  return credential.apiRegion || credential.region || getConfig().region || 'us-east-1';
}

function getAuthRegion(credential) {
  return credential.authRegion || credential.region || getConfig().region || 'us-east-1';
}

function buildApiUrl(credential) {
  const region = getApiRegion(credential);
  return `https://q.${region}.amazonaws.com/generateAssistantResponse`;
}

function buildMcpUrl(credential) {
  const region = getApiRegion(credential);
  return `https://q.${region}.amazonaws.com/mcp`;
}

function buildApiHeaders(credential, token) {
  const cfg = getConfig();
  const machineId = generateMachineId(credential, cfg);
  const region = getApiRegion(credential);
  const host = `q.${region}.amazonaws.com`;

  const headers = {
    'content-type': 'application/json',
    'x-amzn-codewhisperer-optout': 'true',
    'x-amzn-kiro-agent-mode': 'vibe',
    'x-amz-user-agent': `aws-sdk-js/1.0.34 KiroIDE-${cfg.kiroVersion}-${machineId}`,
    'user-agent': `aws-sdk-js/1.0.34 ua/2.1 os/${cfg.systemVersion || 'windows'} lang/js md/nodejs#${cfg.nodeVersion || '22.0.0'} api/codewhispererstreaming#1.0.34 m/E KiroIDE-${cfg.kiroVersion}-${machineId}`,
    'host': host,
    'amz-sdk-invocation-id': crypto.randomUUID(),
    'amz-sdk-request': 'attempt=1; max=3',
    'Authorization': `Bearer ${token}`,
    'Connection': 'close',
  };

  if (credential.profileArn) {
    headers['x-amzn-kiro-profile-arn'] = credential.profileArn;
  }
  if (credential.kiroApiKey) {
    headers['tokentype'] = 'API_KEY';
  }

  return headers;
}

function buildMcpHeaders(credential, token) {
  const cfg = getConfig();
  const machineId = generateMachineId(credential, cfg);
  const region = getApiRegion(credential);
  const host = `q.${region}.amazonaws.com`;

  const headers = {
    'content-type': 'application/json',
    'x-amz-user-agent': `aws-sdk-js/1.0.34 KiroIDE-${cfg.kiroVersion}-${machineId}`,
    'user-agent': `aws-sdk-js/1.0.34 ua/2.1 os/${cfg.systemVersion || 'windows'} lang/js md/nodejs#${cfg.nodeVersion || '22.0.0'} api/codewhispererstreaming#1.0.34 m/E KiroIDE-${cfg.kiroVersion}-${machineId}`,
    'host': host,
    'amz-sdk-invocation-id': crypto.randomUUID(),
    'amz-sdk-request': 'attempt=1; max=3',
    'Authorization': `Bearer ${token}`,
    'Connection': 'close',
  };

  if (credential.profileArn) {
    headers['x-amzn-kiro-profile-arn'] = credential.profileArn;
  }
  if (credential.kiroApiKey) {
    headers['tokentype'] = 'API_KEY';
  }

  return headers;
}

function injectProfileArn(body, credential) {
  if (credential.profileArn) {
    body.profileArn = credential.profileArn;
  }
  return body;
}

module.exports = { buildApiUrl, buildMcpUrl, buildApiHeaders, buildMcpHeaders, injectProfileArn, getApiRegion, getAuthRegion };
