import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Daybar', description: 'A little more room in your day.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
