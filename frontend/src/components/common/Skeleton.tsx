interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ width, height = 16, borderRadius, style }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius, ...style }}
    />
  );
}

export function EventCardSkeleton() {
  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <Skeleton width={60} height={22} borderRadius="999px" />
      </div>
      <Skeleton height={22} style={{ marginBottom: 8, width: '75%' }} />
      <Skeleton height={14} style={{ marginBottom: 4 }} />
      <Skeleton height={14} style={{ marginBottom: 20, width: '60%' }} />
      <Skeleton height={12} style={{ marginBottom: 8, width: '50%' }} />
      <Skeleton height={12} style={{ marginBottom: 8, width: '65%' }} />
      <Skeleton height={12} style={{ marginBottom: 20, width: '45%' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <Skeleton width={60} height={20} />
        <Skeleton width={110} height={36} borderRadius="var(--r-sm)" />
      </div>
    </div>
  );
}
