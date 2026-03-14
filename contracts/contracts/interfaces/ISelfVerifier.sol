// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISelfVerifier {
    struct VerificationData {
        address userAddress;
        bool isVerified;
        uint256 verifiedAt;
        bytes32 nullifier; // prevents double verification
    }

    function isVerified(address user) external view returns (bool);
    function getVerificationData(address user) external view returns (VerificationData memory);
}
