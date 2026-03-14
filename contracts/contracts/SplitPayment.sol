// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";

/**
 * @title SplitPayment
 * @notice Atomically splits a cUSD payment among multiple recipients
 * @dev Accepts one transferFrom call, distributes to N addresses in one tx
 */
contract SplitPayment {
    // ─── Events ─────────────────────────────────────────────────────────────────

    event PaymentSplit(
        address indexed payer,
        address indexed token,
        address[] recipients,
        uint256[] amounts,
        uint256 totalAmount,
        string  memo
    );

    event EqualSplit(
        address indexed payer,
        address indexed token,
        address[] recipients,
        uint256 amountEach,
        string  memo
    );

    // ─── Errors ─────────────────────────────────────────────────────────────────

    error LengthMismatch();
    error NoRecipients();
    error ZeroAmount();
    error TransferFailed();

    // ─── Core Functions ─────────────────────────────────────────────────────────

    /**
     * @notice Split a total amount equally among recipients
     * @param token ERC20 token address (cUSD)
     * @param recipients Array of recipient addresses
     * @param totalAmount Total amount to split (in wei) — must be divisible by recipients.length
     * @param memo Optional note (e.g. "Dinner at Nkoyo")
     */
    function splitEqual(
        address token,
        address[] calldata recipients,
        uint256 totalAmount,
        string calldata memo
    ) external {
        if (recipients.length == 0) revert NoRecipients();
        if (totalAmount == 0) revert ZeroAmount();

        uint256 amountEach = totalAmount / recipients.length;
        if (amountEach == 0) revert ZeroAmount();

        // Pull full amount from sender first
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), totalAmount);
        if (!ok) revert TransferFailed();

        // Distribute to each recipient
        for (uint256 i = 0; i < recipients.length; i++) {
            bool sent = IERC20(token).transfer(recipients[i], amountEach);
            if (!sent) revert TransferFailed();
        }

        // Return any dust (from integer division) to sender
        uint256 distributed = amountEach * recipients.length;
        if (distributed < totalAmount) {
            IERC20(token).transfer(msg.sender, totalAmount - distributed);
        }

        emit EqualSplit(msg.sender, token, recipients, amountEach, memo);
    }

    /**
     * @notice Split with custom amounts per recipient
     * @param token ERC20 token address (cUSD)
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts for each recipient (must match recipients length)
     * @param memo Optional note
     */
    function splitCustom(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts,
        string calldata memo
    ) external {
        if (recipients.length == 0) revert NoRecipients();
        if (recipients.length != amounts.length) revert LengthMismatch();

        // Calculate total
        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        if (total == 0) revert ZeroAmount();

        // Pull total from sender
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), total);
        if (!ok) revert TransferFailed();

        // Distribute individually
        for (uint256 i = 0; i < recipients.length; i++) {
            if (amounts[i] > 0) {
                bool sent = IERC20(token).transfer(recipients[i], amounts[i]);
                if (!sent) revert TransferFailed();
            }
        }

        emit PaymentSplit(msg.sender, token, recipients, amounts, total, memo);
    }

    /**
     * @notice Pay a single recipient — convenience wrapper for direct sends
     */
    function pay(
        address token,
        address recipient,
        uint256 amount,
        string calldata memo
    ) external {
        if (amount == 0) revert ZeroAmount();
        bool ok = IERC20(token).transferFrom(msg.sender, recipient, amount);
        if (!ok) revert TransferFailed();

        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = recipient;
        a[0] = amount;
        emit PaymentSplit(msg.sender, token, r, a, amount, memo);
    }
}
