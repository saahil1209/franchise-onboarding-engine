// Vercel function: hands the browser the Google Maps JavaScript API key from the project's environment variables.
// A Maps JS key is visible to the browser by design, so restrict it to this site's domain (HTTP referrer) and
// to the Maps JavaScript API in Google Cloud. Never put a Gemini or other server-only key here.
const NAMES = ['GOOGLE_MAPS_API_KEY', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_KEY', 'MAPS_API_KEY', 'VITE_GOOGLE_MAPS_API_KEY'];

// Pasted values often carry quotes, spaces or a line break; Google then reports InvalidKeyMapError.
export const clean = v => String(v ?? '').trim().replace(/^["'`]+|["'`;]+$/g, '').trim();

export default function handler(req, res) {
  const name = NAMES.find(n => clean(process.env[n]));
  res.setHeader('Cache-Control', 'no-store');
  if (!name) return res.status(404).json({ error: `No Maps key set. Add GOOGLE_MAPS_API_KEY in the Vercel project's environment variables and redeploy.` });
  const key = clean(process.env[name]);
  // A Google API key is 39 characters and starts with "AIza". The check is only a hint for whoever is debugging.
  const looksRight = /^AIza[0-9A-Za-z_-]{35}$/.test(key);
  res.status(200).json({
    key, mapId: clean(process.env.GOOGLE_MAPS_MAP_ID) || 'DEMO_MAP_ID',
    check: { variable: name, length: key.length, startsWith: key.slice(0, 4), looksLikeAGoogleKey: looksRight },
  });
}
