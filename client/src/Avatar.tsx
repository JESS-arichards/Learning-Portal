import { useState } from 'react';
import type { User } from '../../shared/learning';
import { AuthenticatedImage } from './AuthenticatedResource';

export function Avatar({ user }: { user: User }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = user.hasAvatar ? `/api/me/avatar?v=${encodeURIComponent(user.avatarVersion ?? '')}` : null;
  const parts = user.displayName.trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
  return <span className="jess-nav-avatar">
    {src && failed !== src ? <AuthenticatedImage src={src} alt="" onError={() => {
      console.warn('Unable to load the central Portal avatar.');
      setFailed(src);
    }} /> : <span aria-hidden="true">{initials}</span>}
  </span>;
}
