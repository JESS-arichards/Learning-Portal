import { describe, expect, it } from 'vitest';
import { environmentSchema } from './environment.js';
import { sqlConfig } from './sqlConfig.js';

const settings = {
  PUBLIC_BASE_URL: 'https://learn.school.test', APPLICATIONS_PORTAL_URL: 'https://portal.school.test',
  PLATFORM_API_KEY: 'test-platform-key-at-least-thirty-two-characters',
  SESSION_SECRET: 'test-session-secret-at-least-thirty-two-characters',
  SQL_SERVER: 'sql.school.test', SQL_DATABASE: 'learning', SQL_USER: 'learning_user', SQL_PASSWORD: ' test-password ',
  AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net',
};
describe('credential-only infrastructure configuration', () => {
  it('disables destructive schedule reset by default and validates optional Teams settings together', () => {
    expect(environmentSchema.parse(settings).ALLOW_SCHEDULE_RESET).toBe(false);
    const teams = {
      ENTRA_TENANT_ID: '00000000-0000-4000-8000-000000000001',
      ENTRA_CLIENT_ID: '00000000-0000-4000-8000-000000000002',
      ENTRA_CLIENT_SECRET: 'test-secret',
      TEAMS_TOKEN_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(environmentSchema.safeParse({ ...settings, ...teams }).success).toBe(true);
    expect(environmentSchema.safeParse({ ...settings, ENTRA_CLIENT_ID: teams.ENTRA_CLIENT_ID }).success).toBe(false);
    expect(environmentSchema.safeParse({ ...settings, ...teams, TEAMS_TOKEN_KEY: '' }).success).toBe(true);
    expect(environmentSchema.safeParse({ ...settings, ...teams, TEAMS_TOKEN_KEY: 'invalid' }).success).toBe(false);
    expect(environmentSchema.safeParse({ ...settings, ...teams, ENTRA_TENANT_ID: 'common' }).success).toBe(false);
    expect(environmentSchema.safeParse({ ...settings, ALLOW_SCHEDULE_RESET: 'yes' }).success).toBe(false);
  });
  it('leaves normal SQL unchanged unless serverless is explicitly enabled', () => {
    const parsed = environmentSchema.parse(settings);
    expect(parsed.SQL_SERVERLESS_ENABLED).toBe(false);
    expect(sqlConfig(parsed).pool).toBeUndefined();
    expect(sqlConfig(parsed).connectionTimeout).toBeUndefined();
    for (const invalid of ['TRUE', '1', 'yes', '']) {
      expect(environmentSchema.safeParse({ ...settings, SQL_SERVERLESS_ENABLED: invalid }).success).toBe(false);
    }
  });
  it('uses zero idle minimum and 30-second idle timeout with either SQL credential format', () => {
    const parsed = environmentSchema.parse({ ...settings, SQL_SERVERLESS_ENABLED: 'true' });
    for (const value of [
      parsed,
      { ...parsed, SQL_CONNECTION_STRING: 'Server=other.test;Database=other;User ID=other;Password=test;Encrypt=false;TrustServerCertificate=true;Connection Timeout=60;Min Pool Size=5;' },
    ]) {
      expect(sqlConfig(value)).toMatchObject({
        pool: { min: 0, idleTimeoutMillis: 30000 }, connectionTimeout: 15000,
        options: { connectTimeout: 15000, maxRetriesOnTransientErrors: 0 },
      });
    }
    expect(sqlConfig({ ...parsed, SQL_CONNECTION_STRING: 'Server=other.test;Database=other;User ID=other;Password=test;Encrypt=false;TrustServerCertificate=true;' }))
      .toMatchObject({ server: 'other.test', database: 'other', user: 'other', options: { encrypt: false, trustServerCertificate: true } });
  });
  it('requires explicit SQL credentials and preserves password whitespace', () => {
    const parsed = environmentSchema.parse(settings);
    expect(sqlConfig(parsed)).toMatchObject({
      server: settings.SQL_SERVER, database: 'learning', user: 'learning_user', password: ' test-password ',
      options: { encrypt: true, trustServerCertificate: false },
    });
    expect(environmentSchema.safeParse({ ...settings, SQL_PASSWORD: '' }).success).toBe(false);
    expect(environmentSchema.safeParse({ ...settings, SQL_USER: '' }).success).toBe(false);
  });
  it('supports SQL username/password connection strings without connecting', () => {
    const parsed = environmentSchema.parse({
      ...settings, SQL_USER: '', SQL_PASSWORD: '',
      SQL_CONNECTION_STRING: 'Server=sql.school.test;Database=learning;User ID=learning_user;Password=test-password;Encrypt=true;TrustServerCertificate=false;',
    });
    expect(sqlConfig(parsed)).toMatchObject({ server: 'sql.school.test', database: 'learning', user: 'learning_user', password: 'test-password' });
  });
  it('rejects connection strings without SQL login credentials instead of using identity', () => {
    for (const SQL_CONNECTION_STRING of [
      'Server=sql.school.test;Database=learning;',
      'Server=sql.school.test;Database=learning;Authentication=Active Directory Default;',
      'Server=sql.school.test;Database=learning;User ID=learning_user;Password=test-password;Authentication=Active Directory Password;',
    ]) {
      expect(() => sqlConfig({ ...environmentSchema.parse(settings), SQL_CONNECTION_STRING })).toThrow();
    }
  });
  it('requires account-key HTTPS Blob storage even in development; no disk/account-URL fallback', () => {
    expect(environmentSchema.safeParse({ ...settings, AZURE_STORAGE_CONNECTION_STRING: '' }).success).toBe(false);
    expect(environmentSchema.safeParse({ ...settings, AZURE_STORAGE_CONNECTION_STRING: undefined, AZURE_STORAGE_ACCOUNT_URL: 'https://test.blob.core.windows.net' }).success).toBe(false);
    expect(environmentSchema.safeParse({ ...settings, AZURE_STORAGE_CONNECTION_STRING: settings.AZURE_STORAGE_CONNECTION_STRING.replace('https', 'http') }).success).toBe(false);
    expect(environmentSchema.safeParse({ ...settings, AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=testaccount;SharedAccessSignature=test' }).success).toBe(false);
  });
  it.each(['A_container', 'ab', '-invalid', 'bad--name', 'invalid-', 'x'.repeat(64)])('rejects invalid Blob container %s', (AZURE_STORAGE_CONTAINER) => {
    expect(environmentSchema.safeParse({ ...settings, AZURE_STORAGE_CONTAINER }).success).toBe(false);
  });
});
