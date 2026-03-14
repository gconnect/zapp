// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CeloPayRegistry
 * @notice ERC-8004 inspired agent identity registry
 * @dev Each minted NFT represents a registered agent with an IPFS metadata URI
 */
contract CeloPayRegistry is ERC721URIStorage, Ownable {
    // ─── State ──────────────────────────────────────────────────────────────────

    uint256 private _tokenIds;
    mapping(address => uint256) public agentToken;      // agent address => tokenId
    mapping(uint256 => address) public tokenAgent;      // tokenId => agent address
    mapping(uint256 => uint256) public registeredAt;    // tokenId => timestamp
    mapping(uint256 => bool)    public isActive;        // tokenId => active status

    // ─── Events ─────────────────────────────────────────────────────────────────

    event AgentRegistered(uint256 indexed tokenId, address indexed agent, string metadataURI);
    event AgentUpdated(uint256 indexed tokenId, string newMetadataURI);
    event AgentDeactivated(uint256 indexed tokenId);

    // ─── Errors ─────────────────────────────────────────────────────────────────

    error AgentAlreadyRegistered();
    error NotAgentOwner();
    error AgentNotFound();

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor() ERC721("CeloPay Agent Registry", "CPAR") Ownable(msg.sender) {}

    // ─── Registration ────────────────────────────────────────────────────────────

    /**
     * @notice Register an agent with an IPFS metadata URI
     * @param agentAddress The wallet address that will operate as the agent
     * @param metadataURI IPFS URI pointing to ERC-8004 registration JSON
     */
    function registerAgent(address agentAddress, string calldata metadataURI)
        external
        returns (uint256 tokenId)
    {
        if (agentToken[agentAddress] != 0) revert AgentAlreadyRegistered();

        _tokenIds++;
        tokenId = _tokenIds;

        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);

        agentToken[agentAddress]  = tokenId;
        tokenAgent[tokenId]       = agentAddress;
        registeredAt[tokenId]     = block.timestamp;
        isActive[tokenId]         = true;

        emit AgentRegistered(tokenId, agentAddress, metadataURI);
    }

    /**
     * @notice Update the metadata URI for a registered agent
     */
    function updateAgent(uint256 tokenId, string calldata newMetadataURI) external {
        if (ownerOf(tokenId) != msg.sender) revert NotAgentOwner();
        _setTokenURI(tokenId, newMetadataURI);
        emit AgentUpdated(tokenId, newMetadataURI);
    }

    /**
     * @notice Deactivate an agent registration
     */
    function deactivateAgent(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotAgentOwner();
        isActive[tokenId] = false;
        emit AgentDeactivated(tokenId);
    }

    // ─── View ────────────────────────────────────────────────────────────────────

    function getAgentInfo(address agentAddress) external view returns (
        uint256 tokenId,
        string memory metadataURI,
        uint256 registrationTime,
        bool active
    ) {
        tokenId = agentToken[agentAddress];
        if (tokenId == 0) revert AgentNotFound();
        return (
            tokenId,
            tokenURI(tokenId),
            registeredAt[tokenId],
            isActive[tokenId]
        );
    }

    function totalAgents() external view returns (uint256) {
        return _tokenIds;
    }
}
