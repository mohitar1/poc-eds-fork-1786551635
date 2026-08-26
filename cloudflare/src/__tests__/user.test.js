/**
 * Unit tests for user.js sudo/simulation handling.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../util/helixutil.js', () => ({
  fetchHelixSheet: vi.fn(),
}));

const { fetchHelixSheet } = await import('../util/helixutil.js');
const { getUser, ROLE } = await import('../user.js');
const { PERMISSIONS } = await import('../../../scripts/auth/permissions.js');

function makeRequest(cookies) {
  return { cookies };
}

describe('getUser (sudo/simulation)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('strips the admin role from the simulated identity even when the email is unchanged', async () => {
    fetchHelixSheet.mockResolvedValue({
      'admin@example.com': { roles: ['admin'], countries: [] },
    });

    const session = {
      email: 'admin@example.com',
      domain: 'example.com',
      country: 'US',
      roles: ['admin'],
      permissions: [PERMISSIONS.SUDO],
    };
    const request = makeRequest({ SUDO_COUNTRY: 'italy' });

    const user = await getUser(request, {}, session);

    expect(user.country).toBe('italy');
    expect(user.roles).not.toContain(ROLE.ADMIN);
  });

  it('preserves the real roles under user.su for later restoration', async () => {
    fetchHelixSheet.mockResolvedValue({
      'admin@example.com': { roles: ['admin'], countries: [] },
    });

    const session = {
      email: 'admin@example.com',
      domain: 'example.com',
      country: 'US',
      roles: ['admin'],
      permissions: [PERMISSIONS.SUDO],
    };
    const request = makeRequest({ SUDO_COUNTRY: 'italy' });

    const user = await getUser(request, {}, session);

    expect(user.su.country).toBe('US');
    expect(user.su.roles).toContain(ROLE.ADMIN);
  });

  it('falls back to the simulated users own sheet country when no dropdown country is picked', async () => {
    fetchHelixSheet.mockResolvedValue({
      'target@example.com': { roles: [], countries: ['india'] },
    });

    const session = {
      email: 'admin@example.com',
      domain: 'example.com',
      country: 'US',
      roles: ['admin'],
      permissions: [PERMISSIONS.SUDO],
    };
    const request = makeRequest({ SUDO_EMAIL: 'target@example.com' });

    const user = await getUser(request, {}, session);

    expect(user.email).toBe('target@example.com');
    // Country must not fall back to the admin's real country.
    expect(user.country).not.toBe('US');
    // No dropdown country picked -> use the simulated user's own sheet country.
    expect(user.country).toBe('india');
    expect(user.countries).toContain('india');
    // The real admin country is still preserved for restoration.
    expect(user.su.country).toBe('US');
  });

  it('uses the dropdown SUDO_COUNTRY over the sheet country when both exist', async () => {
    fetchHelixSheet.mockResolvedValue({
      'target@example.com': { roles: [], countries: ['india'] },
    });

    const session = {
      email: 'admin@example.com',
      domain: 'example.com',
      country: 'US',
      roles: ['admin'],
      permissions: [PERMISSIONS.SUDO],
    };
    const request = makeRequest({ SUDO_EMAIL: 'target@example.com', SUDO_COUNTRY: 'Germany' });

    const user = await getUser(request, {}, session);

    expect(user.country).toBe('germany');
  });

  it('does not simulate anything when no SUDO_* cookies are set', async () => {
    const session = {
      email: 'admin@example.com',
      domain: 'example.com',
      country: 'US',
      roles: ['admin'],
      permissions: [PERMISSIONS.SUDO],
    };
    const request = makeRequest({});

    const user = await getUser(request, {}, session);

    expect(user.su).toBeUndefined();
    expect(user.roles).toContain(ROLE.ADMIN);
    expect(fetchHelixSheet).not.toHaveBeenCalled();
  });

  it('denies simulation for users without sudo permission', async () => {
    const session = {
      email: 'user@example.com',
      domain: 'example.com',
      country: 'US',
      roles: [],
      permissions: [],
    };
    const request = makeRequest({ SUDO_COUNTRY: 'italy' });

    const user = await getUser(request, {}, session);

    expect(user.country).toBe('US');
    expect(user.su).toBeUndefined();
  });
});
