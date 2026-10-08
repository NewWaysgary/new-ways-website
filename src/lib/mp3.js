// Works out how long an MP3 recording is, on the server, by reading its frames (nothing is trusted from the browser).
// Used to make sure a public preview is 1 minute or less.
const BITRATES = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};
const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

function header(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const v = (b[i + 1] >> 3) & 3, l = (b[i + 1] >> 1) & 3, br = b[i + 2] >> 4, sr = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (v === 1 || l === 0 || br === 0 || br === 15 || sr === 3) return null;
  const version = v === 3 ? 1 : v === 2 ? 2 : 25;
  const layer = 4 - l;                                    // 1, 2 or 3
  const bitrate = BITRATES[`${version === 1 ? 1 : 2}-${layer}`][br] * 1000;
  const rate = RATES[version][sr];
  const samples = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
  const length = layer === 1 ? (Math.floor(12 * bitrate / rate) + pad) * 4 : Math.floor((samples / 8) * bitrate / rate) + pad;
  const mono = (b[i + 3] >> 6) === 3;
  return { version, layer, rate, samples, length, mono };
}

// Returns the length in seconds, or null if this isn't an MP3 file.
export function mp3Duration(bytes) {
  const b = bytes;
  let i = 0;
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {        // ID3v2 tag at the start
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f)) + (b[5] & 0x10 ? 10 : 0);
  }
  let guard = 0;
  while (i < b.length && !header(b, i) && guard++ < 65536) i++;
  const first = header(b, i);
  if (!first) return null;

  // A VBR header (Xing/Info or VBRI) in the first frame gives the total number of frames
  const side = first.version === 1 ? (first.mono ? 17 : 32) : (first.mono ? 9 : 17);
  const x = i + 4 + side;
  const tag = String.fromCharCode(...b.slice(x, x + 4));
  if ((tag === 'Xing' || tag === 'Info') && (b[x + 7] & 1)) {
    const frames = ((b[x + 8] << 24) >>> 0) + (b[x + 9] << 16) + (b[x + 10] << 8) + b[x + 11];
    if (frames > 0) return frames * first.samples / first.rate;
  }
  if (String.fromCharCode(...b.slice(i + 36, i + 40)) === 'VBRI') {
    const frames = ((b[i + 50] << 24) >>> 0) + (b[i + 51] << 16) + (b[i + 52] << 8) + b[i + 53];
    if (frames > 0) return frames * first.samples / first.rate;
  }

  // Otherwise count every frame
  let seconds = 0, frames = 0;
  while (i < b.length) {
    const h = header(b, i);
    if (h && h.length > 0) { seconds += h.samples / h.rate; frames++; i += h.length; continue; }
    if (b[i] === 0x54 && b[i + 1] === 0x41 && b[i + 2] === 0x47) break;            // ID3v1 tag at the end
    let skip = 0;
    while (i < b.length && !header(b, i) && skip++ < 4096) i++;                     // lost step: find the next frame
    if (skip > 4096) break;
  }
  return frames >= 2 ? seconds : null;
}
