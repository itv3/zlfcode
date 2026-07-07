import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLanguage } from "../../context/language"

export type Translator = ReturnType<typeof useLanguage>["t"]

// undefined 表示未设置；true/false 表示 enable_thinking 的值。
export type EnableThinkingValue = undefined | boolean
export type ThinkingTypeValue = undefined | "enabled" | "disabled" | "adaptive"
export type SplitReasoningValue = undefined | boolean
export type ReasoningEffortValue = undefined | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
export type OutputEffortValue = undefined | "low" | "medium" | "high" | "xhigh" | "max"
export type ChatTemplateArgsValue = undefined | boolean

export type VariantEntry = {
  name: string
  extras?: Record<string, unknown>
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
  image: boolean
  outputModalities: string[]
  contextLimit: string
  outputLimit: string
  costEnabled: boolean
  inputCost: string
  outputCost: string
  cacheReadCost: string
  cacheWriteCost: string
  reasoning: boolean
  variants: VariantEntry[]
}

type VariantOption = { value: string }
type SelectOption<T> = { value: T; labelKey: string }

const COST_INPUT = /^(?:\d+(?:\.\d*)?|\.\d*)?$/

const ENABLE_THINKING_OPTIONS: SelectOption<EnableThinkingValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: true, labelKey: "provider.custom.models.variants.enableThinking.true" },
  { value: false, labelKey: "provider.custom.models.variants.enableThinking.false" },
]

const THINKING_OPTIONS: SelectOption<ThinkingTypeValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: "enabled", labelKey: "provider.custom.models.variants.thinking.enabled" },
  { value: "disabled", labelKey: "provider.custom.models.variants.thinking.disabled" },
  { value: "adaptive", labelKey: "provider.custom.models.variants.thinking.adaptive" },
]

const SPLIT_REASONING_OPTIONS: SelectOption<SplitReasoningValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: true, labelKey: "provider.custom.models.variants.splitReasoning.true" },
  { value: false, labelKey: "provider.custom.models.variants.splitReasoning.false" },
]

const CHAT_TEMPLATE_ARGS_OPTIONS: SelectOption<ChatTemplateArgsValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: true, labelKey: "provider.custom.models.variants.chatTemplateArgs.true" },
  { value: false, labelKey: "provider.custom.models.variants.chatTemplateArgs.false" },
]

const REASONING_EFFORT_OPTIONS: SelectOption<ReasoningEffortValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: "none", labelKey: "provider.custom.models.variants.reasoningEffort.none" },
  { value: "minimal", labelKey: "provider.custom.models.variants.reasoningEffort.minimal" },
  { value: "low", labelKey: "provider.custom.models.variants.reasoningEffort.low" },
  { value: "medium", labelKey: "provider.custom.models.variants.reasoningEffort.medium" },
  { value: "high", labelKey: "provider.custom.models.variants.reasoningEffort.high" },
  { value: "xhigh", labelKey: "provider.custom.models.variants.reasoningEffort.xhigh" },
  { value: "max", labelKey: "provider.custom.models.variants.reasoningEffort.max" },
]

const OUTPUT_EFFORT_OPTIONS: SelectOption<OutputEffortValue>[] = [
  { value: undefined, labelKey: "provider.custom.models.variants.option.unset" },
  { value: "low", labelKey: "provider.custom.models.variants.outputEffort.low" },
  { value: "medium", labelKey: "provider.custom.models.variants.outputEffort.medium" },
  { value: "high", labelKey: "provider.custom.models.variants.outputEffort.high" },
  { value: "xhigh", labelKey: "provider.custom.models.variants.outputEffort.xhigh" },
  { value: "max", labelKey: "provider.custom.models.variants.outputEffort.max" },
]

function cost(value: string, save: (val: string) => void) {
  if (COST_INPUT.test(value)) save(value)
}

type ModelCardProps = {
  m: ModelEntry
  i: () => number
  errors: {
    id?: string
    name?: string
    contextLimit?: string
    outputLimit?: string
    inputCost?: string
    outputCost?: string
    cacheReadCost?: string
    cacheWriteCost?: string
    variants?: Array<{ name?: string }>
  }
  t: Translator
  canRemove: boolean
  variantNames?: string[]
  onChangeId: (val: string) => void
  onChangeName: (val: string) => void
  onChangeImage: (val: boolean) => void
  onChangeContextLimit: (val: string) => void
  onChangeOutputLimit: (val: string) => void
  onChangeCostEnabled: (val: boolean) => void
  onChangeInputCost: (val: string) => void
  onChangeOutputCost: (val: string) => void
  onChangeCacheReadCost: (val: string) => void
  onChangeCacheWriteCost: (val: string) => void
  onChangeReasoning: (val: boolean) => void
  onSelectVariant: (val: string) => void
  onAddVariant: () => void
  onRemoveVariant: (vi: number) => void
  onChangeVariantName: (vi: number, val: string) => void
  onChangeEnableThinking: (vi: number, val: EnableThinkingValue) => void
  onChangeThinking: (vi: number, val: ThinkingTypeValue) => void
  onChangeSplitReasoning: (vi: number, val: SplitReasoningValue) => void
  onChangeReasoningEffort: (vi: number, val: ReasoningEffortValue) => void
  onChangeOutputEffort: (vi: number, val: OutputEffortValue) => void
  onChangeChatTemplateArgs: (vi: number, val: ChatTemplateArgsValue) => void
  onRemove: () => void
}

type VariantRowProps = {
  v: VariantEntry
  vi: () => number
  error: { name?: string } | undefined
  t: Translator
  onChangeName: (val: string) => void
  onChangeEnableThinking: (val: EnableThinkingValue) => void
  onChangeThinking: (val: ThinkingTypeValue) => void
  onChangeSplitReasoning: (val: SplitReasoningValue) => void
  onChangeReasoningEffort: (val: ReasoningEffortValue) => void
  onChangeOutputEffort: (val: OutputEffortValue) => void
  onChangeChatTemplateArgs: (val: ChatTemplateArgsValue) => void
  onRemove: () => void
}

function format(item: string) {
  return item.charAt(0).toUpperCase() + item.slice(1)
}

function item(label: string, child: JSX.Element) {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "4px", flex: "1 1 120px", "min-width": "120px" }}>
      <label style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}>
        {label}
      </label>
      {child}
    </div>
  )
}

function VariantRow(props: VariantRowProps) {
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
      <div style={{ display: "flex", gap: "8px", "align-items": "flex-end" }}>
        <div style={{ flex: 1 }}>
          <TextField
            label={props.t("provider.custom.models.variants.name.label")}
            placeholder={props.t("provider.custom.models.variants.name.placeholder")}
            value={props.v.name}
            onChange={props.onChangeName}
            validationState={props.error?.name ? "invalid" : undefined}
            error={props.error?.name}
          />
        </div>
        <IconButton
          type="button"
          icon="trash"
          variant="ghost"
          onClick={props.onRemove}
          aria-label={props.t("provider.custom.models.variants.remove")}
          style={{ "margin-bottom": "4px" }}
        />
      </div>
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
        {item(
          props.t("provider.custom.models.variants.enableThinking.label"),
          <Select
            options={ENABLE_THINKING_OPTIONS}
            current={ENABLE_THINKING_OPTIONS.find((o) => o.value === props.v.enableThinking)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeEnableThinking(o?.value)}
            placeholder={props.t("provider.custom.models.variants.enableThinking.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />,
        )}
        {item(
          props.t("provider.custom.models.variants.thinking.label"),
          <Select
            options={THINKING_OPTIONS}
            current={THINKING_OPTIONS.find((o) => o.value === props.v.thinking)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeThinking(o?.value)}
            placeholder={props.t("provider.custom.models.variants.thinking.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />,
        )}
        {item(
          props.t("provider.custom.models.variants.splitReasoning.label"),
          <Select
            options={SPLIT_REASONING_OPTIONS}
            current={SPLIT_REASONING_OPTIONS.find((o) => o.value === props.v.splitReasoning)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeSplitReasoning(o?.value)}
            placeholder={props.t("provider.custom.models.variants.splitReasoning.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />,
        )}
        {item(
          props.t("provider.custom.models.variants.reasoningEffort.label"),
          <Select
            options={REASONING_EFFORT_OPTIONS}
            current={REASONING_EFFORT_OPTIONS.find((o) => o.value === props.v.reasoningEffort)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeReasoningEffort(o?.value)}
            placeholder={props.t("provider.custom.models.variants.reasoningEffort.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />,
        )}
        {item(
          props.t("provider.custom.models.variants.outputEffort.label"),
          <Select
            options={OUTPUT_EFFORT_OPTIONS}
            current={OUTPUT_EFFORT_OPTIONS.find((o) => o.value === props.v.outputEffort)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeOutputEffort(o?.value)}
            placeholder={props.t("provider.custom.models.variants.outputEffort.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />,
        )}
        {item(
          props.t("provider.custom.models.variants.chatTemplateArgs.label"),
          <Select
            options={CHAT_TEMPLATE_ARGS_OPTIONS}
            current={CHAT_TEMPLATE_ARGS_OPTIONS.find((o) => o.value === props.v.chatTemplateArgs)}
            value={(o) => String(o.value)}
            label={(o) => props.t(o.labelKey)}
            onSelect={(o) => props.onChangeChatTemplateArgs(o?.value)}
            placeholder={props.t("provider.custom.models.variants.chatTemplateArgs.placeholder")}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />,
        )}
      </div>
    </div>
  )
}

export function ModelCard(props: ModelCardProps) {
  const [open, setOpen] = createSignal(false)
  const opts = createMemo(() =>
    (props.variantNames ?? props.m.variants.map((item) => item.name))
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ value: item })),
  )

  const current = createMemo(() => opts()[0])
  const bad = createMemo(() => props.errors.variants?.some((item) => !!item?.name) ?? false)
  const expanded = () => open() || bad()
  const label = () => {
    if (props.m.variants.length === 0) return props.t("provider.custom.models.variants.add")
    return `${props.t("provider.custom.models.variants.label")} (${props.m.variants.length})`
  }

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
      {/* 模型 ID、名称和移除按钮 */}
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

      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <div
          style={{
            display: "flex",
            "flex-wrap": "nowrap",
            "align-items": "center",
            gap: "16px",
          }}
        >
          <label
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
              flex: "0 0 auto",
              cursor: "pointer",
              "font-size": "var(--kilo-font-size-13)",
              color: "var(--vscode-foreground)",
            }}
          >
            <input
              type="checkbox"
              checked={props.m.image}
              onChange={(e) => props.onChangeImage(e.currentTarget.checked)}
            />
            {props.t("provider.custom.models.image.label")}
          </label>
          <label
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
              flex: "0 0 auto",
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
                <Select<VariantOption>
                  options={opts()}
                  current={current()}
                  value={(o) => o.value}
                  label={(o) => format(o.value)}
                  onSelect={(o) => o && props.onSelectVariant(o.value)}
                  placeholder={props.t("provider.custom.models.variants.reasoningEffort.placeholder")}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </div>
            </div>
          </Show>
        </div>
        <Show when={props.m.reasoning}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <button
              type="button"
              onClick={() => {
                if (props.m.variants.length === 0) {
                  props.onAddVariant()
                  setOpen(true)
                  return
                }
                setOpen((value) => !value)
              }}
              aria-expanded={expanded()}
              style={{
                "align-self": "flex-start",
                border: "none",
                background: "transparent",
                color: "var(--vscode-textLink-foreground)",
                cursor: "pointer",
                padding: "0",
                "font-size": "var(--kilo-font-size-13)",
              }}
            >
              {label()}
            </button>
            <Show when={expanded()}>
              <For each={props.m.variants}>
                {(v, vi) => (
                  <VariantRow
                    v={v}
                    vi={vi}
                    error={props.errors.variants?.[vi()]}
                    t={props.t}
                    onChangeName={(val) => props.onChangeVariantName(vi(), val)}
                    onChangeEnableThinking={(val) => props.onChangeEnableThinking(vi(), val)}
                    onChangeThinking={(val) => props.onChangeThinking(vi(), val)}
                    onChangeSplitReasoning={(val) => props.onChangeSplitReasoning(vi(), val)}
                    onChangeReasoningEffort={(val) => props.onChangeReasoningEffort(vi(), val)}
                    onChangeOutputEffort={(val) => props.onChangeOutputEffort(vi(), val)}
                    onChangeChatTemplateArgs={(val) => props.onChangeChatTemplateArgs(vi(), val)}
                    onRemove={() => props.onRemoveVariant(vi())}
                  />
                )}
              </For>
              <button
                type="button"
                onClick={props.onAddVariant}
                style={{
                  "align-self": "flex-start",
                  border: "none",
                  background: "transparent",
                  color: "var(--vscode-textLink-foreground)",
                  cursor: "pointer",
                  padding: "0",
                  "font-size": "var(--kilo-font-size-13)",
                }}
              >
                {props.t("provider.custom.models.variants.add")}
              </button>
            </Show>
          </div>
        </Show>
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
      </div>

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

    </div>
  )
}
