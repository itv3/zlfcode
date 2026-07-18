export * as ConfigProviderV1 from "./provider"

import { Schema } from "effect"
import { PROMPTS, AI_SDK_PROVIDERS } from "@kilocode/kilo-gateway" // kilocode_change
import { PositiveInt } from "../../schema"

export const ModelStatus = Schema.Literals(["alpha", "beta", "deprecated", "active"])

export const Model = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.Literals(PROMPTS)), // kilocode_change
  isFree: Schema.optional(Schema.Boolean), // kilocode_change
  ai_sdk_provider: Schema.optional(Schema.Literals(AI_SDK_PROVIDERS)), // kilocode_change
  release_date: Schema.optional(Schema.String),
  attachment: Schema.optional(Schema.Boolean),
  reasoning: Schema.optional(Schema.NullOr(Schema.Boolean)), // kilocode_change - allow null so reasoning can be removed via stripNulls on save
  temperature: Schema.optional(Schema.Boolean),
  tool_call: Schema.optional(Schema.Boolean),
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(
    // kilocode_change start - Plus: 允许 cost 字段使用 null 删除哨兵。
    Schema.NullOr(
      Schema.Struct({
        input: Schema.Finite,
        output: Schema.Finite,
        cache_read: Schema.optional(Schema.Finite),
        cache_write: Schema.optional(Schema.Finite),
        context_over_200k: Schema.optional(
          Schema.Struct({
            input: Schema.Finite,
            output: Schema.Finite,
            cache_read: Schema.optional(Schema.Finite),
            cache_write: Schema.optional(Schema.Finite),
          }),
        ),
      }),
    ),
    // kilocode_change end
  ),
  limit: Schema.optional(
    // kilocode_change start - Plus: 允许 limit 字段使用 null 删除哨兵。
    Schema.NullOr(
      Schema.Struct({
        context: Schema.Finite,
        input: Schema.optional(Schema.Finite),
        output: Schema.Finite,
      }),
    ),
    // kilocode_change end
  ),
  modalities: Schema.optional(
    // kilocode_change start - Plus: 允许 modalities 使用 null 删除哨兵。
    Schema.NullOr(
      Schema.Struct({
        input: Schema.optional(
          Schema.mutable(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"]))),
        ),
        output: Schema.optional(
          Schema.mutable(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"]))),
        ),
      }),
    ),
    // kilocode_change end
  ),
  experimental: Schema.optional(Schema.Boolean),
  status: Schema.optional(ModelStatus),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  variants: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.NullOr(
        // kilocode_change - allow null values so removed variants can be deleted via stripNulls on save
        Schema.StructWithRest(
          Schema.Struct({
            disabled: Schema.optional(Schema.Boolean).annotate({ description: "Disable this variant for the model" }),
          }),
          [Schema.Record(Schema.String, Schema.Any)],
        ),
      ),
    ).annotate({ description: "Variant-specific configuration" }),
  ),
})

export const Info = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  env: Schema.optional(Schema.NullOr(Schema.mutable(Schema.Array(Schema.String)))), // kilocode_change - allow null so env can be removed via stripNulls on save
  id: Schema.optional(Schema.String),
  npm: Schema.optional(Schema.String),
  whitelist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  blacklist: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  options: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        apiKey: Schema.optional(Schema.String),
        baseURL: Schema.optional(Schema.String),
        enterpriseUrl: Schema.optional(Schema.String).annotate({
          description: "GitHub Enterprise URL for copilot authentication",
        }),
        setCacheKey: Schema.optional(Schema.Boolean).annotate({
          description: "Enable promptCacheKey for this provider (default false)",
        }),
        timeout: Schema.optional(
          Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
            description: "Timeout in milliseconds for full requests to this provider. Set to false to disable timeout.",
          }),
        ).annotate({
          description: "Timeout in milliseconds for full requests to this provider. Set to false to disable timeout.",
        }),
        headerTimeout: Schema.optional(
          Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
            description:
              "Timeout in milliseconds to wait for response headers. Provider integrations may set defaults. Set to false to disable timeout.",
          }),
        ).annotate({
          description:
            "Timeout in milliseconds to wait for response headers. Provider integrations may set defaults. Set to false to disable timeout.",
        }),
        chunkTimeout: Schema.optional(PositiveInt).annotate({
          description:
            "Timeout in milliseconds between streamed SSE chunks for this provider. If no chunk arrives within this window, the request is aborted.",
        }),
      }),
      [Schema.Record(Schema.String, Schema.Any)],
    ),
  ),
  models: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Model))), // kilocode_change - allow null values so removed models can be deleted via stripNulls on save
}).annotate({ identifier: "ProviderConfig" })
export type Info = Schema.Schema.Type<typeof Info>
