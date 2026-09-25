import { HttpApiError } from "@effect/platform";
import { Effect } from "effect";

export function databaseOperation<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({
    try: operation,
    catch: () => new HttpApiError.ServiceUnavailable(),
  });
}
