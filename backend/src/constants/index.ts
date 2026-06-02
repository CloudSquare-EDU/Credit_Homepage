/** 인프라 과금 항목 프리픽스 — 구독 서비스 필터링에서 제외 */
export const INFRA_BILLING_PREFIXES = [
  'Server', 'Block Storage', 'Virtual Private Cloud', 'Public IP',
  'Network -', 'Software', 'Load Balancer', 'VPC Maintenance',
  'NAT Gateway', 'Snapshot', 'NAS', 'Rule Count',
  'Private IP', 'Inbound Data', 'Network IN', 'Network OUT',
] as const;

/** 동기화 배치 크기 */
export const SYNC_BATCH_SIZE = 10;

/** 계정 기본 이름 프리픽스 */
export const ACCOUNT_NAME_PREFIX = '교육계정_cs';

/** 계정 번호 패딩 자릿수 */
export const ACCOUNT_NUMBER_PAD = 3;

/** 누적 비용 조회 배치 크기 */
export const CUMULATIVE_COST_BATCH_SIZE = 5;
