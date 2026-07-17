/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  async redirects() {
    return [
      {
        source: '/moat',
        destination: '/scan',
        permanent: true,
      },
      {
        source: '/moat/:path*',
        destination: '/scan/:path*',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/scan',
        destination: '/moat',
      },
      {
        source: '/scan/:path*',
        destination: '/moat/:path*',
      },
    ]
  },
}
export default nextConfig
