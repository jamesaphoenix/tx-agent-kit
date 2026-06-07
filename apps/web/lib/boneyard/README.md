# Boneyard skeleton harness

Route-accurate loading skeletons. Two layers:

1. **Static baseline** - `components/ui/boneyard-page-skeleton.tsx` exposes
   `<BoneyardPageSkeleton variant="..." />`, a dependency-free shadcn
   `Card` + `Skeleton` composition. It is always available and is what pages
   render today while their data resolves, so navigation never flashes a blank
   screen.

2. **Captured fixtures (runtime swap)** - a `boneyard:capture` script renders
   the `/boneyard-skeletons` gallery in a headless browser, snapshots the real
   DOM at each breakpoint in `boneyard.config.json`, and writes per-route
   fixtures into `lib/boneyard/bones/*.bones.json` plus a generated
   `registry.ts`. At runtime the `boneyard-js` registry swaps the static
   baseline for the pixel-accurate captured bones.

## Status in this repo

The static baseline (layer 1), the `boneyard.config.json` capture config, and
the `/boneyard-skeletons` gallery route are wired. The runtime fixture-capture
layer (layer 2) is intentionally **not** wired yet because it requires:

- adding the `boneyard-js` dependency (a `pnpm install`, run separately), and
- running the `boneyard:capture` script against this app's real routes to
  generate the per-route `*.bones.json` fixtures + `registry.ts`.

Until that runs, every page falls back to the static `BoneyardPageSkeleton`
variant, which is the correct, safe default. See the follow-up note in the port
summary for the capture wiring.
