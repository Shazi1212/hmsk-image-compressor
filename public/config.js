// Settings a self-hoster may change.

// Where the top-strip links (back, imprint, privacy) point. '' = same site (hmsk.life hosts the app under /apps/).
export const LINK_BASE = 'https://hmsk.life';

// Size presets: the image is scaled down (never up) to fit inside maxW x maxH. These are sensible sizes for each
// place, not official limits of those platforms.
export const PRESETS = {
  original: { maxW: 0, maxH: 0, quality: 85 },
  kleinanzeigen: { maxW: 1600, maxH: 1600, quality: 80 },
  ebay: { maxW: 1600, maxH: 1600, quality: 85 },
  vinted: { maxW: 1280, maxH: 1280, quality: 80 },
  instagram: { maxW: 1080, maxH: 1350, quality: 85 },
  email: { maxW: 1280, maxH: 1280, quality: 72 },
  custom: { maxW: 2000, maxH: 2000, quality: 80 },
};

// Canvas size limit. iPhones and iPads refuse canvases above ~16.7 megapixels.
export const MAX_PIXELS_TOUCH = 16777216;
export const MAX_PIXELS = 60000000;
