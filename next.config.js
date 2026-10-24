/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Better-sqlite3 is a native Node.js module that should work in API routes
  // If you encounter build issues, you may need to ensure it's properly bundled
  
  // HTTP Agent Options for persistent connections (Tailscale mobile optimization)
  httpAgentOptions: {
    keepAlive: true,
  },
  
  // Enable Webpack to handle TypeScript in server.js
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'ws'];
    }
    return config;
  },
};

module.exports = nextConfig;
