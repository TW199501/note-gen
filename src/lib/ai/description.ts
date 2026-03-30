import OpenAI from 'openai';
import { getAISettings, prepareMessages, createChatCompletion, handleAIError, isAnthropicProvider, createAnthropicClient, extractSystemForAnthropic, createOpenAIClient } from './utils';

/**
 * 生成文本描述
 */
export async function fetchAiDesc(text: string) {
  try {
    const aiConfig = await getAISettings('markDescModel')
    const descContent = `Based on the screenshot content: ${text}, return a description. Keep it under 50 characters and avoid special characters.`
    const { messages } = await prepareMessages(descContent)

    return await createChatCompletion(aiConfig, messages)
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}

/**
 * 通过图片生成描述
 */
export async function fetchAiDescByImage(base64: string) {
  try {
    const aiConfig = await getAISettings('imageMethodModel')
    const descContent = `Based on the screenshot content, return a description.`
    const { messages: preparedMessages } = await prepareMessages(descContent)

    if (isAnthropicProvider(aiConfig)) {
      // Anthropic 图片格式
      const anthropic = await createAnthropicClient(aiConfig)
      const { system, messages: anthropicMessages } = extractSystemForAnthropic(preparedMessages)

      // 替换最后一条 user 消息为包含图片的格式
      const lastIdx = anthropicMessages.length - 1
      if (lastIdx >= 0 && anthropicMessages[lastIdx].role === 'user') {
        const match = base64.match(/^data:(image\/\w+);base64,(.+)/)
        if (match) {
          anthropicMessages[lastIdx] = {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: match[1] as any, data: match[2] }
              },
              { type: 'text', text: descContent }
            ]
          }
        }
      }

      const completion = await anthropic.messages.create({
        model: aiConfig?.model || '',
        max_tokens: 8192,
        ...(system ? { system } : {}),
        messages: anthropicMessages,
        temperature: aiConfig?.temperature || 1,
        top_p: aiConfig?.topP || 1,
      })

      const textBlock = completion.content.find(b => b.type === 'text')
      return textBlock?.text || ''
    }

    // OpenAI 格式
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    for (let i = 0; i < preparedMessages.length; i++) {
      const msg = preparedMessages[i]
      if (i === preparedMessages.length - 1 && msg.role === 'user') {
        const textContent = typeof msg.content === 'string' ? msg.content : descContent
        messages.push({
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: base64 } },
            { type: 'text', text: textContent }
          ]
        })
      } else {
        messages.push(msg)
      }
    }

    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })
    return completion.choices[0].message.content || ''
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}
