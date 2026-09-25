// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IEnsPermissionAdapter} from "./EnsPermissionAdapter.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {SpaceAccount} from "./SpaceAccount.sol";

contract SpaceFactory is ERC2771Context {
    constructor(address forwarder) ERC2771Context(forwarder) {}

    event SpaceCreated(address indexed owner, address indexed space, address token, address authorizer);

    function createSpace(address authorizer, IERC20 token, IEnsPermissionAdapter ensAdapter)
        external
        returns (SpaceAccount space)
    {
        address owner = _msgSender();
        space = new SpaceAccount(owner, authorizer, token, ensAdapter, trustedForwarder());
        emit SpaceCreated(owner, address(space), address(token), authorizer);
    }
}
