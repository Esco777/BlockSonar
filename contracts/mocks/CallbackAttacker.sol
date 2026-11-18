// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @dev Test harness only. Can act as a buyer, owner, or withdrawal recipient.
contract CallbackAttacker is IERC721Receiver {
    address public target;
    address public forwardTo;
    bytes public payload;
    uint256 public attackValue;
    uint8 public callback; // 1: NFT receipt, 2: ETH receipt
    bool public attempted;
    bool public succeeded;
    bytes public result;

    function configure(address target_, address forwardTo_, bytes calldata payload_, uint256 value_, uint8 callback_) external {
        target = target_;
        forwardTo = forwardTo_;
        payload = payload_;
        attackValue = value_;
        callback = callback_;
        attempted = false;
        succeeded = false;
        delete result;
    }

    function execute(bytes calldata data) external payable {
        (bool ok, bytes memory reason) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
        }
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        require(msg.sender == target, "Unexpected NFT");
        // Remove the membership before reentering, so AlreadyMember cannot mask
        // a missing reentrancy guard. Tests also fund the nested purchase.
        if (forwardTo != address(0)) IERC721(target).transferFrom(address(this), forwardTo, tokenId);
        if (callback == 1) _attack();
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        if (callback == 2) _attack();
    }

    function _attack() private {
        if (attempted) return;
        attempted = true;
        (succeeded, result) = target.call{value: attackValue}(payload);
    }
}
