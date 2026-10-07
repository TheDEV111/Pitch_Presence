import { resolve } from 'node:path';

// Keep node-postgres certificate and hostname verification enabled. A URI's
// SSL parameters override a separate Client.ssl object, so configure the URI.
export function postgresConnectionUrl(connectionString, rootCertificate) {
  const url = new URL(connectionString);
  if (rootCertificate) {
    url.searchParams.set('sslrootcert', resolve(rootCertificate));
    url.searchParams.set('sslmode', 'verify-full');
  } else if (['require', 'verify-ca'].includes(url.searchParams.get('sslmode'))) {
    // Preserve this installed driver's existing verification behavior explicitly.
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}
