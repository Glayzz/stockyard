// Everything the coin page shows for one stock meme. The pool itself comes from the on-chain
// league; prices, history, trades, pools and the stock's company profile come from Binance.
import { league } from './league.mjs';
import { bw3 } from './binance.mjs';

const C = { binanceChainId: '56' };
const cache = new Map();
const safe = (p) => p.catch(() => null);
const num = (v) => (v == null || v === '' ? null : Number(v));

export async function coin(input) {
  const address = input.toLowerCase();
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < 30000) return hit.value;

  const lg = await league();
  const row = lg.rows.filter((r) => r.address === address).sort((a, b) => b.stockUsd - a.stockUsd)[0];
  if (!row) throw Object.assign(new Error('This coin has no live pool against a stock token.'), { status: 404 });
  const stock = lg.stocks[row.sym];
  const one = (addr) => ({ ...C, tokenContractAddress: addr });

  const [info, adv, basic, pools, trades, coinBars, stockBars, rwaPrice, market, profile] = await Promise.all([
    safe(bw3('/api/v1/dex/market/price-info', { method: 'POST', body: [one(address)] })),
    safe(bw3('/api/v1/dex/market/token/advanced-info', { params: one(address) })),
    safe(bw3('/api/v1/dex/market/token/basic-info', { method: 'POST', params: one(address), body: {} })),
    safe(bw3('/api/v1/dex/market/token/top-liquidity', { params: one(address) })),
    safe(bw3('/api/v1/dex/market/trades', { params: { ...one(address), limit: '40' } })),
    safe(bw3('/api/v1/dex/market/candles', { params: { ...one(address), bar: '1h', limit: '200' } })),
    safe(bw3('/api/v1/dex/market/candles', { params: { ...one(row.stock), bar: '1h', limit: '200' } })),
    safe(bw3('/api/v1/dex/market/rwa/price', { params: { ...C, tokenContractAddresses: row.stock } })),
    safe(bw3('/api/v1/dex/market/rwa/underlying-market', { params: one(row.stock) })),
    safe(bw3('/api/v1/dex/market/rwa/underlying-profile', { params: one(row.stock) })),
  ]);
  const i = info?.[0];
  // Candles are [open, high, low, close, volumeUsd, openTimeMs, trades]; keep [seconds, close], oldest first.
  const series = (bars) => (bars || []).map((b) => [Math.floor(b[5] / 1000), Number(b[3])]).sort((a, b) => a[0] - b[0]);
  const company = profile?.companyInfo;

  const value = {
    binance: Boolean(i || trades || coinBars),
    coin: {
      address, symbol: row.coin, name: row.coinName, decimals: row.decimals, logo: basic?.tokenLogoUrl || row.logo || null,
      price: row.price, mcap: row.mcap, vol24: num(i?.volume24H), holders: i?.holders ?? adv?.holders ?? null,
      change: { h1: num(i?.priceChange1H) / 100, h4: num(i?.priceChange4H) / 100, h24: num(i?.priceChange24H) / 100 },
      created: basic?.createTime || adv?.createTime || null, top10: num(adv?.top10HoldingPercent), tags: adv?.tokenTags || [],
    },
    stock: {
      sym: row.sym, name: row.name, nameZh: stock?.nameZh || null, address: row.stock, logo: stock?.logo || null,
      price: stock?.price || null, tokenPrice: num(rwaPrice?.[0]?.tokenPrice), refPrice: num(rwaPrice?.[0]?.referencePrice),
      high52: num(market?.marketData?.high52W), low52: num(market?.marketData?.low52W),
      about: company?.description || null, aboutZh: company?.descriptionZh || null, website: company?.website || null, industry: company?.industry || null,
      backed: profile?.protections?.collateralReport?.supported ?? null,
    },
    pool: { pair: row.pair, shares: row.shares, stockUsd: row.stockUsd, coinInPool: row.coinInPool },
    pools: (pools || []).map((p) => {
      const other = (p.liquidityAmount || []).find((t) => t.tokenContractAddress?.toLowerCase() !== address);
      return { against: other?.tokenContractAddress?.toLowerCase() === row.stock ? row.name : other?.tokenSymbol || p.pool, protocol: p.protocolName, usd: num(p.liquidityUsd) || 0, isStock: other?.tokenContractAddress?.toLowerCase() === row.stock };
    }).filter((p) => p.usd > 0),
    trades: (trades?.trades || []).filter((t) => Number(t.volume) >= 1).map((t) => {
      const mine = (t.changedTokenInfo || []).find((x) => x.tokenContractAddress?.toLowerCase() === address);
      const st = (t.changedTokenInfo || []).find((x) => x.tokenContractAddress?.toLowerCase() === row.stock);
      const other = (t.changedTokenInfo || []).find((x) => x.tokenContractAddress?.toLowerCase() !== address);
      return { time: t.time, buy: t.type === 'buy', usd: Number(t.volume), coins: num(mine?.amount), shares: num(st?.amount), other: other?.tokenSymbol || null, hash: t.txHash };
    }),
    series: { coin: series(coinBars), stock: series(stockBars) },
  };
  cache.set(address, { at: Date.now(), value });
  return value;
}
