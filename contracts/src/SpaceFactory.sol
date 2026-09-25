// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IEnsPermissionAdapter} from "./EnsPermissionAdapter.sol";
import {SpaceAccount} from "./SpaceAccount.sol";

contract SpaceFactory {
    event SpaceCreated(address indexed owner, address indexed space, address token, address authorizer);

    function createSpace(address authorizer, IERC20 token, IEnsPermissionAdapter ensAdapter)
        external
        returns (SpaceAccount space)
    {
        space = new SpaceAccount(msg.sender, authorizer, token, ensAdapter);
        emit SpaceCreated(msg.sender, address(space), address(token), authorizer);
    }
}
