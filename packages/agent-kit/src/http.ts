import { getAddress, type LocalAccount } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { AccordError } from "./types";

export const defaultApiUrl = "https://accord-api.hrsh.dev";
export const defaultWebOrigin = "https://accord.hrsh.dev";
export class AgentHttp {
  private token?: string;
  constructor(readonly apiUrl = defaultApiUrl, private signer?: LocalAccount, private connectionId?: string, private webOrigin = defaultWebOrigin) {
    const url = new URL(apiUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw new AccordError("insecure_endpoint", "Use HTTPS for the Accord API, or HTTP on localhost for development.");
    }
  }
  private async request<T>(path: string, payload?: unknown, authenticated = false): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl.replace(/\/$/, "")}${path}`, { method: payload === undefined ? "GET" : "POST",
        headers: { ...(payload === undefined ? {} : { "content-type": "application/json" }), ...(authenticated && this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(45_000), redirect: "error" });
    } catch { throw new AccordError("connection_unavailable", "The API response was interrupted. Resume the same operation; do not create a replacement purchase."); }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const decision = body.decision as { code?: string; reason?: string } | undefined;
      throw new AccordError(response.status === 401 ? "unauthorized" : String(body.code ?? decision?.code ?? body._tag ?? `http_${response.status}`),
        String(body.message ?? decision?.reason ?? (response.status === 403 ? "This connection is not permitted to perform that action." : "The API could not complete this action.")), body);
    }
    return body as T;
  }
  async authenticate() {
    if (!this.signer) throw new AccordError("signer_missing", "A local signer is required to connect.");
    const challenge = await this.request<{ id: string; message: string }>("/v1/auth/challenge", { address: this.signer.address });
    const parsed = parseSiweMessage(challenge.message);
    if (parsed.chainId !== 11155111 || parsed.domain !== new URL(this.webOrigin).host || parsed.uri !== this.webOrigin ||
      !parsed.address || getAddress(parsed.address) !== getAddress(this.signer.address)) throw new AccordError("challenge_mismatch", "The sign-in request does not match this signer, Sepolia and the configured Accord website.");
    const signature = await this.signer.signMessage({ message: challenge.message });
    const session = await this.request<{ token: string }>("/v1/auth/verify", { id: challenge.id, address: this.signer.address,
      signature, client: "agent", ...(this.connectionId ? { connectionId: this.connectionId } : {}) });
    this.token = session.token;
  }
  public<T>(path: string, payload?: unknown) { return this.request<T>(path, payload); }
  async call<T>(path: string, payload?: unknown): Promise<T> {
    if (!this.token) await this.authenticate();
    try { return await this.request<T>(path, payload, true); }
    catch (error) {
      if (!(error instanceof AccordError) || error.code !== "unauthorized") throw error;
      await this.authenticate(); return this.request<T>(path, payload, true);
    }
  }
}
