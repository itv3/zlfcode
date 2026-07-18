import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const ProviderReadyPayload = Schema.Struct({
  providerID: ProviderV2.ID,
  modelIDs: Schema.Array(ModelV2.ID),
})

const ProviderReadyResponse = Schema.Struct({
  ready: Schema.Boolean,
  missing: Schema.Array(ModelV2.ID),
  unexpected: Schema.Array(ModelV2.ID),
})

export const ProviderReadyApi = HttpApi.make("provider-ready")
  .add(
    HttpApiGroup.make("provider-ready")
      .add(
        HttpApiEndpoint.post("check", "/provider/ready", {
          query: WorkspaceRoutingQuery,
          payload: ProviderReadyPayload,
          success: described(ProviderReadyResponse, "Provider 模型已就绪"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.ready",
            summary: "检查 Provider 模型",
            description: "等待当前工作区的 Provider 注册表完成加载，并返回仍不可用的模型。",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "provider-ready",
          description: "Kilo Provider 注册表就绪检查接口。",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "kilo HttpApi",
      version: "0.0.1",
      description: "Kilo HTTP API。",
    }),
  )
