/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
    ],
  },
  // This allows any origin during development to prevent "Invalid Header" errors
  allowedDevOrigins: ['localhost:3000', '192.168.1.246:3000', '192.168.1.246'],
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', '192.168.1.246:3000'],
    },
  },
};

export default nextConfig;