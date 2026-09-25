// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// @notice Valueless Sepolia test asset. Anyone may mint 1,000 units to a wallet.
contract AccordTestUSDC is ERC20, ERC2771Context {
    uint256 public constant FAUCET_AMOUNT = 1_000 * 1e6;

    constructor(address forwarder) ERC20("Test USD Coin", "tUSDC") ERC2771Context(forwarder) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucetTo(address recipient) external {
        _mint(recipient, FAUCET_AMOUNT);
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
