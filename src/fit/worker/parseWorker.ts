/**
 * FIT 解析 Web Worker（规格 §23）。
 *
 * 职责仅为消息分发：接收主线程的解析请求，调用 parseFitBytes 纯函数，
 * 成功回传 Activity，失败回传已分类的错误文案（见 errorClassifier）。
 * 重量级解析（fitsdk 解码 + 标准化）在本 worker 中执行，避免阻塞主线程。
 */
import { classifyParseError } from '@/features/import/errorClassifier'
import { parseFitBytes, type ParseRequest, type ParseResponse } from './parseTask'

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id } = event.data
  let response: ParseResponse
  try {
    response = { id, ok: true, activity: parseFitBytes(event.data) }
  } catch (error) {
    response = { id, ok: false, errorMessage: classifyParseError(error) }
  }
  self.postMessage(response)
}
