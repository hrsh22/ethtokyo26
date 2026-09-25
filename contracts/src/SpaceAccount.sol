// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IEnsPermissionAdapter} from "./EnsPermissionAdapter.sol";

/// @notice One Space with funded allocations for people and screened agent payments.
/// The backend authorizes policy checks. A trusted forwarder can submit the
/// participant's signed request while paying gas on their behalf.
contract SpaceAccount is EIP712, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    enum Action {
        CreateAllocation,
        SetMandate,
        Claim,
        Pay,
        RevokeMandate,
        RecoverAllocation
    }

    enum Period {
        None,
        Daily,
        Monthly,
        Interval
    }

    struct Permit {
        address actor;
        Action action;
        uint256 allocationId;
        address recipient;
        uint256 amount;
        bytes32 requestId;
        uint256 nonce;
        uint64 expiry;
        uint64 policyVersion;
        bytes32 detailsHash;
    }

    struct Allocation {
        address beneficiary;
        uint256 remaining;
        uint256 periodCap;
        uint256 spentInPeriod;
        uint256 lastPeriod;
        Period period;
        bool cancelled;
    }

    struct Mandate {
        address agent;
        address registry;
        uint256 nameId;
        uint256 expectedResource;
        uint256 dailyCap;
        uint256 maxPerPayment;
        uint256 spentToday;
        uint256 lastDay;
        uint64 expiry;
        bool active;
    }

    struct AllocationSchedule {
        uint64 startsAt;
        uint64 endsAt;
        uint32 intervalSeconds;
    }

    struct MandateConfig {
        address agent;
        address registry;
        uint256 nameId;
        uint256 expectedResource;
        uint256 dailyCap;
        uint256 maxPerPayment;
        uint64 expiry;
    }

    bytes32 public constant PERMIT_TYPEHASH = keccak256(
        "Permit(address actor,uint8 action,uint256 allocationId,address recipient,uint256 amount,bytes32 requestId,uint256 nonce,uint64 expiry,uint64 policyVersion,bytes32 detailsHash)"
    );

    address public immutable owner;
    address public immutable authorizer;
    IERC20 public immutable token;
    IEnsPermissionAdapter public immutable ensAdapter;

    uint256 public nextAllocationId = 1;
    uint64 public policyVersion = 1;
    mapping(uint256 => Allocation) public allocations;
    uint256 public constant allocationScheduleVersion = 1;
    mapping(uint256 => AllocationSchedule) public allocationSchedules;
    mapping(uint256 => Mandate) public mandates;
    mapping(bytes32 => bool) public consumedRequests;
    mapping(address => mapping(uint256 => bool)) public consumedNonces;

    event AllocationCreated(uint256 indexed allocationId, address indexed beneficiary, uint256 amount);
    event AllocationFunded(uint256 indexed allocationId, uint256 amount);
    event Claimed(bytes32 indexed requestId, uint256 indexed allocationId, address indexed person, uint256 amount);
    event MandateSet(uint256 indexed allocationId, address indexed agent, uint64 expiry);
    event MandateRevoked(uint256 indexed allocationId);
    event PaymentMade(
        bytes32 indexed requestId,
        uint256 indexed allocationId,
        address indexed agent,
        address recipient,
        uint256 amount
    );
    event AllocationRecovered(uint256 indexed allocationId, uint256 amount);

    error Unauthorized();
    error InvalidPermit();
    error ExpiredPermit();
    error RequestConsumed();
    error InvalidAllocation();
    error InvalidMandate();
    error InvalidEnsAuthority();
    error InsufficientAllocation();
    error PeriodLimitExceeded();
    error AllocationExpired();

    constructor(address owner_, address authorizer_, IERC20 token_, IEnsPermissionAdapter ensAdapter_, address forwarder_)
        EIP712("AccordSpace", "1") ERC2771Context(forwarder_)
    {
        if (
            owner_ == address(0) || authorizer_ == address(0) || address(token_) == address(0)
                || address(ensAdapter_) == address(0)
        ) revert Unauthorized();
        owner = owner_;
        authorizer = authorizer_;
        token = token_;
        ensAdapter = ensAdapter_;
    }

    function hashPermit(Permit calldata permit) external view returns (bytes32) {
        return _hashPermit(permit);
    }

    function createAllocation(
        address beneficiary,
        uint256 amount,
        uint256 periodCap,
        Period period,
        Permit calldata permit,
        bytes calldata signature
    ) external nonReentrant returns (uint256 allocationId) {
        if (period == Period.Interval) revert InvalidAllocation();
        return _createAllocation(beneficiary, amount, periodCap, period,
            keccak256(abi.encode(periodCap, period)), permit, signature);
    }

    /// @notice Fixed windows from the funding block, with no carry-over. The
    /// first window is available immediately; the end timestamp is exclusive.
    function createTimedAllocation(
        address beneficiary,
        uint256 amount,
        uint256 periodCap,
        uint32 intervalSeconds,
        uint32 durationSeconds,
        Permit calldata permit,
        bytes calldata signature
    ) external nonReentrant returns (uint256 allocationId) {
        if (intervalSeconds < 60 || intervalSeconds > 1 days || durationSeconds < intervalSeconds
            || durationSeconds > 365 days || durationSeconds % intervalSeconds != 0) revert InvalidAllocation();
        allocationId = _createAllocation(beneficiary, amount, periodCap, Period.Interval,
            keccak256(abi.encode(periodCap, Period.Interval, intervalSeconds, durationSeconds)), permit, signature);
        allocationSchedules[allocationId] = AllocationSchedule(
            uint64(block.timestamp), uint64(block.timestamp + durationSeconds), intervalSeconds
        );
    }

    function _createAllocation(
        address beneficiary, uint256 amount, uint256 periodCap, Period period,
        bytes32 detailsHash, Permit calldata permit, bytes calldata signature
    ) private returns (uint256 allocationId) {
        if (_msgSender() != owner || amount == 0 || periodCap == 0 || periodCap > amount) {
            revert InvalidAllocation();
        }
        if (period == Period.None && periodCap != amount) revert InvalidAllocation();
        allocationId = nextAllocationId++;
        _consumePermit(
            permit,
            signature,
            Action.CreateAllocation,
            allocationId,
            beneficiary,
            amount,
            detailsHash
        );
        allocations[allocationId] = Allocation({
            beneficiary: beneficiary,
            remaining: amount,
            periodCap: periodCap,
            spentInPeriod: 0,
            lastPeriod: 0,
            period: period,
            cancelled: false
        });
        token.safeTransferFrom(_msgSender(), address(this), amount);
        policyVersion++;
        emit AllocationCreated(allocationId, beneficiary, amount);
    }

    function fundAllocation(uint256 allocationId, uint256 amount) external nonReentrant {
        Allocation storage allocation = allocations[allocationId];
        if (_msgSender() != owner || allocationId == 0 || allocationId >= nextAllocationId
                || allocation.cancelled || amount == 0) revert InvalidAllocation();
        if (allocation.period == Period.Interval && block.timestamp >= allocationSchedules[allocationId].endsAt) {
            revert AllocationExpired();
        }
        allocation.remaining += amount;
        token.safeTransferFrom(_msgSender(), address(this), amount);
        emit AllocationFunded(allocationId, amount);
    }

    function claim(uint256 allocationId, uint256 amount, Permit calldata permit, bytes calldata signature)
        external
        nonReentrant
    {
        Allocation storage allocation = allocations[allocationId];
        if (allocation.beneficiary == address(0) || allocation.beneficiary != _msgSender() || allocation.cancelled) {
            revert InvalidAllocation();
        }
        _consumePermit(permit, signature, Action.Claim, allocationId, _msgSender(), amount, bytes32(0));
        _spend(allocationId, allocation, amount);
        emit Claimed(permit.requestId, allocationId, _msgSender(), amount);
        token.safeTransfer(_msgSender(), amount);
    }

    function setMandate(
        uint256 allocationId,
        MandateConfig calldata config,
        Permit calldata permit,
        bytes calldata signature
    ) external nonReentrant {
        Allocation storage allocation = allocations[allocationId];
        if (
            _msgSender() != owner || allocationId == 0 || allocationId >= nextAllocationId
                || allocation.cancelled || allocation.beneficiary != address(0)
                || config.agent == address(0) || config.dailyCap == 0 || config.maxPerPayment == 0
                || config.maxPerPayment > config.dailyCap || config.expiry <= block.timestamp
        ) revert InvalidMandate();
        bytes32 detailsHash = keccak256(
            abi.encode(
                config.registry,
                config.nameId,
                config.expectedResource,
                config.dailyCap,
                config.maxPerPayment,
                config.expiry
            )
        );
        _consumePermit(permit, signature, Action.SetMandate, allocationId, config.agent, 0, detailsHash);
        if (!ensAdapter.isAuthorized(config.registry, config.nameId, config.expectedResource, config.agent)) {
            revert InvalidEnsAuthority();
        }
        Mandate storage previous = mandates[allocationId];
        uint256 today = block.timestamp / 1 days;
        uint256 spentToday = previous.lastDay == today ? previous.spentToday : 0;
        mandates[allocationId] = Mandate({
            agent: config.agent,
            registry: config.registry,
            nameId: config.nameId,
            expectedResource: config.expectedResource,
            dailyCap: config.dailyCap,
            maxPerPayment: config.maxPerPayment,
            spentToday: spentToday,
            lastDay: today,
            expiry: config.expiry,
            active: true
        });
        policyVersion++;
        emit MandateSet(allocationId, config.agent, config.expiry);
    }

    function pay(
        uint256 allocationId,
        address recipient,
        uint256 amount,
        Permit calldata permit,
        bytes calldata signature
    ) external nonReentrant {
        Allocation storage allocation = allocations[allocationId];
        Mandate storage mandate = mandates[allocationId];
        if (
            allocation.cancelled || !mandate.active || mandate.agent != _msgSender()
                || mandate.expiry <= block.timestamp || recipient == address(0)
        ) revert InvalidMandate();
        _consumePermit(permit, signature, Action.Pay, allocationId, recipient, amount, bytes32(0));
        if (!ensAdapter.isAuthorized(mandate.registry, mandate.nameId, mandate.expectedResource, _msgSender())) {
            revert InvalidEnsAuthority();
        }
        if (amount == 0 || amount > mandate.maxPerPayment) revert PeriodLimitExceeded();
        uint256 today = block.timestamp / 1 days;
        if (mandate.lastDay != today) {
            mandate.lastDay = today;
            mandate.spentToday = 0;
        }
        if (mandate.spentToday + amount > mandate.dailyCap) revert PeriodLimitExceeded();
        mandate.spentToday += amount;
        _spend(allocationId, allocation, amount);
        emit PaymentMade(permit.requestId, allocationId, _msgSender(), recipient, amount);
        token.safeTransfer(recipient, amount);
    }

    function revokeMandate(uint256 allocationId, Permit calldata permit, bytes calldata signature)
        external
        nonReentrant
    {
        if (_msgSender() != owner || !mandates[allocationId].active) revert InvalidMandate();
        _consumePermit(permit, signature, Action.RevokeMandate, allocationId, address(0), 0, bytes32(0));
        mandates[allocationId].active = false;
        policyVersion++;
        emit MandateRevoked(allocationId);
    }

    function recoverAllocation(uint256 allocationId, Permit calldata permit, bytes calldata signature)
        external
        nonReentrant
    {
        Allocation storage allocation = allocations[allocationId];
        if (_msgSender() != owner || allocationId == 0 || allocationId >= nextAllocationId
                || allocation.cancelled) revert InvalidAllocation();
        uint256 amount = allocation.remaining;
        _consumePermit(permit, signature, Action.RecoverAllocation, allocationId, owner, amount, bytes32(0));
        allocation.remaining = 0;
        allocation.cancelled = true;
        mandates[allocationId].active = false;
        policyVersion++;
        emit AllocationRecovered(allocationId, amount);
        token.safeTransfer(owner, amount);
    }

    function _spend(uint256 allocationId, Allocation storage allocation, uint256 amount) private {
        AllocationSchedule memory schedule = allocationSchedules[allocationId];
        if (allocation.period == Period.Interval && block.timestamp >= schedule.endsAt) revert AllocationExpired();
        if (amount == 0 || amount > allocation.remaining) revert InsufficientAllocation();
        if (allocation.period == Period.None) {
            allocation.remaining -= amount;
            return;
        }
        uint256 period = allocation.period == Period.Interval
            ? (block.timestamp - schedule.startsAt) / schedule.intervalSeconds + 1
            : _periodId(allocation.period);
        if (allocation.lastPeriod != period) {
            allocation.lastPeriod = period;
            allocation.spentInPeriod = 0;
        }
        if (allocation.spentInPeriod + amount > allocation.periodCap) revert PeriodLimitExceeded();
        allocation.spentInPeriod += amount;
        allocation.remaining -= amount;
    }

    function _periodId(Period period) private view returns (uint256) {
        if (period == Period.Daily) return block.timestamp / 1 days + 1;
        return _calendarMonth(block.timestamp);
    }

    /// @dev Gregorian year * 12 + month, UTC. Civil-from-days for nonnegative Unix timestamps.
    function _calendarMonth(uint256 timestamp) private pure returns (uint256) {
        uint256 z = timestamp / 1 days + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 year = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 month = mp < 10 ? mp + 3 : mp - 9;
        if (month <= 2) year++;
        return year * 12 + month;
    }

    function _consumePermit(
        Permit calldata permit,
        bytes calldata signature,
        Action action,
        uint256 allocationId,
        address recipient,
        uint256 amount,
        bytes32 detailsHash
    ) private {
        if (
            permit.actor != _msgSender() || permit.action != action || permit.allocationId != allocationId
                || permit.recipient != recipient || permit.amount != amount
                || permit.detailsHash != detailsHash || permit.policyVersion != policyVersion
                || permit.requestId == bytes32(0)
        ) revert InvalidPermit();
        if (permit.expiry < block.timestamp) revert ExpiredPermit();
        if (consumedRequests[permit.requestId] || consumedNonces[permit.actor][permit.nonce]) {
            revert RequestConsumed();
        }
        if (!SignatureChecker.isValidSignatureNow(authorizer, _hashPermit(permit), signature)) {
            revert InvalidPermit();
        }
        consumedRequests[permit.requestId] = true;
        consumedNonces[permit.actor][permit.nonce] = true;
    }

    function _hashPermit(Permit calldata permit) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PERMIT_TYPEHASH,
                    permit.actor,
                    permit.action,
                    permit.allocationId,
                    permit.recipient,
                    permit.amount,
                    permit.requestId,
                    permit.nonce,
                    permit.expiry,
                    permit.policyVersion,
                    permit.detailsHash
                )
            )
        );
    }
}
