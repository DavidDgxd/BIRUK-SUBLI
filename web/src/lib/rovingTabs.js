/* WAI-ARIA tabs keyboard model: arrow keys wrap, Home/End jump to the edges. */
export function nextTabIndex(currentIndex, key, count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return null;
  if (key === 'ArrowRight') return (currentIndex + 1) % count;
  if (key === 'ArrowLeft') return (currentIndex - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
