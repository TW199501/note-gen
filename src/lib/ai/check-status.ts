import { AiConfig, ModelConfig } from '@/app/core/setting/config'
import { createOpenAIClient, isAnthropicProvider, createAnthropicClient } from './utils'
import { invokeAiJson, invokeAiBinary, invokeAiMultipart, blobToBytes } from './tauri-client'

export interface CheckResult {
  ok: boolean
  error?: string
}

export async function checkModelConnection(
  aiConfig: AiConfig,
  model: ModelConfig,
  signal?: AbortSignal
): Promise<CheckResult> {
  try {
    if (!model.model || !aiConfig.baseURL) {
      return { ok: false, error: 'Missing model or baseURL' }
    }

    const fullAiConfig: AiConfig = {
      ...aiConfig,
      model: model.model,
      modelType: model.modelType,
      temperature: model.temperature,
      topP: model.topP,
      voice: model.voice,
      enableStream: model.enableStream,
    }

    switch (model.modelType) {
      case 'rerank': {
        const query = 'Apple'
        const documents = ['apple', 'banana', 'fruit', 'vegetable']
        const rerankData = await invokeAiJson<any>(
          {
            config: {
              baseUrl: aiConfig.baseURL,
              apiKey: aiConfig.apiKey,
              customHeaders: aiConfig.customHeaders,
            },
            path: '/rerank',
            method: 'POST',
            body: {
              model: model.model,
              query,
              documents,
            },
          },
          signal
        )
        if (!rerankData || !rerankData.results) {
          return { ok: false, error: 'Rerank result format is incorrect' }
        }
        return { ok: true }
      }

      case 'embedding': {
        const testText = '测试文本'
        const embeddingDataJson = await invokeAiJson<any>(
          {
            config: {
              baseUrl: aiConfig.baseURL,
              apiKey: aiConfig.apiKey,
              customHeaders: aiConfig.customHeaders,
            },
            path: '/embeddings',
            method: 'POST',
            body: {
              model: model.model,
              input: testText,
              encoding_format: 'float',
            },
          },
          signal
        )
        if (
          !embeddingDataJson ||
          !embeddingDataJson.data ||
          !embeddingDataJson.data[0] ||
          !embeddingDataJson.data[0].embedding
        ) {
          return { ok: false, error: 'Embedding result format is incorrect' }
        }
        return { ok: true }
      }

      case 'tts': {
        const testAudioText = '测试音频生成'
        const ttsBuffer = await invokeAiBinary(
          {
            config: {
              baseUrl: aiConfig.baseURL,
              apiKey: aiConfig.apiKey,
              customHeaders: aiConfig.customHeaders,
            },
            path: '/audio/speech',
            method: 'POST',
            body: {
              model: model.model,
              input: testAudioText,
              voice: model.voice || 'alloy',
            },
          },
          signal
        )
        if (!ttsBuffer.byteLength) {
          return { ok: false, error: 'TTS model returned incorrect format' }
        }
        return { ok: true }
      }

      case 'stt': {
        const testAudioBlob = new Blob([new Uint8Array(100)], { type: 'audio/webm' })
        try {
          await invokeAiMultipart(
            {
              config: {
                baseUrl: aiConfig.baseURL,
                apiKey: aiConfig.apiKey,
                customHeaders: aiConfig.customHeaders,
              },
              path: '/audio/transcriptions',
              fileFieldName: 'file',
              fields: {
                model: model.model,
              },
              file: {
                bytes: await blobToBytes(testAudioBlob),
                fileName: 'test.webm',
                contentType: 'audio/webm',
              },
            },
            signal
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('401') || message.includes('403')) {
            return { ok: false, error: message }
          }
        }
        return { ok: true }
      }

      default: {
        if (isAnthropicProvider(fullAiConfig)) {
          const anthropic = await createAnthropicClient(fullAiConfig)
          await anthropic.messages.create({
            model: model.model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hello' }],
          })
        } else {
          const openai = await createOpenAIClient(fullAiConfig)
          await openai.chat.completions.create({
            model: model.model,
            messages: [
              {
                role: 'user' as const,
                content: 'Hello',
              },
            ],
          })
        }
        return { ok: true }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}
