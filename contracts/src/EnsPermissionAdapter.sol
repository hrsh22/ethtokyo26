// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev The relevant view from ENSv2 IPermissionedRegistry, checked against
/// https://github.com/ensdomains/contracts-v2/blob/main/contracts/src/registry/interfaces/IPermissionedRegistry.sol
interface IEnsV2Registry {
    enum Status {
        AVAILABLE,
        RESERVED,
        REGISTERED
    }

    struct State {
        Status status;
        uint64 expiry;
        address latestOwner;
        uint256 tokenId;
        uint256 resource;
    }

    function getState(uint256 anyId) external view returns (State memory);
}

interface IEnsPermissionAdapter {
    function isAuthorized(
        address registry,
        uint256 nameId,
        uint256 expectedResource,
        address actor
    ) external view returns (bool);
}

/// @notice Checks a particular live ENSv2 registration rather than a display name.
/// A different owner, expiry or re-registration invalidates an active mandate.
contract EnsPermissionAdapter is IEnsPermissionAdapter {
    function isAuthorized(
        address registry,
        uint256 nameId,
        uint256 expectedResource,
        address actor
    ) external view returns (bool) {
        if (registry.code.length == 0 || actor == address(0) || expectedResource == 0) {
            return false;
        }
        try IEnsV2Registry(registry).getState(nameId) returns (IEnsV2Registry.State memory state) {
            return state.status == IEnsV2Registry.Status.REGISTERED
                && state.expiry > block.timestamp && state.latestOwner == actor
                && state.resource == expectedResource;
        } catch {
            return false;
        }
    }
}
