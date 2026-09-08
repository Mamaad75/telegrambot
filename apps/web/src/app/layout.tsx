import type { Metadata, Viewport } from 'next';
import { SessionProvider } from '@/lib/session';
import { ThemeProvider } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'بایمر — هوشمندی سرنخ و بازار',
  description:
    'پلتفرم داخلی بایمر برای کشف کسب‌وکارهای هدف، تحلیل حضور دیجیتال آن‌ها، و آماده‌سازی تیم فروش پیش از اولین تماس.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0d' },
  ],
};

/**
 * The document is RTL and Persian by default. The theme class is applied before paint by
 * an inline script so a dark-mode user never sees a white flash on first load.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('baimar.theme')||'dark';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
