const crypto = require('crypto');
const { mapModel, getContextWindow } = require('../models');

function convertRequest(req) {
  const mapping = mapModel(req.model);
  if (!mapping) throw new Error(`模型不支持: ${req.model}`);

  const modelId = mapping.kiroModel;
  if (!req.messages || req.messages.length === 0) throw new Error('消息列表为空');

  let messages = req.messages;
  if (messages[messages.length - 1].role !== 'user') {
    const lastUserIdx = messages.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx < 0) throw new Error('消息列表为空');
    messages = messages.slice(0, lastUserIdx + 1);
  }

  const conversationId = extractSessionId(req.metadata?.user_id) || crypto.randomUUID();
  const history = buildHistory(req, messages, modelId);
  const lastMsg = messages[messages.length - 1];
  const { text, images, toolResults } = processContent(lastMsg.content);

  const tools = convertTools(req.tools);
  addPlaceholderTools(history, tools);

  const context = {};
  if (tools.length > 0) context.tools = tools;
  if (toolResults.length > 0) context.toolResults = toolResults;

  const conversationState = {
    agentContinuationId: crypto.randomUUID(),
    agentTaskType: 'vibe',
    chatTriggerType: 'MANUAL',
    conversationId,
    currentMessage: {
      userInputMessage: {
        content: text,
        modelId,
        origin: 'AI_EDITOR',
        userInputMessageContext: context,
        ...(images.length > 0 ? { images } : {}),
      },
    },
    ...(history.length > 0 ? { history } : {}),
  };

  return { conversationState, thinking: mapping.thinking };
}

function extractSessionId(userId) {
  if (!userId) return null;
  try {
    const json = JSON.parse(userId);
    if (json.session_id && isValidUuid(json.session_id)) return json.session_id;
  } catch {}
  const idx = userId.indexOf('session_');
  if (idx >= 0) {
    const part = userId.slice(idx + 8, idx + 8 + 36);
    if (isValidUuid(part)) return part;
  }
  return null;
}

function isValidUuid(s) {
  return s.length === 36 && (s.match(/-/g) || []).length === 4;
}

function processContent(content) {
  const text = [], images = [], toolResults = [];
  if (typeof content === 'string') {
    text.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && block.text) text.push(block.text);
      else if (block.type === 'image' && block.source) {
        const fmt = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[block.source.media_type];
        if (fmt) images.push({ format: fmt, source: { bytes: block.source.data } });
      } else if (block.type === 'tool_result' && block.tool_use_id) {
        const resultContent = extractToolResultContent(block.content);
        toolResults.push({
          toolUseId: block.tool_use_id,
          content: [{ text: resultContent }],
          status: block.is_error ? 'error' : 'success',
          ...(block.is_error ? { isError: true } : {}),
        });
      }
    }
  }
  return { text: text.join('\n'), images, toolResults };
}

function extractToolResultContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => c.text || '').join('\n');
  return JSON.stringify(content);
}

function convertTools(tools) {
  if (!tools) return [];
  return tools.map(t => ({
    toolSpecification: {
      name: t.name.length > 63 ? shortenName(t.name) : t.name,
      description: (t.description || '').slice(0, 10000),
      inputSchema: { json: normalizeSchema(t.input_schema) },
    },
  }));
}

function shortenName(name) {
  const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, 8);
  return name.slice(0, 54) + '_' + hash;
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {}, required: [], additionalProperties: true };
  const s = { ...schema };
  if (!s.type) s.type = 'object';
  if (!s.properties || typeof s.properties !== 'object') s.properties = {};
  if (!Array.isArray(s.required)) s.required = [];
  if (s.additionalProperties === undefined) s.additionalProperties = true;
  return s;
}

function addPlaceholderTools(history, tools) {
  const existing = new Set(tools.map(t => t.toolSpecification.name.toLowerCase()));
  for (const msg of history) {
    if (msg.assistantResponseMessage?.toolUses) {
      for (const tu of msg.assistantResponseMessage.toolUses) {
        if (!existing.has(tu.name.toLowerCase())) {
          existing.add(tu.name.toLowerCase());
          tools.push({ toolSpecification: { name: tu.name, description: 'Tool used in conversation history', inputSchema: { json: { type: 'object', properties: {}, required: [], additionalProperties: true } } } });
        }
      }
    }
  }
}

function buildHistory(req, messages, modelId) {
  const history = [];
  const thinkingPrefix = generateThinkingPrefix(req);

  if (req.system) {
    const sysContent = (Array.isArray(req.system) ? req.system.map(s => s.text).join('\n') : req.system);
    if (sysContent) {
      const finalContent = thinkingPrefix && !sysContent.includes('<thinking_mode>') ? `${thinkingPrefix}\n${sysContent}` : sysContent;
      history.push({ userInputMessage: { content: finalContent, modelId } });
      history.push({ assistantResponseMessage: { content: 'I will follow these instructions.' } });
    }
  } else if (thinkingPrefix) {
    history.push({ userInputMessage: { content: thinkingPrefix, modelId } });
    history.push({ assistantResponseMessage: { content: 'I will follow these instructions.' } });
  }

  const historyMsgs = messages.slice(0, -1);
  let userBuf = [], assistantBuf = [];

  for (const msg of historyMsgs) {
    if (msg.role === 'user') {
      if (assistantBuf.length > 0) { history.push(mergeAssistant(assistantBuf)); assistantBuf = []; }
      userBuf.push(msg);
    } else if (msg.role === 'assistant') {
      if (userBuf.length > 0) { history.push(mergeUser(userBuf, modelId)); userBuf = []; }
      assistantBuf.push(msg);
    }
  }
  if (assistantBuf.length > 0) history.push(mergeAssistant(assistantBuf));
  if (userBuf.length > 0) {
    history.push(mergeUser(userBuf, modelId));
    history.push({ assistantResponseMessage: { content: 'OK' } });
  }

  return history;
}

function mergeUser(msgs, modelId) {
  const parts = [], allImages = [], allResults = [];
  for (const m of msgs) {
    const { text, images, toolResults } = processContent(m.content);
    if (text) parts.push(text);
    allImages.push(...images);
    allResults.push(...toolResults);
  }
  const msg = { userInputMessage: { content: parts.join('\n'), modelId, userInputMessageContext: {} } };
  if (allImages.length > 0) msg.userInputMessage.images = allImages;
  if (allResults.length > 0) msg.userInputMessage.userInputMessageContext.toolResults = allResults;
  return msg;
}

function mergeAssistant(msgs) {
  let content = '', toolUses = [];
  for (const m of msgs) {
    const { text, tools } = processAssistantContent(m.content);
    if (text.trim()) content += (content ? '\n\n' : '') + text;
    toolUses.push(...tools);
  }
  if (!content && toolUses.length > 0) content = ' ';
  const result = { assistantResponseMessage: { content } };
  if (toolUses.length > 0) result.assistantResponseMessage.toolUses = toolUses;
  return result;
}

function processAssistantContent(content) {
  let thinking = '', text = '';
  const tools = [];
  if (typeof content === 'string') return { text: content, tools };
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'thinking' && block.thinking) thinking += block.thinking;
      else if (block.type === 'text' && block.text) text += block.text;
      else if (block.type === 'tool_use' && block.id && block.name) {
        tools.push({ toolUseId: block.id, name: block.name.length > 63 ? shortenName(block.name) : block.name, input: block.input || {} });
      }
    }
  }
  const finalText = thinking ? (text ? `<thinking>${thinking}</thinking>\n\n${text}` : `<thinking>${thinking}</thinking>`) : text;
  return { text: finalText, tools };
}

function generateThinkingPrefix(req) {
  if (!req.thinking) return null;
  if (req.thinking.type === 'enabled') {
    return `<thinking_mode>enabled</thinking_mode><max_thinking_length>${req.thinking.budget_tokens || 20000}</max_thinking_length>`;
  }
  if (req.thinking.type === 'adaptive') {
    const effort = req.output_config?.effort || 'high';
    return `<thinking_mode>adaptive</thinking_mode><thinking_effort>${effort}</thinking_effort>`;
  }
  return null;
}

module.exports = { convertRequest };

