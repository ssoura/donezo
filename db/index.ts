import { drizzle } from 'drizzle-orm/neon-http';
import {neon} from '@neondatabase/serverless'

import * as schema from './schema'

const sql = neon(process.env.DATABASE_URL!)

// logger
const db = drizzle(sql, {logger: true, schema:schema})
// const db = drizzle(sql)

export {db}

