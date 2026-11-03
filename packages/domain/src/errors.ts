/** @description 可安全公开的领域失败，HTTP 映射沿用当前状态码合同。 */

/** 表达输入、归属或冲突错误；不携带原始 SDK 异常和秘密。 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
  }
}
