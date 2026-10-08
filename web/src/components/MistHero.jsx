/*
 * Decorative highland backdrop: layered mountain ridges and pine silhouettes.
 * Colors come from theme tokens (--bs-mist-*, --bs-pine) so it follows light/dark.
 * The fade into the page surface is done in CSS (.mist-hero::after).
 */

const WIDTH = 1440;
const HEIGHT = 340;

// Small seeded PRNG so the tree layout is stable between renders and builds.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pines cluster at the edges of the viewport and leave the middle open for the title.
function buildTrees() {
  const rand = mulberry32(1500);
  const center = WIDTH / 2;
  const trees = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 26; i += 1) {
      const offset = 150 + i * 26 + rand() * 18;
      const height = 52 + rand() * 48 + (offset > 400 ? 14 : 0);
      trees.push({
        x: Math.round(center + side * offset),
        base: Math.round(262 + rand() * 12),
        height: Math.round(height),
        opacity: Number((0.6 + rand() * 0.35).toFixed(2)),
      });
    }
  }
  return trees;
}

const TREES = buildTrees();

export default function MistHero() {
  return (
    <div className="mist-hero" aria-hidden="true">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMax slice"
        focusable="false"
      >
        <defs>
          <linearGradient id="mist-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--bs-mist-far)" stopOpacity="0.6" />
            <stop offset="1" stopColor="var(--bs-mist-far)" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="mist-near" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--bs-mist-near)" stopOpacity="0.65" />
            <stop offset="1" stopColor="var(--bs-mist-near)" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <path
          d="M0 200 L120 150 L240 185 L380 110 L520 175 L640 140 L760 100 L900 170 L1040 130 L1180 180 L1300 135 L1440 175 L1440 340 L0 340Z"
          fill="url(#mist-far)"
        />
        <path
          d="M0 245 L140 195 L280 230 L420 180 L560 225 L720 170 L880 225 L1020 190 L1160 235 L1300 195 L1440 235 L1440 340 L0 340Z"
          fill="url(#mist-near)"
        />
        {TREES.map(({ x, base, height, opacity }) => {
          const w = height * 0.42;
          return (
            <g key={`${x}-${base}`} opacity={opacity} fill="var(--bs-pine)">
              <polygon
                points={`${x},${base - height} ${x - w * 0.6},${base - height * 0.55} ${x + w * 0.6},${base - height * 0.55}`}
              />
              <polygon
                points={`${x},${base - height * 0.75} ${x - w * 0.8},${base - height * 0.28} ${x + w * 0.8},${base - height * 0.28}`}
              />
              <polygon
                points={`${x},${base - height * 0.5} ${x - w},${base} ${x + w},${base}`}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
