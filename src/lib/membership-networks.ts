export type MembershipNetwork='ethereum'|'bnb'|'solana'
export type MembershipNetworkInfo={id:MembershipNetwork;name:string;currency:'ETH'|'BNB'|'SOL';walletKind:'evm'|'solana';chainId:number;contractAddress:string;configured:boolean;cluster?:string}
export const MEMBERSHIP_NETWORK_LABELS={ethereum:{name:'Ethereum',currency:'ETH'},bnb:{name:'BNB Chain',currency:'BNB'},solana:{name:'Solana',currency:'SOL'}} as const
