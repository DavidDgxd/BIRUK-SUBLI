import { describe, expect, it } from 'vitest';
import { nextTabIndex } from './rovingTabs.js';

describe('nextTabIndex', () => {
  it('wraps right and left across the tab list', () => {
    expect(nextTabIndex(0, 'ArrowRight', 2)).toBe(1);
    expect(nextTabIndex(1, 'ArrowRight', 2)).toBe(0);
    expect(nextTabIndex(1, 'ArrowLeft', 2)).toBe(0);
    expect(nextTabIndex(0, 'ArrowLeft', 2)).toBe(1);
  });

  it('jumps to the edges with Home and End', () => {
    expect(nextTabIndex(1, 'Home', 2)).toBe(0);
    expect(nextTabIndex(0, 'End', 2)).toBe(1);
  });

  it('ignores keys outside the pattern and empty lists', () => {
    expect(nextTabIndex(0, 'Tab', 2)).toBeNull();
    expect(nextTabIndex(0, 'ArrowRight', 0)).toBeNull();
  });
});
