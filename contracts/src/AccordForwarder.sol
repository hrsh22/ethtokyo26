// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Signature-verifying forwarder for sponsored Sepolia transactions.
contract AccordForwarder is ERC2771Forwarder {
    struct Call { address to; uint256 gas; bytes data; }
    bytes32 private constant CALL_TYPEHASH = keccak256("Call(address to,uint256 gas,bytes data)");
    bytes32 private constant BATCH_TYPEHASH = keccak256(
        "ForwardBatch(address from,Call[] calls,uint256 nonce,uint48 deadline)Call(address to,uint256 gas,bytes data)"
    );
    error InvalidBatch();
    error BatchCallFailed(uint256 index, bytes reason);
    event ExecutedForwardBatch(address indexed from, uint256 nonce, uint256 count);

    constructor() ERC2771Forwarder("AccordForwarder") {}

    function batchVersion() external pure returns (uint256) { return 1; }

    /// @notice One signature authorizes the exact ordered calls. All calls and the nonce roll back on failure.
    /// @dev Value transfers are intentionally unsupported. Shares nonces with single-call requests.
    function executeSignedBatch(address from, Call[] calldata calls, uint48 deadline, bytes calldata signature) external {
        if (calls.length == 0 || calls.length > 8) revert InvalidBatch();
        if (block.timestamp > deadline) revert ERC2771ForwarderExpiredRequest(deadline);
        uint256 nonce = nonces(from);
        address signer = ECDSA.recover(_batchDigest(from, calls, nonce, deadline), signature);
        if (signer != from) revert ERC2771ForwarderInvalidSigner(signer, from);
        _useNonce(from);
        for (uint256 i; i < calls.length; ++i) {
            Call calldata item = calls[i];
            if (!_isTrustedByTarget(item.to)) revert ERC2771UntrustfulTarget(item.to, address(this));
            (bool success, bytes memory reason) = item.to.call{gas: item.gas}(abi.encodePacked(item.data, from));
            if (!success) revert BatchCallFailed(i, reason);
        }
        emit ExecutedForwardBatch(from, nonce, calls.length);
    }

    function _batchDigest(address from, Call[] calldata calls, uint256 nonce, uint48 deadline) private view returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            hashes[i] = keccak256(abi.encode(CALL_TYPEHASH, calls[i].to, calls[i].gas, keccak256(calls[i].data)));
        }
        return _hashTypedDataV4(keccak256(abi.encode(
            BATCH_TYPEHASH, from, keccak256(abi.encodePacked(hashes)), nonce, deadline
        )));
    }
}
