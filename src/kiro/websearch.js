const crypto = require('crypto');
const h2 = require('./http2-client');
const { getCredentials, getConfig, saveCredentials } = require('../config');
const { refreshToken, isTokenExpired } = require('./refresh');
const { buildMcpUrl, buildMcpHeaders } = require('./endpoint');
const { formatSse } = require('../stream/transformer');

function hasWebSearchTool(payload) {
  const tools = payload.tools;
  return Array.isArray(tools) && tools.length === 1 && tools[0].name === 'web_search';
}

function extractSearchQuery(payload) {
  const msg = payload.messages && payload.messages[payload.messages.length - 1];
  if (!msg) return null;

  let text;
  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    const block = msg.content.find(b => b.type === 'text');
    text = block ? block.text : null;
  }
  if (!text) return null;

  const prefix = 'Perform a web search for the query: ';
  if (text.startsWith(prefix)) text = text.slice(prefix.length);
  return text || null;
}

function generateRandomId(len, charset) {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

function createMcpRequest(query) {
  const alphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const lowerAlphanumeric = 'abcdefghijklmnopqrstuvwxyz0123456789';

  const random22 = generateRandomId(22, alphanumeric);
  const timestamp = Date.now();
  const random8 = generateRandomId(8, lowerAlphanumeric);

  const requestId = `web_search_tooluse_${random22}_${timestamp}_${random8}`;
  const toolUseId = `srvtoolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`;

  const request = {
    id: requestId,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'web_search',
      arguments: { query },
    },
  };

  return { toolUseId, request };
}

async function callMcpApi(credential, mcpRequest) {
  const token = credential.accessToken || credential.kiroApiKey;
  const url = buildMcpUrl(credential);
  const headers = buildMcpHeaders(credential, token);
  const body = JSON.stringify(mcpRequest);

  console.log(`[websearch] MCP request: ${mcpRequest.params.arguments.query}`);

  const res = await h2.request(url, { method: 'POST', headers, body });

  if (!res.ok) {
    const text = res.body ? res.body.toString('utf8') : '';
    throw new Error(`MCP API error: ${res.status} ${text.slice(0, 200)}`);
  }

  const responseText = res.body.toString('utf8');
  console.log(`[websearch] MCP response: ${responseText.slice(0, 500)}`);

  const mcpResponse = JSON.parse(responseText);
  if (mcpResponse.error) {
    throw new Error(`MCP error: ${mcpResponse.error.code || -1} - ${mcpResponse.error.message || 'Unknown'}`);
  }
  return mcpResponse;
}

function parseSearchResults(mcpResponse) {
  if (!mcpResponse.result || !mcpResponse.result.content || !mcpResponse.result.content.length) return null;
  const content = mcpResponse.result.content[0];
  if (content.type !== 'text') return null;
  try {
    return JSON.parse(content.text);
  } catch {
    return null;
  }
}

function generateSearchSummary(query, results) {
  let summary = `Here are the search results for "${query}":\n\n`;
  if (results && results.results && results.results.length > 0) {
    for (let i = 0; i < results.results.length; i++) {
      const r = results.results[i];
      summary += `${i + 1}. **${r.title}**\n`;
      if (r.snippet) {
        const truncated = r.snippet.length > 200 ? r.snippet.slice(0, 200) + '...' : r.snippet;
        summary += `   ${truncated}\n`;
      }
      summary += `   Source: ${r.url}\n\n`;
    }
  } else {
    summary += 'No results found.\n';
  }
  summary += '\nPlease note that these are web search results and may not be fully accurate or up-to-date.';
  return summary;
}

function generateWebSearchEvents(model, query, toolUseId, searchResults, inputTokens) {
  const messageId = 'msg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const events = [];

  // 1. message_start
  events.push({
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: inputTokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    },
  });

  // 2. text block (decision) - index 0
  const decisionText = `I'll search for "${query}".`;
  events.push({ event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: decisionText } } });
  events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } });

  // 3. server_tool_use - index 1
  events.push({ event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { id: toolUseId, type: 'server_tool_use', name: 'web_search', input: { query } } } });
  events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } });

  // 4. web_search_tool_result - index 2
  let searchContent = [];
  if (searchResults && searchResults.results) {
    searchContent = searchResults.results.map(r => {
      let pageAge = null;
      if (r.publishedDate) {
        const d = new Date(r.publishedDate);
        pageAge = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      }
      return {
        type: 'web_search_result',
        title: r.title,
        url: r.url,
        encrypted_content: r.snippet || '',
        page_age: pageAge,
      };
    });
  }
  events.push({ event: 'content_block_start', data: { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', content: searchContent } } });
  events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: 2 } });

  // 5. text block (summary) - index 3
  const summary = generateSearchSummary(query, searchResults);
  events.push({ event: 'content_block_start', data: { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } } });

  // chunk the summary
  for (let i = 0; i < summary.length; i += 100) {
    events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: summary.slice(i, i + 100) } } });
  }
  events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: 3 } });

  // 6. message_delta + message_stop
  const outputTokens = Math.ceil((summary.length + 3) / 4);
  events.push({ event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outputTokens, server_tool_use: { web_search_requests: 1 } } } });
  events.push({ event: 'message_stop', data: { type: 'message_stop' } });

  return events;
}

async function handleWebSearchRequest(payload, res) {
  const query = extractSearchQuery(payload);
  if (!query) {
    return res.status(400).json({ type: 'error', error: { type: 'invalid_request_error', message: '无法从消息中提取搜索查询' } });
  }

  console.log(`[websearch] 处理搜索请求: "${query}"`);

  const { toolUseId, request: mcpRequest } = createMcpRequest(query);

  // Get a valid credential
  const creds = getCredentials();
  const cred = creds.find(c => !c.disabled) || creds[0];
  if (!cred) {
    return res.status(500).json({ type: 'error', error: { type: 'api_error', message: '没有可用凭据' } });
  }

  // Refresh token if needed
  if (!cred.kiroApiKey && isTokenExpired(cred)) {
    await refreshToken(cred);
    const credPath = process.argv.find((a, i) => process.argv[i - 1] === '--credentials') || require('path').join(__dirname, '../../config/credentials.json');
    saveCredentials(credPath);
  }

  let searchResults = null;
  try {
    const mcpResponse = await callMcpApi(cred, mcpRequest);
    searchResults = parseSearchResults(mcpResponse);
  } catch (e) {
    console.warn(`[websearch] MCP API 调用失败: ${e.message}`);
  }

  const inputTokens = Math.ceil((JSON.stringify(payload.messages).length) / 4);
  const events = generateWebSearchEvents(payload.model, query, toolUseId, searchResults, inputTokens);

  if (payload.stream === false) {
    // Non-streaming: build full response
    const content = [];
    const decisionText = `I'll search for "${query}".`;
    content.push({ type: 'text', text: decisionText });
    content.push({ id: toolUseId, type: 'server_tool_use', name: 'web_search', input: { query } });

    let searchContent = [];
    if (searchResults && searchResults.results) {
      searchContent = searchResults.results.map(r => ({
        type: 'web_search_result',
        title: r.title,
        url: r.url,
        encrypted_content: r.snippet || '',
        page_age: r.publishedDate ? new Date(r.publishedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null,
      }));
    }
    content.push({ type: 'web_search_tool_result', content: searchContent });
    content.push({ type: 'text', text: generateSearchSummary(query, searchResults) });

    return res.json({
      id: 'msg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24),
      type: 'message',
      role: 'assistant',
      model: payload.model,
      content,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: Math.ceil(decisionText.length / 4) },
    });
  }

  // Streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  for (const event of events) {
    res.write(formatSse(event));
  }
  res.end();
}

module.exports = { hasWebSearchTool, extractSearchQuery, handleWebSearchRequest };
