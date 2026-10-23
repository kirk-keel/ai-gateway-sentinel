export interface VisionDlpResult {
  hasExifMetadata: boolean;
  strippedTags: string[];
  sanitizedDataUrl: string;
}

export class VisionDlpSanitizer {
  /**
   * Sanitizes a data URL (e.g. data:image/jpeg;base64,...) by stripping EXIF GPS
   * and camera metadata segments while preserving raw image pixels.
   */
  public sanitizeDataUrl(dataUrl: string): VisionDlpResult {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return { hasExifMetadata: false, strippedTags: [], sanitizedDataUrl: dataUrl };
    }

    const match = dataUrl.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/i);
    if (!match) {
      return { hasExifMetadata: false, strippedTags: [], sanitizedDataUrl: dataUrl };
    }

    const mime = match[1].toLowerCase();
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    if (mime === 'jpeg' || mime === 'jpg') {
      return this.sanitizeJpeg(buffer, dataUrl);
    } else if (mime === 'png') {
      return this.sanitizePng(buffer, dataUrl);
    }

    return { hasExifMetadata: false, strippedTags: [], sanitizedDataUrl: dataUrl };
  }

  /**
   * Strips APP1 EXIF segments (0xFFE1) from JPEG files.
   */
  public sanitizeJpeg(buffer: Buffer, originalDataUrl: string): VisionDlpResult {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      return { hasExifMetadata: false, strippedTags: [], sanitizedDataUrl: originalDataUrl };
    }

    const strippedTags: string[] = [];
    const cleanChunks: Buffer[] = [buffer.subarray(0, 2)]; // Start with SOI (0xFFD8)
    let idx = 2;
    let hasExif = false;

    while (idx < buffer.length - 1) {
      if (buffer[idx] !== 0xff) {
        break;
      }

      const marker = buffer[idx + 1];

      // End of Image (EOI) or Start of Scan (SOS)
      if (marker === 0xd9 || marker === 0xda) {
        cleanChunks.push(buffer.subarray(idx));
        break;
      }

      // Read chunk length (big endian 16-bit)
      if (idx + 3 >= buffer.length) break;
      const length = (buffer[idx + 2] << 8) | buffer[idx + 3];
      const chunkEnd = idx + 2 + length;

      if (chunkEnd > buffer.length) break;

      // APP1 Marker (EXIF / GPS / XMP)
      if (marker === 0xe1) {
        hasExif = true;
        strippedTags.push('EXIF_APP1_GPS_METADATA');
      } else if (marker === 0xfe) {
        // Comment marker
        hasExif = true;
        strippedTags.push('JPEG_COMMENT');
      } else {
        // Keep standard image segments (DQT, DHT, SOF, etc.)
        cleanChunks.push(buffer.subarray(idx, chunkEnd));
      }

      idx = chunkEnd;
    }

    if (!hasExif) {
      return { hasExifMetadata: false, strippedTags: [], sanitizedDataUrl: originalDataUrl };
    }

    const cleanBuffer = Buffer.concat(cleanChunks);
    const sanitizedDataUrl = `data:image/jpeg;base64,${cleanBuffer.toString('base64')}`;

    return {
      hasExifMetadata: true,
      strippedTags,
      sanitizedDataUrl,
    };
  }

  /**
   * Strips eXIf and metadata text chunks (tEXt, zTXt, iTXt) from PNG files.
   */
  public sanitizePng(buffer: Buffer, originalDataUrl: string): VisionDlpResult {
    const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIG)) {
      return { hasExifMetadata: false, strippedTags: [], sanitizedDataUrl: originalDataUrl };
    }

    const strippedTags: string[] = [];
    const cleanChunks: Buffer[] = [PNG_SIG];
    let idx = 8;
    let hasExif = false;

    while (idx < buffer.length - 8) {
      const length = buffer.readUInt32BE(idx);
      const type = buffer.toString('ascii', idx + 4, idx + 8);
      const chunkTotalLen = 12 + length; // 4 len + 4 type + data + 4 crc

      if (idx + chunkTotalLen > buffer.length) break;

      // Filter out metadata chunks: eXIf, tEXt, zTXt, iTXt
      if (type === 'eXIf' || type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        hasExif = true;
        strippedTags.push(`PNG_${type}_METADATA`);
      } else {
        cleanChunks.push(buffer.subarray(idx, idx + chunkTotalLen));
      }

      idx += chunkTotalLen;
    }

    if (!hasExif) {
      return { hasExifMetadata: false, strippedTags: [], sanitizedDataUrl: originalDataUrl };
    }

    const cleanBuffer = Buffer.concat(cleanChunks);
    const sanitizedDataUrl = `data:image/png;base64,${cleanBuffer.toString('base64')}`;

    return {
      hasExifMetadata: true,
      strippedTags,
      sanitizedDataUrl,
    };
  }
}

export const visionDlpSanitizer = new VisionDlpSanitizer();
