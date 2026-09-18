# DSS 휴가 관리

사내 휴가 신청·결재와 남은 연차 확인. 자세한 내용은 [CLAUDE.md](./CLAUDE.md).

## 실행

```
"C:\Users\이남준\pgsql\bin\pg_ctl.exe" -D C:\pgdata -l C:\pgdata\server.log start   # PostgreSQL (꺼져 있으면)
npm run dev                                                                          # http://localhost:3300
```

## 명령어

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (포트 3300, 0.0.0.0) |
| `npm run build` / `npm start` | 운영 빌드 / 실행 (`output: "standalone"`) |
| `npm run typecheck` · `npm run lint` | 타입 검사 · 린트 |
| `npm run db:generate` | 스키마 변경 → 마이그레이션 SQL 생성 (생성된 SQL 은 손으로 고치지 않는다) |
| `npm run db:migrate` | 마이그레이션 적용 — **사용자 승인 후에만** |
| `npm run seed:dev` | 개발용 가짜 데이터 (명단이 비어 있을 때만, 지우지 않음) |
| `npm run test:leave` | 휴가 계산 규칙 검사 (DB 없이) |
| `npm run test:workflow` | 신청·결재 흐름 검사 — **테스트 DB(`dss_leave_test`)에서만** |

`test:workflow` 는 `DATABASE_URL` 을 테스트 DB 로 바꿔서 실행한다 (화면용 DB 면 스스로 멈춘다).

## 환경변수

`.env.example` 을 보고 `.env.local` 을 만든다. `.env.local` 은 git 에 올리지 않는다.

## NAS 배포 (준비만 되어 있음)

`Dockerfile` (멀티스테이지, node:24-alpine, 포트 3300, TZ=Asia/Seoul).
배포는 직접 하지 않고 절차를 따로 정리해 드린다.
