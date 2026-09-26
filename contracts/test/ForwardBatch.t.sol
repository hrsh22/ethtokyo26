// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "./SpaceAccount.t.sol";
import {AccordForwarder} from "../src/AccordForwarder.sol";
import {AccordTestUSDC} from "../src/AccordTestUSDC.sol";
import {SpaceAccount} from "../src/SpaceAccount.sol";
import {EnsPermissionAdapter} from "../src/EnsPermissionAdapter.sol";

contract ForwardBatchTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant USER_KEY = 0xA11CE;
    uint256 private constant AUTH_KEY = 0xB0B;
    AccordForwarder private forwarder;
    AccordTestUSDC private token;
    SpaceAccount private space;
    address private user;

    function setUp() public {
        user = vm.addr(USER_KEY);
        forwarder = new AccordForwarder();
        token = new AccordTestUSDC(address(forwarder));
        space = new SpaceAccount(user, vm.addr(AUTH_KEY), token, new EnsPermissionAdapter(), address(forwarder));
        token.faucetTo(user);
    }

    function calls(uint256 amount) private returns (AccordForwarder.Call[] memory result) {
        SpaceAccount.Permit memory permit = SpaceAccount.Permit(user, SpaceAccount.Action.CreateAllocation, 1,
            address(0), amount, bytes32(uint256(1)), 0, uint64(block.timestamp + 300), space.policyVersion(),
            keccak256(abi.encode(amount, SpaceAccount.Period.None)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AUTH_KEY, space.hashPermit(permit));
        result = new AccordForwarder.Call[](2);
        result[0] = AccordForwarder.Call(address(token), 150_000, abi.encodeCall(token.approve, (address(space), amount)));
        result[1] = AccordForwarder.Call(address(space), 1_500_000, abi.encodeCall(space.createAllocation,
            (address(0), amount, amount, SpaceAccount.Period.None, permit, abi.encodePacked(r, s, v))));
    }

    function sign(AccordForwarder.Call[] memory items, uint48 deadline, uint256 chainId) private returns (bytes memory) {
        bytes32[] memory hashes = new bytes32[](items.length);
        for (uint256 i; i < items.length; ++i) hashes[i] = keccak256(abi.encode(
            keccak256("Call(address to,uint256 gas,bytes data)"), items[i].to, items[i].gas, keccak256(items[i].data)));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("AccordForwarder"), keccak256("1"), chainId, address(forwarder)));
        bytes32 body = keccak256(abi.encode(
            keccak256("ForwardBatch(address from,Call[] calls,uint256 nonce,uint48 deadline)Call(address to,uint256 gas,bytes data)"),
            user, keccak256(abi.encodePacked(hashes)), forwarder.nonces(user), deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_KEY, keccak256(abi.encodePacked("\x19\x01", domain, body)));
        return abi.encodePacked(r, s, v);
    }

    function attempt(AccordForwarder.Call[] memory items, uint48 deadline, bytes memory signature) private returns (bool) {
        (bool ok,) = address(forwarder).call(abi.encodeCall(forwarder.executeSignedBatch, (user, items, deadline, signature)));
        return ok;
    }

    function testApprovalAndFundingUseOneSignatureAndNonce() public {
        AccordForwarder.Call[] memory items = calls(100e6);
        uint48 deadline = uint48(block.timestamp + 300);
        bytes memory signature = sign(items, deadline, block.chainid);
        require(attempt(items, deadline, signature));
        require(token.balanceOf(address(space)) == 100e6 && token.balanceOf(user) == 900e6);
        require(forwarder.nonces(user) == 1 && space.nextAllocationId() == 2);
        require(!attempt(items, deadline, signature), "replayed batch");
        require(token.balanceOf(address(space)) == 100e6);
    }
    function testRevertedFundingRollsBackApprovalAndNonce() public {
        AccordForwarder.Call[] memory items = calls(1001e6);
        uint48 deadline = uint48(block.timestamp + 300);
        require(!attempt(items, deadline, sign(items, deadline, block.chainid)));
        require(token.allowance(user, address(space)) == 0 && forwarder.nonces(user) == 0);
        require(space.nextAllocationId() == 1 && token.balanceOf(user) == 1000e6);
    }
    function testCallOrderGasAndCalldataAreSigned() public {
        AccordForwarder.Call[] memory items = calls(100e6);
        uint48 deadline = uint48(block.timestamp + 300);
        bytes memory signature = sign(items, deadline, block.chainid);
        items[0].gas++;
        require(!attempt(items, deadline, signature));
        items[0].gas--;
        (items[0], items[1]) = (items[1], items[0]);
        require(!attempt(items, deadline, signature));
        require(forwarder.nonces(user) == 0);
    }
    function testWrongDomainAndExpiredSignatureFail() public {
        AccordForwarder.Call[] memory items = calls(100e6);
        uint48 deadline = uint48(block.timestamp + 300);
        require(!attempt(items, deadline, sign(items, deadline, block.chainid + 1)));
        bytes memory signature = sign(items, deadline, block.chainid);
        vm.warp(deadline + 1);
        require(!attempt(items, deadline, signature));
        require(forwarder.nonces(user) == 0);
    }
    function testUntrustedTargetAndInsufficientCallGasRevertWholeBatch() public {
        AccordForwarder.Call[] memory items = calls(100e6);
        uint48 deadline = uint48(block.timestamp + 300);
        items[1].to = address(0xBAD);
        require(!attempt(items, deadline, sign(items, deadline, block.chainid)));
        items[1].to = address(space);
        items[1].gas = 100;
        require(!attempt(items, deadline, sign(items, deadline, block.chainid)));
        require(token.allowance(user, address(space)) == 0 && forwarder.nonces(user) == 0);
    }
    function testEmptyAndOversizedBatchesFail() public {
        AccordForwarder.Call[] memory items = new AccordForwarder.Call[](0);
        require(!attempt(items, uint48(block.timestamp + 300), ""));
        items = new AccordForwarder.Call[](9);
        require(!attempt(items, uint48(block.timestamp + 300), ""));
    }
}
