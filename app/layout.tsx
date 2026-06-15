import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AuthGuard from "@/components/AuthGuard";
import AppearanceProvider from "@/components/AppearanceProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ConstructIQ",
  description: "Enterprise Construction Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen bg-gray-100">
        <AppearanceProvider>
          <AuthGuard>{children}</AuthGuard>
        </AppearanceProvider>
      </body>
    </html>
  );
}
