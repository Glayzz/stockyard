# public/vendor

`walletconnect.js` is [@walletconnect/ethereum-provider](https://www.npmjs.com/package/@walletconnect/ethereum-provider)
2.26.0 and what it depends on, bundled into one browser module so the site needs no build step and
no outside CDN. `public/trade.js` only fetches it when someone presses the WalletConnect button.

To rebuild it, in an empty folder:

```bash
npm install --ignore-scripts @walletconnect/ethereum-provider@2.26.0 esbuild@0.25
echo "export { EthereumProvider } from '@walletconnect/ethereum-provider';" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 --platform=browser \
  --define:global=globalThis --define:process.env.NODE_ENV='"production"' \
  --legal-comments=none --outfile=walletconnect.js
```

The button shows once `WALLETCONNECT_ID` in `public/shared.js` holds a project ID from
[dashboard.reown.com](https://dashboard.reown.com). The ID is public by design.
