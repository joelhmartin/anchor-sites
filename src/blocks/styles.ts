// Client-only entry: imports every block's CSS so the SPA bundle includes them.
// The server's `src/blocks/index.ts` does NOT import this — tsx can't handle
// .css imports at runtime. Vite picks this up via the client bundle.

import "./hero/styles.css";
import "./rich-text/styles.css";
import "./cta/styles.css";
