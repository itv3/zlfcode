import { startParentWatchdog } from "../parent-watchdog"

type ServerLike = {
  stop: (close?: boolean) => Promise<void>
}

export namespace KiloShutdown {
  const tasks = new Set<() => void | Promise<void>>()

  /**
   * 等待受管 server 的退出信号。
   * 除了常规 SIGTERM/SIGINT/SIGHUP 之外，还会通过 parent-watchdog 检测父进程是否消失，
   * 防止 Remote-SSH/扩展宿主切换后留下孤儿 `kilo serve`。
   *
   * 孤儿检测完全复用 startParentWatchdog 的判定逻辑：仅在设置了 KILO_PARENT_PID
   * 环境变量（编辑器客户端作为父进程启动时会注入）时才生效；未设置时绝不做任何
   * 父进程检测，因此手动后台运行（如 nohup/disown）的 `kilo serve` 在父 shell
   * 退出后不会被误判为孤儿而自行关停。
   *
   * @param options.watchdogIntervalMs 孤儿检测轮询间隔（毫秒），仅供测试缩短等待时间。
   */
  export function waitForServer(server: ServerLike, options?: { watchdogIntervalMs?: number }) {
    return new Promise<void>((resolve) => {
      const state = { done: false }
      const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const

      const stop = async () => {
        if (state.done) return
        state.done = true
        for (const signal of signals) {
          process.off(signal, onSignal)
        }
        stopWatchdog()
        try {
          // 延迟加载运行时，避免后台进程 schema 初始化时形成工具注册循环依赖。
          const runtime = await import("@/project/instance-runtime")
          await runtime.InstanceRuntime.disposeAllInstances()
          await server.stop(true)
        } finally {
          resolve()
        }
      }

      const onSignal = () => {
        void stop()
      }

      for (const signal of signals) {
        process.once(signal, onSignal)
      }

      // 统一的孤儿检测入口：未设置 KILO_PARENT_PID 时 startParentWatchdog 是空操作，
      // 此处不会启动任何轮询定时器。
      const stopWatchdog = startParentWatchdog(() => {
        void stop()
      }, options?.watchdogIntervalMs)
    })
  }

  export function register(task: () => void | Promise<void>) {
    tasks.add(task)
    return () => tasks.delete(task)
  }

  export async function run() {
    const pending = Array.from(tasks)
    tasks.clear()
    await Promise.all(pending.map((task) => task()))
  }
}
