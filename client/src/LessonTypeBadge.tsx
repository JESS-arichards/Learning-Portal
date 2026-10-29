import { BookOpen, Calculator, FlaskConical, Globe, Monitor, Music, Palette, Pencil, Star, Users, Video } from 'lucide-react';
import type { LessonType } from '../../shared/learning';

export const LESSON_TYPE_ICON_OPTIONS = {
  book: { label: 'Book', Icon: BookOpen },
  video: { label: 'Video', Icon: Video },
  pencil: { label: 'Pencil', Icon: Pencil },
  flask: { label: 'Science', Icon: FlaskConical },
  calculator: { label: 'Calculator', Icon: Calculator },
  palette: { label: 'Art', Icon: Palette },
  music: { label: 'Music', Icon: Music },
  globe: { label: 'Globe', Icon: Globe },
  monitor: { label: 'Computer', Icon: Monitor },
  users: { label: 'Group', Icon: Users },
  star: { label: 'Star', Icon: Star },
};

export function LessonTypeBadge({ type }: { type?: LessonType }) {
  if (!type) return null;
  const Icon = type.icon ? LESSON_TYPE_ICON_OPTIONS[type.icon].Icon : null;
  return <span className="lesson-type-badge" style={{ color: type.colour, backgroundColor: `${type.colour}26` }}>
    {Icon && <Icon size={14} aria-hidden="true" />}<span>{type.name}</span>
  </span>;
}
