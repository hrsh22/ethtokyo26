// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IEnsPermissionAdapter} from "./EnsPermissionAdapter.sol";
import {SpaceFactory} from "./SpaceFactory.sol";
import {SpaceAccount} from "./SpaceAccount.sol";
import {SpaceNamespace} from "./SpaceNamespace.sol";

contract NamedSpaceFactory is SpaceFactory {
    SpaceNamespace public immutable namespace;
    constructor(address forwarder, SpaceNamespace namespace_) SpaceFactory(forwarder) { namespace = namespace_; }

    /// @notice The Space, registry, resolver and ENS binding either all exist or all revert.
    function createNamedSpace(address authorizer, IERC20 token, string calldata name) external returns (SpaceAccount space) {
        address owner = _msgSender();
        space = new SpaceAccount(owner, authorizer, token, IEnsPermissionAdapter(address(namespace.adapter())), trustedForwarder());
        namespace.createNamespace(address(space), owner, name);
        emit SpaceCreated(owner, address(space), address(token), authorizer);
    }
}
