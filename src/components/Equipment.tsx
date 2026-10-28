import { useLookups } from './Lookups';

/** Choose several items to bring (water, boots ...) from the equipment list. */
export function EquipmentPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const items = useLookups('equipment');
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  if (!items.length) return null;
  return (
    <div className="chips" role="group" aria-label="מה להביא">
      {items.map((l) => (
        <button key={l.id} type="button" className={value.includes(l.id) ? 'on' : ''} aria-pressed={value.includes(l.id)} onClick={() => toggle(l.id)}>
          {value.includes(l.id) ? '✓ ' : ''}{l.name_he}
        </button>
      ))}
    </div>
  );
}

/** The names of the chosen items, in list order. */
export function useEquipmentNames() {
  const all = useLookups('equipment', { includeInactive: true });
  return (ids: string[] | null | undefined) => all.filter((l) => ids?.includes(l.id)).map((l) => l.name_he);
}
