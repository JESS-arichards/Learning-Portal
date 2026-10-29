import { environmentSchema } from './environment.js';

const env = environmentSchema.parse(process.env);
export const config = {
  ...env,
  APPLICATIONS_PORTAL_URL: env.APPLICATIONS_PORTAL_URL.replace(/\/+$/, ''),
  production: env.NODE_ENV === 'production',
};
