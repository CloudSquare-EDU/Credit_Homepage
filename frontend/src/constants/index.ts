/** 인프라 과금 항목 프리픽스 — 구독 서비스 필터링에서 제외 */
export const INFRA_BILLING_PREFIXES = [
  'Server', 'Block Storage', 'Virtual Private Cloud', 'Public IP',
  'Network -', 'Software', 'Load Balancer', 'VPC Maintenance',
  'NAT Gateway', 'Snapshot', 'NAS', 'Rule Count',
  'Private IP', 'Inbound Data', 'Network IN', 'Network OUT',
] as const;

/** 서브계정 비밀번호 최소 길이 */
export const PASSWORD_MIN_LENGTH = 8;

/** 과정 목록 기본 페이지 크기 */
export const DEFAULT_PAGE_LIMIT = 20;

/** 계정 기본 이름 프리픽스 */
export const ACCOUNT_NAME_PREFIX = '교육계정_cs';
