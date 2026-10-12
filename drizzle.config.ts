import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Load the same files the app does, so `npm run db:push` works whether your
// connection string lives in .env or .env.local (Next.js prefers .env.local).
dotenv.config();
dotenv.config({ path: ".env.local", override: true, quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
