/** @description 在线 APK 上传状态；暂停只中断本次传输，续传按存储已确认的分片推进。 */
import { useEffect, useRef, useState } from 'react'
import { hostedArtifactLimits as limits, hostedPartBytes } from '@release-harbor/contracts'
import {
  decodeArtifactLink,
  decodeCompletedParts,
  decodeHostedArtifact,
  hostedArtifactAction,
  uploadHostedPart,
} from './artifactApi.ts'

type Stage = 'hashing' | 'uploading' | 'completing' | 'paused' | 'failed' | 'done'
type Transfer = { stage: Stage; fileName: string; sent: number; total: number; error?: string }
type Draft = { file: File; requestId: string; id?: string; manifest?: string[] }

/** 当前弹窗的传输控制器；离开页面后丢弃文件，保留服务端接收记录。 */
export interface HostedArtifactTransfer {
  /** 当前弹窗中选定的文件名。 */
  fileName?: string
  /** 发送进度和状态；已传输不表示已通过检查。 */
  transfer?: Transfer
  /** 当前正在计算、发送或核对。 */
  busy: boolean
  /** 设置新文件，指定记录时要求续传相同内容。 */
  select(file: File, artifactId?: string): void
  /** 切换新建或续传目标时清除上一个文件。 */
  reset(): void
  /** 用户显式开始或继续当前文件。 */
  start(): Promise<void>
  /** 暂停等待及当前 PUT，不能撤销已到达对象存储的分片。 */
  pause(): void
}

/** 保存当前文件和幂等标识；接收成功后通知父级清除续传选择，签名地址不留存。 */
export function useHostedArtifactUpload(
  path: string,
  refresh: () => void,
  onDone: () => void,
): HostedArtifactTransfer {
  const active = useRef<AbortController | undefined>(undefined)
  const draft = useRef<Draft | undefined>(undefined)
  const mounted = useRef(false)
  const [fileName, setFileName] = useState<string>()
  const [transfer, setTransfer] = useState<Transfer>()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      active.current?.abort()
    }
  }, [])

  function select(file: File, artifactId?: string) {
    if (active.current) return
    draft.current = { file, id: artifactId, requestId: crypto.randomUUID() }
    setFileName(file.name)
    setTransfer(undefined)
  }

  async function start() {
    const current = draft.current
    if (!current || active.current) return
    const controller = new AbortController()
    active.current = controller
    let sent = 0
    const { file } = current
    const report = (stage: Stage, error?: string) => {
      if (mounted.current)
        setTransfer({ stage, fileName: file.name, sent, total: file.size, error })
    }
    try {
      // 1. 逐片计算，避免把整包载入内存；重新选包也核对实际内容。
      if (!/\.apk$/i.test(file.name) || file.size < 1 || file.size > limits.maxBytes)
        throw new Error('请选择大于 0 字节且不超过 256 MiB 的 APK')
      report('hashing')
      const manifest = (current.manifest ??= await checksumManifest(file, controller.signal))
      controller.signal.throwIfAborted()
      if (!current.id) {
        const record = await hostedArtifactAction(
          path,
          {
            requestId: current.requestId,
            fileName: file.name,
            sizeBytes: file.size,
            manifest,
          },
          decodeHostedArtifact,
          controller.signal,
        )
        current.id = record.id
      }

      // 2. 先读取真实已存分片，再逐片领取短期能力，暂停后不会重传已确认分片。
      const recordPath = path + '/' + current.id
      const completed = new Set(
        await hostedArtifactAction(
          recordPath + '/resume',
          { manifest },
          decodeCompletedParts,
          controller.signal,
        ),
      )
      if ([...completed].some((part) => part > manifest.length))
        throw new Error('返回的分片进度超出所选文件范围')
      sent = [...completed].reduce((total, part) => total + hostedPartBytes(file.size, part), 0)
      report('uploading')
      for (const [index, checksum] of manifest.entries()) {
        const part = index + 1
        if (completed.has(part)) continue
        controller.signal.throwIfAborted()
        const url = await hostedArtifactAction(
          recordPath + '/part',
          { part },
          decodeArtifactLink,
          controller.signal,
        )
        const slice = file.slice(index * limits.partBytes, (index + 1) * limits.partBytes)
        await uploadHostedPart(url, slice, checksum, controller.signal)
        sent += slice.size
        report('uploading')
      }

      // 3. 由服务端核对对象和版本，传完字节仍需等待这一步。
      report('completing')
      await hostedArtifactAction(
        recordPath + '/complete',
        {},
        decodeHostedArtifact,
        controller.signal,
      )
      report('done')
      draft.current = undefined
      if (mounted.current) {
        setFileName(undefined)
        onDone()
      }
    } catch (error) {
      if (controller.signal.aborted) report('paused')
      else
        report(
          'failed',
          error instanceof Error && error.name !== 'TypeError'
            ? error.message
            : '传输中断，可继续上传；已接收分片会保留',
        )
    } finally {
      active.current = undefined
      if (mounted.current) refresh()
    }
  }

  return {
    fileName,
    transfer,
    busy:
      transfer?.stage === 'hashing' ||
      transfer?.stage === 'uploading' ||
      transfer?.stage === 'completing',
    select,
    reset: () => {
      if (active.current) return
      draft.current = undefined
      setFileName(undefined)
      setTransfer(undefined)
    },
    start,
    pause: () => active.current?.abort(),
  }
}

async function checksumManifest(file: File, signal: AbortSignal): Promise<string[]> {
  const manifest: string[] = []
  for (let start = 0; start < file.size; start += limits.partBytes) {
    signal.throwIfAborted()
    const bytes = await file.slice(start, start + limits.partBytes).arrayBuffer()
    const checksum = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    manifest.push(btoa(String.fromCharCode(...checksum)))
  }
  return manifest
}
