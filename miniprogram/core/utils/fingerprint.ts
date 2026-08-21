/**
 * 文件指纹计算（SHA-256）。
 *
 * 用于 FIT 文件重复导入检测（规格 §9）：
 * 同一文件内容指纹一致，重名但内容不同不会误判。
 * 浏览器（Web Crypto，需 HTTPS/localhost）与 Node 均可用。
 */

/**
 * 计算字节内容的 SHA-256 指纹。
 *
 * @param bytes 文件二进制内容
 * @returns 64 位小写十六进制字符串
 */
export async function computeFingerprint(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
