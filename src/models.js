const { getConfig } = require('./config');

const DEFAULT_MODELS = [
  { id: 'claude-opus-4-7', kiroModel: 'claude-opus-4.7', displayName: 'Claude Opus 4.7', created: 1778544000, contextWindow: 1000000, aliases: ['opus-4-7', 'opus-4.7', 'opus'] },
  { id: 'claude-opus-4-7-thinking', kiroModel: 'claude-opus-4.7', displayName: 'Claude Opus 4.7 (Thinking)', created: 1778544000, contextWindow: 1000000, aliases: ['opus-4-7-thinking', 'opus-4.7-thinking'], thinking: { type: 'adaptive', budgetTokens: 20000, effort: 'high' } },
  { id: 'claude-opus-4-6', kiroModel: 'claude-opus-4.6', displayName: 'Claude Opus 4.6', created: 1770163200, contextWindow: 1000000, aliases: ['opus-4-6', 'opus-4.6'] },
  { id: 'claude-opus-4-6-thinking', kiroModel: 'claude-opus-4.6', displayName: 'Claude Opus 4.6 (Thinking)', created: 1770163200, contextWindow: 1000000, aliases: ['opus-4-6-thinking', 'opus-4.6-thinking'], thinking: { type: 'adaptive', budgetTokens: 20000, effort: 'high' } },
  { id: 'claude-sonnet-4-6', kiroModel: 'claude-sonnet-4.6', displayName: 'Claude Sonnet 4.6', created: 1771286400, contextWindow: 1000000, aliases: ['sonnet-4-6', 'sonnet-4.6'] },
  { id: 'claude-sonnet-4-6-thinking', kiroModel: 'claude-sonnet-4.6', displayName: 'Claude Sonnet 4.6 (Thinking)', created: 1771286400, contextWindow: 1000000, aliases: ['sonnet-4-6-thinking', 'sonnet-4.6-thinking'], thinking: { type: 'enabled', budgetTokens: 20000 } },
  { id: 'claude-opus-4-5', kiroModel: 'claude-opus-4.5', displayName: 'Claude Opus 4.5', created: 1763942400, contextWindow: 200000, aliases: ['opus-4-5', 'opus-4.5'] },
  { id: 'claude-opus-4-5-thinking', kiroModel: 'claude-opus-4.5', displayName: 'Claude Opus 4.5 (Thinking)', created: 1763942400, contextWindow: 200000, aliases: ['opus-4-5-thinking', 'opus-4.5-thinking'], thinking: { type: 'enabled', budgetTokens: 20000 } },
  { id: 'claude-sonnet-4-5', kiroModel: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', created: 1759104000, contextWindow: 200000, aliases: ['sonnet-4-5', 'sonnet-4.5', 'sonnet'] },
  { id: 'claude-sonnet-4-5-thinking', kiroModel: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5 (Thinking)', created: 1759104000, contextWindow: 200000, aliases: ['sonnet-4-5-thinking', 'sonnet-4.5-thinking'], thinking: { type: 'enabled', budgetTokens: 20000 } },
  { id: 'claude-haiku-4-5', kiroModel: 'claude-haiku-4.5', displayName: 'Claude Haiku 4.5', created: 1760486400, contextWindow: 200000, aliases: ['haiku', 'haiku-4-5', 'haiku-4.5'] },
  { id: 'claude-haiku-4-5-thinking', kiroModel: 'claude-haiku-4.5', displayName: 'Claude Haiku 4.5 (Thinking)', created: 1760486400, contextWindow: 200000, aliases: ['haiku-thinking'], thinking: { type: 'enabled', budgetTokens: 20000 } },
];

let dynamicModels = null;

function setDynamicModels(models) {
  dynamicModels = models;
}

function getDynamicModels() {
  return dynamicModels;
}

function getModels() {
  const cfg = getConfig();
  let models = cfg.replaceDefaultModels ? [] : [...DEFAULT_MODELS];

  if (dynamicModels && dynamicModels.length > 0) {
    for (const dm of dynamicModels) {
      if (!models.find(m => m.kiroModel === dm.kiroModel)) {
        models.push(dm);
      }
    }
  }

  for (const custom of (cfg.modelMappings || [])) {
    const idx = models.findIndex(m => m.id.toLowerCase() === custom.id.toLowerCase());
    if (idx >= 0) models.splice(idx, 1);
    models.push(custom);
  }
  return models;
}

function mapModel(model) {
  const models = getModels();
  const lower = model.toLowerCase();

  const exact = models.find(m => m.id.toLowerCase() === lower);
  if (exact) return exact;

  let best = null, bestScore = 0;
  for (const m of models) {
    for (const alias of (m.aliases || [])) {
      if (alias && lower.includes(alias.toLowerCase()) && alias.length > bestScore) {
        best = m;
        bestScore = alias.length;
      }
    }
  }
  return best;
}

function getContextWindow(model) {
  const m = mapModel(model);
  return m ? (m.contextWindow || 200000) : 200000;
}

module.exports = { getModels, mapModel, getContextWindow, setDynamicModels, getDynamicModels, DEFAULT_MODELS };
