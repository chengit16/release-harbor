/** @description 仅由可信 Node 通过私有 stdin 调用的 macOS Keychain 桥接；文件和命令参数不含凭据。 */
ObjC.import('Foundation')
ObjC.import('Security')

function run() {
  // 1. 材料只从私有管道读取，原生桥接脚本本身不保存用户数据。
  const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
  const raw = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)
  const request = JSON.parse(ObjC.unwrap(raw))
  const query = $.NSMutableDictionary.alloc.init
  // JXA 不导出 Security 的 CFString 常量；使用 Apple 公布的底层常量值。
  query.setObjectForKey($('genp'), $('class'))
  query.setObjectForKey($(request.service), $('svce'))
  query.setObjectForKey($(request.account), $('acct'))
  let status
  // 2. 更新或新增指定账号，不改变安全库服务、目录格式或其他账号。
  if (request.action === 'set') {
    const values = $.NSMutableDictionary.alloc.init
    values.setObjectForKey($(request.secret).dataUsingEncoding($.NSUTF8StringEncoding), $('v_Data'))
    status = $.SecItemUpdate(query, values)
    if (status === -25300) {
      query.addEntriesFromDictionary(values)
      status = $.SecItemAdd(query, null)
    }
    return JSON.stringify({ status: Number(status) })
  }
  if (request.action === 'delete') return JSON.stringify({ status: Number($.SecItemDelete(query)) })
  if (request.action !== 'get') throw new Error('不支持的安全库动作')
  // 3. 只返回本次读取结果给可信父进程，父进程负责写后比较且不记录正文。
  query.setObjectForKey($(true), $('r_Data'))
  const result = Ref()
  status = $.SecItemCopyMatching(query, result)
  // CFData 指针必须显式桥接，不能将 Ref 本身作为 NSData 解码。
  const secret =
    status === 0
      ? ObjC.unwrap(
          $.NSString.alloc.initWithDataEncoding(
            ObjC.castRefToObject(result[0]),
            $.NSUTF8StringEncoding,
          ),
        )
      : null
  return JSON.stringify({ status: Number(status), secret })
}
