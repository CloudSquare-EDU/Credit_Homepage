interface StatusBadgeProps {
  status: string;
  type?: 'course' | 'cleanup' | 'default';
}

export default function StatusBadge({ status, type = 'default' }: StatusBadgeProps) {
  let colorClasses = 'bg-gray-100 text-gray-600';
  let label = status;
  let dot = 'bg-gray-400';

  if (type === 'course') {
    switch (status) {
      case 'DRAFT':
        colorClasses = 'bg-gray-100 text-gray-600';
        dot = 'bg-gray-400';
        label = '초안';
        break;
      case 'ACTIVE':
        colorClasses = 'bg-blue-50 text-blue-700';
        dot = 'bg-blue-500';
        label = '진행중';
        break;
      case 'COMPLETED':
        colorClasses = 'bg-emerald-50 text-emerald-700';
        dot = 'bg-emerald-500';
        label = '완료';
        break;
      case 'ARCHIVED':
        colorClasses = 'bg-amber-50 text-amber-700';
        dot = 'bg-amber-400';
        label = '보관';
        break;
    }
  } else if (type === 'cleanup') {
    switch (status) {
      case 'PENDING':
        colorClasses = 'bg-amber-50 text-amber-700';
        dot = 'bg-amber-400';
        label = '대기중';
        break;
      case 'RUNNING':
        colorClasses = 'bg-blue-50 text-blue-700';
        dot = 'bg-blue-500';
        label = '실행중';
        break;
      case 'COMPLETED':
        colorClasses = 'bg-emerald-50 text-emerald-700';
        dot = 'bg-emerald-500';
        label = '완료';
        break;
      case 'FAILED':
        colorClasses = 'bg-red-50 text-red-700';
        dot = 'bg-red-500';
        label = '실패';
        break;
      case 'CANCELLED':
        colorClasses = 'bg-gray-100 text-gray-600';
        dot = 'bg-gray-400';
        label = '취소됨';
        break;
    }
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClasses}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {label}
    </span>
  );
}
