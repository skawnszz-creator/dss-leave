import { defineConfig } from "drizzle-kit";

// drizzle-kit 은 Next.js 와 달리 .env.local 을 자동으로 읽지 않는다.
// Node 20.12+ 의 내장 기능을 쓴다 (추가 라이브러리 없음).
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 아직 없어도 generate 는 동작한다.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
