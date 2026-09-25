import { AccordApi } from "@accord/api-contract";
import { HttpApiBuilder } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";
import { AuthLive } from "./auth";
import { AdminLive } from "./admin";
import { DatabaseLive } from "./db";
import { SpacesLive } from "./spaces";
import { PermitsLive } from "./permits";
import { WorldLive } from "./world";
import { EnsLive } from "./ens";
import { ResearchLive } from "./research";
import { ActivityLive } from "./activity";
import { SponsorLive } from "./sponsor";
import { adapterAddress, factoryAddress, permitSigner } from "./chain";
import { getAddress, isAddress } from "viem";

const StatusLive = HttpApiBuilder.group(AccordApi, "status", (handlers) =>
  handlers.handle("health", () =>
    Effect.succeed({ status: "ok" as const, chainId: 11155111 as const }),
  ).handle("config", () => Effect.sync(() => {
    try {
      const factory = factoryAddress();
      const adapter = adapterAddress();
      const authorizer = permitSigner().address;
      const demoToken = process.env.DEMO_TOKEN_ADDRESS;
      const forwarder = process.env.FORWARDER_ADDRESS;
      const demoSpace = process.env.NEXT_PUBLIC_DEMO_SPACE_ADDRESS;
      const registry = process.env.ENSV2_REGISTRY_ADDRESS;
      return {
        configured: true,
        factoryAddress: factory,
        adapterAddress: adapter,
        authorizerAddress: authorizer,
        ...(demoToken && isAddress(demoToken) ? { demoTokenAddress: getAddress(demoToken) } : {}),
        ...(forwarder && isAddress(forwarder) ? { forwarderAddress: getAddress(forwarder) } : {}),
        ...(demoSpace && isAddress(demoSpace) ? { demoSpaceAddress: getAddress(demoSpace) } : {}),
        ...(registry && isAddress(registry) ? { ensRegistryAddress: getAddress(registry) } : {}),
      };
    } catch { return { configured: false }; }
  })),
);

const CatalogLive = HttpApiBuilder.group(AccordApi, "catalog", (handlers) =>
  handlers.handle("list", () =>
    Effect.succeed({
      templates: [
        {
          id: "recurring-support" as const,
          mode: "people" as const,
          name: "Recurring support",
          description: "Reserve funds a person can claim on a schedule.",
        },
        {
          id: "research-budget" as const,
          mode: "agents" as const,
          name: "Research budget",
          description: "Let an agent make screened purchases within a mandate.",
        },
      ],
    }),
  ),
);

const ApiLive = HttpApiBuilder.api(AccordApi).pipe(
  Layer.provide(StatusLive),
  Layer.provide(CatalogLive),
  Layer.provide(EnsLive),
  Layer.provide(ResearchLive),
  Layer.provide(ActivityLive),
  Layer.provide(SponsorLive),
  Layer.provide(AuthLive),
  Layer.provide(AdminLive),
  Layer.provide(SpacesLive),
  Layer.provide(PermitsLive),
  Layer.provide(WorldLive),
);

const port = Number(process.env.API_PORT ?? "4000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("API_PORT must be an integer between 1 and 65535");
}

const ServerLive = HttpApiBuilder.serve().pipe(
  Layer.provide(ApiLive),
  Layer.provide(DatabaseLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port, ...(process.env.API_HOST ? { host: process.env.API_HOST } : {}) })),
);

Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
