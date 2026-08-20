import { afterEach, describe, expect, it } from 'vitest';

import { imageUrl } from './api';

afterEach(() => window.history.pushState({}, '', '/'));

describe('imageUrl', () => {
  it('selects the POS session for image tags rendered by the POS', () => {
    window.history.pushState({}, '', '/pos');

    expect(imageUrl('product', 7, 3)).toBe('/api/v1/images/product/7?v=3&session_surface=pos');
  });

  it('keeps administration image URLs unchanged', () => {
    expect(imageUrl('pos_category', 2, 1)).toBe('/api/v1/images/pos_category/2?v=1');
  });
});
