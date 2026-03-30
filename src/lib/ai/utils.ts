import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import type OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { AiConfig } from "@/app/core/setting/config";
import { readFile } from "@tauri-apps/plugin-fs";
import { createTauriOpenAIClient, type OpenAICompatibleClient } from "./tauri-client";

/**
 * 获取当前的prompt内容
 */
export async function getPromptContent(): Promise<string> {
  const store = await Store.load('store.json')
  const currentPromptId = await store.get<string>('currentPromptId')
  let promptContent = ''
  
  if (currentPromptId) {
    const promptList = await store.get<Array<{id: string, content: string}>>('promptList')
    if (promptList) {
      const currentPrompt = promptList.find(prompt => prompt.id === currentPromptId)
      if (currentPrompt && currentPrompt.content) {
        promptContent = currentPrompt.content
      }
    }
  }
  
  return promptContent
}

/**
 * 获取AI设置
 */
export async function getAISettings(modelType?: string): Promise<AiConfig | undefined> {
  const store = await Store.load('store.json')
  const aiConfigs = await store.get<AiConfig[]>('aiModelList')
  const modelId = await store.get(modelType || 'primaryModel')

  if (!modelId || !aiConfigs) {
    return undefined
  }

  // 在新的数据结构中，需要找到包含指定模型ID的配置
  for (const config of aiConfigs) {
    // 检查新的 models 数组结构
    if (config.models && config.models.length > 0) {
      // 首先尝试直接匹配模型ID
      let targetModel = config.models.find(model => model.id === modelId)

      // 如果没找到，尝试匹配组合键格式 ${config.key}-${model.id}
      if (!targetModel && typeof modelId === 'string' && modelId.includes('-')) {
        const expectedPrefix = `${config.key}-`
        if (modelId.startsWith(expectedPrefix)) {
          const originalModelId = modelId.substring(expectedPrefix.length)
          targetModel = config.models.find(model => model.id === originalModelId)
        }
      }

      if (targetModel) {
        const result = {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        }
        return result
      }
    } else {
      // 向后兼容：处理旧的单模型结构
      if (config.key === modelId) {
        return config
      }
    }
  }

  return undefined
}

/**
 * 检查AI服务配置是否有效
 */
export async function validateAIService(baseURL: string | undefined): Promise<string | null> {
  if (!baseURL) {
    toast({
      title: 'AI Error',
      description: 'Please configure the AI base URL first',
      variant: 'destructive',
    })
    return null
  }
  return baseURL
}

/**
 * 将图片 URL 转换为 base64 格式
 */
export async function convertImageToBase64(imageUrl: string): Promise<string | null> {
  try {
    // 如果已经是 base64 格式，直接返回
    if (imageUrl.startsWith('data:image')) {
      return imageUrl
    }
    
    // 从 Tauri URL 中提取文件路径
    // convertFileSrc 生成的 URL 格式类似: tauri://localhost/path 或 asset://localhost/path
    let filePath = imageUrl
    
    // 移除 tauri:// 或 asset:// 协议前缀
    if (imageUrl.startsWith('tauri://localhost/')) {
      filePath = imageUrl.replace('tauri://localhost/', '')
    } else if (imageUrl.startsWith('asset://localhost/')) {
      filePath = imageUrl.replace('asset://localhost/', '')
    } else if (imageUrl.startsWith('http://tauri.localhost/')) {
      filePath = imageUrl.replace('http://tauri.localhost/', '')
    }
    
    // URL 解码
    filePath = decodeURIComponent(filePath)
    
    // 读取文件
    const fileData = await readFile(filePath)
    
    // 转换为 base64
    const base64 = btoa(
      new Uint8Array(fileData).reduce((data, byte) => data + String.fromCharCode(byte), '')
    )
    
    // 根据文件扩展名确定 MIME 类型
    let mimeType = 'image/png'
    if (filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')) {
      mimeType = 'image/jpeg'
    } else if (filePath.toLowerCase().endsWith('.gif')) {
      mimeType = 'image/gif'
    } else if (filePath.toLowerCase().endsWith('.webp')) {
      mimeType = 'image/webp'
    }
    
    return `data:${mimeType};base64,${base64}`
  } catch (error) {
    console.error('Failed to convert image to base64:', error)
    return null
  }
}

/**
 * 处理AI请求错误
 */
export function handleAIError(error: any, showToast = true): string | null {
  if (error?.message === 'Request was aborted.' || error?.name === 'AbortError') {
    return null
  }

  const status = error?.status || error?.statusCode || error?.response?.status
  let description: string

  switch (status) {
    case 401:
      description = 'Invalid or expired API Key (401 Unauthorized)'
      break
    case 403:
      description = 'API access denied (403 Forbidden)'
      break
    case 429:
      description = 'Too many requests, please try again later (429 Rate Limit)'
      break
    case 500:
    case 502:
    case 503:
      description = `AI service temporarily unavailable (${status})`
      break
    default:
      if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
        description = 'AI service connection timed out, please check network or API URL'
      } else if (error?.code === 'ECONNREFUSED' || error?.message?.includes('ECONNREFUSED')) {
        description = 'AI service connection refused, please check API URL'
      } else {
        description = error instanceof Error ? error.message : 'Unknown error'
      }
  }

  if (showToast) {
    toast({
      title: status ? `AI Error (${status})` : 'AI Error',
      description,
      variant: 'destructive',
    })
  }

  return `Request failed: ${description}`
}

/**
 * 为不同AI类型准备消息
 * @param text 用户输入文本（如果提供了 baseMessages，此参数将作为最后一条用户消息）
 * @param baseMessages 基础消息数组（如对话历史），如果提供，将合并到返回结果中
 */
export async function prepareMessages(
  text: string,
  baseMessages?: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<{
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  geminiText?: string
}> {
  // 获取prompt内容
  let promptContent = await getPromptContent()

  // 注入用户语言偏好
  try {
    const appLanguage = typeof window !== 'undefined' ? localStorage.getItem('app-language') || 'zh' : 'zh'
    const langMap: Record<string, string> = {
      'zh': '简体中文',
      'zh-TW': '繁體中文',
      'en': 'English',
      'ja': '日本語',
      'pt-BR': 'Português (Brasil)',
    }
    const userLanguage = langMap[appLanguage] || appLanguage
    if (userLanguage !== '简体中文') {
      const langInstruction = `Please respond in ${userLanguage}.`
      promptContent = promptContent ? `${langInstruction}\n\n${promptContent}` : langInstruction
    }
  } catch {}


  // 加载记忆上下文
  try {
    const { contextLoader } = await import('@/lib/context/loader')
    // 确定用于检索记忆的查询文本
    let queryText = text || ''
    if (baseMessages && baseMessages.length > 0) {
      // 如果提供了消息数组，使用最后一条用户消息作为查询
      const lastUserMessage = [...baseMessages].reverse().find(m => m.role === 'user')
      if (lastUserMessage) {
        queryText = typeof lastUserMessage.content === 'string' ? lastUserMessage.content : queryText
      }
    }

    if (queryText) {
      const memoryContext = await contextLoader.getContextForQuery(queryText)
      if (memoryContext.preferences.length > 0 || memoryContext.memory.length > 0) {
        const memoryPrompt = contextLoader.formatMemoriesForPrompt(memoryContext)
        promptContent += '\n\n' + memoryPrompt
      }
    }
  } catch (error) {
    // 如果记忆加载失败，不影响正常对话
    console.error('Failed to load memory context:', error)
  }

  // 如果提供了基础消息数组，直接使用它
  if (baseMessages && baseMessages.length > 0) {
    // 检查是否已经有 system 消息
    const hasSystemMessage = baseMessages.some(msg => msg.role === 'system')

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

    // 如果需要添加 system prompt 且当前没有 system 消息
    if (promptContent && !hasSystemMessage) {
      messages.push({
        role: 'system',
        content: promptContent
      })
    }

    // 添加所有基础消息
    messages.push(...baseMessages)

    // 添加系统提示词（如果有且原消息中没有）
    if (promptContent && hasSystemMessage) {
      // 如果已有 system 消息，合并内容
      const firstSystemIndex = messages.findIndex(msg => msg.role === 'system')
      if (firstSystemIndex !== -1) {
        const existingContent = typeof messages[firstSystemIndex].content === 'string'
          ? messages[firstSystemIndex].content
          : ''
        messages[firstSystemIndex] = {
          role: 'system',
          content: existingContent + '\n\n' + promptContent
        }
      }
    }

    return { messages, geminiText: undefined }
  }

  // 定义消息数组（旧逻辑，保持向后兼容）
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let geminiText: string | undefined

  if (promptContent) {
    messages.push({
      role: 'system',
      content: promptContent
    })
  }

  messages.push({
    role: 'user',
    content: text
  })

  return { messages, geminiText }
}

/**
 * 判断是否为 Anthropic Claude 服务
 */
export function isAnthropicProvider(config?: AiConfig): boolean {
  if (!config?.baseURL) return false
  return config.baseURL.includes('api.anthropic.com')
}

/**
 * 从 OpenAI 格式消息中提取 system 和 user/assistant 消息（Anthropic 格式）
 */
export function extractSystemForAnthropic(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): { system: string; messages: Anthropic.MessageParam[] } {
  let system = ''
  const filtered: Anthropic.MessageParam[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      const content = typeof msg.content === 'string' ? msg.content : ''
      system += (system ? '\n\n' : '') + content
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      // 转换多模态内容格式
      let content: Anthropic.MessageParam['content']
      if (Array.isArray(msg.content)) {
        content = (msg.content as any[]).map((part: any) => {
          if (part.type === 'text') {
            return { type: 'text' as const, text: part.text }
          }
          if (part.type === 'image_url' && part.image_url?.url) {
            const url = part.image_url.url as string
            if (url.startsWith('data:')) {
              const match = url.match(/^data:(image\/\w+);base64,(.+)/)
              if (match) {
                return {
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                    data: match[2],
                  }
                }
              }
            }
            return { type: 'text' as const, text: `[image: ${url}]` }
          }
          return { type: 'text' as const, text: JSON.stringify(part) }
        })
      } else {
        content = typeof msg.content === 'string' ? msg.content : ''
      }
      filtered.push({ role: msg.role, content })
    }
  }

  // Anthropic 要求第一条消息必须是 user
  if (filtered.length > 0 && filtered[0].role !== 'user') {
    filtered.unshift({ role: 'user', content: '...' })
  }

  return { system, messages: filtered }
}

/**
 * 创建 Anthropic 客户端
 */
export async function createAnthropicClient(aiConfig?: AiConfig) {
  const store = await Store.load('store.json')
  let apiKey = aiConfig?.apiKey
  if (!apiKey) {
    apiKey = await store.get<string>('apiKey') || ''
  }

  return new Anthropic({
    apiKey: apiKey || '',
    dangerouslyAllowBrowser: true,
    timeout: 300_000,
    maxRetries: 0,
    defaultHeaders: aiConfig?.customHeaders || {},
  })
}

/**
 * 统一的非流式 AI 调用（支持 OpenAI 和 Anthropic）
 */
export async function createChatCompletion(
  aiConfig: AiConfig | undefined,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: { temperature?: number; topP?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
  if (isAnthropicProvider(aiConfig)) {
    const anthropic = await createAnthropicClient(aiConfig)
    const { system, messages: anthropicMessages } = extractSystemForAnthropic(messages)

    const completion = await anthropic.messages.create({
      model: aiConfig?.model || '',
      max_tokens: options?.maxTokens || 8192,
      ...(system ? { system } : {}),
      messages: anthropicMessages,
      temperature: options?.temperature ?? aiConfig?.temperature ?? 1,
      top_p: options?.topP ?? aiConfig?.topP ?? 1,
    }, { signal: options?.signal as any })

    const textBlock = completion.content.find(b => b.type === 'text')
    return textBlock?.text || ''
  }

  const openai = await createOpenAIClient(aiConfig)
  const completion = await openai.chat.completions.create({
    model: aiConfig?.model || '',
    messages,
    temperature: options?.temperature ?? aiConfig?.temperature ?? 1,
    top_p: options?.topP ?? aiConfig?.topP ?? 1,
    ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
  }, { signal: options?.signal })

  return completion.choices[0]?.message?.content || ''
}

/**
 * 统一的流式 AI 调用（支持 OpenAI 和 Anthropic）
 */
export async function createChatCompletionStream(
  aiConfig: AiConfig | undefined,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  onChunk: (chunk: string, isFirst: boolean) => void,
  options?: { temperature?: number; topP?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<void> {
  if (isAnthropicProvider(aiConfig)) {
    const anthropic = await createAnthropicClient(aiConfig)
    const { system, messages: anthropicMessages } = extractSystemForAnthropic(messages)

    const stream = anthropic.messages.stream({
      model: aiConfig?.model || '',
      max_tokens: options?.maxTokens || 8192,
      ...(system ? { system } : {}),
      messages: anthropicMessages,
      temperature: options?.temperature ?? aiConfig?.temperature ?? 1,
      top_p: options?.topP ?? aiConfig?.topP ?? 1,
    }, { signal: options?.signal as any })

    let isFirst = true
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        onChunk(event.delta.text, isFirst)
        isFirst = false
      }
    }
    return
  }

  const openai = await createOpenAIClient(aiConfig)
  const stream = await openai.chat.completions.create({
    model: aiConfig?.model || '',
    messages,
    temperature: options?.temperature ?? aiConfig?.temperature ?? 1,
    top_p: options?.topP ?? aiConfig?.topP ?? 1,
    ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
    stream: true,
  }, { signal: options?.signal })

  let isFirst = true
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content
    if (content) {
      onChunk(content, isFirst)
      isFirst = false
    }
  }
}

/**
 * 创建OpenAI客户端，适用于所有AI类型
 */
export async function createOpenAIClient(AiConfig?: AiConfig): Promise<OpenAICompatibleClient> {
  const store = await Store.load('store.json')

  if (AiConfig) {
    return createTauriOpenAIClient(AiConfig)
  }

  const baseURL = await store.get<string>('baseURL')
  const apiKey = await store.get<string>('apiKey')

  return createTauriOpenAIClient({
    key: 'runtime',
    title: 'Runtime',
    baseURL,
    apiKey,
  })
}
