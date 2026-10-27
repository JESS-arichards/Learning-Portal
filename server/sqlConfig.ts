import sql from 'mssql';

export function sqlConfig(settings: {
  SQL_CONNECTION_STRING?: string; SQL_SERVER?: string; SQL_DATABASE?: string;
  SQL_USER?: string; SQL_PASSWORD?: string; SQL_ENCRYPT: string; SQL_TRUST_SERVER_CERTIFICATE: string;
}): sql.config {
  const parsed: sql.config = settings.SQL_CONNECTION_STRING
    ? sql.ConnectionPool.parseConnectionString(settings.SQL_CONNECTION_STRING)
    : {
      server: settings.SQL_SERVER ?? '', database: settings.SQL_DATABASE,
      user: settings.SQL_USER, password: settings.SQL_PASSWORD,
      options: { encrypt: settings.SQL_ENCRYPT === 'true', trustServerCertificate: settings.SQL_TRUST_SERVER_CERTIFICATE === 'true' },
    };
  if (!parsed.server || !parsed.database || !parsed.user || !parsed.password
    || parsed.authentication && parsed.authentication.type !== 'default'
    || 'authentication_type' in parsed && parsed.authentication_type !== 'default') {
    throw new Error('Learning requires SQL username/password authentication with server and database specified. Managed identity and integrated authentication are not supported.');
  }
  return parsed;
}
