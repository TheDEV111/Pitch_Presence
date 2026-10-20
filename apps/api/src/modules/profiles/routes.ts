import { footballFields, teamProfileFields, photoUpload } from '@pitchpresence/shared';
import { empty, type Router } from '../../plugins/router.js';
import { ProfileService } from './service.js';
export function profileRoutes(r: Router) {
  const service = new ProfileService(r.db);
  r.add('GET', '/api/v1/me/player-profile', empty, (_, c) => service.read(c.user, c.user.id), {
    access: 'PLAYER',
  });
  r.add(
    'PATCH',
    '/api/v1/me/player-profile',
    footballFields,
    (i, c) => service.save(c.user, i, c.request.id),
    { access: 'PLAYER' },
  );
  r.add(
    'PUT',
    '/api/v1/me/player-profile/photo',
    photoUpload,
    (i, c) => service.photo(c.user, i, c.request.id),
    { access: 'PLAYER', bodyLimit: 2_850_000 },
  );
  r.add(
    'DELETE',
    '/api/v1/me/player-profile/photo',
    empty,
    (_, c) => service.photo(c.user, null, c.request.id),
    { access: 'PLAYER' },
  );
  r.add('GET', '/api/v1/management/players/:id/profile', empty, (_, c) =>
    service.read(c.user, c.params.id!),
  );
  r.add('PATCH', '/api/v1/management/players/:id/profile', teamProfileFields, (i, c) =>
    service.saveTeam(c.user, c.params.id!, i, c.request.id),
  );
  r.add(
    'GET',
    '/api/v1/players/:id/photo',
    empty,
    async (_, c) =>
      c.reply
        .header('Cache-Control', 'private, no-store')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .type('image/webp')
        .send(await service.image(c.user, c.params.id!)),
    { access: 'authenticated', binary: true },
  );
}
