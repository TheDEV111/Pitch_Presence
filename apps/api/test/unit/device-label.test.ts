import { expect, it } from 'vitest';
import { deviceLabel } from '../../src/modules/auth/device.js';
it('recognizes overlapping browser identifiers without retaining arbitrary client text', () => {
  expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe(
    'Edge on Windows',
  );
  expect(
    deviceLabel(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/1 Safari/604.1',
    ),
  ).toBe('Safari on iOS');
  expect(deviceLabel('Mozilla/5.0 (Linux; Android 14) Firefox/130.0')).toBe('Firefox on Android');
  expect(deviceLabel('<script>unknown</script>')).toBeNull();
  expect(deviceLabel('x'.repeat(2049))).toBeNull();
  expect(deviceLabel()).toBeNull();
});
