import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://kuro1325.github.io/LLM-Evaluation"),
  title: "LLM Evaluation · 大模型评测工作台",
  description: "面向产品经理与项目经理的轻量级大模型业务适配评测工具",
  openGraph: {
    title: "LLM Evaluation",
    description: "在同一业务任务下，对比两个大模型的质量、效率与成本。",
    images: ["/LLM-Evaluation/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
