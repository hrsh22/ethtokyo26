// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Local integration fixture for viem's Universal Resolver call. Never deployed
// by production scripts; registry ownership is deliberately independent.
contract MockRecipientResolver {
    mapping(bytes32 => address) public recipients;

    function setAddress(bytes32 node, address recipient) external { recipients[node] = recipient; }

    function resolveWithGateways(bytes calldata, bytes calldata data, string[] calldata)
        external view returns (bytes memory, address)
    {
        require(bytes4(data[:4]) == bytes4(keccak256("addr(bytes32)")), "Unexpected record");
        bytes32 node = abi.decode(data[4:], (bytes32));
        return (abi.encode(recipients[node]), address(this));
    }
}
