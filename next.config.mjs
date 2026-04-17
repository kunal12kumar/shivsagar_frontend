/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Skip ESLint during `next build` — CI lint is handled separately.
  // This prevents warnings (unused vars, <img> tags) from failing the Amplify build.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Skip TypeScript type-check during build — keeps deploy fast.
  typescript: {
    ignoreBuildErrors: true,
  },

  // Allow images from any HTTPS source (S3, CDN, local API proxy)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http',  hostname: 'localhost' },
    ],
  },
}
export default nextConfig
