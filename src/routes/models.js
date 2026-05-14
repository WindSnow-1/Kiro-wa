const { Router } = require('express');
const { getModels } = require('../models');
const router = Router();

router.get('/models', (req, res) => {
  const models = getModels();
  res.json({
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created: m.created || 1700000000,
      owned_by: m.ownedBy || 'anthropic',
      display_name: m.displayName || m.id,
      type: m.modelType || 'chat',
      max_tokens: m.maxTokens || 64000,
    })),
  });
});

module.exports = router;
