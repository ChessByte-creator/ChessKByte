/** Mascote do Byte Chess: um peão-robô em pixel art. */
export function ByteMark({ size = 44 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} role="img" aria-label="Byte, o peão-robô" shapeRendering="crispEdges">
      <rect x="0" y="0" width="16" height="16" rx="3" fill="#3f2a1d" />
      {/* antena */}
      <rect x="7" y="1" width="2" height="2" fill="#f0d9b5" />
      <rect x="7" y="3" width="2" height="1" fill="#b58863" />
      {/* cabeça */}
      <rect x="3" y="4" width="10" height="7" fill="#f0d9b5" />
      <rect x="2" y="5" width="1" height="5" fill="#b58863" />
      <rect x="13" y="5" width="1" height="5" fill="#b58863" />
      {/* olhos */}
      <rect x="5" y="6" width="2" height="2" fill="#1c1915" />
      <rect x="9" y="6" width="2" height="2" fill="#1c1915" />
      <rect x="5" y="6" width="1" height="1" fill="#f4efe6" />
      <rect x="9" y="6" width="1" height="1" fill="#f4efe6" />
      {/* boca */}
      <rect x="5" y="9" width="6" height="1" fill="#8e342c" />
      {/* base de peão */}
      <rect x="4" y="12" width="8" height="2" fill="#b58863" />
      <rect x="3" y="14" width="10" height="1" fill="#f0d9b5" />
    </svg>
  );
}
