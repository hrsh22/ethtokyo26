// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEnsPermissionAdapter, IEnsV2Registry} from "./EnsPermissionAdapter.sol";

interface IEnsSubregistry {
    function getSubregistry(string calldata label) external view returns (address);
}

/// @notice Pins each managed registry to its live parent registration. The registrar
/// can add bindings, but cannot replace a binding to rescue revoked registrations.
contract HierarchicalEnsPermissionAdapter is IEnsPermissionAdapter {
    address public immutable rootRegistry;
    address public immutable registrar;

    struct Parent {
        address registry;
        address owner;
        uint256 nameId;
        uint256 resource;
        string label;
    }
    mapping(address => Parent) public parents;
    event NamespaceBound(address indexed registry, address indexed parent, string label);
    error InvalidNamespace();

    constructor(address root, address operator) {
        if (root.code.length == 0 || operator == address(0)) revert InvalidNamespace();
        rootRegistry = root;
        registrar = operator;
    }

    function bindNamespace(address registry, address parent, string calldata label) external {
        if (msg.sender != registrar || registry.code.length == 0 || registry == rootRegistry
            || parents[registry].registry != address(0) || bytes(label).length == 0
            || (parent != rootRegistry && !_validHierarchy(parent))) revert InvalidNamespace();
        uint256 nameId = uint256(keccak256(bytes(label)));
        IEnsV2Registry.State memory state = IEnsV2Registry(parent).getState(nameId);
        if (!_valid(state, state.resource, state.latestOwner)
            || IEnsSubregistry(parent).getSubregistry(label) != registry) revert InvalidNamespace();
        parents[registry] = Parent(parent, state.latestOwner, nameId, state.resource, label);
        if (!_validHierarchy(registry)) revert InvalidNamespace();
        emit NamespaceBound(registry, parent, label);
    }

    function isAuthorized(address registry, uint256 nameId, uint256 expectedResource, address actor)
        external view returns (bool)
    {
        // Agent identities must be in a managed child registry, never arbitrary roots.
        if (registry == rootRegistry || !_validHierarchy(registry)) return false;
        try IEnsV2Registry(registry).getState(nameId) returns (IEnsV2Registry.State memory state) {
            return _valid(state, expectedResource, actor);
        } catch { return false; }
    }

    function namespaceActive(address registry) external view returns (bool) {
        return _validHierarchy(registry);
    }

    function _validHierarchy(address registry) private view returns (bool) {
        for (uint256 depth; depth < 8; depth++) {
            if (registry == rootRegistry) return true;
            Parent storage parent = parents[registry];
            if (parent.registry == address(0)) return false;
            try IEnsV2Registry(parent.registry).getState(parent.nameId) returns (IEnsV2Registry.State memory state) {
                if (!_valid(state, parent.resource, parent.owner)) return false;
            } catch { return false; }
            try IEnsSubregistry(parent.registry).getSubregistry(parent.label) returns (address child) {
                if (child != registry) return false;
            } catch { return false; }
            registry = parent.registry;
        }
        return false;
    }

    function _valid(IEnsV2Registry.State memory state, uint256 resource, address owner) private view returns (bool) {
        return resource != 0 && owner != address(0) && state.status == IEnsV2Registry.Status.REGISTERED
            && state.expiry > block.timestamp && state.resource == resource && state.latestOwner == owner;
    }
}
