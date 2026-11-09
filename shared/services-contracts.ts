import {defineRpc} from '@getpaseo/plugin';
import {z} from 'zod';
export const row=z.object({id:z.string(),name:z.string(),description:z.string(),kind:z.enum(['Постоянная','По расписанию']),lastRun:z.string().nullable(),status:z.string()});
export const read=defineRpc({name:'services.read',input:z.object({}),output:z.object({rows:z.array(row)})});
export type ServiceRow=z.infer<typeof row>;
