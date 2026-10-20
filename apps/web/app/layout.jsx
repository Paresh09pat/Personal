import { Cormorant_Garamond, Inter } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
});
const body = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata = {
  title: 'Our Little World',
  description: 'A private little world for the two of you — messages, memories, letters and surprises.',
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdf6f4' },
    { media: '(prefers-color-scheme: dark)', color: '#160a10' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
