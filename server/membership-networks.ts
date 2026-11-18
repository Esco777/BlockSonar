import {createMembershipVerifier} from './membership-verifier.js'
import {SolanaMembership} from './solana-membership.js'
export function createMembershipNetworks(env:NodeJS.ProcessEnv=process.env){
 const ethereum=createMembershipVerifier(env)
 const chain=Number(env.MEMBERSHIP_BNB_CHAIN_ID||56),rpc=env.MEMBERSHIP_BNB_RPC_URL||(env.ALCHEMY_API_KEY&&[56,97].includes(chain)?`https://${chain===56?'bnb-mainnet':'bnb-testnet'}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`:'')
 const bnb=createMembershipVerifier({...env,MEMBERSHIP_CONTRACT_ADDRESS:env.MEMBERSHIP_BNB_CONTRACT_ADDRESS||'',MEMBERSHIP_CHAIN_ID:String(chain),MEMBERSHIP_RPC_URL:rpc,VITE_MEMBERSHIP_CONTRACT_ADDRESS:env.VITE_MEMBERSHIP_BNB_CONTRACT_ADDRESS||'',VITE_MEMBERSHIP_CHAIN_ID:String(chain)})
 bnb.network='bnb'
 const solana=new SolanaMembership(env)
 return {ethereum,bnb,solana}
}
