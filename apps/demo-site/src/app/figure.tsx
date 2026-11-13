import Image from 'next/image';
import type { PublicAsset, PublicVideo } from '../types/cms';

/**
 * An image with the file's caption and credit under it (spec §5.2, §7.2: both are additive fields
 * of format 1, absent in a bundle written before they were delivered). The alt text is the use's.
 */
export function Figure({ image }: { image: PublicAsset }) {
  const caption = image.caption ?? null;
  const credit = image.credit ?? null;
  return (
    <figure>
      <Image src={image.url} alt={image.alt} width={image.width} height={image.height} />
      {caption !== null || credit !== null ? (
        <figcaption>
          {caption}
          {credit !== null ? <small> {credit}</small> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A video field's value: a link to the video on its provider, with its still image. */
export function VideoLink({ video }: { video: PublicVideo }) {
  return (
    <section>
      <a href={video.url}>{video.title}</a>
      {video.still ? <Figure image={video.still} /> : null}
    </section>
  );
}
