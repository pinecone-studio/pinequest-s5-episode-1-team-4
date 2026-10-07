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

// Явах зам ихэвчлэн кадрын доод, голын хэсэгт харагдана.
const PATH = { left: 0.15, top: 0.45, width: 0.7 };

/**
 * Алхах горимд: бүтэн кадр + явах замын томруулсан зураг. Тоосго, мод зэрэг жижиг
 * саад бүтэн кадрыг жижигрүүлэхэд хэдхэн пиксел болдог.
 */
export async function walkingViews(input: Image, maxSide: number): Promise<{ full: Image; path?: Image }> {
  try {
    const { data, info } = await sharp(input.image).rotate().toBuffer({ resolveWithObject: true });
    const top = Math.round(info.height * PATH.top);
    const region = { left: Math.round(info.width * PATH.left), top, width: Math.round(info.width * PATH.width), height: info.height - top };
    const pathImage = new Uint8Array(await sharp(data).extract(region).toBuffer());
    const [full, path] = await Promise.all([
      shrinkImage({ ...input, image: data }, maxSide, 70),
      shrinkImage({ ...input, image: pathImage }, maxSide, 70),
    ]);
    return { full, path };
  } catch {
    return { full: input };
  }
}
