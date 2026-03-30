import { getAISettings, validateAIService, createChatCompletion, createChatCompletionStream, handleAIError } from './utils';

/**
 * 清理补全结果
 */
function cleanupCompletion(text: string): string {
  return text
    .trim()
    .replace(/^```[\s\S]*?```$/g, '')
    .replace(/^```\w*\s*/g, '')
    .replace(/\s*```$/g, '')
    .replace(/^[\s\n]+|[\s\n]+$/g, '')
    .replace(/^["'""жат]|["'""жат]$/g, '')
    .replace(/^续写[：:]\s*/i, '')
    .replace(/^补全[：:]\s*/i, '')
    .replace(/^Continuation[:\s]*/i, '')
    .trim()
}

const buildCompletionPrompt = (context: string) => `Continue the following text naturally. Requirements:
- Return ONLY the continuation text (1 sentence)
- Use the same language as the context
- Do NOT use code blocks, markdown formatting, or special syntax
- Return plain text only

Context:
${context}

Continuation:`

/**
 * 快速生成代码/文本补全
 */
export async function fetchCompletion(context: string, abortSignal?: AbortSignal): Promise<string> {
  try {
    const aiConfig = await getAISettings('completionModel')
    if (validateAIService(aiConfig?.baseURL) === null) return ''

    const messages = [{ role: 'user' as const, content: buildCompletionPrompt(context) }]
    const result = await createChatCompletion(aiConfig, messages, {
      temperature: 0.7, topP: 0.95, maxTokens: 80, signal: abortSignal
    })

    return cleanupCompletion(result)
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 流式获取补全结果
 */
export async function fetchCompletionStream(
  context: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  try {
    const aiConfig = await getAISettings('completionModel')

    // 验证AI服务
    if (await validateAIService(aiConfig?.baseURL) === null) return

    const messages = [{ role: 'user' as const, content: buildCompletionPrompt(context) }]

    await createChatCompletionStream(aiConfig, messages, (chunk, isFirst) => {
      const cleaned = cleanupCompletion(chunk)
      if (cleaned) onChunk(cleaned, isFirst)
    }, {
      temperature: 0.7, topP: 0.95, maxTokens: 80, signal: abortSignal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    throw error
  }
}
