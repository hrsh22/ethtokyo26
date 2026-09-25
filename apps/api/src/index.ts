import { HttpApiBuilder } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { createServer } from "node:http";
import { ApiLive } from "./app";
import { DatabaseLive } from "./db";

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
