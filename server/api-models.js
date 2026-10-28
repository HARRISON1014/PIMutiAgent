import { createModels, createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';

const factories = {'openai-completions':openAICompletionsApi,'openai-responses':openAIResponsesApi,'anthropic-messages':anthropicMessagesApi,'google-generative-ai':googleGenerativeAIApi};
export function createApiModel(connection) {
  const api = connection.api || 'openai-completions';
  const model = {id:connection.model,name:connection.name,api,provider:connection.id,baseUrl:connection.baseUrl,reasoning:connection.reasoning || false,input:['text'],contextWindow:connection.contextWindow,maxTokens:connection.maxTokens,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  if (api === 'openai-completions') model.compat = {supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens'};
  const models = createModels();
  models.setProvider(createProvider({id:connection.id,name:connection.name,baseUrl:connection.baseUrl,models:[model],auth:{apiKey:envApiKeyAuth(connection.name,[connection.apiKeyEnv])},api:factories[api]()}));
  return {models,model};
}
export function normalizedUsage(usage = {}, source) {
  return {input:(usage.input || 0)+(usage.cacheRead || 0)+(usage.cacheWrite || 0),output:usage.output || 0,cached:usage.cacheRead || 0,source};
}
export async function listConnectionModels(c,key,signal = AbortSignal.timeout(12000)) {
  const base = c.baseUrl.replace(/\/$/, ''), headers = {};
  let url = `${base}/models`;
  if (c.api === 'anthropic-messages') { url = `${base.replace(/\/v1$/,'')}/v1/models`; headers['x-api-key']=key; headers['anthropic-version']='2023-06-01'; }
  else if (c.api === 'google-generative-ai') headers['x-goog-api-key']=key;
  else headers.Authorization=`Bearer ${key}`;
  const response = await fetch(url,{headers,signal});
  if (!response.ok) throw new Error(`模型列表请求失败（HTTP ${response.status}），请检查端点、密钥和账号权限`);
  const result = await response.json();
  return (result.data || result.models || []).map(m=>m.id || m.name?.replace(/^models\//,'')).filter(id=>typeof id === 'string').slice(0,1000);
}
