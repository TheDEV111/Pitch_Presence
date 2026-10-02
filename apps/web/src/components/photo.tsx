'use client';
import { useState } from 'react';
import { media } from '@/lib/media';
export function Photo({
  kind = 'training',
  eager = false,
  className = '',
}: {
  kind?: keyof typeof media;
  eager?: boolean;
  className?: string;
}) {
  const asset = media[kind];
  const [local, setLocal] = useState(process.env.NEXT_PUBLIC_LOCAL_MEDIA === 'true');
  return (
    <img
      className={`photo ${className}`}
      src={
        local
          ? `/media/${asset.file}-1440.webp`
          : `${asset.remote}?auto=compress&cs=tinysrgb&w=1440`
      }
      srcSet={[640, 960, 1440, 1920]
        .map(
          (width) =>
            `${local ? `/media/${asset.file}-${width}.webp` : `${asset.remote}?auto=compress&cs=tinysrgb&w=${width}`} ${width}w`,
        )
        .join(', ')}
      sizes="(max-width: 767px) 100vw, (max-width: 1199px) 55vw, 700px"
      alt={asset.alt}
      width={1440}
      height={960}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      onError={() => {
        if (local) setLocal(false);
      }}
    />
  );
}
