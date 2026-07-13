import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// All docs pages are prerendered (SSG, no revalidate), so serve them from the
// read-only static assets cache instead of rendering on demand in the Worker.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
