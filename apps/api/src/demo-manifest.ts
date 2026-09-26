// Explicitly published demo records only. Never select the newest user's data.
// These identifiers and transactions are documented in agent-toolkit-live-evidence.md.
export const demoManifest = {
  spaceAddress: "0x7ba799558ce5B5Dd0bA260aE47f6106de359ad0F",
  spaceName: "Tokyo Team", allocationId: "2",
  agent: "0x43FA83BF16F0C70acD2861D82FB05863F9676Ac8",
  agentName: "toolkit-research.tokyo-team-7ba79955.accordspaces26.eth",
  owner: "0xFa8AFC5EAD8b6CA65b90294aC75be9c9946cF2fd",
  token: "0x06729AbBE1B9683eA3d5adDd151C15C93bE2A0a4",
  seller: "0xA4f6d0abDD38F1C622403e985Ba4E3e3b604b624",
  adapter: "0x6462eCB827CE2596b7F926664166C25819813eaf",
  registry: "0xD3288EC3076102c8BbCECCC3d85F95523f711F49",
  nameId: "110590561626249838558893857974284378351670816140726820435044816180678893952881",
  resource: "110590561626249838558893857974284378351670816140726820435044816180676728455168",
  approved: { quoteId: "3cc0a05e-a2b5-4e8c-b27f-c38f53ecdf6a", tx: "0xe3e318cfa404a68bdcc733334d91d30ed4c6bb7fa31d30d0af3f79fb5245c2aa" },
  denied: { quoteId: "0e2d68d0-133d-496d-92cc-5d4d3f28fdd4" },
  revoked: { quoteId: "77690359-7a40-491e-9d1c-f6bad4d62b93", tx: "0xe7157f384c84f340a3e88012ff308aae84ec936d2272f353adfb07389ae550b6" },
} as const;
