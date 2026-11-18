// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @dev Local tests only. Never use a mock price feed on a public network.
contract MockEthUsdFeed is IAggregatorV3 {
    uint8 public immutable decimals;
    string public constant description = "ETH / USD";
    uint80 private roundId = 1;
    int256 private answer;
    uint256 private updatedAt;
    uint80 private answeredInRound = 1;
    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
    }
    function setRound(uint80 id, int256 answer_, uint256 timestamp, uint80 answered) external {
        roundId = id; answer = answer_; updatedAt = timestamp; answeredInRound = answered;
    }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}
