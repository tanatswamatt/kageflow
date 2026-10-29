import type { NextConfig } from "next";

// Sent with every page and API response (security review KF-H01).
const securityHeaders = [
  // only ever load Kageflow over HTTPS, for two years, including app. and www.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // no other site may show Kageflow inside a frame (stops click-jacking)
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // shared invoice links carry a secret token: never pass the full address on to other sites
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // the camera is used by the VIN scanner on this site only; nothing else is needed
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // imports send up to 2 000 rows in one go; the default 1 MB limit cut big files off
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
