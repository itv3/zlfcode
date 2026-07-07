import * as vscode from "vscode"

export function self(ctx?: vscode.ExtensionContext): vscode.Extension<unknown> | undefined {
  return (
    ctx?.extension ??
    vscode.extensions.getExtension("itv3.kilo-code-plus") ??
    vscode.extensions.getExtension("kilocode.kilo-code")
  )
}

export function version(ctx?: vscode.ExtensionContext): string {
  return self(ctx)?.packageJSON?.version ?? "unknown"
}
