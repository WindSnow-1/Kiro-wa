const fs = require('fs');
const path = require('path');

const usageData = {
  startTime: Date.now(),
  credentials: {},
  daily: {},
};

function getCredKey(credIndex) {
  return `cred_${credIndex}`;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function trackRequest(credIndex, model, inputTokens, outputTokens) {
  const key = getCredKey(credIndex);
  if (!usageData.credentials[key]) {
    usageData.credentials[key] = { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, models: {}, quotaExhausted: false };
  }
  const cred = usageData.credentials[key];
  cred.totalRequests++;
  cred.totalInputTokens += inputTokens || 0;
  cred.totalOutputTokens += outputTokens || 0;

  if (!cred.models[model]) cred.models[model] = { requests: 0, inputTokens: 0, outputTokens: 0 };
  cred.models[model].requests++;
  cred.models[model].inputTokens += inputTokens || 0;
  cred.models[model].outputTokens += outputTokens || 0;

  const today = getToday();
  if (!usageData.daily[today]) usageData.daily[today] = { requests: 0, inputTokens: 0, outputTokens: 0 };
  usageData.daily[today].requests++;
  usageData.daily[today].inputTokens += inputTokens || 0;
  usageData.daily[today].outputTokens += outputTokens || 0;
}

function markQuotaExhausted(credIndex) {
  const key = getCredKey(credIndex);
  if (!usageData.credentials[key]) {
    usageData.credentials[key] = { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, models: {}, quotaExhausted: true };
  }
  usageData.credentials[key].quotaExhausted = true;
  usageData.credentials[key].quotaExhaustedAt = new Date().toISOString();
}

function getUsageStats() {
  const uptime = Math.floor((Date.now() - usageData.startTime) / 1000);
  let totalRequests = 0, totalInput = 0, totalOutput = 0;
  for (const cred of Object.values(usageData.credentials)) {
    totalRequests += cred.totalRequests;
    totalInput += cred.totalInputTokens;
    totalOutput += cred.totalOutputTokens;
  }
  return {
    uptime,
    uptimeFormatted: formatUptime(uptime),
    totalRequests,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    credentials: usageData.credentials,
    daily: usageData.daily,
  };
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = { trackRequest, markQuotaExhausted, getUsageStats };
