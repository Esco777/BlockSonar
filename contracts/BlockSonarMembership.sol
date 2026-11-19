// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

//A lifetime BlockSonar membership belongs to the current NFT holder.
//No expiry, burn, blacklist, admin revocation, or upgrade mechanism.
contract BlockSonarMembership is ERC721, Ownable2Step, ReentrancyGuard {
    uint256 public constant PRICE_USD = 200;
    uint256 public constant SALE_COMMISSION_PERCENT = 10;
    address public immutable deployer;
    IAggregatorV3 public immutable ethUsdFeed;
    uint256 public immutable maxPriceAge;
    uint256 private immutable feedScale;
    uint256 public immutable maxSupply;
    uint256 public totalMinted;
    bool public mintingOpen;
    mapping(address => uint256) public membershipTokenOf;
    // Native-currency asking price in wei; zero means unlisted.
    mapping(uint256 => uint256) public salePrice;
    string private baseTokenURI;

    error InvalidPriceFeed();
    error InvalidPriceAge();
    error InvalidOraclePrice();
    error StaleOraclePrice();
    error RefundFailed();
    error OnlyDeployer(address caller);
    error InvalidSupply();
    error EmptyBaseURI();
    error MintingClosed();
    error IncorrectPayment(uint256 expected, uint256 received);
    error AlreadyMember(address account);
    error SoldOut();
    error InvalidRecipient();
    error NoFunds();
    error WithdrawalFailed();
    error NotTokenOwner();
    error InvalidSalePrice();
    error NotForSale();
    error SalePaymentFailed();

    event MembershipPurchased(address indexed member, uint256 indexed tokenId, uint256 paidWei);
    event MembershipIssued(address indexed member, uint256 indexed tokenId);
    event MintingStatusChanged(bool open);
    event FundsWithdrawn(address indexed recipient, uint256 amount);
    event MembershipListed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event MembershipListingCancelled(uint256 indexed tokenId);
    event MembershipSold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, address commissionRecipient, uint256 commission);

    constructor(
        address initialOwner,
        address feed,
        uint256 maxPriceAge_,
        uint256 supply, string memory baseURI_)

        ERC721("BlockSonar Lifetime Membership", "SONAR")
        Ownable(initialOwner)
    {
        if (supply == 0) revert InvalidSupply();
        if (bytes(baseURI_).length == 0) revert EmptyBaseURI();
        if (feed.code.length == 0) revert InvalidPriceFeed();
        if (maxPriceAge_ == 0) revert InvalidPriceAge();
        uint8 decimals_ = IAggregatorV3(feed).decimals();
        if (decimals_ > 18) revert InvalidPriceFeed();
        deployer = msg.sender;
        ethUsdFeed = IAggregatorV3(feed);
        maxPriceAge = maxPriceAge_;
        feedScale = 10 ** decimals_;
        maxSupply = supply;
        baseTokenURI = baseURI_;
    }

    function hasAccess(address account) external view returns (bool) {
        return account != address(0) && membershipTokenOf[account] != 0;
    }

    function setMintingOpen(bool open) external onlyOwner nonReentrant {
        mintingOpen = open;
        emit MintingStatusChanged(open);
    }

    //Native ETH or BNB needed for $200, rounded up to the nearest wei. The deployment must use the matching native/USD feed.
    function mintPrice()
        public view returns (uint256)

    {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = ethUsdFeed.latestRoundData();
        if (answer <= 0 || roundId == 0 || answeredInRound < roundId || updatedAt == 0 || updatedAt > block.timestamp) revert InvalidOraclePrice();
        if (block.timestamp - updatedAt > maxPriceAge) revert StaleOraclePrice();
        return Math.mulDiv(PRICE_USD * 1 ether, feedScale, uint256(answer), Math.Rounding.Ceil);
    }

    function mint() external payable nonReentrant returns (uint256 tokenId) {
        if (!mintingOpen) revert MintingClosed();
        uint256 required = mintPrice();

        if (msg.value < required) revert IncorrectPayment(required, msg.value);
        tokenId = _issue(msg.sender);

        uint256 excess = msg.value - required;
        if (excess != 0) {
            (bool success,) = payable(msg.sender).call{value: excess}("");
            if (!success) revert RefundFailed();
        }

        emit MembershipPurchased(msg.sender, tokenId, required);
    }

    function listForSale(uint256 tokenId, uint256 price) external nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        if (price == 0) revert InvalidSalePrice();
        salePrice[tokenId] = price;
        emit MembershipListed(tokenId, msg.sender, price);
    }

    function cancelSale(uint256 tokenId) external nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        if (salePrice[tokenId] == 0) revert NotForSale();
        delete salePrice[tokenId];
        emit MembershipListingCancelled(tokenId);
    }

    // Commission applies to sales settled here. Ordinary ERC721 transfers remain available.
    function buyMembership(uint256 tokenId) external payable nonReentrant {

        uint256 price = salePrice[tokenId];
        if (price == 0) revert NotForSale();

        if (msg.value != price) revert IncorrectPayment(price, msg.value);
        address seller = ownerOf(tokenId);

        if (msg.sender == seller) revert InvalidRecipient();
        address commissionRecipient = owner();

        // Round down to whole wei; the seller receives the remainder.
        uint256 commission = Math.mulDiv(price, SALE_COMMISSION_PERCENT, 100);

        // _update clears the listing and moves membership before any callbacks.
        _safeTransfer(seller, msg.sender, tokenId);

        (bool sellerPaid,) = payable(seller).call{value: price - commission}("");
        if (!sellerPaid) revert SalePaymentFailed();

        if (commission != 0) {
            (bool ownerPaid,) = payable(commissionRecipient).call{value: commission}("");
            if (!ownerPaid) revert SalePaymentFailed();
        }
        emit MembershipSold(tokenId, seller, msg.sender, price, commissionRecipient, commission);
    }

    // Ownership controls administration and resale commissions. Mint withdrawals stay with the original deployer.
    // Administrative changes must not run inside mint/refund callbacks.
    function transferOwnership(address newOwner) public override onlyOwner nonReentrant {
        super.transferOwnership(newOwner);
    }

    function acceptOwnership() public override nonReentrant {
        super.acceptOwnership();
    }

    function renounceOwnership() public view override onlyOwner
    {
        revert InvalidRecipient();
    }

    //Owner-issued memberships share the same supply and one-per-wallet rules.
    function mintFor(address member) external onlyOwner nonReentrant returns (uint256) {
        return _issue(member);
    }

    function withdraw(address payable recipient) external nonReentrant {
        if (msg.sender != deployer) revert OnlyDeployer(msg.sender);

        if (recipient == address(0)) revert InvalidRecipient();
        uint256 amount = address(this).balance;

        if (amount == 0) revert NoFunds();
        (bool success,) = recipient.call{value: amount}("");

        if (!success) revert WithdrawalFailed();
        emit FundsWithdrawn(recipient, amount);
    }

    function _issue(address member) private returns (uint256 tokenId) {
        if (member == address(0)) revert InvalidRecipient();

        if (membershipTokenOf[member] != 0) revert AlreadyMember(member);

        if (totalMinted == maxSupply) revert SoldOut();
        tokenId = ++totalMinted;
        _safeMint(member, tokenId);
        emit MembershipIssued(member, tokenId);
    }

    function _update(address to,
        uint256 tokenId,
        address auth) internal override returns (address from)
        {
        address previous = _ownerOf(tokenId);
        if (to != address(0) && to != previous && membershipTokenOf[to] != 0) revert AlreadyMember(to);
        from = super._update(to, tokenId, auth);

        if (salePrice[tokenId] != 0) {
            delete salePrice[tokenId];
            emit MembershipListingCancelled(tokenId);
        }

        if (from != address(0)) delete membershipTokenOf[from];

        if (to != address(0)) membershipTokenOf[to] = tokenId;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }
}
