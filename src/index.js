const express = require('express');
const path = require('path');
const { loadConfig, loadCredentials, getConfig } = require('./config');
const { initProvider } = require('./kiro/provider');
const { fetchAvailableModels } = require('./kiro/model-discovery');

const configPath = process.argv.find((a, i) => process.argv[i - 1] === '-c') || path.join(__dirname, '../config/config.json');
const credPath = process.argv.find((a, i) => process.argv[i - 1] === '--credentials') || path.join(__dirname, '../config/credentials.json');

loadConfig(configPath);
loadCredentials(credPath);

const cfg = getConfig();
initProvider();

const app = express();
app.use(express.json({ limit: '50mb' }));

// Auth middleware
app.use('/v1', (req, res, next) => {
  const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (cfg.apiKey && key !== cfg.apiKey) {
    return res.status(401).json({ error: { type: 'authentication_error', message: 'Invalid API key' } });
  }
  next();
});

app.use('/cc/v1', (req, res, next) => {
  const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (cfg.apiKey && key !== cfg.apiKey) {
    return res.status(401).json({ error: { type: 'authentication_error', message: 'Invalid API key' } });
  }
  next();
});

// Routes
app.use('/v1', require('./routes/models'));
app.use('/v1', require('./routes/messages'));
app.use('/cc/v1', require('./routes/messages'));
app.use('/', require('./routes/admin'));

app.listen(cfg.port, cfg.host, () => {
  console.log(`[kiro-node] 启动: ${cfg.host}:${cfg.port}`);
  console.log(`[kiro-node] API Key: ${cfg.apiKey ? cfg.apiKey.slice(0, 10) + '***' : '(none)'}`);
  console.log(`[kiro-node] GET  /v1/models`);
  console.log(`[kiro-node] POST /v1/messages`);
  console.log(`[kiro-node] POST /cc/v1/messages`);
  console.log(`[kiro-node] GET  /admin`);

  fetchAvailableModels().then(models => {
    if (models && models.length > 0) {
      console.log(`[kiro-node] 可用模型: ${models.map(m => m.kiroModel).join(', ')}`);
    }
  }).catch(e => console.error('[kiro-node] 获取可用模型失败:', e.message));
});
