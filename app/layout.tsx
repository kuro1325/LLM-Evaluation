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
  description: "在统一业务规则与人工检查点下，为办公、法律和英语教育场景选择更适配的大模型。",
  openGraph: {
    title: "LLM Evaluation",
    description: "在同一业务任务下，对比两个大模型的质量、效率、成本与风险。",
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
