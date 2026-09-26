export const forwardRequestTypes = {
  ForwardRequest: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

export const forwardBatchTypes = {
  Call: [{ name: "to", type: "address" }, { name: "gas", type: "uint256" }, { name: "data", type: "bytes" }],
  ForwardBatch: [{ name: "from", type: "address" }, { name: "calls", type: "Call[]" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }],
} as const;

export const agentRegistrationTypes = {
  AgentRegistration: [{ name: "registry", type: "address" }, { name: "requestId", type: "bytes32" },
    { name: "label", type: "string" }, { name: "agent", type: "address" },
    { name: "expiry", type: "uint64" }, { name: "deadline", type: "uint48" }],
} as const;
