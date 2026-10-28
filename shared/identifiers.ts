import { z } from 'zod';

// SQL uniqueidentifier values and browser-generated UUIDs can differ in casing.
export const uuidSchema = z.string().uuid().toLowerCase();
