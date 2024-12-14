import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
import * as sagaSchema from "./schema";
const { Pool } = pkg;

export const dbPool = createPool(process.env.DATABASE_URL!);
export const db = drizzle(dbPool, {
  schema: {
    ...sagaSchema,
  },
});

function createPool(url: string) {
  return new Pool({
    connectionString: url,
    connectionTimeoutMillis: Number.parseInt(
      process.env.DATABASE_CONNECTION_TIMEOUT ?? "5000",
    ),
    idleTimeoutMillis: Number.parseInt(
      process.env.DATABASE_IDLE_CONNECTION_TIMEOUT ?? "0",
    ),
    allowExitOnIdle: true,
    max: Number.parseInt(process.env.DATABASE_MAX_CONNECTIONS ?? "10"),
    statement_timeout: Number.parseInt(
      process.env.DATABASE_STATEMENT_TIMEOUT ?? "5000",
    ),
    idle_in_transaction_session_timeout: Number.parseInt(
      process.env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT ?? "5000",
    ),
    application_name: process.env.APP_NAME ?? "saga",
  });
}
