# planeweb

Shared charts, formatters, and theme helpers for network-plane browser apps.

**No npm.** Apps bundle this package with **esbuild** (same as Speedplane):

```bash
esbuild web/src/main.ts --bundle --outfile=web/dist/main.js --sourcemap
```

In your app entry, import by path, for example:

```ts
import { renderLineChart, fetchJSON } from "../../../packages/planeweb/src/index.ts";
```

esbuild follows those imports and compiles TypeScript. To use a checkout of [network-plane/planeweb](https://github.com/network-plane/planeweb) elsewhere, vendor or submodule the `src/` tree and point imports at that path.

This repo does not use npm, Node, or nvm.
