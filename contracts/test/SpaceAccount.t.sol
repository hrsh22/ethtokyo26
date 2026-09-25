// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EnsPermissionAdapter, IEnsV2Registry, IEnsPermissionAdapter} from "../src/EnsPermissionAdapter.sol";
import {SpaceAccount} from "../src/SpaceAccount.sol";
import {SpaceFactory} from "../src/SpaceFactory.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
}

contract DemoToken is ERC20 {
    constructor() ERC20("Accord Demo", "ACD") {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract MockEnsV2Registry is IEnsV2Registry {
    mapping(uint256 => State) private _states;

    function setState(uint256 nameId, Status status, address owner, uint64 expiry, uint256 resource)
        external
    {
        _states[nameId] = State(status, expiry, owner, nameId, resource);
    }

    function getState(uint256 nameId) external view returns (State memory) {
        return _states[nameId];
    }
}

contract SpaceAccountTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xB0B;
    uint256 private constant NAME_ID = 123;
    uint256 private constant RESOURCE = 7;
    uint256 private constant UNIT = 1e18;

    DemoToken private token;
    SpaceAccount private space;
    MockEnsV2Registry private registry;
    address private beneficiary;
    address private agent;
    address private seller;
    uint256 private nextNonce;

    function setUp() public {
        token = new DemoToken();
        token.mint(address(this), 1000 * UNIT);
        registry = new MockEnsV2Registry();
        EnsPermissionAdapter adapter = new EnsPermissionAdapter();
        space = new SpaceAccount(address(this), vm.addr(SIGNER_KEY), IERC20(address(token)), adapter);
        token.approve(address(space), type(uint256).max);
        beneficiary = vm.addr(0xA11CE);
        agent = vm.addr(0xA6E17);
        seller = vm.addr(0x5E11);
    }

    function testFactoryCreatesOwnerControlledSpace() public {
        SpaceFactory factory = new SpaceFactory();
        SpaceAccount created = factory.createSpace(vm.addr(SIGNER_KEY), IERC20(address(token)),
            IEnsPermissionAdapter(address(new EnsPermissionAdapter())));
        require(created.owner() == address(this), "wrong owner");
    }

    function testClaimNeedsPersonAndSingleUsePermit() public {
        uint256 id = _createAllocation(beneficiary, 500 * UNIT, 200 * UNIT, SpaceAccount.Period.Monthly);
        SpaceAccount.Permit memory claimPermit = _permit(
            beneficiary, SpaceAccount.Action.Claim, id, beneficiary, 200 * UNIT, bytes32(0)
        );
        bytes memory signature = _sign(claimPermit);

        vm.prank(beneficiary);
        space.claim(id, 200 * UNIT, claimPermit, signature);
        require(token.balanceOf(beneficiary) == 200 * UNIT, "claim not paid");

        vm.expectRevert(SpaceAccount.RequestConsumed.selector);
        vm.prank(beneficiary);
        space.claim(id, 200 * UNIT, claimPermit, signature);

        SpaceAccount.Permit memory altered = _permit(
            beneficiary, SpaceAccount.Action.Claim, id, beneficiary, UNIT, bytes32(0)
        );
        bytes memory alteredSignature = _sign(altered);
        vm.expectRevert(SpaceAccount.InvalidAllocation.selector);
        vm.prank(seller);
        space.claim(id, UNIT, altered, alteredSignature);
    }

    function testCalendarMonthCapResetsAtUtcBoundary() public {
        uint256 id = _createAllocation(beneficiary, 500 * UNIT, 200 * UNIT, SpaceAccount.Period.Monthly);
        vm.warp(1790812799); // Last second of a UTC calendar month
        _claim(id, 200 * UNIT);
        SpaceAccount.Permit memory excess = _permit(
            beneficiary, SpaceAccount.Action.Claim, id, beneficiary, UNIT, bytes32(0)
        );
        bytes memory excessSignature = _sign(excess);
        vm.expectRevert(SpaceAccount.PeriodLimitExceeded.selector);
        vm.prank(beneficiary);
        space.claim(id, UNIT, excess, excessSignature);

        vm.warp(1790812800); // First second of the next UTC calendar month
        _claim(id, 200 * UNIT);
        require(token.balanceOf(beneficiary) == 400 * UNIT, "period did not reset");
    }

    function testAgentBudgetAndLiveEnsAuthority() public {
        uint256 id = _configuredAgentAllocation();
        _pay(id, 5 * UNIT, seller);
        _pay(id, 5 * UNIT, seller);
        _pay(id, 5 * UNIT, seller);
        _pay(id, 5 * UNIT, seller);
        require(token.balanceOf(seller) == 20 * UNIT, "wrong seller amount");

        SpaceAccount.Permit memory overBudget = _permit(
            agent, SpaceAccount.Action.Pay, id, seller, UNIT, bytes32(0)
        );
        bytes memory overBudgetSignature = _sign(overBudget);
        vm.expectRevert(SpaceAccount.PeriodLimitExceeded.selector);
        vm.prank(agent);
        space.pay(id, seller, UNIT, overBudget, overBudgetSignature);

        vm.warp(block.timestamp + 1 days);
        _pay(id, 5 * UNIT, seller);

        SpaceAccount.Permit memory pending = _permit(
            agent, SpaceAccount.Action.Pay, id, seller, UNIT, bytes32(0)
        );
        bytes memory pendingSignature = _sign(pending);
        registry.setState(NAME_ID, IEnsV2Registry.Status.REGISTERED, beneficiary,
            uint64(block.timestamp + 10 days), RESOURCE);
        vm.expectRevert(SpaceAccount.InvalidEnsAuthority.selector);
        vm.prank(agent);
        space.pay(id, seller, UNIT, pending, pendingSignature);
    }

    function testRevocationInvalidatesPreviouslyIssuedPayment() public {
        uint256 id = _configuredAgentAllocation();
        SpaceAccount.Permit memory pending = _permit(
            agent, SpaceAccount.Action.Pay, id, seller, UNIT, bytes32(0)
        );
        bytes memory signature = _sign(pending);
        SpaceAccount.Permit memory revocation = _permit(
            address(this), SpaceAccount.Action.RevokeMandate, id, address(0), 0, bytes32(0)
        );
        space.revokeMandate(id, revocation, _sign(revocation));

        vm.expectRevert(SpaceAccount.InvalidMandate.selector);
        vm.prank(agent);
        space.pay(id, seller, UNIT, pending, signature);
    }

    function testReplacingMandateCannotResetDailySpend() public {
        uint256 id = _configuredAgentAllocation();
        _pay(id, 5 * UNIT, seller);
        _pay(id, 5 * UNIT, seller);
        _pay(id, 5 * UNIT, seller);
        _pay(id, 5 * UNIT, seller);

        _setMandate(id);
        SpaceAccount.Permit memory payment = _permit(
            agent, SpaceAccount.Action.Pay, id, seller, UNIT, bytes32(0)
        );
        bytes memory paymentSignature = _sign(payment);
        vm.expectRevert(SpaceAccount.PeriodLimitExceeded.selector);
        vm.prank(agent);
        space.pay(id, seller, UNIT, payment, paymentSignature);

        SpaceAccount.Permit memory revocation = _permit(
            address(this), SpaceAccount.Action.RevokeMandate, id, address(0), 0, bytes32(0)
        );
        space.revokeMandate(id, revocation, _sign(revocation));
        _setMandate(id);
        payment = _permit(agent, SpaceAccount.Action.Pay, id, seller, UNIT, bytes32(0));
        paymentSignature = _sign(payment);
        vm.expectRevert(SpaceAccount.PeriodLimitExceeded.selector);
        vm.prank(agent);
        space.pay(id, seller, UNIT, payment, paymentSignature);
    }

    function testChangedRecipientAndUnpermittedCallFail() public {
        uint256 id = _configuredAgentAllocation();
        SpaceAccount.Permit memory payment = _permit(
            agent, SpaceAccount.Action.Pay, id, seller, UNIT, bytes32(0)
        );
        bytes memory paymentSignature = _sign(payment);
        vm.expectRevert(SpaceAccount.InvalidPermit.selector);
        vm.prank(agent);
        space.pay(id, beneficiary, UNIT, payment, paymentSignature);
        require(token.balanceOf(beneficiary) == 0, "redirected payment");
    }

    function testTopUpAndRecoveryCannotDoubleSpend() public {
        uint256 id = _createAllocation(address(0), 10 * UNIT, 10 * UNIT, SpaceAccount.Period.None);
        space.fundAllocation(id, 10 * UNIT);
        registry.setState(NAME_ID, IEnsV2Registry.Status.REGISTERED, agent,
            uint64(block.timestamp + 10 days), RESOURCE);
        _setMandate(id);
        _pay(id, 5 * UNIT, seller);
        SpaceAccount.Permit memory recovery = _permit(
            address(this), SpaceAccount.Action.RecoverAllocation, id, address(this), 15 * UNIT, bytes32(0)
        );
        space.recoverAllocation(id, recovery, _sign(recovery));
        require(token.balanceOf(address(space)) == 0, "funds remain locked");

        SpaceAccount.Permit memory pending = _permit(
            agent, SpaceAccount.Action.Pay, id, seller, UNIT, bytes32(0)
        );
        bytes memory pendingSignature = _sign(pending);
        vm.expectRevert(SpaceAccount.InvalidMandate.selector);
        vm.prank(agent);
        space.pay(id, seller, UNIT, pending, pendingSignature);
    }

    function _createAllocation(
        address person,
        uint256 amount,
        uint256 periodCap,
        SpaceAccount.Period period
    ) private returns (uint256 id) {
        id = space.nextAllocationId();
        SpaceAccount.Permit memory permit = _permit(
            address(this), SpaceAccount.Action.CreateAllocation, id, person, amount,
            keccak256(abi.encode(periodCap, period))
        );
        space.createAllocation(person, amount, periodCap, period, permit, _sign(permit));
    }

    function _timedAllocation(address person) private returns (uint256 id) {
        id = space.nextAllocationId();
        SpaceAccount.Permit memory permit = _permit(address(this), SpaceAccount.Action.CreateAllocation,
            id, person, 50 * UNIT, keccak256(abi.encode(10 * UNIT, SpaceAccount.Period.Interval, uint32(60), uint32(300))));
        space.createTimedAllocation(person, 50 * UNIT, 10 * UNIT, 60, 300, permit, _sign(permit));
    }

    function testMinuteWindowsResetFromFundingWithoutCarryOver() public {
        vm.warp(1007); // Deliberately not a clock-minute boundary.
        uint256 id = _timedAllocation(beneficiary);
        (uint64 start, uint64 end, uint32 interval) = space.allocationSchedules(id);
        require(start == 1007 && end == 1307 && interval == 60, "incorrect schedule");
        _claim(id, 4 * UNIT);
        _claim(id, 6 * UNIT);
        vm.warp(1066);
        SpaceAccount.Permit memory excess = _permit(beneficiary, SpaceAccount.Action.Claim, id, beneficiary, UNIT, bytes32(0));
        bytes memory signature = _sign(excess);
        vm.expectRevert(SpaceAccount.PeriodLimitExceeded.selector);
        vm.prank(beneficiary);
        space.claim(id, UNIT, excess, signature);
        vm.warp(1067);
        _claim(id, 10 * UNIT);
        vm.warp(1247); // Skipping windows cannot accumulate their caps.
        excess = _permit(beneficiary, SpaceAccount.Action.Claim, id, beneficiary, 11 * UNIT, bytes32(0));
        signature = _sign(excess);
        vm.expectRevert(SpaceAccount.PeriodLimitExceeded.selector);
        vm.prank(beneficiary);
        space.claim(id, 11 * UNIT, excess, signature);
        _claim(id, 10 * UNIT);
        require(token.balanceOf(beneficiary) == 30 * UNIT, "wrong claimed amount");
    }

    function testMinuteExpiryRejectsCachedPermitAndAllowsRecovery() public {
        vm.warp(1007);
        uint256 id = _timedAllocation(beneficiary);
        vm.warp(1306);
        _claim(id, 5 * UNIT);
        SpaceAccount.Permit memory pending = _permit(beneficiary, SpaceAccount.Action.Claim, id, beneficiary, UNIT, bytes32(0));
        bytes memory signature = _sign(pending);
        vm.warp(1307);
        vm.expectRevert(SpaceAccount.AllocationExpired.selector);
        vm.prank(beneficiary);
        space.claim(id, UNIT, pending, signature);
        vm.expectRevert(SpaceAccount.AllocationExpired.selector);
        space.fundAllocation(id, UNIT);
        SpaceAccount.Permit memory recovery = _permit(address(this), SpaceAccount.Action.RecoverAllocation,
            id, address(this), 45 * UNIT, bytes32(0));
        space.recoverAllocation(id, recovery, _sign(recovery));
        require(token.balanceOf(address(space)) == 0, "unclaimed funds locked");
    }

    function testTimedScheduleIsSignedAndCannotUseLegacyEntryPoint() public {
        SpaceAccount.Permit memory permit = _permit(address(this), SpaceAccount.Action.CreateAllocation,
            1, beneficiary, 50 * UNIT, keccak256(abi.encode(10 * UNIT, SpaceAccount.Period.Interval, uint32(60), uint32(300))));
        bytes memory signature = _sign(permit);
        vm.expectRevert(SpaceAccount.InvalidPermit.selector);
        space.createTimedAllocation(beneficiary, 50 * UNIT, 10 * UNIT, 60, 600, permit, signature);
        vm.expectRevert(SpaceAccount.InvalidAllocation.selector);
        space.createTimedAllocation(beneficiary, 50 * UNIT, 10 * UNIT, 0, 300, permit, signature);
        vm.expectRevert(SpaceAccount.InvalidAllocation.selector);
        space.createTimedAllocation(beneficiary, 50 * UNIT, 10 * UNIT, 60, 301, permit, signature);
        vm.expectRevert(SpaceAccount.InvalidAllocation.selector);
        space.createAllocation(beneficiary, 50 * UNIT, 10 * UNIT, SpaceAccount.Period.Interval, permit, signature);
    }

    function testTimedAgentPaymentsAlsoExpire() public {
        vm.warp(1007);
        uint256 id = _timedAllocation(address(0));
        registry.setState(NAME_ID, IEnsV2Registry.Status.REGISTERED, agent, uint64(block.timestamp + 10 days), RESOURCE);
        _setMandate(id);
        _pay(id, 5 * UNIT, seller);
        SpaceAccount.Permit memory pending = _permit(agent, SpaceAccount.Action.Pay, id, seller, UNIT, bytes32(0));
        pending.expiry = 2000;
        bytes memory signature = _sign(pending);
        vm.warp(1307);
        vm.expectRevert(SpaceAccount.AllocationExpired.selector);
        vm.prank(agent);
        space.pay(id, seller, UNIT, pending, signature);
    }

    function _configuredAgentAllocation() private returns (uint256 id) {
        id = _createAllocation(address(0), 100 * UNIT, 100 * UNIT, SpaceAccount.Period.None);
        registry.setState(NAME_ID, IEnsV2Registry.Status.REGISTERED, agent,
            uint64(block.timestamp + 10 days), RESOURCE);
        _setMandate(id);
    }

    function _setMandate(uint256 id) private {
        SpaceAccount.MandateConfig memory config = SpaceAccount.MandateConfig({
            agent: agent,
            registry: address(registry),
            nameId: NAME_ID,
            expectedResource: RESOURCE,
            dailyCap: 20 * UNIT,
            maxPerPayment: 5 * UNIT,
            expiry: uint64(block.timestamp + 10 days)
        });
        bytes32 detailsHash = keccak256(abi.encode(
            config.registry, config.nameId, config.expectedResource,
            config.dailyCap, config.maxPerPayment, config.expiry
        ));
        SpaceAccount.Permit memory permit = _permit(
            address(this), SpaceAccount.Action.SetMandate, id, agent, 0, detailsHash
        );
        space.setMandate(id, config, permit, _sign(permit));
    }

    function _claim(uint256 id, uint256 amount) private {
        SpaceAccount.Permit memory permit = _permit(
            beneficiary, SpaceAccount.Action.Claim, id, beneficiary, amount, bytes32(0)
        );
        bytes memory signature = _sign(permit);
        vm.prank(beneficiary);
        space.claim(id, amount, permit, signature);
    }

    function _pay(uint256 id, uint256 amount, address recipient) private {
        SpaceAccount.Permit memory permit = _permit(
            agent, SpaceAccount.Action.Pay, id, recipient, amount, bytes32(0)
        );
        bytes memory signature = _sign(permit);
        vm.prank(agent);
        space.pay(id, recipient, amount, permit, signature);
    }

    function _permit(
        address actor,
        SpaceAccount.Action action,
        uint256 allocationId,
        address recipient,
        uint256 amount,
        bytes32 detailsHash
    ) private returns (SpaceAccount.Permit memory) {
        return SpaceAccount.Permit({
            actor: actor,
            action: action,
            allocationId: allocationId,
            recipient: recipient,
            amount: amount,
            requestId: keccak256(abi.encode(++nextNonce, actor, action)),
            nonce: nextNonce,
            expiry: uint64(block.timestamp + 1 hours),
            policyVersion: space.policyVersion(),
            detailsHash: detailsHash
        });
    }

    function _sign(SpaceAccount.Permit memory permit) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, space.hashPermit(permit));
        return abi.encodePacked(r, s, v);
    }
}
