# Accord

Accord is a working name for a protocol that gives people and agents access to shared funds under explicit conditions.

## Language

**Space**:
A shared funding context containing participants, allocations, and the rules governing access to its funds.
_Avoid_: Vault, pool

**Allocation**:
Funds reserved within a Space for a person or purpose. An allocation is distinct from a spending limit, which restricts how quickly or in what amounts its funds may be used.
_Avoid_: Balance, allowance when referring to the reserved funds

**Mandate**:
A human-approved grant of authority for an agent to spend from an allocation, subject to defined actions, limits, conditions, and expiry.
_Avoid_: Agent wallet, agent allocation when referring to authority

**Condition**:
A requirement that must be satisfied before a permitted action can proceed, such as a date, an approval, or an acceptable screening result.
_Avoid_: Trigger when satisfaction alone does not execute the action

**Claim**:
A permitted person's request to receive funds from an allocation once its conditions are satisfied.
_Avoid_: Withdrawal when referring to a beneficiary's entitlement

**Template**:
A reusable starting configuration for a Space's allocations, permissions, and conditions.
_Avoid_: Separate protocol when referring to a configuration of Accord
