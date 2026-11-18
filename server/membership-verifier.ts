import type {MembershipNetwork} from '../src/lib/membership-networks.js'
import {Contract,FetchRequest,JsonRpcProvider,getAddress,hashMessage,isAddress,verifyMessage} from 'ethers'
export type MembershipVerifier={network?:MembershipNetwork;cluster?:string;configured:boolean;chainId:number;contractAddress:string;hasAccess:(address:string)=>Promise<boolean>;validSignature:(address:string,message:string,signature:string)=>Promise<boolean>;close?:()=>void}
export function createMembershipVerifier(env:NodeJS.ProcessEnv):MembershipVerifier {
 const contractAddress=env.MEMBERSHIP_CONTRACT_ADDRESS||env.VITE_MEMBERSHIP_CONTRACT_ADDRESS||''
 const chainId=Number(env.MEMBERSHIP_CHAIN_ID||env.VITE_MEMBERSHIP_CHAIN_ID||0)
 const rpc=env.MEMBERSHIP_RPC_URL||(chainId===31337?'http://127.0.0.1:8545':env.ALCHEMY_API_KEY&&[1,11155111].includes(chainId)?`https://${chainId===1?'eth-mainnet':'eth-sepolia'}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`:'')
 const frontendMatches=(!env.VITE_MEMBERSHIP_CONTRACT_ADDRESS||env.VITE_MEMBERSHIP_CONTRACT_ADDRESS.toLowerCase()===contractAddress.toLowerCase())&&(!env.VITE_MEMBERSHIP_CHAIN_ID||Number(env.VITE_MEMBERSHIP_CHAIN_ID)===chainId)
 const publicChain=env.NODE_ENV!=='production'||![31337,1337].includes(chainId)
 const configured=frontendMatches&&publicChain&&isAddress(contractAddress)&&!/^0x0{40}$/i.test(contractAddress)&&Number.isSafeInteger(chainId)&&chainId>0&&!!rpc
 let provider:JsonRpcProvider|undefined
 if(configured){const request=new FetchRequest(rpc);request.timeout=8000;provider=new JsonRpcProvider(request,undefined,{cacheTimeout:0})}
 const ready=async()=>{
  if(!provider||!configured)throw new Error('Membership verification is not configured')
  if((await provider.getNetwork()).chainId!==BigInt(chainId))throw new Error('Membership RPC chain mismatch')
  if(await provider.getCode(contractAddress)==='0x')throw new Error('Membership contract unavailable')
  const contract=new Contract(contractAddress,['function hasAccess(address) view returns(bool)','function PRICE_USD() view returns(uint256)'],provider)
  if(await contract.PRICE_USD()!==200n)throw new Error('Unexpected membership contract')
  return contract
 }
 return {network:'ethereum',configured,chainId,contractAddress:configured?getAddress(contractAddress):'',async hasAccess(address){return Boolean(await(await ready()).hasAccess(address))},async validSignature(address,message,signature){
  try{if(getAddress(verifyMessage(message,signature))===getAddress(address))return true}catch{/* Contract wallets may use ERC-1271. */}
  await ready()
  if(await provider!.getCode(address)==='0x')return false
  try{return await new Contract(address,['function isValidSignature(bytes32,bytes) view returns(bytes4)'],provider).isValidSignature(hashMessage(message),signature)==='0x1626ba7e'}catch{return false}
 },close(){provider?.destroy()}}
}
