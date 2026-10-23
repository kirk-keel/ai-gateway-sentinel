import { describe, it, expect } from 'vitest';
import { visionDlpSanitizer } from '../src/guardrails/vision-dlp.js';
import { sanitizeChatRequestBody } from '../src/guardrails/index.js';

describe('Multi-Modal Vision DLP: EXIF GPS & Metadata Sanitizer', () => {
  // Helper to create synthetic JPEG with APP1 EXIF segment
  function createJpegWithExif(): Buffer {
    const exifData = Buffer.from('Exif\0\0GPS:Lat=29.7604,Lon=-95.3698');
    const app1Length = exifData.length + 2; // Length includes the 2 length bytes
    const app1Header = Buffer.from([0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff]);

    return Buffer.concat([
      Buffer.from([0xff, 0xd8]), // SOI
      app1Header,
      exifData,
      Buffer.from([0xff, 0xd9]), // EOI
    ]);
  }

  function createCleanJpeg(): Buffer {
    return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // SOI + EOI
  }

  it('detects and strips EXIF GPS metadata from JPEG data URLs', () => {
    const rawJpeg = createJpegWithExif();
    const dataUrl = `data:image/jpeg;base64,${rawJpeg.toString('base64')}`;

    const result = visionDlpSanitizer.sanitizeDataUrl(dataUrl);
    expect(result.hasExifMetadata).toBe(true);
    expect(result.strippedTags).toContain('EXIF_APP1_GPS_METADATA');

    // Decode sanitized buffer to verify APP1 was stripped
    const cleanB64 = result.sanitizedDataUrl.replace(/^data:image\/jpeg;base64,/, '');
    const cleanBuf = Buffer.from(cleanB64, 'base64');

    expect(cleanBuf[0]).toBe(0xff);
    expect(cleanBuf[1]).toBe(0xd8); // SOI intact
    expect(cleanBuf[cleanBuf.length - 2]).toBe(0xff);
    expect(cleanBuf[cleanBuf.length - 1]).toBe(0xd9); // EOI intact

    // Must not contain the EXIF marker 0xFF 0xE1
    let containsApp1 = false;
    for (let i = 0; i < cleanBuf.length - 1; i++) {
      if (cleanBuf[i] === 0xff && cleanBuf[i + 1] === 0xe1) {
        containsApp1 = true;
        break;
      }
    }
    expect(containsApp1).toBe(false);
  });

  it('leaves clean JPEGs without EXIF untouched', () => {
    const clean = createCleanJpeg();
    const dataUrl = `data:image/jpeg;base64,${clean.toString('base64')}`;

    const result = visionDlpSanitizer.sanitizeDataUrl(dataUrl);
    expect(result.hasExifMetadata).toBe(false);
    expect(result.sanitizedDataUrl).toBe(dataUrl);
  });

  it('sanitizes multi-modal chat completions message content automatically', () => {
    const rawJpeg = createJpegWithExif();
    const dataUrl = `data:image/jpeg;base64,${rawJpeg.toString('base64')}`;

    const body = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this wellhead core sample photograph' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    };

    const sanitized = sanitizeChatRequestBody(body);
    expect(sanitized.allowed).toBe(true);
    expect(sanitized.hasRedactions).toBe(true);

    const updatedUrl = (sanitized.sanitizedBody.messages[0].content as any[])[1].image_url.url;
    expect(updatedUrl).not.toBe(dataUrl);

    // Verify sanitized image no longer has APP1
    const cleanB64 = updatedUrl.replace(/^data:image\/jpeg;base64,/, '');
    const cleanBuf = Buffer.from(cleanB64, 'base64');
    expect(cleanBuf.includes(Buffer.from([0xff, 0xe1]))).toBe(false);
  });
});
