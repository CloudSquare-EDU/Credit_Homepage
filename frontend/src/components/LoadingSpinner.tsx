export default function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };

  return (
    <div className="flex flex-col items-center justify-center p-12 gap-3">
      <div
        className={`${sizeClasses[size]} animate-spin rounded-full border-2 border-gray-200 border-t-ncp-primary`}
      />
      {size !== 'sm' && (
        <p className="text-sm text-gray-400">불러오는 중...</p>
      )}
    </div>
  );
}
