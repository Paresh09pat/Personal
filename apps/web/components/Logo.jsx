import Link from 'next/link';
import { Heart } from 'lucide-react';

export function Logo({ href = '/', size = 'md' }) {
  const text = size === 'lg' ? 'text-4xl' : 'text-2xl';
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-ink">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-ink shadow-soft">
        <Heart className="h-4.5 w-4.5 fill-current" aria-hidden />
      </span>
      <span className={`font-display ${text} font-semibold italic tracking-tight`}>Our Little World</span>
    </Link>
  );
}
