// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";

/**
 * @title EsusuCircle
 * @notice Rotating savings and credit association (ROSCA) on Celo
 * @dev Members contribute equal amounts each round; one member receives the pot per round
 */
contract EsusuCircle {
    // ─── Structs ────────────────────────────────────────────────────────────────

    struct Circle {
        string  name;
        address admin;
        bool useNativeCELO;
        address cUSDToken;
        uint256 contributionAmount; // in wei (18 decimals)
        uint256 intervalDays;       // days between rounds
        uint256 maxMembers;
        uint256 currentRound;
        uint256 nextPayoutTime;
        bool    active;
        address[] members;
        mapping(address => bool)    isMember;
        mapping(uint256 => address) roundRecipient;   // round => who received payout
        mapping(uint256 => mapping(address => bool)) roundPaid; // round => member => paid
        mapping(uint256 => uint256) roundContributions; // round => total contributed
    }

    // ─── State ──────────────────────────────────────────────────────────────────
    // In the Circle struct, add:
    bool useNativeCELO;
    uint256 public circleCount;
    mapping(uint256 => Circle) private circles;
    mapping(address => uint256[]) public userCircles; // user => circle IDs

    // ─── Events ─────────────────────────────────────────────────────────────────

    event CircleCreated(uint256 indexed circleId, string name, address admin, uint256 contribution);
    event MemberJoined(uint256 indexed circleId, address member);
    event ContributionMade(uint256 indexed circleId, uint256 round, address member, uint256 amount);
    event PayoutReleased(uint256 indexed circleId, uint256 round, address recipient, uint256 amount);
    event CircleClosed(uint256 indexed circleId);

    // ─── Errors ─────────────────────────────────────────────────────────────────

    error NotAdmin();
    error NotMember();
    error AlreadyMember();
    error CircleFull();
    error CircleNotActive();
    error AlreadyPaidThisRound();
    error RoundNotComplete();
    error PayoutNotDue();
    error TransferFailed();
    error InvalidAmount();

    // ─── Modifiers ──────────────────────────────────────────────────────────────

    modifier onlyAdmin(uint256 circleId) {
        if (circles[circleId].admin != msg.sender) revert NotAdmin();
        _;
    }

    modifier onlyMember(uint256 circleId) {
        if (!circles[circleId].isMember[msg.sender]) revert NotMember();
        _;
    }

    modifier circleActive(uint256 circleId) {
        if (!circles[circleId].active) revert CircleNotActive();
        _;
    }

    // ─── Core Functions ─────────────────────────────────────────────────────────

    /**
     * @notice Create a new esusu circle
     * @param name Human-readable circle name
     * @param cUSDToken Address of cUSD token (or any ERC20)
     * @param contributionAmount Amount each member contributes per round (in wei)
     * @param intervalDays Days between rounds
     * @param maxMembers Maximum number of members allowed
     */
    function createCircle(
        string calldata name,
        address cUSDToken,
        uint256 contributionAmount,
        uint256 intervalDays,
        uint256 maxMembers
    ) external returns (uint256 circleId) {
        if (contributionAmount == 0) revert InvalidAmount();
        if (maxMembers < 2) revert InvalidAmount();

        circleId = ++circleCount;
        Circle storage c = circles[circleId];
        c.name               = name;
        c.admin              = msg.sender;
        c.cUSDToken          = cUSDToken;
        c.contributionAmount = contributionAmount;
        c.intervalDays       = intervalDays;
        c.maxMembers         = maxMembers;
        c.currentRound       = 1;
        c.nextPayoutTime     = block.timestamp + (intervalDays * 1 days);
        c.active             = true;

        // Admin auto-joins
        c.members.push(msg.sender);
        c.isMember[msg.sender] = true;
        userCircles[msg.sender].push(circleId);

        emit CircleCreated(circleId, name, msg.sender, contributionAmount);
        emit MemberJoined(circleId, msg.sender);
    }

    /**
     * @notice Join an existing circle
     */
    function joinCircle(uint256 circleId) external circleActive(circleId) {
        Circle storage c = circles[circleId];
        if (c.isMember[msg.sender]) revert AlreadyMember();
        if (c.members.length >= c.maxMembers) revert CircleFull();

        c.members.push(msg.sender);
        c.isMember[msg.sender] = true;
        userCircles[msg.sender].push(circleId);

        emit MemberJoined(circleId, msg.sender);
    }

    /**
     * @notice Contribute to the current round
     * @dev Member must have approved this contract to spend contributionAmount
     */
    function contribute(uint256 circleId)
        external
        circleActive(circleId)
        onlyMember(circleId)
    {
        Circle storage c = circles[circleId];
        uint256 round = c.currentRound;

        if (c.roundPaid[round][msg.sender]) revert AlreadyPaidThisRound();

        bool ok = IERC20(c.cUSDToken).transferFrom(
            msg.sender,
            address(this),
            c.contributionAmount
        );
        if (!ok) revert TransferFailed();

        c.roundPaid[round][msg.sender]     = true;
        c.roundContributions[round]        += c.contributionAmount;

        emit ContributionMade(circleId, round, msg.sender, c.contributionAmount);
    }

    /**
     * @notice Release payout to the designated recipient for the current round
     * @dev Can be called by admin or any member once all have paid and interval passed
     * @param circleId The circle ID
     * @param recipient Address that receives the pot this round
     */
    function releasePayout(uint256 circleId, address recipient)
        external
        circleActive(circleId)
        onlyAdmin(circleId)
    {
        Circle storage c = circles[circleId];
        uint256 round = c.currentRound;

        if (!_allPaid(circleId, round)) revert RoundNotComplete();
        if (block.timestamp < c.nextPayoutTime) revert PayoutNotDue();
        if (!c.isMember[recipient]) revert NotMember();

        uint256 pot = c.roundContributions[round];
        c.roundRecipient[round] = recipient;
        c.currentRound++;
        c.nextPayoutTime = block.timestamp + (c.intervalDays * 1 days);

        bool ok = IERC20(c.cUSDToken).transfer(recipient, pot);
        if (!ok) revert TransferFailed();

        emit PayoutReleased(circleId, round, recipient, pot);

        // Close circle if all members have received once
        if (c.currentRound > c.members.length) {
            c.active = false;
            emit CircleClosed(circleId);
        }
    }

    // ─── View Functions ─────────────────────────────────────────────────────────

    function getCircleInfo(uint256 circleId) external view returns (
        string memory name,
        address admin,
        uint256 contributionAmount,
        uint256 currentRound,
        uint256 memberCount,
        uint256 maxMembers,
        uint256 nextPayoutTime,
        bool active
    ) {
        Circle storage c = circles[circleId];
        return (
            c.name,
            c.admin,
            c.contributionAmount,
            c.currentRound,
            c.members.length,
            c.maxMembers,
            c.nextPayoutTime,
            c.active
        );
    }

    function getMembers(uint256 circleId) external view returns (address[] memory) {
        return circles[circleId].members;
    }

    function hasPaidThisRound(uint256 circleId, address member) external view returns (bool) {
        Circle storage c = circles[circleId];
        return c.roundPaid[c.currentRound][member];
    }

    function getRoundContributions(uint256 circleId, uint256 round) external view returns (uint256) {
        return circles[circleId].roundContributions[round];
    }

    function getUserCircles(address user) external view returns (uint256[] memory) {
        return userCircles[user];
    }

    // ─── Internal ───────────────────────────────────────────────────────────────

    function _allPaid(uint256 circleId, uint256 round) internal view returns (bool) {
        Circle storage c = circles[circleId];
        for (uint256 i = 0; i < c.members.length; i++) {
            if (!c.roundPaid[round][c.members[i]]) return false;
        }
        return true;
    }

// Add new create function:
function createCircleCELO(
    string calldata name,
    uint256 contributionAmount,
    uint256 intervalDays,
    uint256 maxMembers
) external returns (uint256 circleId) {
    if (contributionAmount == 0) revert InvalidAmount();
    if (maxMembers < 2) revert InvalidAmount();

    circleId = ++circleCount;
    Circle storage c = circles[circleId];
    c.name               = name;
    c.admin              = msg.sender;
    c.useNativeCELO      = true;
    c.contributionAmount = contributionAmount;
    c.intervalDays       = intervalDays;
    c.maxMembers         = maxMembers;
    c.currentRound       = 1;
    c.nextPayoutTime     = block.timestamp + (intervalDays * 1 days);
    c.active             = true;

    c.members.push(msg.sender);
    c.isMember[msg.sender] = true;
    userCircles[msg.sender].push(circleId);

    emit CircleCreated(circleId, name, msg.sender, contributionAmount);
    emit MemberJoined(circleId, msg.sender);
}

function contributeCELO(uint256 circleId)
    external
    payable
    circleActive(circleId)
    onlyMember(circleId)
{
    Circle storage c = circles[circleId];
    if (!c.useNativeCELO) revert TransferFailed();
    uint256 round = c.currentRound;
    if (c.roundPaid[round][msg.sender]) revert AlreadyPaidThisRound();
    if (msg.value != c.contributionAmount) revert InvalidAmount();

    c.roundPaid[round][msg.sender]  = true;
    c.roundContributions[round]    += msg.value;

    emit ContributionMade(circleId, round, msg.sender, msg.value);
}

function releasePayoutCELO(uint256 circleId, address payable recipient)
    external
    circleActive(circleId)
    onlyAdmin(circleId)
{
    Circle storage c = circles[circleId];
    if (!c.useNativeCELO) revert TransferFailed();
    uint256 round = c.currentRound;

    if (!_allPaid(circleId, round)) revert RoundNotComplete();
    if (block.timestamp < c.nextPayoutTime) revert PayoutNotDue();
    if (!c.isMember[recipient]) revert NotMember();

    uint256 pot = c.roundContributions[round];
    c.roundRecipient[round] = recipient;
    c.currentRound++;
    c.nextPayoutTime = block.timestamp + (c.intervalDays * 1 days);

    (bool ok, ) = recipient.call{value: pot}("");
    if (!ok) revert TransferFailed();

    emit PayoutReleased(circleId, round, recipient, pot);

    if (c.currentRound > c.members.length) {
        c.active = false;
        emit CircleClosed(circleId);
    }
}

receive() external payable {}
}
