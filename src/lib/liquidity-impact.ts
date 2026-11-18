export type LiquidityPixelDirection = 'up' | 'down'
export function liquidityPixelDirection(previousPrice:number,currentPrice:number):LiquidityPixelDirection|null {
 if(!Number.isFinite(previousPrice)||!Number.isFinite(currentPrice)||previousPrice===currentPrice)return null
 return currentPrice<previousPrice?'up':'down'
}
export function liquidityPixelOffset(direction:LiquidityPixelDirection,index:number,seed:number,progress:number){
 const age=Math.max(0,Math.min(1,progress)),travel=1-(1-age)**2
 const spread=(Math.sin(index*13+seed)+1)/2
 const fade=Math.min(1,age/(.75+spread*.25)),remaining=1-fade
 const size=Math.ceil((index%4===0?12:9)*remaining**.8)
 return {x:Math.sin(index*7+seed)*(14+spread*42)*travel,y:(direction==='up'?-1:1)*(30+spread*90)*travel,size,alpha:remaining**1.2}
}
