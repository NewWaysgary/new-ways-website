// Where the code, expiry date and QR code go on the two approved gift voucher designs (public/images/vouchers/), in
// pixels from the top-left corner of the original 1983 × 793 images. The same layout is used for both designs, for the
// PNG (drawn at this exact size) and for the PDF (where the picture and these positions are scaled together).
//
// SUPPLIED is the coordinate file sent with the designs. Measured against the actual images, those regions sit to the
// left of the printed boxes (the code region starts 20 px left of the code box's border and overlaps its top edge;
// the expiry and QR regions start about 50 px left of their boxes). REGIONS are the same three areas fine-tuned to the
// INSIDE of each printed box, measured from the pixels of both images (identical in both):
//   code box inside: x 651–1529, y 587–662        -> region with padding inside it
//   expiry box inside: x 1647–1913, y 597–666     -> region with padding inside it
//   QR box: the light grey square inside the gold frame, x 1660–1901, y 90–331 (the QR code with its white quiet zone
//           covers exactly that square)
export const SUPPLIED = {
  code: { x: 628, y: 566, w: 855, h: 78 },
  expiry: { x: 1594, y: 576, w: 260, h: 70 },
  qr: { x: 1607, y: 88, w: 230, h: 230 }
};

export const LAYOUT = {
  width: 1983,
  height: 793,
  templates: { 30: '/images/vouchers/voucher-30.png', 60: '/images/vouchers/voucher-60.png' },
  regions: {
    code: { x: 671, y: 593, w: 839, h: 64 },
    expiry: { x: 1661, y: 603, w: 238, h: 58 },
    qr: { x: 1660, y: 90, w: 242, h: 242 }
  },
  text: {
    font: 'Caladea', fontUrl: '/fonts/Caladea-Bold.ttf', colour: '#00173C', qrDark: '#00173C',   // the designs' own dark navy
    capHeight: 0.667,      // Caladea Bold's capital height, as a share of the font size
    tracking: 0.08,        // extra space between letters, as a share of the font size
    padX: 14,              // space kept clear at each side of a box
    codeMax: 54, expiryMax: 44
  }
};

// The biggest font size (up to max) at which the text fits the region's width (after the side padding) and its
// capitals fill no more than 60% of the region's height. measure(text, size) -> width without the extra spacing.
export function fitText(str, r, max, measure) {
  const n = [...String(str)].length;
  const t = LAYOUT.text;
  const perUnit = measure(str, 1) + t.tracking * Math.max(0, n - 1);
  const byWidth = (r.w - 2 * t.padX) / perUnit;
  const byHeight = (r.h * 0.6) / t.capHeight;
  return { size: Math.floor(Math.min(max, byWidth, byHeight) * 10) / 10 };
}
