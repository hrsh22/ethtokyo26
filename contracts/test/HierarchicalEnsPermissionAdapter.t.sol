// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DemoToken, MockEnsV2Registry, Vm} from "./SpaceAccount.t.sol";
import {HierarchicalEnsPermissionAdapter} from "../src/HierarchicalEnsPermissionAdapter.sol";
import {IEnsV2Registry} from "../src/EnsPermissionAdapter.sol";
import {SpaceAccount} from "../src/SpaceAccount.sol";

contract HierarchyRegistry is MockEnsV2Registry {
    mapping(string => address) public children;
    function setChild(string calldata label, address child) external { children[label] = child; }
    function getSubregistry(string calldata label) external view returns (address) { return children[label]; }
}

contract HierarchicalEnsPermissionAdapterTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    HierarchyRegistry private root;
    HierarchyRegistry private parent;
    HierarchyRegistry private leaf;
    HierarchicalEnsPermissionAdapter private adapter;
    DemoToken private token;
    SpaceAccount private space;
    address private agent;
    address private seller;
    uint256 private nonce;
    uint256 private constant KEY = 0xB0B;
    uint256 private constant NAME = uint256(keccak256("research"));
    uint256 private constant PARENT = uint256(keccak256("accord"));
    uint256 private constant TEAM = uint256(keccak256("team"));

    function setUp() public {
        vm.warp(1000);
        root = new HierarchyRegistry(); parent = new HierarchyRegistry(); leaf = new HierarchyRegistry();
        adapter = new HierarchicalEnsPermissionAdapter(address(root), address(this));
        agent = vm.addr(100); seller = vm.addr(101);
        root.setState(PARENT, IEnsV2Registry.Status.REGISTERED, address(this), 100000, 1);
        root.setChild("accord", address(parent)); adapter.bindNamespace(address(parent), address(root), "accord");
        parent.setState(TEAM, IEnsV2Registry.Status.REGISTERED, address(this), 100000, 2);
        parent.setChild("team", address(leaf)); adapter.bindNamespace(address(leaf), address(parent), "team");
        leaf.setState(NAME, IEnsV2Registry.Status.REGISTERED, agent, 100000, 3);
        token = new DemoToken(); token.mint(address(this), 1000);
        space = new SpaceAccount(address(this), vm.addr(KEY), token, adapter, address(0));
        token.approve(address(space), 1000);
        SpaceAccount.Permit memory create = permit(address(this), SpaceAccount.Action.CreateAllocation, address(0), 100, keccak256(abi.encode(uint256(100), SpaceAccount.Period.None)));
        space.createAllocation(address(0), 100, 100, SpaceAccount.Period.None, create, sign(create));
        SpaceAccount.MandateConfig memory config = SpaceAccount.MandateConfig(agent, address(leaf), NAME, 3, 100, 50, 100000);
        SpaceAccount.Permit memory grant = permit(address(this), SpaceAccount.Action.SetMandate, agent, 0,
            keccak256(abi.encode(config.registry, config.nameId, config.expectedResource, config.dailyCap, config.maxPerPayment, config.expiry)));
        space.setMandate(1, config, grant, sign(grant));
    }
    function permit(address actor, SpaceAccount.Action action, address to, uint256 amount, bytes32 details) private returns (SpaceAccount.Permit memory) {
        ++nonce;
        return SpaceAccount.Permit(actor, action, 1, to, amount, bytes32(nonce), nonce, 90000, space.policyVersion(), details);
    }
    function sign(SpaceAccount.Permit memory p) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, space.hashPermit(p)); return abi.encodePacked(r,s,v);
    }
    function testLiveHierarchyAllowsPaymentOnce() public {
        SpaceAccount.Permit memory p = permit(agent, SpaceAccount.Action.Pay, seller, 20, 0);
        bytes memory signature = sign(p);
        vm.prank(agent); space.pay(1, seller, 20, p, signature);
        require(token.balanceOf(seller)==20);
        vm.expectRevert(SpaceAccount.RequestConsumed.selector); vm.prank(agent); space.pay(1, seller, 20, p, signature);
    }
    function testRevokingLeafBlocksAlreadySignedPayment() public {
        SpaceAccount.Permit memory p = permit(agent, SpaceAccount.Action.Pay, seller, 20, 0);
        bytes memory signature = sign(p);
        leaf.setState(NAME, IEnsV2Registry.Status.AVAILABLE, address(0), 1000, 4);
        vm.expectRevert(SpaceAccount.InvalidEnsAuthority.selector); vm.prank(agent); space.pay(1, seller, 20, p, signature);
        require(token.balanceOf(seller)==0 && !space.consumedRequests(p.requestId));
    }
    function testReregisteredLeafCannotReuseOldApproval() public {
        leaf.setState(NAME, IEnsV2Registry.Status.REGISTERED, agent, 100000, 4);
        require(!adapter.isAuthorized(address(leaf), NAME, 3, agent));
    }
    function testParentExpiryBlocksCachedPayment() public {
        SpaceAccount.Permit memory p = permit(agent, SpaceAccount.Action.Pay, seller, 20, 0);
        bytes memory signature = sign(p);
        root.setState(PARENT, IEnsV2Registry.Status.REGISTERED, address(this), 1001, 1); vm.warp(1001);
        vm.expectRevert(SpaceAccount.InvalidEnsAuthority.selector); vm.prank(agent); space.pay(1, seller, 20, p, signature);
    }
    function testDetachedChildBlocksCachedPayment() public {
        SpaceAccount.Permit memory p = permit(agent, SpaceAccount.Action.Pay, seller, 20, 0);
        bytes memory signature = sign(p);
        parent.setChild("team", address(0));
        vm.expectRevert(SpaceAccount.InvalidEnsAuthority.selector); vm.prank(agent); space.pay(1, seller, 20, p, signature);
    }
    function testReassignedParentAndNewRegistrationBlockIdentity() public {
        root.setState(PARENT, IEnsV2Registry.Status.REGISTERED, seller, 100000, 1);
        require(!adapter.isAuthorized(address(leaf), NAME, 3, agent));
        root.setState(PARENT, IEnsV2Registry.Status.REGISTERED, address(this), 100000, 9);
        require(!adapter.isAuthorized(address(leaf), NAME, 3, agent));
        vm.expectRevert(HierarchicalEnsPermissionAdapter.InvalidNamespace.selector);
        adapter.bindNamespace(address(parent), address(root), "accord");
    }
    function testUnmanagedRegistryAndRootCannotAuthorizeAgents() public {
        root.setState(NAME, IEnsV2Registry.Status.REGISTERED, agent, 100000, 3);
        require(!adapter.isAuthorized(address(root), NAME, 3, agent));
        HierarchyRegistry other = new HierarchyRegistry(); other.setState(NAME, IEnsV2Registry.Status.REGISTERED, agent, 100000, 3);
        require(!adapter.isAuthorized(address(other), NAME, 3, agent));
        vm.expectRevert(HierarchicalEnsPermissionAdapter.InvalidNamespace.selector); vm.prank(agent);
        adapter.bindNamespace(address(other), address(root), "accord");
    }
    function testAgentFundingCannotBypassPermit() public {
        vm.expectRevert(SpaceAccount.InvalidAllocation.selector); space.fundAllocation(1, 10);
        SpaceAccount.Permit memory p = permit(address(this), SpaceAccount.Action.FundAgentAllocation, address(this), 10, 0);
        bytes memory signature = sign(p);
        vm.expectRevert(SpaceAccount.InvalidPermit.selector); space.fundAgentAllocation(1, 11, p, signature);
        uint256 beforeVersion = space.policyVersion(); space.fundAgentAllocation(1, 10, p, signature);
        (,uint256 remaining,,,,,) = space.allocations(1);
        require(remaining==110 && space.policyVersion()==beforeVersion+1);
        vm.expectRevert(SpaceAccount.InvalidPermit.selector); space.fundAgentAllocation(1, 10, p, signature);
    }
}
