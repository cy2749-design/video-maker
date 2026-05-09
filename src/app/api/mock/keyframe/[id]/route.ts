export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <rect x="110" y="280" width="860" height="1080" rx="36" fill="#111827" opacity=".82" stroke="#5eead4" stroke-opacity=".45"/>
  <rect x="180" y="380" width="720" height="360" rx="24" fill="#1f2937"/>
  <rect x="220" y="440" width="280" height="28" rx="14" fill="#f59e0b"/>
  <rect x="220" y="510" width="560" height="22" rx="11" fill="#94a3b8"/>
  <rect x="220" y="570" width="490" height="22" rx="11" fill="#64748b"/>
  <circle cx="540" cy="980" r="165" fill="#334155"/>
  <rect x="310" y="1160" width="460" height="90" rx="45" fill="#0f766e"/>
  <text x="540" y="1510" fill="#f8fafc" font-family="Arial, sans-serif" font-size="54" text-anchor="middle">Mock Keyframe</text>
  <text x="540" y="1590" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="34" text-anchor="middle">${id}</text>
</svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
}
