import type { NextConfig } from 'next';
const config: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['playwright', 'proper-lockfile'],
  outputFileTracingExcludes: { '/*': ['./datos-privados/**', './**/*.xlsx', './data/test-*/**'] },
};
export default config;
