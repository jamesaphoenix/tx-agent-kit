import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  typescript: {
    // .source module types are resolved by Turbopack at compile time,
    // not by tsc. Skip the standalone TS check during build.
    ignoreBuildErrors: true,
  },
};

const withMDX = createMDX();

export default withMDX(config);
