const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  host: '0.0.0.0',
  port: 8990,
  apiKey: 'sk-kiro-node',
  adminApiKey: 'sk-admin',
  region: 'us-east-1',
  kiroVersion: '0.9.2',
  systemVersion: 'windows',
  nodeVersion: '22.0.0',
  defaultEndpoint: 'ide',
  modelMappings: [],
  replaceDefaultModels: false,
  machineId: null,
  tlsRejectUnauthorized: true,
  proxy: null,
};

let config = { ...DEFAULT_CONFIG };
let credentials = [];

function applyEnv(base) {
  const next = { ...base };
  if (process.env.HOST) next.host = process.env.HOST;
  if (process.env.PORT) {
    const port = Number(process.env.PORT);
    if (Number.isFinite(port)) next.port = port;
  }
  if (process.env.API_KEY) next.apiKey = process.env.API_KEY;
  if (process.env.ADMIN_API_KEY) next.adminApiKey = process.env.ADMIN_API_KEY;
  if (process.env.REGION) next.region = process.env.REGION;
  if (process.env.KIRO_VERSION) next.kiroVersion = process.env.KIRO_VERSION;
  if (process.env.SYSTEM_VERSION) next.systemVersion = process.env.SYSTEM_VERSION;
  if (process.env.NODE_VERSION) next.nodeVersion = process.env.NODE_VERSION;
  return next;
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    config = applyEnv(DEFAULT_CONFIG);
    return config;
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config = applyEnv({ ...DEFAULT_CONFIG, ...raw });
  return config;
}

function loadCredentials(credPath) {
  if (!fs.existsSync(credPath)) {
    credentials = [];
    return credentials;
  }
  const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  credentials = Array.isArray(raw) ? raw : [raw];
  credentials.forEach((cred, i) => {
    if (!cred.id) cred.id = i + 1;
  });
  return credentials;
}

function saveCredentials(credPath) {
  fs.mkdirSync(path.dirname(credPath), { recursive: true });
  fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2), 'utf-8');
}

function getConfig() { return config; }
function getCredentials() { return credentials; }

module.exports = { loadConfig, loadCredentials, saveCredentials, getConfig, getCredentials };
