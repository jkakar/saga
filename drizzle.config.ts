import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["src/postgres/schema.ts"],
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
