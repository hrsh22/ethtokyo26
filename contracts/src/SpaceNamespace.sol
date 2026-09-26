// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HierarchicalEnsPermissionAdapter} from "./HierarchicalEnsPermissionAdapter.sol";
import {IEnsV2Registry} from "./EnsPermissionAdapter.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IProxyFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
}
interface IManagedRegistry {
    function initialize(address rootAccount, uint256 roles) external;
    function grantRootRoles(uint256 roles, address account) external returns (bool);
    function setParent(address parent, string calldata label) external;
    function register(string calldata label, address owner, address registry, address resolver, uint256 roles, uint64 expiry) external returns (uint256);
    function renew(uint256 nameId, uint64 expiry) external;
}
interface IManagedResolver {
    function initialize(address rootAccount, uint256 roles, bytes[] calldata records) external;
    function setAddr(bytes32 node, address value) external;
    function setText(bytes32 node, string calldata key, string calldata value) external;
}

/// @notice Atomic ENS provisioning. Issued name tokens receive no management or transfer roles.
contract SpaceNamespace is ERC2771Context, EIP712 {
    bytes32 private constant REGISTRATION_TYPEHASH = keccak256(
        "AgentRegistration(address registry,bytes32 requestId,string label,address agent,uint64 expiry,uint48 deadline)"
    );
    uint256 private constant ROOT_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111;
    address public immutable operator;
    address public immutable parent;
    bytes32 public immutable parentNode;
    IProxyFactory public immutable proxyFactory;
    address public immutable registryImplementation;
    address public immutable resolverImplementation;
    HierarchicalEnsPermissionAdapter public immutable adapter;
    address public factory;
    mapping(address space => address registry) public registries;
    mapping(address registry => bytes32 node) public nodes;
    error Unauthorized();
    error InvalidName();
    event NamespaceCreated(address indexed space, address registry, address resolver, string label);

    constructor(address operator_, address forwarder, address root, address parent_, string memory parentLabel,
        bytes32 parentNode_, address proxyFactory_, address registryImplementation_, address resolverImplementation_)
        ERC2771Context(forwarder) EIP712("AccordNamespace", "1") {
        operator = operator_;
        parent = parent_;
        parentNode = parentNode_;
        proxyFactory = IProxyFactory(proxyFactory_);
        registryImplementation = registryImplementation_;
        resolverImplementation = resolverImplementation_;
        adapter = new HierarchicalEnsPermissionAdapter(root, address(this));
        adapter.bindNamespace(parent_, root, parentLabel);
    }

    function setFactory(address value) external {
        if (msg.sender != operator || factory != address(0) || value.code.length == 0) revert Unauthorized();
        factory = value;
    }

    function createNamespace(address space, address owner, string calldata displayName) external returns (address registry) {
        if (msg.sender != factory || registries[space] != address(0)) revert Unauthorized();
        string memory label = labelFor(space, displayName);
        bytes32 node = keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
        registry = proxyFactory.deployProxy(registryImplementation, uint256(keccak256(abi.encode("namespace", space))),
            abi.encodeCall(IManagedRegistry.initialize, (address(this), ROOT_ROLES)));
        IManagedRegistry(registry).grantRootRoles(ROOT_ROLES, operator);
        IManagedRegistry(registry).setParent(parent, label);
        bytes[] memory records = new bytes[](2);
        records[0] = abi.encodeCall(IManagedResolver.setAddr, (node, space));
        records[1] = abi.encodeCall(IManagedResolver.setText, (node, "description", displayName));
        address resolver = proxyFactory.deployProxy(resolverImplementation, uint256(keccak256(abi.encode("space-resolver", space))),
            abi.encodeCall(IManagedResolver.initialize, (operator, ROOT_ROLES, records)));
        IManagedRegistry(parent).register(label, owner, registry, resolver, 0, uint64(block.timestamp + 365 days));
        adapter.bindNamespace(registry, parent, label);
        registries[space] = registry;
        nodes[registry] = node;
        emit NamespaceCreated(space, registry, resolver, label);
    }

    /// @notice Deploys the resolver and registers/renews an agent in one transaction.
    function provisionAgent(address registry, bytes32 requestId, string calldata label, address agent, uint64 expiry)
        external returns (uint256 resource) {
        if (msg.sender != operator) revert Unauthorized();
        return _provisionAgent(registry, requestId, label, agent, expiry);
    }

    /// @notice The registrar authorizes exact terms after World verification. A wallet can then
    /// atomically register the name and install its signed mandate through the gas sponsor.
    function provisionAgentAuthorized(address registry, bytes32 requestId, string calldata label, address agent,
        uint64 expiry, uint48 deadline, bytes calldata signature) external returns (uint256 resource) {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            REGISTRATION_TYPEHASH, registry, requestId, keccak256(bytes(label)), agent, expiry, deadline
        )));
        if (block.timestamp > deadline || ECDSA.recover(digest, signature) != operator) revert Unauthorized();
        return _provisionAgent(registry, requestId, label, agent, expiry);
    }

    function _provisionAgent(address registry, bytes32 requestId, string calldata label, address agent, uint64 expiry)
        private returns (uint256 resource) {
        if (nodes[registry] == bytes32(0) || !adapter.namespaceActive(registry)) revert Unauthorized();
        if (agent == address(0) || bytes(label).length == 0 || bytes(label).length > 32) revert InvalidName();
        for (uint256 i; i < bytes(label).length; ++i) {
            bytes1 c = bytes(label)[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || (i > 0 && c == "-"))) revert InvalidName();
        }
        uint256 nameId = uint256(keccak256(bytes(label)));
        IEnsV2Registry.State memory state = IEnsV2Registry(registry).getState(nameId);
        if (state.status == IEnsV2Registry.Status.REGISTERED) {
            if (state.latestOwner != agent) revert InvalidName();
            if (expiry > state.expiry) IManagedRegistry(registry).renew(nameId, expiry);
        } else {
            if (state.expiry != 0) revert InvalidName();
            bytes[] memory records = new bytes[](1);
            records[0] = abi.encodeCall(IManagedResolver.setAddr,
                (keccak256(abi.encodePacked(nodes[registry], bytes32(nameId))), agent));
            address resolver = proxyFactory.deployProxy(resolverImplementation, uint256(requestId),
                abi.encodeCall(IManagedResolver.initialize, (operator, ROOT_ROLES, records)));
            IManagedRegistry(registry).register(label, agent, address(0), resolver, 0, expiry);
        }
        return IEnsV2Registry(registry).getState(nameId).resource;
    }

    function labelFor(address space, string memory displayName) public pure returns (string memory) {
        bytes memory source = bytes(displayName);
        if (source.length < 2 || source.length > 320) revert InvalidName();
        bytes memory slug = new bytes(source.length);
        uint256 length;
        bool separator;
        for (uint256 i; i < source.length; ++i) {
            uint8 c = uint8(source[i]);
            if (c >= 65 && c <= 90) c += 32;
            if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
                if (separator && length > 0) slug[length++] = "-";
                slug[length++] = bytes1(c);
                separator = false;
            } else separator = true;
        }
        if (length == 0) { slug = bytes("space"); length = 5; }
        if (length > 18) length = 18;
        bytes memory output = new bytes(length + 9);
        for (uint256 i; i < length; ++i) output[i] = slug[i];
        output[length] = "-";
        bytes16 hexDigits = "0123456789abcdef";
        for (uint256 i; i < 8; ++i) output[length + 1 + i] = hexDigits[(uint160(space) >> (156 - i * 4)) & 15];
        return string(output);
    }
}
