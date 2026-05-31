import { Zap } from 'lucide-react';

interface Props { basePrice: number; currentPrice: number; }

export function SurgeBadge({ basePrice, currentPrice }: Props) {
  const isSurge = currentPrice > basePrice;
  const multiplier = (currentPrice / basePrice).toFixed(1);

  if (!isSurge) {
    return <span className="price-base">${currentPrice.toFixed(2)}</span>;
  }

  return (
    <span className="price-surge">
      <Zap size={13} />
      ${currentPrice.toFixed(2)}
      <span className="surge-tag">{multiplier}×</span>
    </span>
  );
}
