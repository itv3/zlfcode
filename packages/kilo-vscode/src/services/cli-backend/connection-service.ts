import * as vscode from "vscode"
import { ServerManager } from "./server-manager"
import { createKiloClient, type KiloClient } from "@kilocode/sdk/v2/client"
import { SdkSSEAdapter, type SSEPayload } from "./sdk-sse-adapter"
import type { ServerConfig } from "./types"
import { resolveEventSessionId as resolveEventSessionIdPure } from "./connection-utils"
import { SandboxPreference } from "../sandbox-preference"
import type { StoredProviderKey } from "../../provider-actions"

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error"
type SSEEventListener = (event: SSEPayload, directory?: string) => void
type StateListener = (state: ConnectionState, error?: Error) => void
type SSEEventFilter = (event: SSEPayload, directory?: string) => boolean
type NotificationDismissListener = (notificationId: string) => void
type LanguageChangeListener = (locale: string) => void
type ProfileChangeListener = (data: unknown) => void
type MigrationCompleteListener = () => void
type FavoritesChangeListener = (favorites: Array<{ providerID: string; modelID: string }>) => void
type ProvidersChangeListener = (source: string | undefined, revision: number, message?: unknown) => void
type ModelSelectorExpandedListener = (value: boolean) => void
type ClearPendingPromptsListener = () => void
type DirectoryProvider = () => string[]

function isNotFound(err: unknown) {
  if (!err || typeof err !== "object") return false
  const obj = err as Record<string, unknown>
  if (obj.name === "NotFoundError") return true
  if (obj._tag === "NotFound") return true
  if (obj.status === 404) return true
  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>
    return data.name === "NotFoundError" || data._tag === "NotFound"
  }
  return false
}

// Poll /global/health every 10 seconds.
// This provides a second detection channel for server death independent of the SSE heartbeat.
const HEALTH_POLL_INTERVAL_MS = 10_000
const HEALTH_FAILURE_LIMIT = 3

/** Reject all pending network-offline waits for a given directory. */
async function drainNetworkWaits(client: KiloClient, dir: string) {
  const { data: waits, error: err } = await client.network.list({ directory: dir })
  if (err) throw new Error(`Failed to list network waits for ${dir}: ${String(err)}`)
  if (!waits) return
  for (const w of waits) {
    const { error } = await client.network.reject({ requestID: w.id, directory: dir })
    if (error) throw new Error(`Failed to reject network wait ${w.id}: ${String(error)}`)
  }
}

/**
 * Shared connection service that owns the single ServerManager, KiloClient (SDK), and SdkSSEAdapter.
 * Multiple KiloProvider instances subscribe to it for SSE events and state changes.
 */
export class KiloConnectionService {
  readonly sandboxPreference: SandboxPreference
  private readonly serverManager: ServerManager
  private client: KiloClient | null = null
  private sseClient: SdkSSEAdapter | null = null
  private info: { port: number } | null = null
  private config: ServerConfig | null = null
  private state: ConnectionState = "disconnected"
  private error: Error | null = null
  private connectPromise: Promise<void> | null = null
  private connectCancel: ((error: Error) => void) | null = null
  private recoveryPromise: Promise<void> | null = null
  private healthPollTimer: ReturnType<typeof setInterval> | null = null
  private healthFailures = 0
  private disposed = false
  private remoteService: import("../RemoteStatusService").RemoteStatusService | null = null

  private readonly eventListeners: Set<SSEEventListener> = new Set()
  private readonly stateListeners: Set<StateListener> = new Set()
  private readonly notificationDismissListeners: Set<NotificationDismissListener> = new Set()
  private readonly languageChangeListeners: Set<LanguageChangeListener> = new Set()
  private readonly profileChangeListeners: Set<ProfileChangeListener> = new Set()
  private readonly migrationCompleteListeners: Set<MigrationCompleteListener> = new Set()
  private readonly favoritesChangeListeners: Set<FavoritesChangeListener> = new Set()
  private readonly providersChangeListeners: Set<ProvidersChangeListener> = new Set()
  private readonly modelSelectorExpandedListeners: Set<ModelSelectorExpandedListener> = new Set()
  private readonly clearPendingPromptsListeners: Set<ClearPendingPromptsListener> = new Set()
  private readonly directoryProviders: Set<DirectoryProvider> = new Set()
  private queue: Promise<void> = Promise.resolve()
  private providerRevision = 0
  private providerKeys: Record<string, StoredProviderKey> = {}
  private rootDirectory: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  private currentDirectory: string | undefined
  private readonly permissionDirectories: Map<string, string> = new Map()
  private readonly questionDirectories: Map<string, string> = new Map()
  private questionRevision = 0

  /**
   * Shared mapping used to resolve session scope for events that don't reliably include a sessionID.
   * Used primarily for message.part.updated where only messageID may be present.
   */
  private readonly messageSessionIdsByMessageId: Map<string, string> = new Map()

  /** Provider key → single focused session ID. */
  private readonly focused: Map<string, string> = new Map()
  /** Provider key → all open (background) session IDs. */
  private readonly opened: Map<string, string[]> = new Map()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private viewedSending = false
  private viewedDirty = false
  private unsubRemote: (() => void) | null = null

  constructor(context: vscode.ExtensionContext) {
    const state =
      context.workspaceState ??
      ({
        get: <T>(_key: string, fallback?: T) => fallback,
        update: async () => undefined,
      } satisfies Pick<vscode.Memento, "get" | "update">)
    this.sandboxPreference = new SandboxPreference(state)
    this.serverManager = new ServerManager(context, (code) => this.handleServerExit(code))
  }

  /** 串行执行全局 Provider 配置保存，避免多个 Webview 并发覆盖同一个配置文件。 */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** 当前共享 Provider 快照版本。 */
  getProviderRevision(): number {
    return this.providerRevision
  }

  /** 用最新权威拉取结果原子替换扩展宿主中的 Provider 密钥缓存。 */
  replaceProviderKeys(keys: Record<string, StoredProviderKey>): void {
    this.providerKeys = { ...keys }
  }

  /** 返回 Provider 密钥缓存副本，避免调用方意外修改共享状态。 */
  getProviderKeys(): Record<string, StoredProviderKey> {
    return { ...this.providerKeys }
  }

  /** 精确更新单个 Provider 的密钥缓存。 */
  setProviderKey(id: string, key?: StoredProviderKey): void {
    const keys = { ...this.providerKeys }
    if (key) keys[id] = key
    if (!key) delete keys[id]
    this.providerKeys = keys
  }

  /**
   * Lazily start server + SSE. Multiple callers share the same promise.
   */
  async connect(workspaceDir: string): Promise<void> {
    if (this.disposed) throw new Error("Connection service has been disposed.")
    this.trackDirectory(workspaceDir)
    if (this.recoveryPromise) {
      return this.recoveryPromise
    }
    return this.startConnection(workspaceDir)
  }

  /** 建立连接并复用同一轮启动，避免多个调用方重复创建 SDK 与 SSE。 */
  private async startConnection(workspaceDir: string): Promise<void> {
    if (this.disposed) throw new Error("Connection service has been disposed.")
    if (this.connectPromise) {
      return this.connectPromise
    }
    if (this.state === "connected") {
      return
    }

    // Mark as connecting early so concurrent callers won't start another connection attempt.
    this.setState("connecting")

    this.connectPromise = this.doConnect(workspaceDir)
    try {
      await this.connectPromise
    } catch (error) {
      // If doConnect() fails before SSE can emit a state transition, avoid leaving consumers stuck in "connecting".
      if (!this.disposed)
        this.setState("error", this.error ?? (error instanceof Error ? error : new Error(String(error))))
      throw error
    } finally {
      this.connectPromise = null
    }
  }

  /**
   * Get the shared SDK client. Throws if not connected.
   */
  getClient(): KiloClient {
    if (!this.client || this.state !== "connected") {
      throw new Error("Not connected — call connect() first")
    }
    return this.client
  }

  /**
   * Get the shared SDK client, auto-connecting if not yet started.
   * Accepts an optional directory to use as the workspace root; falls back
   * to the first VS Code workspace folder. Throws if neither is available
   * or if the connection fails.
   */
  async getClientAsync(dir?: string): Promise<KiloClient> {
    if (dir) this.trackDirectory(dir)
    if (this.client && this.state === "connected") return this.client
    const root = dir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!root) throw new Error("No workspace folder open")
    this.trackDirectory(root)
    await this.connect(root)
    return this.getClient()
  }

  /** Directories that may own directory-scoped requests on the shared backend. */
  getKnownDirectories(): string[] {
    const dirs = new Set<string>()
    if (this.rootDirectory) dirs.add(this.rootDirectory)
    if (this.currentDirectory) dirs.add(this.currentDirectory)
    for (const provider of this.directoryProviders) {
      for (const dir of provider()) {
        if (dir) dirs.add(dir)
      }
    }
    return [...dirs]
  }

  /**
   * Get server info (port). Returns null if not connected.
   */
  getServerInfo(): { port: number } | null {
    return this.info
  }

  /**
   * Get server config (baseUrl + password). Returns null if not connected.
   * Used by TelemetryProxy to POST events to the CLI server.
   */
  getServerConfig(): ServerConfig | null {
    return this.config
  }

  /**
   * Set the remote status service. When remote is disabled, flushViewed()
   * is a no-op. When remote becomes enabled (startup refresh, user toggle,
   * or SSE event), the accumulated focused/opened state is automatically
   * flushed so the server is never left unaware of already-open sessions.
   */
  setRemoteService(service: import("../RemoteStatusService").RemoteStatusService | null): void {
    this.unsubRemote?.()
    this.unsubRemote = null
    this.remoteService = service
    if (service) {
      this.unsubRemote = service.onChange((state) => {
        if (state.enabled) this.flushViewed()
      })
    }
  }

  private isRemoteEnabled(): boolean {
    return this.remoteService?.getState().enabled ?? false
  }

  /**
   * Current connection state.
   */
  getConnectionState(): ConnectionState {
    return this.state
  }

  /**
   * Last connection error. Cleared when a new connection attempt begins.
   */
  getConnectionError(): Error | null {
    return this.error
  }

  /**
   * Subscribe to SSE events. Returns unsubscribe function.
   */
  onEvent(listener: SSEEventListener): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /**
   * Subscribe to SSE events with a filter. The filter runs for every incoming SSE event.
   */
  onEventFiltered(filter: SSEEventFilter, listener: SSEEventListener): () => void {
    const wrapped: SSEEventListener = (event, directory) => {
      if (!filter(event, directory)) {
        return
      }
      listener(event, directory)
    }
    return this.onEvent(wrapped)
  }

  /**
   * Record a messageID -> sessionID mapping, typically from message.updated or from HTTP message history.
   */
  recordMessageSessionId(messageId: string, sessionId: string): void {
    if (!messageId || !sessionId) {
      return
    }
    this.messageSessionIdsByMessageId.set(messageId, sessionId)
  }

  /**
   * Remove all messageID → sessionID entries for a given session.
   * Called when a session is deleted or otherwise pruned so the map
   * does not grow unbounded over the extension lifetime.
   *
   * Also drops the session from any provider's focused or opened set
   * so the server's `viewed` notification stops advertising a deleted
   * id after external (CLI/TUI/cascade) deletes arrive via SSE.
   */
  pruneSession(sessionId: string): void {
    for (const [mid, sid] of this.messageSessionIdsByMessageId) {
      if (sid === sessionId) this.messageSessionIdsByMessageId.delete(mid)
    }
    for (const [key, sid] of this.focused) {
      if (sid === sessionId) this.focused.delete(key)
    }
    for (const [key, ids] of this.opened) {
      if (!ids.includes(sessionId)) continue
      const next = ids.filter((id) => id !== sessionId)
      if (next.length === 0) this.opened.delete(key)
      else this.opened.set(key, next)
    }
    this.flushViewed()
  }

  /**
   * Best-effort sessionID extraction for an SSE event.
   * Returns undefined for global events.
   */
  resolveEventSessionId(event: SSEPayload): string | undefined {
    return resolveEventSessionIdPure(
      event,
      (messageId) => this.messageSessionIdsByMessageId.get(messageId),
      (messageId, sessionId) => this.recordMessageSessionId(messageId, sessionId),
    )
  }

  recordPermissionDirectory(requestID: string, directory: string): void {
    if (!requestID || !directory) {
      return
    }
    this.permissionDirectories.set(requestID, directory)
  }

  getPermissionDirectory(requestID: string): string | undefined {
    return this.permissionDirectories.get(requestID)
  }

  clearPermissionDirectory(requestID: string): void {
    this.permissionDirectories.delete(requestID)
  }

  prunePermissionDirectories(active: Set<string>, dirs?: Set<string>): void {
    for (const [id, dir] of this.permissionDirectories) {
      if (active.has(id)) {
        continue
      }
      if (dirs && !dirs.has(dir)) {
        continue
      }
      this.permissionDirectories.delete(id)
    }
  }

  recordQuestionDirectory(requestID: string, directory: string): void {
    if (!requestID || !directory) {
      return
    }
    this.questionDirectories.set(requestID, directory)
  }

  getQuestionDirectory(requestID: string): string | undefined {
    return this.questionDirectories.get(requestID)
  }

  clearQuestionDirectory(requestID: string): void {
    this.questionDirectories.delete(requestID)
    // A resolved request must invalidate an in-flight recovery scan so stale list data cannot repost it.
    this.questionRevision += 1
  }

  getQuestionRevision(): number {
    return this.questionRevision
  }

  pruneQuestionDirectories(active: Set<string>, dirs: Set<string>): void {
    const size = this.questionDirectories.size
    for (const [id, dir] of this.questionDirectories) {
      if (active.has(id) || !dirs.has(dir)) continue
      this.questionDirectories.delete(id)
    }
    if (this.questionDirectories.size !== size) this.questionRevision += 1
  }

  /**
   * Subscribe to notification dismiss events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onNotificationDismissed(listener: NotificationDismissListener): () => void {
    this.notificationDismissListeners.add(listener)
    return () => {
      this.notificationDismissListeners.delete(listener)
    }
  }

  /**
   * Broadcast a notification dismiss event to all subscribed KiloProvider instances.
   */
  notifyNotificationDismissed(notificationId: string): void {
    for (const listener of this.notificationDismissListeners) {
      listener(notificationId)
    }
  }

  /**
   * Subscribe to language change events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onLanguageChanged(listener: LanguageChangeListener): () => void {
    this.languageChangeListeners.add(listener)
    return () => {
      this.languageChangeListeners.delete(listener)
    }
  }

  /**
   * Broadcast a language change event to all subscribed KiloProvider instances.
   */
  notifyLanguageChanged(locale: string): void {
    for (const listener of this.languageChangeListeners) {
      listener(locale)
    }
  }

  /**
   * Subscribe to profile change events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onProfileChanged(listener: ProfileChangeListener): () => void {
    this.profileChangeListeners.add(listener)
    return () => {
      this.profileChangeListeners.delete(listener)
    }
  }

  /**
   * Broadcast a profile change event to all subscribed KiloProvider instances.
   */
  notifyProfileChanged(data: unknown): void {
    for (const listener of this.profileChangeListeners) {
      listener(data)
    }
  }

  /**
   * Subscribe to migration-complete events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onMigrationComplete(listener: MigrationCompleteListener): () => void {
    this.migrationCompleteListeners.add(listener)
    return () => {
      this.migrationCompleteListeners.delete(listener)
    }
  }

  /**
   * Broadcast a migration-complete event to all subscribed KiloProvider instances.
   */
  notifyMigrationComplete(): void {
    for (const listener of this.migrationCompleteListeners) {
      listener()
    }
  }

  /**
   * Subscribe to favorites change events broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onFavoritesChanged(listener: FavoritesChangeListener): () => void {
    this.favoritesChangeListeners.add(listener)
    return () => {
      this.favoritesChangeListeners.delete(listener)
    }
  }

  /**
   * Broadcast a favorites change event to all subscribed KiloProvider instances.
   */
  notifyFavoritesChanged(favorites: Array<{ providerID: string; modelID: string }>): void {
    for (const listener of this.favoritesChangeListeners) {
      listener(favorites)
    }
  }

  /**
   * 订阅 provider 变更广播。任一 KiloProvider 保存/断开后,
   * 其他 webview 通过它重新拉取 providersLoaded。
   */
  onProvidersChanged(listener: ProvidersChangeListener): () => void {
    this.providersChangeListeners.add(listener)
    return () => {
      this.providersChangeListeners.delete(listener)
    }
  }

  /**
   * 广播 provider 变更来源,让其他 KiloProvider 刷新 provider 状态。
   */
  notifyProvidersChanged(source?: string, message?: unknown): number {
    const revision = ++this.providerRevision
    for (const listener of this.providersChangeListeners) {
      listener(source, revision, message)
    }
    return revision
  }

  /**
   * Subscribe to model-selector expand/collapse changes broadcast from any KiloProvider. Returns unsubscribe function.
   */
  onModelSelectorExpandedChanged(listener: ModelSelectorExpandedListener): () => void {
    this.modelSelectorExpandedListeners.add(listener)
    return () => {
      this.modelSelectorExpandedListeners.delete(listener)
    }
  }

  /**
   * Broadcast a model-selector expand/collapse change to all subscribed KiloProvider instances.
   */
  notifyModelSelectorExpandedChanged(value: boolean): void {
    for (const listener of this.modelSelectorExpandedListeners) {
      listener(value)
    }
  }

  /**
   * Subscribe to clear-pending-prompts broadcast. Returns unsubscribe function.
   * Fired after a config save drains all pending permissions/questions so each
   * webview can clear stale prompt UI.
   */
  onClearPendingPrompts(listener: ClearPendingPromptsListener): () => void {
    this.clearPendingPromptsListeners.add(listener)
    return () => {
      this.clearPendingPromptsListeners.delete(listener)
    }
  }

  /**
   * Register a callback that returns workspace directories tracked by a
   * KiloProvider (root + worktree dirs). Used by drainPendingPrompts() to
   * cover all active Instance directories across every provider.
   */
  registerDirectoryProvider(provider: DirectoryProvider): () => void {
    this.directoryProviders.add(provider)
    return () => {
      this.directoryProviders.delete(provider)
    }
  }

  private trackDirectory(dir: string): void {
    if (!dir) return
    this.rootDirectory ??= dir
    this.currentDirectory = dir
  }

  /**
   * Reject all pending permission requests and questions across every
   * directory known to any currently-mounted KiloProvider.
   *
   * Must be called before operations that trigger Instance.disposeAll()
   * (e.g. config save) to prevent orphaned Promises from freezing
   * sessions.
   *
   * Throws if any list/reject call fails so callers can abort the
   * destructive operation.
   */
  async drainPendingPrompts(): Promise<void> {
    if (!this.client) return

    // Only drain directories from currently-mounted providers (root + worktree dirs).
    // Previously this also called project.list() to include every historically-opened
    // directory, but each permission/question list call goes through Instance.provide()
    // which bootstraps fresh instances (including indexing) for directories without
    // cached instances. Disposed worktree sessions can't have pending prompts anyway.
    const dirs = new Set<string>()
    for (const provider of this.directoryProviders) {
      for (const dir of provider()) {
        dirs.add(dir)
      }
    }

    for (const dir of dirs) {
      const { data: perms, error: permsErr } = await this.client.permission.list({ directory: dir })
      if (permsErr) throw new Error(`Failed to list permissions for ${dir}: ${String(permsErr)}`)
      if (perms) {
        for (const perm of perms) {
          const { error } = await this.client.permission.reply({ requestID: perm.id, reply: "reject", directory: dir })
          if (error && !isNotFound(error)) throw new Error(`Failed to reject permission ${perm.id}: ${String(error)}`)
        }
      }
      const { data: qs, error: qsErr } = await this.client.question.list({ directory: dir })
      if (qsErr) throw new Error(`Failed to list questions for ${dir}: ${String(qsErr)}`)
      if (qs) {
        for (const q of qs) {
          const { error } = await this.client.question.reject({ requestID: q.id, directory: dir })
          if (error && !isNotFound(error)) throw new Error(`Failed to reject question ${q.id}: ${String(error)}`)
        }
      }
      await drainSuggestions(this.client, dir)
      await drainNetworkWaits(this.client, dir)
    }
    for (const listener of this.clearPendingPromptsListeners) {
      listener()
    }
  }

  /**
   * Subscribe to connection state changes. Returns unsubscribe function.
   */
  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  /**
   * Register the session a provider is actively viewing (focused).
   * After any change the aggregated set is sent to the server (debounced).
   */
  registerFocused(key: string, sessionID: string): void {
    if (this.focused.get(key) === sessionID) return
    this.focused.set(key, sessionID)
    this.flushViewed()
  }

  /**
   * Unregister a provider's focused session (e.g. on dispose, hidden, or clearSession).
   */
  unregisterFocused(key: string): void {
    if (!this.focused.has(key)) return
    this.focused.delete(key)
    this.flushViewed()
  }

  /**
   * Register the open (background tab) session IDs for a provider.
   * Sessions that appear in both focused and open are reported as focused only.
   */
  registerOpen(key: string, ids: string[]): void {
    const prev = this.opened.get(key)
    if (prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])) return
    this.opened.set(key, ids)
    this.flushViewed()
  }

  /** Debounced: send the aggregated focused + open session IDs to the server. */
  flushViewed(): void {
    if (!this.isRemoteEnabled()) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.sendViewed()
    }, 150)
  }

  private sendViewed(): void {
    if (!this.isRemoteEnabled()) {
      this.viewedDirty = false
      return
    }
    if (this.viewedSending) {
      this.viewedDirty = true
      return
    }
    if (!this.client) return

    const focus = new Set(this.focused.values())
    const open = new Set<string>()
    for (const ids of this.opened.values()) {
      for (const id of ids) {
        if (!focus.has(id)) open.add(id)
      }
    }

    this.viewedSending = true
    this.viewedDirty = false
    void this.client.session
      .viewed({ focused: [...focus], open: [...open] })
      .catch((err) => console.warn("[Kilo New] ConnectionService: viewed flush failed:", err))
      .finally(() => {
        this.viewedSending = false
        if (this.viewedDirty) this.sendViewed()
      })
  }

  /**
   * Clean up everything: kill server, close SSE, clear listeners.
   */
  dispose(): void {
    this.disposed = true
    this.cancelConnection(new Error("Connection service has been disposed."))
    this.stopHealthPoll()
    this.sseClient?.dispose()
    this.serverManager.dispose()
    this.eventListeners.clear()
    this.stateListeners.clear()
    this.notificationDismissListeners.clear()
    this.profileChangeListeners.clear()
    this.migrationCompleteListeners.clear()
    this.favoritesChangeListeners.clear()
    this.clearPendingPromptsListeners.clear()
    this.directoryProviders.clear()
    this.rootDirectory = undefined
    this.currentDirectory = undefined
    this.messageSessionIdsByMessageId.clear()
    this.permissionDirectories.clear()
    this.questionDirectories.clear()
    this.questionRevision += 1
    this.focused.clear()
    this.opened.clear()
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.viewedDirty = false
    this.unsubRemote?.()
    this.unsubRemote = null
    this.client = null
    this.sseClient = null
    this.config = null
    this.info = null
    this.state = "disconnected"
    this.error = null
  }

  private setState(state: ConnectionState, error?: Error): void {
    this.state = state
    this.error = state === "error" ? (error ?? this.error) : null
    for (const listener of this.stateListeners) {
      listener(state, this.error ?? undefined)
    }
  }

  /** 在清理 SSE 处理器前同步结束仍在等待首个事件的连接。 */
  private cancelConnection(error: Error): void {
    const cancel = this.connectCancel
    this.connectCancel = null
    cancel?.(error)
  }

  /** 每 10 秒探测一次当前后端；SSE 重连期间仍继续探测 HTTP 健康状态。 */
  private startHealthPoll(baseUrl: string, password: string): void {
    this.stopHealthPoll()

    this.healthPollTimer = setInterval(() => {
      void this.pollHealth(baseUrl, password)
    }, HEALTH_POLL_INTERVAL_MS)

    // Don't keep the extension host alive just for the health poll
    this.healthPollTimer.unref?.()
  }

  /**
   * 只探测创建本轮定时器的连接。HTTP 仍健康时让 SSE 自带的重连循环继续工作；
   * 连续失败才释放旧实例并重建，避免把短暂 SSE 中断误判为进程死亡。
   */
  private async pollHealth(baseUrl: string, password: string): Promise<void> {
    const config = this.config
    const client = this.client
    const sse = this.sseClient
    if (!config || !client || !sse || config.baseUrl !== baseUrl || config.password !== password) return

    const healthy = await this.checkHealth(baseUrl, password)
    if (this.config !== config || this.client !== client || this.sseClient !== sse) return
    if (healthy) {
      this.healthFailures = 0
      return
    }

    this.healthFailures += 1
    console.warn("[Kilo New] ConnectionService: CLI backend health check failed", {
      failures: this.healthFailures,
    })
    if (this.healthFailures >= HEALTH_FAILURE_LIMIT) {
      console.warn("[Kilo New] ConnectionService: CLI backend is unavailable; reconnecting")
      void this.recover(new Error("CLI backend is unavailable. Reconnecting automatically."))
      return
    }
    sse.reconnect()
  }

  private stopHealthPoll(): void {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer)
      this.healthPollTimer = null
    }
  }

  private async checkHealth(baseUrl: string, password: string): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    try {
      const res = await fetch(`${baseUrl}/global/health`, {
        headers: { Authorization: `Basic ${Buffer.from(`kilo:${password}`).toString("base64")}` },
        signal: controller.signal,
      })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  /** 单飞恢复当前后端；所有并发调用方等待同一轮 Server、SDK 与 SSE 重建。 */
  private recover(reason: Error): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.recoveryPromise) return this.recoveryPromise

    const root = this.currentDirectory ?? this.rootDirectory ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const task = Promise.resolve().then(async () => {
      if (this.disposed) return
      const pending = this.connectPromise
      this.serverManager.forgetServer()
      this.resetConnection()
      if (pending) await pending.catch(() => undefined)
      if (this.disposed) return
      if (!root) throw new Error("CLI backend disconnected and no workspace folder is available.")
      await this.startConnection(root)
    })
    const done = task
      .catch((error) => {
        if (this.disposed) return
        this.setState("error", error instanceof Error ? error : new Error(String(error)))
      })
      .finally(() => {
        if (this.recoveryPromise === done) this.recoveryPromise = null
      })
    this.recoveryPromise = done
    this.setState("error", reason)
    return done
  }

  private resetConnection(): void {
    this.cancelConnection(new Error("Connection attempt was reset."))
    this.stopHealthPoll()
    const sse = this.sseClient
    this.sseClient = null
    sse?.disconnect()
    this.client = null
    this.config = null
    this.info = null
    this.permissionDirectories.clear()
    this.questionDirectories.clear()
    this.questionRevision += 1
    this.healthFailures = 0
  }

  private handleServerExit(code: number | null): void {
    console.warn("[Kilo New] ConnectionService: CLI background process exited:", code)
    void this.recover(
      new Error(`CLI background process exited with code ${code ?? "unknown"}. Reconnecting automatically.`),
    )
  }

  private async doConnect(workspaceDir: string): Promise<void> {
    // Never expose a stale SDK client while its replacement server is starting.
    this.resetConnection()

    const server = await this.serverManager.getServer()
    if (this.disposed) {
      this.serverManager.dispose()
      throw new Error("Connection service has been disposed.")
    }
    this.info = { port: server.port }

    const config: ServerConfig = {
      baseUrl: `http://127.0.0.1:${server.port}`,
      password: server.password,
    }

    this.config = config

    // Create SDK client with Basic Auth header
    const authHeader = `Basic ${Buffer.from(`kilo:${server.password}`).toString("base64")}`
    const client = createKiloClient({
      baseUrl: config.baseUrl,
      headers: {
        Authorization: authHeader,
      },
    })
    const sse = new SdkSSEAdapter(client)
    this.client = client
    this.sseClient = sse

    // Wait until SSE yields its first server event before resolving connect().
    // Initial stream failures are handled by the adapter reconnect loop.
    let resolveConnected: (() => void) | null = null
    let rejectConnected: ((error: Error) => void) | null = null
    const connectedPromise = new Promise<void>((resolve, reject) => {
      resolveConnected = resolve
      rejectConnected = reject
    })

    const cancel = (error: Error) => {
      rejectConnected?.(error)
      resolveConnected = null
      rejectConnected = null
      if (this.connectCancel === cancel) this.connectCancel = null
    }
    const ready = () => {
      resolveConnected?.()
      resolveConnected = null
      rejectConnected = null
      if (this.connectCancel === cancel) this.connectCancel = null
    }
    this.connectCancel = cancel

    let didConnect = false

    // Wire SSE events → broadcast to all registered listeners
    sse.onEvent((event, directory) => {
      if (this.sseClient !== sse) return
      this.handlePermissionEvent(event, directory)
      this.handleQuestionEvent(event, directory)
      for (const listener of this.eventListeners) {
        listener(event, directory)
      }
    })

    sse.onError((error) => {
      if (this.sseClient !== sse) return
      this.setState("error", error)
    })

    // Wire SSE state → broadcast to all registered state listeners
    sse.onStateChange((sseState) => {
      if (this.sseClient !== sse) {
        if (!didConnect && sseState === "disconnected") {
          cancel(new Error(`SSE connection ended in state: ${sseState}`))
        }
        return
      }

      this.setState(sseState)

      if (sseState === "connected") {
        didConnect = true
        ready()
        return
      }

      if (!didConnect && sseState === "disconnected") {
        cancel(new Error(`SSE connection ended in state: ${sseState}`))
      }
    })

    sse.connect()

    await connectedPromise

    if (this.disposed || this.client !== client || this.sseClient !== sse) {
      sse.dispose()
      if (this.disposed) this.serverManager.dispose()
      throw new Error(this.disposed ? "Connection service has been disposed." : "Connection attempt was superseded.")
    }

    // Start the independent health poll once we are confirmed connected.
    this.startHealthPoll(config.baseUrl, config.password)
  }

  private handlePermissionEvent(event: SSEPayload, directory?: string): void {
    if (event.type === "permission.asked" && directory) {
      this.recordPermissionDirectory(event.properties.id, directory)
      return
    }
    if (event.type === "permission.replied") {
      this.clearPermissionDirectory(event.properties.requestID)
    }
  }

  private handleQuestionEvent(event: SSEPayload, directory?: string): void {
    if (event.type === "question.asked" && directory) {
      this.questionRevision += 1
      this.recordQuestionDirectory(event.properties.id, directory)
      return
    }
    if (event.type === "question.replied" || event.type === "question.rejected") {
      this.clearQuestionDirectory(event.properties.requestID)
    }
  }
}

async function drainSuggestions(client: KiloClient, directory: string): Promise<void> {
  const { data, error: err } = await client.suggestion.list({ directory })
  if (err) throw new Error(`Failed to list suggestions for ${directory}: ${String(err)}`)
  if (data) {
    for (const s of data) {
      const { error } = await client.suggestion.dismiss({ requestID: s.id, directory })
      if (error) throw new Error(`Failed to dismiss suggestion ${s.id}: ${String(error)}`)
    }
  }
}
