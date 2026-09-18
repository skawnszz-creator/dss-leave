const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 주소창·폼에서 온 ID 가 UUID 모양인지.
 * 모양이 틀린 값을 그대로 DB 에 넘기면 PostgreSQL 오류가 나서 500 화면이 뜬다.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
