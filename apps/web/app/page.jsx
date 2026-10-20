import Link from 'next/link';
import { BookHeart, Gift, Images, Lock, Mail, MessageCircleHeart, Video } from 'lucide-react';
import { Logo } from '@/components/Logo';

const FEATURES = [
  { icon: MessageCircleHeart, title: 'Private chat', text: 'Messages, photos, videos and voice notes only the two of you can see.' },
  { icon: Images, title: 'Shared gallery', text: 'Albums of your favourite moments, stored privately.' },
  { icon: BookHeart, title: 'Memories', text: 'A timeline of your story, milestones and anniversaries.' },
  { icon: Mail, title: 'Open-when letters', text: 'Sealed letters that unlock exactly when they are needed.' },
  { icon: Gift, title: 'Surprises', text: 'Plan surprises in secret and reveal them at the perfect moment.' },
  { icon: Video, title: 'Calls', text: 'Audio and video calls straight from your little world.' },
];

export default function Landing() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <nav className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <Link href="/login" className="rounded-full px-5 py-2.5 font-medium text-ink-soft hover:text-accent">
            Sign in
          </Link>
          <Link href="/register" className="rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink shadow-soft hover:brightness-110">
            Create account
          </Link>
        </div>
      </nav>

      <section className="py-20 text-center sm:py-28">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1.5 text-sm font-medium text-accent">
          <Lock className="h-3.5 w-3.5" /> Private by design
        </p>
        <h1 className="mx-auto max-w-3xl font-display text-6xl leading-[1.02] sm:text-8xl">
          A little world, <em className="text-accent">just for two.</em>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-ink-soft">
          Every relationship gets its own completely separate space — its own messages, memories, letters and
          surprises. Nothing ever crosses between spaces.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link href="/register" className="rounded-full bg-accent px-8 py-3.5 text-lg font-medium text-accent-ink shadow-soft hover:brightness-110">
            Begin your little world
          </Link>
          <Link href="/login" className="glass rounded-full px-8 py-3.5 text-lg font-medium">
            I have an account
          </Link>
        </div>
      </section>

      <section className="grid gap-5 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="glass rounded-3xl p-6">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Icon className="h-6 w-6" />
            </span>
            <h2 className="font-display text-2xl">{title}</h2>
            <p className="mt-1 text-ink-soft">{text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
