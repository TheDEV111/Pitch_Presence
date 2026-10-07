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
  const local =
    process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_LOCAL_MEDIA === 'true';
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div className={`photo photo-fallback ${className}`} role="img" aria-label={asset.alt}>
        PitchPresence · More football. Less admin.
      </div>
    );
  return (
    <img
      className={`photo ${className}`}
      src={
        local
          ? `/media/${asset.file}-1440.webp`
          : `${asset.remote}?auto=compress&cs=tinysrgb&w=1440`
      }
      srcSet={[320, 640, 960, 1440, 1920]
        .map(
          (width) =>
            `${local ? `/media/${asset.file}-${width}.webp` : `${asset.remote}?auto=compress&cs=tinysrgb&w=${width}`} ${width}w`,
        )
        .join(', ')}
      sizes="(max-width: 767px) 100vw, (max-width: 1199px) 55vw, 700px"
      alt={asset.alt}
      width={kind === 'coach' ? 3456 : 5568}
      height={kind === 'coach' ? 5184 : 3712}
      style={{ objectPosition: kind === 'coach' ? '50% 40%' : '50% 50%' }}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      onError={() => setFailed(true)}
    />
  );
}
