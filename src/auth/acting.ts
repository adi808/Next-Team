import { useParams } from 'react-router-dom';
import type { EntityRole, Mode } from '../lib/types';

const MODE_ROLE: Record<Mode, EntityRole> = {
  sysadmin: 'system_admin', admin: 'club_admin', coach: 'coach', parent: 'parent', player: 'player',
};

/** The role the current mode acts as. One account can hold several roles; each mode shows only its own rights. */
export function useActingRole(): EntityRole | undefined {
  const { mode } = useParams();
  return MODE_ROLE[mode as Mode];
}
