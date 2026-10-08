/** @type {import('next').NextConfig} */
const nextConfig = {
  // Legacy URLs are served as-is (e.g. /app_playtown/friendship_tree/ with the slash).
  skipTrailingSlashRedirect: true,
  // Native / heavy server deps stay external to the server bundle.
  serverExternalPackages: ['mysql2', 'pdfkit'],
};

export default nextConfig;
