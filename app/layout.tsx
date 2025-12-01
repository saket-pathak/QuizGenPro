import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css"; // <--- This is CRITICAL. It loads your styles.

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "QuizGenPro",
  description: "AI-Powered Quiz Generator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning={true}>{children}</body>
    </html>
  );
}
