import {coinGeckoConfig} from '../server/dist/server/coingecko-config.js'
import {CoinGeckoMarkets} from '../server/dist/server/coingecko-markets.js'
const publicConfig = {}
const config = coinGeckoConfig(publicConfig), service = new CoinGeckoMarkets(publicConfig)
try {
 console.log(JSON.stringify({provider:'CoinGecko',plan:config.mode,keyConfigured:config.configured}))
 const result=await service.page(1)
 console.log(JSON.stringify({connected:true,rows:result.rows.length,observedAt:result.at}))
}catch(error){console.error(error.message);process.exitCode=1}finally{service.stop()}
