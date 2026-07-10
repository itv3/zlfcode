import { type ChildProcess } from "child_process"
import { spawn } from "../../util/process"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { resolveLocalBwrapEnv, resolveTreeSitterEnv } from "./cli-resources"
import { t } from "./i18n"
import { parseServerPort } from "./server-utils"

export interface ServerInstance {
  port: number
  password: string
  process?: ChildProcess
  pid?: number
  shared?: boolean
}

const STARTUP_TIMEOUT_SECONDS = 180
const KILL_FALLBACK_MS = 5_000
const LOCK_STALE_MS = 90_000
const LOCK_WAIT_MS = 250
const HEALTH_TIMEOUT_MS = 1_500

type WorkspaceFolderLike = { uri: { fsPath: string } }
type ServerExitListener = (code: number | null) => void
type SharedState = {
  pid: number
  port: number
  password: string
  cliPath: string
  version: string
}

export function resolveServerCwd(folders: readonly WorkspaceFolderLike[] | undefined, storage: string): string {
  return folders?.[0]?.uri.fsPath ?? storage
}

export function resolveIndexingEnv(folders: readonly WorkspaceFolderLike[] | undefined): Record<string, string> {
  if (folders && folders.length > 0) return {}
  return { KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" }
}

export function resolveManagedServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, KILO_DISABLE_CHANNEL_DB: "true" }
}

export class ServerManager {
  private instance: ServerInstance | null = null
  private startupPromise: Promise<ServerInstance> | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onExit?: ServerExitListener,
  ) {
    this.pruneDeadSharedState()
  }

  /**
   * Get or start the server instance
   */
  async getServer(): Promise<ServerInstance> {
    console.log("[Kilo New] ServerManager: 🔍 getServer called")
    if (this.instance) {
      if (await this.isInstanceHealthy(this.instance)) {
        console.log("[Kilo New] ServerManager: ♻️ Returning existing instance:", { port: this.instance.port })
        return this.instance
      }
      this.dropInstance(this.instance, "existing CLI backend is unavailable")
    }

    if (this.startupPromise) {
      console.log("[Kilo New] ServerManager: ⏳ Startup already in progress, waiting...")
      return this.startupPromise
    }

    console.log("[Kilo New] ServerManager: 🚀 Starting new server instance...")
    this.startupPromise = this.withStartupLock(async () => {
      const shared = await this.getSharedServer()
      if (shared) return shared
      const server = await this.startServer()
      this.writeSharedState(server)
      return server
    })
    try {
      this.instance = await this.startupPromise
      console.log("[Kilo New] ServerManager: ✅ Server started successfully:", { port: this.instance.port })
      return this.instance
    } finally {
      this.startupPromise = null
    }
  }

  private async startServer(): Promise<ServerInstance> {
    const password = crypto.randomBytes(32).toString("hex")
    const cliPath = this.getCliPath()
    console.log("[Kilo New] ServerManager: 📍 CLI path:", cliPath)
    console.log("[Kilo New] ServerManager: 🔐 Generated password (length):", password.length)

    // Verify the CLI binary exists
    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `CLI binary not found at expected path: ${cliPath}. Please ensure the CLI is built and bundled with the extension.`,
      )
    }

    const stat = fs.statSync(cliPath)
    console.log("[Kilo New] ServerManager: 📄 CLI isFile:", stat.isFile())
    console.log("[Kilo New] ServerManager: 📄 CLI mode (octal):", (stat.mode & 0o777).toString(8))

    return new Promise((resolve, reject) => {
      console.log("[Kilo New] ServerManager: 🎬 Spawning CLI process:", cliPath, ["serve", "--port", "0"])
      const cfg = vscode.workspace.getConfiguration("kilo-code.new")
      const claudeCompat = cfg.get<boolean>("claudeCodeCompat", false)
      // Pin cwd so the CLI doesn't inherit the extension host's cwd ("/" under F5 debug)
      // or "$HOME" in empty VS Code windows.
      const folders = vscode.workspace.workspaceFolders
      const spawnCwd = resolveServerCwd(folders, this.context.globalStorageUri.fsPath)
      fs.mkdirSync(spawnCwd, { recursive: true })
      const indexingEnv = resolveIndexingEnv(folders)
      const localCli =
        this.context.extensionMode === vscode.ExtensionMode.Development ||
        fs.existsSync(path.join(this.context.extensionPath, "bin", ".cli-version"))
      const bwrapEnv = process.env.KILO_BWRAP_PATH ? {} : resolveLocalBwrapEnv(this.context.extensionPath, localCli)
      // TLS / corporate-proxy support:
      //   - Default NODE_USE_SYSTEM_CA=1 so the bundled Bun CLI trusts the OS
      //     trust store (Windows cert store, macOS keychain, Linux /etc/ssl).
      //     Mirrors VS Code's `http.systemCertificates` default (true).
      //   - Allow users behind MITM proxies to point at a custom CA bundle via
      //     `kilo-code.new.extraCaCerts` (NODE_EXTRA_CA_CERTS).
      //   - Honor VS Code's `http.proxyStrictSSL=false` as an explicit opt-out
      //     from verification, matching what VS Code already does for its own
      //     requests. Users explicitly set that; we don't flip it ourselves.
      // All three are overridable by the user's environment.
      const extraCaCerts = cfg.get<string>("extraCaCerts", "").trim()
      const proxyStrictSSL = vscode.workspace.getConfiguration("http").get<boolean>("proxyStrictSSL", true)
      const serverProcess = spawn(cliPath, ["serve", "--port", "0"], {
        cwd: spawnCwd,
        env: {
          NODE_USE_SYSTEM_CA: "1",
          ...(extraCaCerts && { NODE_EXTRA_CA_CERTS: extraCaCerts }),
          ...(!proxyStrictSSL && { NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
          ...resolveManagedServerEnv(process.env),
          // VS Code's http.proxy / http.noProxy settings are not reflected in
          // process.env, so spawned children bypass the user's configured proxy
          // and fail behind corporate firewalls. Forward them as the standard
          // HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars that Bun's fetch and
          // most HTTP clients already respect.
          ...buildProxyEnv(),
          // Force mimalloc (the allocator Bun ships with) to return freed pages
          // to the OS immediately instead of retaining them in its arenas.
          // Without this, Bun.spawn's piped stdio accumulates ~2 MB of native
          // RSS per call on Windows, causing the Agent Manager (which polls git
          // once per second per worktree) to reach multi-GB RSS in minutes.
          // See oven-sh/bun#18265 and Jarred's workaround note in #21560.
          MIMALLOC_PURGE_DELAY: "0",
          KILO_SERVER_PASSWORD: password,
          KILO_CLIENT: "vscode",
          KILO_ENABLE_QUESTION_TOOL: "true",
          KILOCODE_FEATURE: "vscode-extension",
          ...indexingEnv,
          KILO_TELEMETRY_LEVEL: vscode.env.isTelemetryEnabled ? "all" : "off",
          KILO_APP_NAME: "kilo-code",
          KILO_EDITOR_NAME: vscode.env.appName,
          KILO_PLATFORM: "vscode",
          KILO_MACHINE_ID: vscode.env.machineId,
          KILO_APP_VERSION: this.context.extension.packageJSON.version,
          KILO_VSCODE_VERSION: vscode.version,
          KILOCODE_VERSION: this.context.extension.packageJSON.version,
          KILOCODE_EDITOR_NAME: `${vscode.env.appName} ${vscode.version}`,
          ...(!claudeCompat && { KILO_DISABLE_CLAUDE_CODE: "true" }),
          ...resolveTreeSitterEnv(this.context.extensionPath),
          ...bwrapEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      })
      console.log("[Kilo New] ServerManager: 📦 Process spawned with PID:", serverProcess.pid)

      let resolved = false
      const stderrLines: string[] = []

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        console.log("[Kilo New] ServerManager: 📥 CLI Server stdout:", output)

        const port = parseServerPort(output)
        if (port !== null && !resolved) {
          resolved = true
          console.log("[Kilo New] ServerManager: 🎯 Port detected:", port)
          resolve({ port, password, process: serverProcess })
        }
      })

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const errorOutput = data.toString()
        console.error("[Kilo New] ServerManager: ⚠️ CLI Server stderr:", errorOutput)
        stderrLines.push(errorOutput)
      })

      serverProcess.on("error", (error) => {
        console.error("[Kilo New] ServerManager: ❌ Process error:", error)
        if (!resolved) {
          reject(error)
        }
      })

      serverProcess.on("exit", (code) => {
        console.log("[Kilo New] ServerManager: 🛑 Process exited with code:", code)
        this.clearSharedState(serverProcess.pid)
        if (this.instance?.process === serverProcess) {
          this.instance = null
          this.onExit?.(code)
        }
        if (!resolved) {
          const { userMessage, userDetails } = toErrorMessage(
            t("server.processExited", { code: code ?? "null" }),
            stderrLines,
            cliPath,
          )
          reject(new ServerStartupError(userMessage, userDetails))
        }
      })

      setTimeout(() => {
        if (!resolved) {
          console.error(`[Kilo New] ServerManager: ⏰ Server startup timeout (${STARTUP_TIMEOUT_SECONDS}s)`)
          ServerManager.killProcess(serverProcess, "SIGTERM")
          ServerManager.scheduleKillFallback(serverProcess)
          const { userMessage, userDetails } = toErrorMessage(
            t("server.startupTimeout", { seconds: STARTUP_TIMEOUT_SECONDS }),
            stderrLines,
            cliPath,
          )
          reject(new ServerStartupError(userMessage, userDetails))
        }
      }, STARTUP_TIMEOUT_SECONDS * 1000)
    })
  }

  private async withStartupLock<T>(fn: () => Promise<T>): Promise<T> {
    const root = this.context.globalStorageUri.fsPath
    const lock = this.lockDir()
    const started = Date.now()
    fs.mkdirSync(root, { recursive: true })

    while (true) {
      const acquired = this.tryLock(lock)
      if (acquired) {
        try {
          return await fn()
        } finally {
          fs.rmSync(lock, { recursive: true, force: true })
        }
      }
      if (this.isLockAbandoned(lock)) {
        console.warn("[Kilo New] ServerManager: removing abandoned startup lock:", lock)
        fs.rmSync(lock, { recursive: true, force: true })
        continue
      }
      if (this.isLockStale(lock)) {
        console.warn("[Kilo New] ServerManager: removing stale startup lock:", lock)
        fs.rmSync(lock, { recursive: true, force: true })
        continue
      }
      if (Date.now() - started > LOCK_STALE_MS + STARTUP_TIMEOUT_SECONDS * 1000) {
        throw new Error("Timed out waiting for another Kilo backend startup to finish")
      }
      await sleep(LOCK_WAIT_MS)
    }
  }

  private tryLock(lock: string): boolean {
    try {
      fs.mkdirSync(lock)
      fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, time: Date.now() }))
      return true
    } catch (error) {
      if (isExistsError(error)) {
        return false
      }
      throw error
    }
  }

  private async getSharedServer(): Promise<ServerInstance | null> {
    const state = this.readSharedState()
    if (!state) return null
    if (state.cliPath !== this.getCliPath()) return null
    if (state.version !== this.context.extension.packageJSON.version) return null
    if (!this.isProcessAlive(state.pid)) {
      this.clearSharedState(state.pid)
      return null
    }
    if (!(await this.isSharedHealthy(state))) {
      this.clearSharedState(state.pid)
      return null
    }
    console.log("[Kilo New] ServerManager: Reusing shared CLI backend:", { pid: state.pid, port: state.port })
    return { port: state.port, password: state.password, pid: state.pid, shared: true }
  }

  private readSharedState(): SharedState | null {
    try {
      const data = JSON.parse(fs.readFileSync(this.statePath(), "utf8")) as Partial<SharedState>
      if (
        typeof data.pid !== "number" ||
        typeof data.port !== "number" ||
        typeof data.password !== "string" ||
        typeof data.cliPath !== "string" ||
        typeof data.version !== "string"
      ) {
        return null
      }
      return data as SharedState
    } catch {
      return null
    }
  }

  private writeSharedState(server: ServerInstance): void {
    if (!server.process?.pid) return
    const state: SharedState = {
      pid: server.process.pid,
      port: server.port,
      password: server.password,
      cliPath: this.getCliPath(),
      version: this.context.extension.packageJSON.version,
    }
    fs.writeFileSync(this.statePath(), JSON.stringify(state), { mode: 0o600 })
  }

  private clearSharedState(pid?: number): void {
    const state = this.readSharedState()
    if (pid !== undefined && state?.pid !== pid) return
    fs.rmSync(this.statePath(), { force: true })
  }

  private pruneDeadSharedState(): void {
    const state = this.readSharedState()
    if (!state) return
    if (state.cliPath !== this.getCliPath()) return
    if (state.version !== this.context.extension.packageJSON.version) return
    if (this.isProcessAlive(state.pid)) return
    console.warn("[Kilo New] ServerManager: removing shared state for dead CLI backend:", { pid: state.pid })
    this.clearSharedState(state.pid)
  }

  private async isSharedHealthy(state: SharedState): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
    try {
      const res = await fetch(`http://127.0.0.1:${state.port}/global/health`, {
        headers: { Authorization: `Basic ${Buffer.from(`kilo:${state.password}`).toString("base64")}` },
        signal: controller.signal,
      })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private async isInstanceHealthy(server: ServerInstance): Promise<boolean> {
    const code = server.process?.exitCode
    if (code !== undefined && code !== null) return false
    const pid = server.process?.pid ?? server.pid
    if (pid !== undefined && !this.isProcessAlive(pid)) return false
    if (server.process) return true
    return this.isSharedHealthy({
      pid: pid ?? 0,
      port: server.port,
      password: server.password,
      cliPath: this.getCliPath(),
      version: this.context.extension.packageJSON.version,
    })
  }

  private dropInstance(server: ServerInstance, reason: string): void {
    const pid = server.process?.pid ?? server.pid
    console.warn("[Kilo New] ServerManager: dropping CLI backend:", { reason, port: server.port, pid })
    this.instance = null
    this.clearSharedState(pid)
    if (!server.process) return
    ServerManager.killProcess(server.process, "SIGTERM")
    ServerManager.scheduleKillFallback(server.process)
  }

  private isLockStale(lock: string): boolean {
    try {
      return Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS
    } catch {
      return true
    }
  }

  private isLockAbandoned(lock: string): boolean {
    const pid = this.readLockOwner(lock)
    if (pid === undefined) {
      return false
    }
    return !this.isProcessAlive(pid)
  }

  private readLockOwner(lock: string): number | undefined {
    try {
      const file = path.join(lock, "owner.json")
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: unknown }
      if (typeof data.pid === "number") {
        return data.pid
      }
    } catch {
      return undefined
    }
    return undefined
  }

  private lockDir(): string {
    return path.join(this.context.globalStorageUri.fsPath, "server-start.lock")
  }

  private statePath(): string {
    return path.join(this.context.globalStorageUri.fsPath, "server-start.json")
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const binName = process.platform === "win32" ? "kilo.exe" : "kilo"
    const cliPath = path.join(this.context.extensionPath, "bin", binName)
    console.log("[Kilo New] ServerManager: 📦 Using CLI path:", cliPath)
    return cliPath
  }

  /**
   * Kill a process and its entire process group.
   * On Unix, we send the signal to -pid (negative) to reach the whole group.
   * On Windows, process.kill() on the child handle is sufficient.
   */
  private static killProcess(proc: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
    if (proc.pid === undefined) {
      return
    }
    try {
      if (process.platform !== "win32") {
        // Negative PID targets the entire process group
        process.kill(-proc.pid, signal)
      } else {
        proc.kill(signal)
      }
    } catch (err) {
      const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined
      if (code !== "ESRCH") {
        console.warn("[Kilo New] ServerManager: failed to signal process", { pid: proc.pid, signal, err })
      }
    }
  }

  dispose(): void {
    if (!this.instance) {
      return
    }
    const proc = this.instance.process
    this.instance = null
    if (!proc) {
      return
    }

    // 不要在真正退出前提前删除共享状态文件。
    // 否则扩展宿主先退出、`kilo serve` 还活着时，新宿主会误以为没有共享后端，
    // 进而再拉起第二个 server，造成 provider/chat 状态分裂。
    console.log("[Kilo New] ServerManager: 🔴 Disposing — sending SIGTERM to process group, PID:", proc.pid)
    ServerManager.killProcess(proc, "SIGTERM")

    // SIGTERM 可能被服务端忽略，或者 Instance.disposeAll() 超过 serve.ts 的退出等待。
    // 这里额外安排 SIGKILL 兜底，确保进程树最终会被清理。
    ServerManager.scheduleKillFallback(proc)
  }

  forgetSharedServer(): boolean {
    if (!this.instance?.shared) return false
    this.dropInstance(this.instance, "shared CLI backend was forgotten")
    return true
  }

  forgetServer(): boolean {
    if (!this.instance) return false
    this.dropInstance(this.instance, "CLI backend was forgotten")
    return true
  }

  private static scheduleKillFallback(proc: ChildProcess): void {
    const timer = setTimeout(() => {
      if (proc.exitCode === null) {
        console.warn("[Kilo New] ServerManager: ⚠️ Process did not exit after SIGTERM, sending SIGKILL")
        ServerManager.killProcess(proc, "SIGKILL")
      }
    }, KILL_FALLBACK_MS)
    // 不让这个兜底计时器阻止扩展宿主退出。
    timer.unref()
    proc.on("exit", () => clearTimeout(timer))
  }
}

export class ServerStartupError extends Error {
  readonly userMessage: string
  readonly userDetails: string
  constructor(userMessage: string, userDetails: string) {
    super(userDetails)
    this.name = "ServerStartupError"
    this.userMessage = userMessage
    this.userDetails = userDetails
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  return (error as { code?: unknown }).code === "EEXIST"
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

/**
 * Translate VS Code's `http.proxy` / `http.noProxy` / `http.proxySupport`
 * settings into the standard proxy env vars, so the spawned CLI honors the
 * user's proxy configuration. Returns an empty object when no override is
 * needed, so callers can spread unconditionally.
 *
 * `http.proxySupport: "off"` is VS Code's opt-in way to disable proxy support
 * entirely; when set, we explicitly clear the env vars so ambient shell
 * HTTP_PROXY/http_proxy doesn't leak into the spawned child.
 */
export function buildProxyEnv(): Record<string, string> {
  const httpConfig = vscode.workspace.getConfiguration("http")
  const proxyInfo = httpConfig.inspect<string>("proxy")
  const noProxyInfo = httpConfig.inspect<string[]>("noProxy")
  const proxySupport = httpConfig.get<string>("proxySupport")

  if (proxySupport === "off") {
    return { HTTP_PROXY: "", HTTPS_PROXY: "", NO_PROXY: "", http_proxy: "", https_proxy: "", no_proxy: "" }
  }

  const proxy = httpConfig.get<string>("proxy")
  const noProxy = httpConfig.get<string[]>("noProxy")
  const proxySet =
    proxyInfo !== undefined &&
    [
      proxyInfo.globalValue,
      proxyInfo.workspaceValue,
      proxyInfo.workspaceFolderValue,
      proxyInfo.globalLanguageValue,
      proxyInfo.workspaceLanguageValue,
      proxyInfo.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined)
  const noProxySet =
    noProxyInfo !== undefined &&
    [
      noProxyInfo.globalValue,
      noProxyInfo.workspaceValue,
      noProxyInfo.workspaceFolderValue,
      noProxyInfo.globalLanguageValue,
      noProxyInfo.workspaceLanguageValue,
      noProxyInfo.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined)
  const env: Record<string, string> = {}
  if (proxy && proxy.trim() !== "") {
    env.HTTP_PROXY = proxy
    env.HTTPS_PROXY = proxy
    env.http_proxy = proxy
    env.https_proxy = proxy
  }
  if (proxySet && proxy !== undefined && proxy.trim() === "") {
    env.HTTP_PROXY = ""
    env.HTTPS_PROXY = ""
    env.http_proxy = ""
    env.https_proxy = ""
  }
  if (Array.isArray(noProxy) && noProxy.length > 0) {
    env.NO_PROXY = noProxy.join(",")
    env.no_proxy = noProxy.join(",")
  }
  if (noProxySet && Array.isArray(noProxy) && noProxy.length === 0) {
    env.NO_PROXY = ""
    env.no_proxy = ""
  }
  return env
}

export function toErrorMessage(
  error: string,
  stderrLines: string[],
  cliPath?: string,
): {
  userMessage: string
  userDetails: string
  error: string
} {
  let lines = stderrLines.flatMap((line) => line.split("\n"))

  const errorLine = lines.map(stripAnsi).find((line) => /Error:\s+/.test(line))
  const userMessage = errorLine
    ? errorLine.match(/Error:\s+(.+)/)![1].trim()
    : stripAnsi([...lines].reverse().find((line) => line.trim() !== "") ?? error).trim()

  lines = [error, ...lines]
  if (cliPath && cliPath.trim() !== "") {
    lines = [`CLI path: ${cliPath}`, ...lines]
  }

  const detailsText = lines.map(stripAnsi).join("\n").trim()

  return {
    userMessage,
    userDetails: detailsText,
    error,
  }
}
