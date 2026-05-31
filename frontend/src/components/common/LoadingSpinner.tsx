interface Props { size?: 'sm' | 'md' | 'lg'; }

export function LoadingSpinner({ size = 'md' }: Props) {
  return <div className={`spinner spinner-${size}`} />;
}
