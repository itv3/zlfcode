import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Show, createMemo } from "solid-js"
import { useLanguage } from "../../context/language"

export type Translator = ReturnType<typeof useLanguage>["t"]

// undefined = not set; true/false = enable_thinking value
export type EnableThinkingValue = undefined | boolean
export type ThinkingTypeValue = undefined | "enabled" | "disabled" | "adaptive"
export type SplitReasoningValue = undefined | boolean
export type ReasoningEffortValue = undefined | "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
export type OutputEffortValue = undefined | "low" | "medium" | "high" | "xhigh" | "max"
export type ChatTemplateArgsValue = undefined | boolean
export type Modality = "text" | "audio" | "image" | "video" | "pdf"

export type Modalities = {
  input?: Modality[]
  output?: Modality[]
}

export type VariantEntry = {
  name: string
  raw?: Record<string, unknown>
  enableThinking: EnableThinkingValue
  thinking: ThinkingTypeValue
  splitReasoning: SplitReasoningValue
  reasoningEffort: ReasoningEffortValue
  outputEffort: OutputEffortValue
  chatTemplateArgs: ChatTemplateArgsValue
}

export type ModelEntry = {
  id: string
  name: string
  reasoning: boolean
  supportsImages: boolean
  modalities: Modalities
  variants: VariantEntry[]
  // kilocode_change start - ZLF 定制：模型级 token 上限与成本配置（上游没有这组字段）
  contextLimit: string
  outputLimit: string
  costEnabled: boolean
  inputCost: string
  outputCost: string
  cacheReadCost: string
  cacheWriteCost: string
  // kilocode_change end
}

// kilocode_change start - ZLF 定制：成本输入只允许十进制小数
const COST_INPUT = /^(?:\d+(?:\.\d*)?|\.\d*)?$/

function cost(value: string, save: (val: string) => void) {
  if (COST_INPUT.test(value)) save(value)
}
// kilocode_change end

type ModelCardProps = {
  m: ModelEntry
  errors: {
    id?: string
    name?: string
    variants?: Array<{ name?: string }>
    // kilocode_change start - ZLF 定制：limit / cost 字段的校验错误
    contextLimit?: string
    outputLimit?: string
    inputCost?: string
    outputCost?: string
    cacheReadCost?: string
    cacheWriteCost?: string
    // kilocode_change end
  }
  t: Translator
  canRemove: boolean
  // kilocode_change start - ZLF 定制：「默认推理强度」选择器（把选中变体置顶为默认档）
  variantNames?: string[]
  onSelectVariant: (val: string) => void
  // kilocode_change end
  onChangeId: (val: string) => void
  onChangeName: (val: string) => void
  onChangeReasoning: (val: boolean) => void
  onChangeSupportsImages: (val: boolean) => void
  // kilocode_change start - ZLF 定制：limit / cost 字段的回调
  onChangeContextLimit: (val: string) => void
  onChangeOutputLimit: (val: string) => void
  onChangeCostEnabled: (val: boolean) => void
  onChangeInputCost: (val: string) => void
  onChangeOutputCost: (val: string) => void
  onChangeCacheReadCost: (val: string) => void
  onChangeCacheWriteCost: (val: string) => void
  // kilocode_change end
  onRemove: () => void
}

// kilocode_change - 变体名首字母大写用于「默认推理强度」下拉展示
function format(item: string) {
  return item.charAt(0).toUpperCase() + item.slice(1)
}

export function ModelCard(props: ModelCardProps) {
  const issue = () => props.errors.variants?.find((error) => error.name)?.name
  // kilocode_change start - ZLF 定制：可选默认档位 = 已有变体名，否则由 Dialog 传入预设档位名
  const opts = createMemo(() =>
    (props.variantNames ?? props.m.variants.map((item) => item.name)).map((item) => item.trim()).filter(Boolean),
  )
  const current = createMemo(() => opts()[0])
  // kilocode_change end

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        padding: "8px",
        border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
        "border-radius": "6px",
      }}
    >
      {/* Model id + name + remove */}
      <div style={{ display: "flex", gap: "8px", "align-items": "flex-end" }}>
        <div style={{ flex: 1 }}>
          <TextField
            label={props.t("provider.custom.models.id.label")}
            placeholder={props.t("provider.custom.models.id.placeholder")}
            value={props.m.id}
            onChange={props.onChangeId}
            validationState={props.errors.id ? "invalid" : undefined}
            error={props.errors.id}
          />
        </div>
        <div style={{ flex: 1 }}>
          <TextField
            label={props.t("provider.custom.models.name.label")}
            placeholder={props.t("provider.custom.models.name.placeholder")}
            value={props.m.name}
            onChange={props.onChangeName}
            validationState={props.errors.name ? "invalid" : undefined}
            error={props.errors.name}
          />
        </div>
        <IconButton
          type="button"
          icon="trash"
          variant="ghost"
          onClick={props.onRemove}
          disabled={!props.canRemove}
          aria-label={props.t("provider.custom.models.remove")}
          style={{ "margin-bottom": "4px" }}
        />
      </div>

      {/* kilocode_change start - ZLF 定制：上下文 / 输出 token 上限输入框 */}
      <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
        <div style={{ flex: 1 }}>
          <TextField
            type="number"
            label={props.t("provider.custom.models.contextLimit.label")}
            placeholder={props.t("provider.custom.models.contextLimit.placeholder")}
            value={props.m.contextLimit}
            onChange={props.onChangeContextLimit}
            validationState={props.errors.contextLimit ? "invalid" : undefined}
            error={props.errors.contextLimit}
          />
        </div>
        <div style={{ flex: 1 }}>
          <TextField
            type="number"
            label={props.t("provider.custom.models.outputLimit.label")}
            placeholder={props.t("provider.custom.models.outputLimit.placeholder")}
            value={props.m.outputLimit}
            onChange={props.onChangeOutputLimit}
            validationState={props.errors.outputLimit ? "invalid" : undefined}
            error={props.errors.outputLimit}
          />
        </div>
      </div>
      {/* kilocode_change end */}

      {/* Reasoning and Image toggles */}
      <div style={{ display: "flex", gap: "16px", "align-items": "center", "flex-wrap": "wrap" }}>
        <label
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            cursor: "pointer",
            "font-size": "var(--kilo-font-size-13)",
            color: "var(--vscode-foreground)",
          }}
        >
          <input
            type="checkbox"
            checked={props.m.reasoning}
            onChange={(e) => props.onChangeReasoning(e.currentTarget.checked)}
          />
          {props.t("provider.custom.models.reasoning.label")}
        </label>

        <label
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            cursor: "pointer",
            "font-size": "var(--kilo-font-size-13)",
            color: "var(--vscode-foreground)",
          }}
        >
          <input
            type="checkbox"
            checked={props.m.supportsImages}
            onChange={(e) => props.onChangeSupportsImages(e.currentTarget.checked)}
          />
          {props.t("provider.custom.models.modalities.image")}
        </label>

        {/* kilocode_change start - ZLF 定制：成本选项开关 */}
        <label
          style={{
            display: "flex",
            "align-items": "center",
            gap: "8px",
            cursor: "pointer",
            "font-size": "var(--kilo-font-size-13)",
            color: "var(--vscode-foreground)",
          }}
        >
          <input
            type="checkbox"
            checked={props.m.costEnabled}
            onChange={(e) => props.onChangeCostEnabled(e.currentTarget.checked)}
          />
          {props.t("provider.custom.models.cost.label")}
        </label>
        {/* kilocode_change end */}

        {/* kilocode_change start - ZLF 定制：默认推理强度选择器（选中档位置顶为模型默认） */}
        <Show when={props.m.reasoning && opts().length > 0}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px", flex: "0 1 auto", "min-width": "0" }}>
            <span
              style={{
                "font-size": "var(--kilo-font-size-13)",
                color: "var(--vscode-foreground)",
                flex: "0 0 auto",
                "white-space": "nowrap",
              }}
            >
              {props.t("provider.custom.models.variants.default.label")}
            </span>
            <div style={{ width: "112px", "min-width": "92px" }}>
              <Select<string>
                options={opts()}
                current={current()}
                value={(o) => o}
                label={format}
                onSelect={(o) => o && props.onSelectVariant(o)}
                placeholder={props.t("provider.custom.models.variants.reasoningEffort.placeholder")}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </div>
          </div>
        </Show>
        {/* kilocode_change end */}
      </div>

      {/* kilocode_change start - ZLF 定制：模型成本（$/1M token）输入区 */}
      <Show when={props.m.costEnabled}>
        <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
          <div style={{ flex: 1 }}>
            <TextField
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.]?[0-9]*"
              label={props.t("provider.custom.models.inputCost.label")}
              placeholder={props.t("provider.custom.models.cost.placeholder")}
              value={props.m.inputCost}
              onChange={(v) => cost(v, props.onChangeInputCost)}
              validationState={props.errors.inputCost ? "invalid" : undefined}
              error={props.errors.inputCost}
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.]?[0-9]*"
              label={props.t("provider.custom.models.outputCost.label")}
              placeholder={props.t("provider.custom.models.cost.placeholder")}
              value={props.m.outputCost}
              onChange={(v) => cost(v, props.onChangeOutputCost)}
              validationState={props.errors.outputCost ? "invalid" : undefined}
              error={props.errors.outputCost}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
          <div style={{ flex: 1 }}>
            <TextField
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.]?[0-9]*"
              label={props.t("provider.custom.models.cacheReadCost.label")}
              placeholder={props.t("provider.custom.models.cost.placeholder")}
              value={props.m.cacheReadCost}
              onChange={(v) => cost(v, props.onChangeCacheReadCost)}
              validationState={props.errors.cacheReadCost ? "invalid" : undefined}
              error={props.errors.cacheReadCost}
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.]?[0-9]*"
              label={props.t("provider.custom.models.cacheWriteCost.label")}
              placeholder={props.t("provider.custom.models.cost.placeholder")}
              value={props.m.cacheWriteCost}
              onChange={(v) => cost(v, props.onChangeCacheWriteCost)}
              validationState={props.errors.cacheWriteCost ? "invalid" : undefined}
              error={props.errors.cacheWriteCost}
            />
          </div>
        </div>
      </Show>
      {/* kilocode_change end */}

      <Show when={issue()}>
        {(error) => (
          <span
            role="alert"
            style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-errorForeground)" }}
          >
            {error()}
          </span>
        )}
      </Show>
    </div>
  )
}
