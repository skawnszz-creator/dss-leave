@AGENTS.md

# DSS 휴가 관리 시스템

직원이 휴가를 신청하고, 결재권자들이 순서 없이 모두 승인하면 확정되고, 모두가 이번 달 달력에서 누가 쉬는지와
내 남은 휴가를 보는 사내 휴가 대장. 엑셀(연차휴가관리대장)을 2027년 1월 1일부터 대신한다.
DSS 통합 로그인 포털(dss-auth) 뒤에 붙는 사내 시스템 중 하나다.

**이어서 작업할 때는 이 파일과 아래 문서를 먼저 읽는다.**

| 문서 | 내용 |
|---|---|
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 무엇을 만드는가 (인터뷰 결과, 휴가 규칙, 1·2차 범위, 만들지 않는 것, 미정 목록) |
| [DESIGN.md](./DESIGN.md) | 화면 흐름, 데이터 구조, 계산 방식 |
| [README.md](./README.md) | 실행 방법, 명령어 |

---

## 지금 어디까지 됐나

**2026-09-18 — 초안 화면 완성 (개발용 가짜 데이터)**
달력 · 휴가 신청 · 내 휴가(거둬들이기·날짜 변경·취소 신청) · 결재함 · 직원 관리(계정 연결·일수 조정·정정) ·
휴가 설정(근속 표·직급·공휴일) · 확인 대기 · 임시 로그인.

**2026-09-18 수정 요청 반영**
- 결재 순서 없앰: 결재권자 모두에게 동시에 가고, 순서 없이 모두 승인하면 확정. 한 명이라도 반려하면 끝.
- 달력: 주말(토·일)·공휴일·회사 휴무일을 모두 빨간날로 (토요일 파란색 → 빨간색, 칸 배경도 옅은 빨강).
- 달력: 일본 법정 휴일에 빨간 글씨 "(교산 휴무일)". 거래처 교산(京三)이 쉬는 날을 보려는 것.
- 달력: 결재 대기 칩이 천천히 깜빡인다 (Tailwind 기본 `animate-pulse`, 2초 주기).
- 내 휴가 → 「사용 내역 인쇄」(`/leave/print`): 연도별 A4 세로 한 장. 요약 + 내역 + 결재자·결재일.
  메뉴·버튼은 `no-print` 로 감춘다 (`globals.css` 의 `@media print`).

**2026-09-21 — 연차 부여 기준을 1월 1일 → 입사일로 바꿈**
사람마다 **자기 입사 기념일**에 그해 연차를 받고, 다음 기념일 전날에 사라진다. 1주년이 되는 날 곧바로
첫 연차가 나와 옛 9-2(월차가 끝나고 연차를 못 받는 기간) 문제가 없어졌다. 대신 **연차 연도가 사람마다
다르다** — 화면·인쇄물에 연도 번호와 기간을 같이 보여준다. `rules.ts` 의 `leaveYearOf`·`leaveYearWindow`
가 기준이고, 조정 기록의 `year` 도 이제 **연차 연도**를 뜻한다 (스키마는 그대로).

**2026-09-21 — 가짜 데이터를 모두 비웠다**
`dss_leave` · `dss_leave_test` 두 DB 모두 **구조만 두고 내용은 0행**이다 (직급·근속 표·공휴일 포함).
실제 명단·설정은 운영 시작 때 휴가 관리자가 화면에서 넣는다. 데모나 개발 확인이 필요하면
`npm run seed:dev` 로 가짜 데이터를 다시 넣을 수 있다 (명단이 비어 있을 때만 들어간다).

### 다음에 할 일

| | 작업 |
|---|---|
| 1 | 사용자 수정 요청 반영 |
| 2 | **입사일 기준 전환 숙제** — REQUIREMENTS 9-13: 2027-01-01에 켤 때 사람마다 잔여를 관리자 조정으로 맞춰 넣어야 한다. 9-14(취업규칙)도 대표 확인 필요 |
| 3 | dss-auth OIDC 연결 — **다른 직원이 한다.** `src/lib/auth/` 에 oidc.ts 를 넣고 dev-login.ts 를 지운다 |
| 4 | 운영 시작 전: 실제 명단·입사일·근속 표 입력, 공휴일 확인, NAS 배포 |

---

## 시작하는 방법

PostgreSQL 은 계측기 시스템과 같은 서버(`C:\Users\이남준\pgsql`, 서비스 등록 안 됨)를 쓰고
DB 만 따로다(`dss_leave`). PC 를 껐다 켰으면 둘 다 꺼져 있다.

```
"C:\Users\이남준\pgsql\bin\pg_ctl.exe" -D C:\pgdata -l C:\pgdata\server.log start
npm run dev
```

http://localhost:3300 → 임시 로그인에서 사람 고르기 (전부 가짜 이름)

---

## 이 프로젝트에서 지켜야 할 것

- **로그인을 만들지 않는다.** dss-auth 포털에 OIDC 로 위임한다. 지금은 임시 로그인
  (`src/lib/auth/dev-login.ts`, `DEV_FAKE_LOGIN_ENABLED`, 기본값 꺼짐).
- **dss-auth 의 DB 에 접근하지 않는다.** 사람은 ID 토큰의 `sub`(= `web_users.auth_sub`)로만 잇는다.
- **역할은 이 사이트가 갖는다.** `web_users.role` = MEMBER / LEAVE_ADMIN(휴가 관리자).
  결재권은 역할이 아니라 **직급**(`web_ranks.can_approve`)으로 정해진다.
- **휴가 사유는 본인과 결재권자에게만** 보인다 (`canSeeReason`). 휴가 관리자라도 결재권이 없으면 못 본다.
- **물리 삭제를 하지 않는다.** 소프트 삭제 4컬럼 고정. 중요한 행위는 `web_audit_logs` 에 남긴다.
- **결재가 끝난 휴가를 직접 고치지 않는다.** 날짜 변경·취소는 새 신청(CHANGE·CANCEL)을 만들어 다시 결재한다.
- **날짜는 'YYYY-MM-DD' 글자로 다룬다.** Date 로 바꾸면 NAS 컨테이너(UTC)에서 하루씩 밀린다. 오늘은 `todayKst()`.
- **원본 엑셀은 읽기만 한다.** `\\192.168.0.222\7_항상필요한자료\...\4. 연차관리\` — 이름·직급만 믿고 나머지 값은 틀렸다.
- **PowerShell 스크립트를 만들지 않는다.** 배치는 TypeScript + tsx.
- **마이그레이션 적용·데이터 변경·git push 는 사용자 승인 후에** 한다.

## 알아두면 좋은 것

- 계산 규칙은 전부 `src/lib/leave/rules.ts` 에 있고 DB 를 읽지 않는다. 규칙을 고치면
  `npm run test:leave` 의 예시도 함께 고친다.
- 신청·결재 흐름 검사는 **테스트 전용 DB `dss_leave_test`** 에서만 돈다. 화면용 DB(`dss_leave`)에서
  돌리지 않게 스크립트가 `DATABASE_URL` 끝을 확인한다. `.env.local` 은 화면용 DB 를 가리키므로
  **환경 변수로 덮어써서** 돌린다 (Node 는 환경 변수를 `.env.local` 보다 우선한다):

  ```bash
  TEST_URL=$(grep '^DATABASE_URL' .env.local | cut -d= -f2- | sed 's|/dss_leave$|/dss_leave_test|')
  DATABASE_URL="$TEST_URL" npm run seed:dev        # 명단이 비어 있을 때만 들어간다
  DATABASE_URL="$TEST_URL" npm run test:workflow
  ```

  한 번 돌리면 기록이 남아 **다음 실행 전에 테스트 DB 를 비워야 한다.** 구조는 두고 내용만 지운다:

  ```sql
  TRUNCATE TABLE web_audit_logs, web_approval_steps, web_leave_adjustments, web_leave_requests,
    web_sessions, web_users, web_employees, web_holidays, web_tenure_rules, web_ranks
  RESTART IDENTITY CASCADE;
  ```
- 연차 일수는 **저장하지 않고 그때그때 계산**한다 (입사일 + 근속 표 + 조정). **연차 연도는 사람마다 다르다**
  (입사 기념일 ~ 다음 기념일 전날). 그래서 근속 표를 바꾸면
  지난 해 숫자도 바뀐다. 해마다 확정(스냅샷)할지는 DESIGN.md 의 남은 문제 참고.
- 공휴일은 `seed-dev.ts` 에 2026·2027년을 넣어 두었다. 음력 날짜·대체공휴일은 **확인이 필요하다**.
  휴일을 넣거나 빼면 그날에 걸친 휴가의 일수를 다시 센다 (`recomputeDaysAround`).
- **교산 휴무일(일본 법정 휴일)은 DB 에 없다.** `src/lib/jp-holidays.ts` 가 법 규칙으로 해마다 계산한다
  (고정일·해피 먼데이·춘분/추분·대체휴일·국민의 휴일). **표시 전용**이라 한국 휴가 일수 계산에 넣지 않는다.
  일본이 법을 바꾸거나 임시 휴일을 정하면 이 파일을 고치고 `npm run test:leave` 의 연도별 목록을 늘린다.
- 포트 3300. 계측기 3200 · A/S 3000 · dss-auth 3100 과 겹치지 않게.
