import { describe, it, expect } from 'vitest';

describe('hexToRgba', () => {
  it('converts a hex colour with alpha 1', () => {
    expect(hexToRgba('#ff0000', 1)).toBe('rgba(255, 0, 0, 1)');
  });

  it('converts a hex colour with fractional alpha', () => {
    expect(hexToRgba('#00ff00', 0.5)).toBe('rgba(0, 255, 0, 0.5)');
  });

  it('converts a hex colour with alpha 0', () => {
    expect(hexToRgba('#0000ff', 0)).toBe('rgba(0, 0, 255, 0)');
  });

  it('handles a mixed-value hex colour', () => {
    expect(hexToRgba('#b41e1e', 0.15)).toBe('rgba(180, 30, 30, 0.15)');
  });

  it('handles the default blacklisted colour', () => {
    expect(hexToRgba('#32cd32', 1)).toBe('rgba(50, 205, 50, 1)');
  });
});
