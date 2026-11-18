// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
interface IMembership {
    function mint() external payable returns (uint256);
    function withdraw(address payable recipient) external;
    function hasAccess(address account) external view returns (bool);
    function acceptOwnership() external;
}
contract RejectingReceiver {
    function mint(address membership) external payable { IMembership(membership).mint{value: msg.value}(); }
}
contract ReenteringReceiver is IERC721Receiver {
    IMembership public membership;
    bool public reentrySucceeded;
    bool public accessDuringCallback;
    function mint(address target) external payable { membership = IMembership(target); membership.mint{value: msg.value}(); }
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        accessDuringCallback = membership.hasAccess(address(this));
        try membership.mint() { reentrySucceeded = true; } catch {}
        return IERC721Receiver.onERC721Received.selector;
    }
}
contract RejectEther {
    function acceptOwnership(address membership) external { IMembership(membership).acceptOwnership(); }
    receive() external payable { revert("Rejected"); }
}
contract RejectRefundReceiver is IERC721Receiver {
    function mint(address membership) external payable { IMembership(membership).mint{value: msg.value}(); }
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { return IERC721Receiver.onERC721Received.selector; }
    receive() external payable { revert("No refunds"); }
}
