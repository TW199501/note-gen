import { getAISettings, prepareMessages, createOpenAIClient, createChatCompletionStream, handleAIError, validateAIService } from './utils';
import { createAiStreamContentProcessor, sanitizeAiRewriteOutput } from './sanitize';

const REWRITE_OUTPUT_RULE = 'Never output any thinking, reasoning, analysis, or <think> tags. Output only the final rewritten text.'

const ORGANIZE_PROMPT = `You are a Markdown editor. Reorganize and restructure the following Markdown content for better readability and logical flow.

Rules:
1. Add appropriate headings and subheadings to organize sections
2. Reorder content for logical flow
3. Break up long paragraphs, merge fragmented ones
4. Preserve ALL original information and semantics — do NOT add or remove factual content
5. Preserve Markdown formatting (bold, italic, links, code, tables, images, etc.)
6. Respond in the SAME language as the input
7. Output ONLY the reorganized Markdown, no explanations, no wrapping code fences

Input:
`

export async function fetchAiPolish(text: string): Promise<string> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const polishPrompt = `Polish the following text. Output ONLY the polished text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(polishPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
    })

    return sanitizeAiRewriteOutput(completion.choices[0]?.message?.content || '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

export async function fetchAiConcise(text: string): Promise<string> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const concisePrompt = `Make the following text more concise. Output ONLY the concise text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(concisePrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
    })

    return sanitizeAiRewriteOutput(completion.choices[0]?.message?.content || '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

export async function fetchAiExpand(text: string): Promise<string> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const expandPrompt = `Expand the following text with more details. Output ONLY the expanded text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(expandPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
    })

    return sanitizeAiRewriteOutput(completion.choices[0]?.message?.content || '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

export async function fetchAiPolishStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const polishPrompt = `Polish the following text. Output ONLY the polished text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(polishPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const rawThinking = (delta as { reasoning_content?: string } | undefined)?.reasoning_content || ''
      const content = delta?.content || ''

      if (rawThinking) {
        accumulatedThinking += rawThinking
        onThinkingUpdate?.(accumulatedThinking)
      }

      if (content) {
        const processed = processor.push(content)
        if (processed.thinking) {
          accumulatedThinking += processed.thinking
          onThinkingUpdate?.(accumulatedThinking)
        }
        if (processed.content) {
          onChunk(processed.content, isFirst)
          isFirst = false
        }
      }
    }

    const remaining = processor.flush()
    if (remaining.thinking) {
      accumulatedThinking += remaining.thinking
      onThinkingUpdate?.(accumulatedThinking)
    }
    if (remaining.content) {
      onChunk(remaining.content, isFirst)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    throw error
  }
}

export async function fetchAiConciseStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const concisePrompt = `Make the following text more concise. Output ONLY the concise text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(concisePrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const rawThinking = (delta as { reasoning_content?: string } | undefined)?.reasoning_content || ''
      const content = delta?.content || ''

      if (rawThinking) {
        accumulatedThinking += rawThinking
        onThinkingUpdate?.(accumulatedThinking)
      }

      if (content) {
        const processed = processor.push(content)
        if (processed.thinking) {
          accumulatedThinking += processed.thinking
          onThinkingUpdate?.(accumulatedThinking)
        }
        if (processed.content) {
          onChunk(processed.content, isFirst)
          isFirst = false
        }
      }
    }

    const remaining = processor.flush()
    if (remaining.thinking) {
      accumulatedThinking += remaining.thinking
      onThinkingUpdate?.(accumulatedThinking)
    }
    if (remaining.content) {
      onChunk(remaining.content, isFirst)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    throw error
  }
}

export async function fetchAiExpandStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const expandPrompt = `Expand the following text with more details. Output ONLY the expanded text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(expandPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const rawThinking = (delta as { reasoning_content?: string } | undefined)?.reasoning_content || ''
      const content = delta?.content || ''

      if (rawThinking) {
        accumulatedThinking += rawThinking
        onThinkingUpdate?.(accumulatedThinking)
      }

      if (content) {
        const processed = processor.push(content)
        if (processed.thinking) {
          accumulatedThinking += processed.thinking
          onThinkingUpdate?.(accumulatedThinking)
        }
        if (processed.content) {
          onChunk(processed.content, isFirst)
          isFirst = false
        }
      }
    }

    const remaining = processor.flush()
    if (remaining.thinking) {
      accumulatedThinking += remaining.thinking
      onThinkingUpdate?.(accumulatedThinking)
    }
    if (remaining.content) {
      onChunk(remaining.content, isFirst)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    throw error
  }
}

export async function fetchAiOrganizeStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')
    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const { messages } = await prepareMessages(`${ORGANIZE_PROMPT}${text}`)
    await createChatCompletionStream(aiConfig, messages, onChunk, { temperature: 0.7, topP: 0.95, signal: abortSignal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    throw error
  }
}
