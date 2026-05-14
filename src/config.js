const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  host: '0.0.0.0',
  port: 8990,
  apiKey: '',
  adminApiKey: '',
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

function loadConfig(configPath) {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config = { ...DEFAULT_CONFIG, ...raw };
  return config;
}

function loadCredentials(credPath) {
  const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  credentials = Array.isArray(raw) ? raw : [raw];
  credentials.forEach((cred, i) => {
    if (!cred.id) cred.id = i + 1;
  });
  return credentials;
}

function saveCredentials(credPath) {
  fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2), 'utf-8');
}

function getConfig() { return config; }
function getCredentials() { return credentials; }

module.exports = { loadConfig, loadCredentials, saveCredentials, getConfig, getCredentials };
