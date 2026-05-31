import { useMemo } from 'react';
import { useBookingStore } from '../../store/bookingStore';
import clsx from 'clsx';

interface Seat {
  id: string;
  seat_number: string;
  section: string;
  row_label: string;
  status: 'available' | 'reserved' | 'booked';
}

interface Props {
  seats: Seat[];
  onSeatSelect: (seat: Seat) => void;
}

export function SeatMap({ seats, onSeatSelect }: Props) {
  const { selectedSeatId, seatStatuses } = useBookingStore();

  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, Seat[]>>();
    for (const seat of seats) {
      if (!map.has(seat.section)) map.set(seat.section, new Map());
      const rowMap = map.get(seat.section)!;
      if (!rowMap.has(seat.row_label)) rowMap.set(seat.row_label, []);
      rowMap.get(seat.row_label)!.push(seat);
    }
    for (const rowMap of map.values()) {
      for (const [row, rowSeats] of rowMap) {
        rowMap.set(row, [...rowSeats].sort((a, b) => parseInt(a.seat_number) - parseInt(b.seat_number)));
      }
    }
    return map;
  }, [seats]);

  const stats = useMemo(() => {
    let available = 0, reserved = 0, booked = 0;
    for (const seat of seats) {
      const live = seatStatuses[seat.id] ?? seat.status;
      if (live === 'available') available++;
      else if (live === 'reserved') reserved++;
      else booked++;
    }
    return { available, reserved, booked };
  }, [seats, seatStatuses]);

  return (
    <div className="seat-map-container">
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Available', count: stats.available, color: 'var(--accent-light)' },
          { label: 'Reserved', count: stats.reserved, color: 'var(--warning)' },
          { label: 'Booked', count: stats.booked, color: 'var(--text-faint)' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: s.color, flexShrink: 0,
            }} />
            <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
            <span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
          </div>
        ))}
      </div>

      <div className="stage-block">
        <span className="stage-label">◀ Stage ▶</span>
      </div>

      {[...grouped.entries()].map(([section, rowMap]) => (
        <div key={section} className="seat-section">
          <div className="seat-section-label">{section}</div>
          {[...rowMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([row, rowSeats]) => (
            <div key={row} className="seat-row">
              <span className="row-lbl">{row}</span>
              <div className="seats-row">
                {rowSeats.map(seat => {
                  const liveStatus = seatStatuses[seat.id] ?? seat.status;
                  const isSelected = selectedSeatId === seat.id;
                  const isAvailable = liveStatus === 'available';

                  return (
                    <button
                      key={seat.id}
                      className={clsx('seat-btn', {
                        available: liveStatus === 'available' && !isSelected,
                        selected: isSelected,
                        reserved: liveStatus === 'reserved',
                        booked: liveStatus === 'booked',
                      })}
                      disabled={!isAvailable}
                      onClick={() => isAvailable && onSeatSelect(seat)}
                      title={`${section} · Row ${row} · Seat ${seat.seat_number} · ${liveStatus}`}
                      aria-label={`Seat ${seat.seat_number}, row ${row}, ${section}, ${liveStatus}`}
                      aria-pressed={isSelected}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="seat-legend">
        {[
          { cls: 'available', label: 'Available' },
          { cls: 'selected',  label: 'Selected' },
          { cls: 'reserved',  label: 'Reserved (10 min hold)' },
          { cls: 'booked',    label: 'Booked' },
        ].map(({ cls, label }) => (
          <div key={cls} className="legend-item">
            <div className={`legend-dot ${cls}`} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
