import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PCMC GIS Explorer | 2D & 3D Electoral Ward Visualizer',
  description:
    'Interactive 2D & 3D GIS visualization of Pimpri-Chinchwad Municipal Corporation (PCMC) electoral ward boundaries with metric extrusion, zone analytics, and topological audits.',
  keywords: [
    'PCMC',
    'Pimpri-Chinchwad',
    'GIS',
    'deck.gl',
    'MapLibre',
    '3D Extruded Map',
    'Electoral Wards',
    'GeoPandas',
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
