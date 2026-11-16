// Helper to safely obtain Cloudflare D1 database and Workers AI bindings
// Works across both Astro 7 / Cloudflare:workers runtime and dev environments
export async function getCloudflareBindings() {
  try {
    // Dynamic import to satisfy Cloudflare runtime without breaking bundler
    const cf = await import('cloudflare:workers');
    return cf.env as any;
  } catch (e) {
    return null;
  }
}
