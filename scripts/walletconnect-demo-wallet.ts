import { createInterface } from "node:readline/promises";

import { WalletKit } from "@reown/walletkit";
import type { WalletKitTypes } from "@reown/walletkit";
import { Core } from "@walletconnect/core";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import { isHex } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 11155111;
const CAIP_CHAIN = `eip155:${CHAIN_ID}`;
const APPROVED_METHODS = ["personal_sign"];
const APPROVED_EVENTS: string[] = [];
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const WALLETCONNECT_URI_PATTERN = /^wc:[^\s]+$/;

const fail = (message: string): never => {
  throw new Error(message);
};

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  return value || fail(`${name} is required`);
};

const redactSensitiveText = (value: unknown): string => {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/wc:[^\s]+/gi, "[redacted WalletConnect URI]")
    .replace(/0x[0-9a-fA-F]{64}/g, "[redacted secret]");
};

const normalizePairingUri = (value: string): string => {
  const uri = value.trim();
  if (!WALLETCONNECT_URI_PATTERN.test(uri)) {
    return fail("WalletConnect input must be one pairing URI");
  }

  const query = uri.includes("?") ? uri.slice(uri.indexOf("?") + 1) : "";
  const expiry = new URLSearchParams(query).get("expiryTimestamp");
  if (expiry !== null) {
    if (!/^\d+$/.test(expiry)) {
      return fail("WalletConnect pairing URI has an invalid expiry");
    }
    const expirySeconds = Number(expiry);
    if (!Number.isSafeInteger(expirySeconds)) {
      return fail("WalletConnect pairing URI has an invalid expiry");
    }
    if (expirySeconds <= Math.floor(Date.now() / 1_000)) {
      return fail("WalletConnect pairing URI has expired");
    }
  }

  return uri;
};

const readPairingUri = async (): Promise<string> => {
  const configured = process.env.WALLETCONNECT_URI?.trim();
  if (configured) return normalizePairingUri(configured);

  if (process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return normalizePairingUri(
        await prompt.question("Paste the WalletConnect URI, then press Enter: "),
      );
    } finally {
      prompt.close();
    }
  }

  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  return normalizePairingUri(input);
};

const allowedAccordMetadata = (metadata: {
  readonly name: string;
  readonly url: string;
}): boolean => {
  if (!/^Accord(?:\b|\s|\p{Pd})/u.test(metadata.name.trim())) return false;

  try {
    const url = new URL(metadata.url);
    return (
      url.protocol === "http:" &&
      url.hostname === "localhost" &&
      url.port === "3000"
    );
  } catch {
    return false;
  }
};

const proposalChains = (proposal: {
  readonly requiredNamespaces?: Record<string, { readonly chains?: string[] }>;
  readonly optionalNamespaces?: Record<string, { readonly chains?: string[] }>;
}): string[] =>
  [
    ...Object.entries(proposal.requiredNamespaces ?? {}),
    ...Object.entries(proposal.optionalNamespaces ?? {}),
  ].flatMap(([namespace, value]) => {
    const namespaceChain = namespace.includes(":") ? namespace : undefined;
    return [...(namespaceChain ? [namespaceChain] : []), ...(value.chains ?? [])];
  });

const proposalNamespacesAreAllowed = (proposal: {
  readonly requiredNamespaces?: Record<string, unknown>;
  readonly optionalNamespaces?: Record<string, unknown>;
}): boolean =>
  [
    ...Object.keys(proposal.requiredNamespaces ?? {}),
    ...Object.keys(proposal.optionalNamespaces ?? {}),
  ].every(
    (namespace) => namespace === "eip155" || namespace === CAIP_CHAIN,
  );

const requiredMethodsAreAllowed = (proposal: {
  readonly requiredNamespaces?: Record<
    string,
    { readonly methods?: readonly string[] }
  >;
}): boolean =>
  Object.values(proposal.requiredNamespaces ?? {}).every((namespace) =>
    (namespace.methods ?? []).every((method) => method === "personal_sign"),
  );

const sameAddress = (left: unknown, right: string): boolean =>
  typeof left === "string" && left.toLowerCase() === right.toLowerCase();

const personalSignMessage = (
  params: unknown,
  address: string,
): string | { readonly raw: Hex } => {
  if (!Array.isArray(params) || params.length !== 2) {
    return fail("personal_sign requires exactly a message and account");
  }

  const [first, second] = params;
  const message = sameAddress(first, address) ? second : first;
  const requestedAccount = sameAddress(first, address) ? first : second;
  if (!sameAddress(requestedAccount, address) || typeof message !== "string") {
    return fail("personal_sign account does not match the demo human wallet");
  }

  return isHex(message) ? { raw: message as Hex } : message;
};

const main = async (): Promise<void> => {
  const projectId = requiredEnvironment("NEXT_PUBLIC_REOWN_PROJECT_ID");
  const privateKey = requiredEnvironment("DEMO_HUMAN_PRIVATE_KEY");
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    fail("DEMO_HUMAN_PRIVATE_KEY must be a 32-byte 0x-prefixed hex value");
  }

  const account = privateKeyToAccount(privateKey as Hex);
  console.log(`Accord demo human wallet: ${account.address}`);
  console.log(`Allowed chain: Ethereum Sepolia (${CHAIN_ID})`);
  console.log("Allowed method: personal_sign");

  if (process.argv.includes("--check")) {
    console.log("Wallet configuration is valid.");
    return;
  }

  const pairingUri = await readPairingUri();
  const caipAccount = `${CAIP_CHAIN}:${account.address}`;
  const core = new Core({
    customStoragePrefix: `accord-demo-wallet-${account.address.toLowerCase()}-${Date.now()}`,
    projectId,
    telemetryEnabled: false,
  });
  const wallet = await WalletKit.init({
    core: core as unknown as WalletKitTypes.Options["core"],
    metadata: {
      name: "Accord demo human wallet",
      description: "Headless WalletConnect signer for the Accord local demo",
      url: "http://localhost:3000",
      icons: [],
    },
  });
  const approvedTopics = new Set<string>();

  wallet.on("session_proposal", async (event) => {
    const proposal = event.params;
    const metadata = proposal.proposer.metadata;
    const chains = proposalChains(proposal);
    const allowed =
      allowedAccordMetadata(metadata) &&
      proposalNamespacesAreAllowed(proposal) &&
      requiredMethodsAreAllowed(proposal) &&
      chains.length > 0 &&
      chains.every((chain) => chain === CAIP_CHAIN);

    if (!allowed) {
      await wallet.rejectSession({
        id: event.id,
        reason: getSdkError("USER_REJECTED"),
      });
      console.error(
        "Rejected WalletConnect proposal: expected Accord at http://localhost:3000 on Ethereum Sepolia.",
      );
      return;
    }

    try {
      const namespaces = buildApprovedNamespaces({
        proposal,
        supportedNamespaces: {
          eip155: {
            accounts: [caipAccount],
            chains: [CAIP_CHAIN],
            events: APPROVED_EVENTS,
            methods: APPROVED_METHODS,
          },
        },
      });
      const session = await wallet.approveSession({
        id: event.id,
        namespaces,
      });
      approvedTopics.add(session.topic);
      console.log("WalletConnect session approved for Accord localhost.");
    } catch (error) {
      console.error(
        `Could not approve WalletConnect session: ${redactSensitiveText(error)}`,
      );
    }
  });

  wallet.on("session_request", async (event) => {
    const { method, params } = event.params.request;
    let response:
      | { id: number; jsonrpc: "2.0"; result: unknown }
      | {
          id: number;
          jsonrpc: "2.0";
          error: { code: number; message: string };
        };

    try {
      if (!approvedTopics.has(event.topic)) {
        fail("Session was not approved by the Accord wallet policy");
      }
      if (event.params.chainId !== CAIP_CHAIN) {
        fail("Only Ethereum Sepolia requests are allowed");
      }
      if (method !== "personal_sign") {
        fail("Only personal_sign is allowed");
      }

      const message = personalSignMessage(params, account.address);
      const signature = await account.signMessage({ message });
      response = { id: event.id, jsonrpc: "2.0", result: signature };
      console.log("Signed one Accord personal_sign request.");
    } catch (error) {
      const message = redactSensitiveText(error);
      response = {
        id: event.id,
        jsonrpc: "2.0",
        error: { code: 4200, message },
      };
      console.error(`Rejected WalletConnect request ${method}: ${message}`);
    }

    await wallet.respondSessionRequest({ topic: event.topic, response });
  });

  wallet.on("session_delete", (event) => {
    approvedTopics.delete(event.topic);
    console.log("WalletConnect session disconnected.");
  });

  console.log("Pairing with the Accord browser session…");
  await wallet.pair({ uri: pairingUri });
  console.log("Pairing request sent; waiting for Accord session approval…");
  await new Promise<never>(() => undefined);
};

main().catch((error: unknown) => {
  console.error(`Accord demo wallet failed: ${redactSensitiveText(error)}`);
  process.exitCode = 1;
});
