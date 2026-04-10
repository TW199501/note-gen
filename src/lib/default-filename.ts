import { exists } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from './workspace'

/**
 * 生成当天日期前缀的基础文件名
 * 格式：YYYY-MM-DD
 */
function getTodayPrefix(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 生成唯一的默认文件名
 * 默认以当天日期为基础，格式为 YYYY-MM-DD-01.md, YYYY-MM-DD-02.md, ...
 * @param parentPath 父目录路径，空字符串表示根目录
 * @param baseName 基础文件名，默认使用当天日期
 * @returns 唯一的文件名（包含.md扩展名）
 */
export async function generateUniqueFilename(parentPath: string = '', baseName?: string): Promise<string> {
  const workspace = await getWorkspacePath()
  const useDateFormat = !baseName
  const prefix = baseName || getTodayPrefix()

  let counter = useDateFormat ? 1 : 0
  let filename = useDateFormat ? `${prefix}-${String(counter).padStart(2, '0')}.md` : `${prefix}.md`

  while (true) {
    const fullRelativePath = parentPath ? `${parentPath}/${filename}` : filename
    const pathOptions = await getFilePathOptions(fullRelativePath)

    let fileExists = false
    try {
      if (workspace.isCustom) {
        fileExists = await exists(pathOptions.path)
      } else {
        fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      fileExists = false
    }

    if (!fileExists) {
      return filename
    }

    counter++
    if (useDateFormat) {
      filename = `${prefix}-${String(counter).padStart(2, '0')}.md`
    } else {
      filename = `${prefix} (${counter}).md`
    }
  }
}

/**
 * 生成复制文件的唯一名称
 * @param parentPath 父目录路径
 * @param originalName 原始文件名
 * @returns 唯一的文件名（保留原始扩展名）
 */
export async function generateCopyFilename(parentPath: string, originalName: string): Promise<string> {
  const workspace = await getWorkspacePath()

  // 分离文件名和扩展名
  const lastDotIndex = originalName.lastIndexOf('.')
  const baseName = lastDotIndex > 0 ? originalName.substring(0, lastDotIndex) : originalName
  const extension = lastDotIndex > 0 ? originalName.substring(lastDotIndex) : ''

  // 首先尝试原始名称
  let filename = originalName
  let counter = 0

  while (true) {
    // 构建完整的相对路径
    const fullRelativePath = parentPath ? `${parentPath}/${filename}` : filename
    const pathOptions = await getFilePathOptions(fullRelativePath)

    // 检查文件是否存在
    let fileExists = false
    try {
      if (workspace.isCustom) {
        fileExists = await exists(pathOptions.path)
      } else {
        fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      // 如果检查失败，假设文件不存在
      fileExists = false
    }

    if (!fileExists) {
      return filename
    }

    // 文件存在，生成下一个候选名称
    counter++
    if (counter === 1) {
      // 第一次重复，使用 "_copy" 后缀
      filename = `${baseName}_copy${extension}`
    } else {
      // 后续重复，使用数字后缀
      filename = `${baseName}_copy_${counter}${extension}`
    }
  }
}

/**
 * 生成复制文件夹的唯一名称
 * @param parentPath 父目录路径
 * @param originalName 原始文件夹名
 * @returns 唯一的文件夹名
 */
export async function generateCopyFoldername(parentPath: string, originalName: string): Promise<string> {
  const workspace = await getWorkspacePath()

  // 首先尝试原始名称
  let foldername = originalName
  let counter = 0

  while (true) {
    // 构建完整的相对路径
    const fullRelativePath = parentPath ? `${parentPath}/${foldername}` : foldername
    const pathOptions = await getFilePathOptions(fullRelativePath)

    // 检查文件夹是否存在
    let folderExists = false
    try {
      if (workspace.isCustom) {
        folderExists = await exists(pathOptions.path)
      } else {
        folderExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      // 如果检查失败，假设文件夹不存在
      folderExists = false
    }

    if (!folderExists) {
      return foldername
    }

    // 文件夹存在，生成下一个候选名称
    counter++
    if (counter === 1) {
      // 第一次重复，使用 "_copy" 后缀
      foldername = `${originalName}_copy`
    } else {
      // 后续重复，使用数字后缀
      foldername = `${originalName}_copy_${counter}`
    }
  }
}


