import sharp from 'sharp';

export type Image = { image: Uint8Array; mediaType: string };

/** Илгээхэд хурдан хэмжээ рүү жижигрүүлнэ. Уншиж чадахгүй зураг бол эхний хэвээр нь буцаана. */
export async function shrinkImage(input: Image, maxSide: number, quality: number): Promise<Image> {
  try {
    const output = await sharp(input.image)
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    return { image: new Uint8Array(output), mediaType: 'image/jpeg' };
  } catch {
    return input;
  }
}
