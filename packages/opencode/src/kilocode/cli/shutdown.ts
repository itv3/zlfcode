import { InstanceRuntime } from "@/project/instance-runtime"

type ServerLike = {
  stop: (close?: boolean) => Promise<void>
}

export namespace KiloShutdown {
  const tasks = new Set<() => void | Promise<void>>()

  /**
   * 等待受管 server 的退出信号。
   * 除了常规 SIGTERM/SIGINT/SIGHUP 之外，还会检测父进程是否已经消失，
   * 防止 Remote-SSH/扩展宿主切换后留下孤儿 `kilo serve`。
   */
  export function waitForServer(server: ServerLike) {
    return new Promise<void>((resolve) => {
      const state = { done: false, timer: undefined as ReturnType<typeof setInterval> | undefined }
      const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const
      const parent = process.ppid

      const orphaned = () => {
        if (process.ppid !== parent) return true
        if (parent === 1) return false
        try {
          process.kill(parent, 0)
          return false
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          return code === "ESRCH"
        }
      }

      const stop = async () => {
        if (state.done) return
        state.done = true
        for (const signal of signals) {
          process.off(signal, onSignal)
        }
        if (state.timer) {
          clearInterval(state.timer)
        }
        try {
          await InstanceRuntime.disposeAllInstances()
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

      state.timer = setInterval(() => {
        if (!orphaned()) return
        void stop()
      }, 1_000)
      state.timer.unref?.()
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
