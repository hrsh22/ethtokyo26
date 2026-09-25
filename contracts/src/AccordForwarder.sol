// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @notice Signature-verifying forwarder for sponsored Sepolia transactions.
contract AccordForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("AccordForwarder") {}
}
