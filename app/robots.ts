import type { MetadataRoute } from "next";

/** app.kageflow.co.za is the private app; keep crawlers out (the marketing site has its own robots.txt) */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
