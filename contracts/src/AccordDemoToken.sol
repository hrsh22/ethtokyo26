// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Valueless Sepolia demonstration asset; anyone can request test units.
contract AccordDemoToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;

    constructor() ERC20("Accord Demo", "ACD") {}

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
