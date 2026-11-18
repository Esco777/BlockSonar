# Membership security boundaries

This review and the automated tests are not an independent security audit or a guarantee of safety.

## Callback hardening

Minting, owner issuance, withdrawals, sale status changes, and both stages of ownership transfer share OpenZeppelin's reentrancy guard. An NFT receiver, refund receiver, or owner receiving ETH cannot reenter these operations during settlement. Ordinary authorized ERC721 transfers remain available, including transfers from a receiver callback. Membership belongs to the current holder, who may differ from the original purchaser by the time the purchase completes.

The callback security suite funds nested purchases and transfers the first NFT away before retrying. It checks the exact reentrancy error rather than accepting any failed call. This prevents underpayment or the one-membership rule from masking a missing guard. It also checks owner callbacks, withdrawal callbacks, pending ownership acceptance, and normal operations after a blocked attempt.

## Trust and availability

- The owner can issue free memberships up to the shared cap, close public minting, and transfer ownership. Protect the owner account; a compromised owner can exercise those powers. Existing memberships cannot be administratively revoked.
- The immutable oracle address must be a trusted ETH/USD feed for the deployment chain. Interface compatibility and timestamp checks cannot establish that a price is truthful. Never deploy with the unrestricted mock feed used by tests.
- Set maximum price age against the selected feed's documented heartbeat and application requirements. Oracle failures or stale prices halt paid minting; they do not remove existing membership access.
- The current implementation has no L2 sequencer-uptime check. Review and implement chain-specific protections before deploying on a sequencer-based L2.
- Purchases send ETH directly to the owner. An owner contract that rejects ETH blocks paid minting until ownership is transferred to a working recipient. This behavior is deliberate and tested.
- A failed refund or NFT-receiver callback reverts the entire purchase, including the NFT and payment. It affects that purchase, not future buyers.
- One membership per wallet is not one membership per person. Users can use additional wallets or transfer their NFT before purchasing again.
- Source changes do not update an already deployed instance: this contract has no upgrade mechanism.

## Verification

Run `npm run contracts:test`. JavaScript tests live in `contracts/test`; Solidity attack harnesses live in `contracts/mocks` and must not be used as production services.

References: [OpenZeppelin ReentrancyGuard](https://docs.openzeppelin.com/contracts/5.x/api/utils#ReentrancyGuard), [Chainlink feed selection](https://docs.chain.link/data-feeds/selecting-data-feeds), [Chainlink EVM feed usage](https://docs.chain.link/data-feeds/using-data-feeds).
