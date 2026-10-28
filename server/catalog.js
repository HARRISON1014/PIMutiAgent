const api = (id, name, provider, baseUrl, apiKeyEnv, protocol = 'openai-completions', docs = '', kind = 'api') => ({ id, name, provider, kind, api:protocol, baseUrl, apiKeyEnv, model:'', docs, note:kind === 'coding-plan' ? '使用该 Coding Plan 专用密钥和端点，额度由厂商管理。' : '按 API 账号计费；网页会员权益以厂商说明为准。' });
const cli = (id,name,provider,adapter,docs,login) => ({id,name,provider,kind:'subscription-cli',adapter,binary:adapter,model:'',docs,login,note:'复用官方 CLI 登录；安装和登录状态不等于所选模型已经通过推理验证。'});
export const catalog = [
  cli('codex-sub','OpenAI · Codex 订阅','openai','codex','https://learn.chatgpt.com/docs/non-interactive-mode','codex login'),
  cli('claude-sub','Anthropic · Claude Code 订阅','anthropic','claude','https://code.claude.com/docs/en/headless','claude auth login'),
  cli('gemini-sub','Google · Gemini CLI 账号额度','google','gemini','https://geminicli.com/docs/cli/headless/','gemini（选择 Login with Google）'),
  cli('copilot-sub','GitHub · Copilot 订阅','github','copilot','https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference','copilot（使用 /login）'),
  cli('qwen-sub','阿里 · Qwen Code 登录额度','qwen','qwen','https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/','qwen（使用 /auth 选择对应账号方案）'),
  cli('kimi-sub','Moonshot · Kimi Code 订阅','moonshot','kimi','https://moonshotai.github.io/kimi-code/en/customization/agents','kimi（使用 /login）'),
  api('openai-api','OpenAI API','openai','https://api.openai.com/v1','OPENAI_API_KEY','openai-responses','https://developers.openai.com/api/docs'),
  api('anthropic-api','Anthropic API','anthropic','https://api.anthropic.com','ANTHROPIC_API_KEY','anthropic-messages','https://platform.claude.com/docs'),
  api('google-api','Google Gemini API','google','https://generativelanguage.googleapis.com/v1beta','GEMINI_API_KEY','google-generative-ai','https://ai.google.dev/gemini-api/docs'),
  api('deepseek-api','DeepSeek API','deepseek','https://api.deepseek.com/v1','DEEPSEEK_API_KEY','openai-completions','https://api-docs.deepseek.com'),
  api('moonshot-api','Moonshot / Kimi API','moonshot','https://api.moonshot.cn/v1','MOONSHOT_API_KEY','openai-completions','https://platform.moonshot.cn/docs'),
  api('kimi-plan','Kimi Coding Plan 专用 API','moonshot','https://api.kimi.com/coding/v1','KIMI_CODING_API_KEY','openai-completions','https://moonshotai.github.io/kimi-cli/en/configuration/providers.html','coding-plan'),
  api('qwen-api','阿里云 · 通义千问 API','qwen','https://dashscope.aliyuncs.com/compatible-mode/v1','DASHSCOPE_API_KEY','openai-completions','https://help.aliyun.com/zh/model-studio/'),
  api('qwen-token-plan','阿里云 · Qwen Token Plan','qwen','https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','QWEN_TOKEN_PLAN_CN_API_KEY','openai-completions','https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/','coding-plan'),
  api('glm-api','智谱 GLM API','zai','https://open.bigmodel.cn/api/paas/v4','ZHIPU_API_KEY','openai-completions','https://docs.bigmodel.cn'),
  api('glm-plan','智谱 GLM Coding Plan','zai','https://open.bigmodel.cn/api/coding/paas/v4','ZHIPU_CODING_API_KEY','openai-completions','https://docs.bigmodel.cn','coding-plan'),
  api('minimax-api','MiniMax API','minimax','https://api.minimaxi.com/anthropic','MINIMAX_API_KEY','anthropic-messages','https://platform.minimaxi.com/docs'),
  api('minimax-plan','MiniMax Coding Plan','minimax','https://api.minimaxi.com/anthropic','MINIMAX_CODING_API_KEY','anthropic-messages','https://platform.minimaxi.com/docs/coding-plan/intro','coding-plan'),
  api('doubao-api','火山方舟 · 豆包 API','doubao','https://ark.cn-beijing.volces.com/api/v3','ARK_API_KEY','openai-completions','https://www.volcengine.com/docs/82379'),
  api('xai-api','xAI · Grok API','xai','https://api.x.ai/v1','XAI_API_KEY','openai-completions','https://docs.x.ai'),
  api('mistral-api','Mistral API','mistral','https://api.mistral.ai/v1','MISTRAL_API_KEY','openai-completions','https://docs.mistral.ai'),
  api('openrouter-api','OpenRouter 多模型 API','openrouter','https://openrouter.ai/api/v1','OPENROUTER_API_KEY','openai-completions','https://openrouter.ai/docs'),
  api('siliconflow-api','硅基流动 API','siliconflow','https://api.siliconflow.cn/v1','SILICONFLOW_API_KEY','openai-completions','https://docs.siliconflow.cn'),
  api('custom-api','自定义兼容 API / 网关','custom','http://127.0.0.1:11434/v1','CUSTOM_API_KEY','openai-completions',''),
];
export const supportNotes = [
  '任意连接均可负责规划、审计、风险判断或执行；同一厂商可以创建多个连接并使用不同模型。',
  'ChatGPT / Claude / Gemini / Copilot / Qwen / Kimi 的接入使用对应官方 CLI；请确认账号方案实际包含所选模型。',
  'DeepSeek、Grok、豆包等网页会员不自动转换为程序调用额度。没有官方自动化通道的网页订阅，当前使用 API 入口。',
  'API 协议适配和 CLI 协议测试通过不代表所有厂商账号都已完成真实推理；请对每个连接使用“推理测试”。',
];
